// C5 review: importApply needs the fresh master password, and the cached import text never
// outlives its session (lock, expiry, idle lock, password change, new session, changed key
// generation). Synthetic secrets only; real PBKDF2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { DEFAULT_SETTINGS } from "../src/lib/settings.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "correct horse battery staple", PW2 = "a completely different passphrase";
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snap = (area) => JSON.stringify([...area.map]);
const TEXT = JSON.stringify({ otp_list: [{ name: "A", key: syntheticSecret(1) }, { name: "", key: syntheticSecret(2) }] });

async function ready() {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  const make = (session = env.session) => createService({ session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.svc = make();
  env.make = make;
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  ok(await env.call("setup", { password: PW, confirm: PW }));
  env.p = ok(await env.call("importPreview", { text: TEXT }));
  assert.equal(env.svc.hasPendingImport(), true);
  return env;
}
const apply = (env, extra = {}) => env.call("importApply",
  { revision: env.p.revision, fileHash: env.p.fileHash, names: { 1: "Ohne Namen 1" }, masterPassword: PW, ...extra });

test("apply needs the fresh master password: missing or wrong password writes nothing, the preview stays usable", async () => {
  const env = await ready();
  const before = snap(env.local);
  for (const masterPassword of [undefined, "", "wrong password, long enough", PW2]) {
    assert.equal(err(await apply(env, { masterPassword })), "invalid:current-password");
    assert.equal(snap(env.local), before, "nothing written");
    assert.equal(env.svc.hasPendingImport(), true, "a fixable input error keeps the preview");
  }
  const r = ok(await apply(env));
  assert.deepEqual([r.imported, r.locked], [2, false]);
  assert.equal(env.svc.hasPendingImport(), false, "dropped after the apply");
});

test("session expired before the apply: locked, nothing written, cache dropped", async () => {
  const env = await ready();
  const before = snap(env.local);
  env.clk.advance(16 * 60_000);
  assert.match(err(await apply(env)), /^locked/);
  assert.equal(snap(env.local), before);
  assert.equal(env.svc.hasPendingImport(), false);
});

test("session expires while the master password is being verified: locked, nothing written, cache dropped", async () => {
  const env = await ready();
  const before = snap(env.local);
  const get = env.local.get.bind(env.local);
  let armed = true;
  env.local.get = async (k) => { if (armed) { armed = false; env.clk.advance(16 * 60_000); } return get(k); }; // during authorizeSensitive
  assert.match(err(await apply(env)), /^locked/);
  env.local.get = get;
  assert.equal(snap(env.local), before);
  assert.equal(env.svc.hasPendingImport(), false);
});

test("concurrent write while the apply verifies the password: conflict, nothing imported, cache dropped", async () => {
  const env = await ready();
  const other = env.make(); // second instance on the same storage and session
  const running = apply(env);
  ok(await other.handle({ cmd: "addAccount", revision: env.p.revision, account: { name: "Concurrent", secret: syntheticSecret(3) } }));
  assert.equal(err(await running), "conflict");
  ok(await env.call("unlock", { password: PW }));
  assert.deepEqual(ok(await env.call("listAccounts")).accounts.map((a) => a.name), ["Concurrent"]);
  assert.equal(env.svc.hasPendingImport(), false);
});

test("changed file or revision: conflict and the stale preview is dropped", async () => {
  const env = await ready();
  assert.equal(err(await apply(env, { fileHash: "f".repeat(64) })), "conflict");
  assert.equal(env.svc.hasPendingImport(), false);
  env.p = ok(await env.call("importPreview", { text: TEXT }));
  assert.equal(err(await apply(env, { revision: env.p.revision + 1 })), "conflict");
  assert.equal(env.svc.hasPendingImport(), false);
  assert.equal(ok(await env.call("listAccounts")).accounts.length, 0);
});

// Every way a session ends must drop the cached text, and the old preview must stay unusable.
const ENDINGS = [
  ["explicit lock", async (env) => ok(await env.call("lock"))],
  ["expiry handled by the auto-lock alarm", async (env) => { env.clk.advance(16 * 60_000); await env.svc.onAlarm(); }],
  ["expiry noticed by the gate", async (env) => { env.clk.advance(16 * 60_000); err(await env.call("getCodes")); }],
  ["system idle lock", async (env) => {
    await env.local.set({ settings: { ...DEFAULT_SETTINGS, idleLock: true } });
    await env.svc.onIdleState("idle");
  }],
  ["password change", async (env) => ok(await env.call("changePassword", { current: PW, next: PW2, confirm: PW2 }))],
  ["new session (unlock again)", async (env) => ok(await env.call("unlock", { password: PW }))],
  ["key generation changed elsewhere", async (env) => {
    const other = env.make(fakeArea());
    ok(await other.handle({ cmd: "unlock", password: PW }));
    ok(await other.handle({ cmd: "changePassword", current: PW, next: PW2, confirm: PW2 }));
    err(await env.call("listAccounts")); // this instance notices the new generation and locks
  }],
];
for (const [label, end] of ENDINGS) {
  test(`import cache dropped on ${label}; the old preview cannot be reused`, async () => {
    const env = await ready();
    await end(env);
    assert.equal(env.svc.hasPendingImport(), false, "cache dropped");
    const pw = label.includes("password") || label.includes("generation") ? PW2 : PW;
    if (!ok(await env.call("status")).unlocked) ok(await env.call("unlock", { password: pw }));
    const before = snap(env.local);
    assert.equal(err(await apply(env, { masterPassword: pw })), "conflict");
    assert.equal(snap(env.local), before, "nothing written");
  });
}

test("a lock during the preview caches nothing", async () => {
  const env = await ready();
  ok(await env.call("importCancel"));
  const get = env.session.get.bind(env.session);
  let calls = 0, locked = null;
  env.session.get = async (k) => { if (++calls === 2 && !locked) locked = env.call("lock"); return get(k); }; // the preview's recheck
  assert.match(err(await env.call("importPreview", { text: TEXT })), /^locked/);
  env.session.get = get;
  await locked;
  assert.equal(env.svc.hasPendingImport(), false);
});

test("the cache hook is not reachable through messages", async () => {
  const env = await ready();
  assert.equal(err(await env.call("hasPendingImport")), "invalid:cmd");
});
