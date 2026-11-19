// C3 session security: auto-lock settings on the running session, activity boundaries,
// event-page restarts, stale session IDs, fresh password verification for sensitive
// operations (authorizeSensitive), optional system-idle lock and recovery boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { newSession, touch, checkSession } from "../src/lib/session-policy.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const MIN = 60_000;
const PW = "correct horse battery staple", PW2 = "a completely different passphrase";
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snapshot = (area) => JSON.stringify([...area.map].filter(([k]) => k.startsWith("vault")));

// Test-only PBKDF2 counter (no production hook).
const subtle = globalThis.crypto.subtle, realDerive = subtle.deriveKey.bind(subtle);
let derivations = 0;
subtle.deriveKey = (alg, ...rest) => { if (alg?.name === "PBKDF2") derivations++; return realDerive(alg, ...rest); };

async function ready({ minutes } = {}) {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.make = () => createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.svc = env.make();
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  env.settings = (s) => env.local.set({ settings: s });
  env.sess = async () => (await env.session.get("session")).session;
  if (minutes) await env.settings({ autoLockMinutes: minutes });
  ok(await env.call("setup", { password: PW, confirm: PW }));
  ({ revision: env.revision } = ok(await env.call("addAccount", { revision: 1, account: { name: "A", secret: syntheticSecret(1) } })));
  return env;
}

test("touch: a new timeout applies from this activity; validity uses the old values", () => {
  const s = newSession({}, 1000, 10 * MIN);
  const t = touch(s, 2000, 5 * MIN);
  assert.deepEqual([t.timeoutMs, t.lastActivity, t.deadline], [5 * MIN, 2000, 2000 + 5 * MIN]);
  assert.equal(checkSession(t, 2000), "ok");
  assert.equal(touch(s, 1000 + 10 * MIN, 60 * MIN), null, "expired stays expired, whatever the new timeout");
  assert.equal(touch(s, 2000, 0), null);
  assert.equal(touch(s, 2000, NaN), null);
  assert.equal(touch(s, 2000).timeoutMs, 10 * MIN, "default keeps the session's timeout");
});

test("C3.1 default 15 minutes; activity extends, code refreshes do not", async () => {
  const env = await ready();
  const s0 = await env.sess();
  assert.equal(s0.timeoutMs, 15 * MIN);
  env.clk.advance(10 * MIN);
  ok(await env.call("getCodes")); // TOTP refresh
  ok(await env.call("listAccounts"));
  assert.equal((await env.sess()).deadline, s0.deadline, "reads never move the deadline");
  ok(await env.call("activity"));
  assert.equal((await env.sess()).deadline, env.clk.now() + 15 * MIN);
});

test("C3.1 a shorter auto-lock setting applies to the running session at once", async () => {
  const env = await ready();
  env.clk.advance(3 * MIN);
  await env.settings({ autoLockMinutes: 5 });
  await env.svc.onSettingsChanged();
  const s = await env.sess();
  assert.deepEqual([s.timeoutMs, s.deadline], [5 * MIN, s.lastActivity + 5 * MIN]);
  assert.equal(env.alarms.alarms.get("autolock").when, s.deadline);
  env.clk.advance(2 * MIN);
  assert.equal(err(await env.call("getCodes")), "locked:expired");
});

test("C3.1 a shorter setting that is already exceeded locks immediately", async () => {
  const env = await ready();
  env.clk.advance(6 * MIN);
  await env.settings({ autoLockMinutes: 5 });
  await env.svc.onSettingsChanged();
  assert.equal(await env.sess(), undefined);
  assert.equal(err(await env.call("getCodes")), "locked:none");
});

test("C3.1 a longer setting never extends a session without activity", async () => {
  const env = await ready({ minutes: 5 });
  const before = await env.sess();
  await env.settings({ autoLockMinutes: 60 });
  await env.svc.onSettingsChanged();
  assert.deepEqual(await env.sess(), before);
  env.clk.advance(5 * MIN);
  assert.equal(err(await env.call("getCodes")), "locked:expired", "old deadline still holds");
});

test("C3.1 a longer setting applies from the next real activity", async () => {
  const env = await ready({ minutes: 5 });
  await env.settings({ autoLockMinutes: 60 });
  env.clk.advance(4 * MIN);
  ok(await env.call("activity"));
  assert.equal((await env.sess()).deadline, env.clk.now() + 60 * MIN);
});

test("C3.1 settings writes and activity cannot revive an expired session", async () => {
  const env = await ready({ minutes: 5 });
  env.clk.advance(5 * MIN);
  await env.settings({ autoLockMinutes: 240 });
  await env.svc.onSettingsChanged();
  assert.equal(await env.sess(), undefined, "expired session wiped on settings change");
  assert.match(err(await env.call("activity")), /^locked/);
});

test("C3.1 expiry holds across event-page restarts; a backwards clock locks the new instance", async () => {
  const env = await ready({ minutes: 5 });
  env.svc = env.make();
  ok(await env.call("getCodes"));
  env.clk.advance(5 * MIN);
  env.svc = env.make();
  assert.equal(err(await env.call("getCodes")), "locked:expired");
  const e2 = await ready();
  e2.svc = e2.make();
  e2.clk.advance(-1);
  assert.equal(err(await e2.call("getCodes")), "locked:clock");
});

test("C3.1 expiry during an asynchronous operation rejects its result", async () => {
  const env = await ready({ minutes: 5 });
  env.clk.advance(5 * MIN - 1);
  // The deadline passes only after the gate admitted the operation: on its vault read.
  const get = env.local.get.bind(env.local);
  let passed = false;
  env.local.get = async (k) => { if (!passed && [k].flat().includes("vault")) { passed = true; env.clk.advance(1); } return get(k); };
  assert.match(err(await env.call("getCodes")), /^locked/);
  assert.equal(passed, true);
  assert.equal(await env.sess(), undefined);
});

test("C3.1 stale session ID: a re-unlock during an operation rejects the old operation", async () => {
  const env = await ready();
  const pending = env.call("getCodes");
  const relock = (async () => { await env.call("lock"); return env.call("unlock", { password: PW }); })();
  assert.match(err(await pending), /^locked/);
  ok(await relock);
  ok(await env.call("getCodes"), "the new session works");
});

test("C3.3 authorizeSensitive: fresh PBKDF2 against the current vault; session unaffected", async () => {
  const env = await ready();
  const before = await env.sess(), d0 = derivations;
  const r = await env.svc.authorizeSensitive(PW);
  assert.equal(derivations - d0, 1, "one fresh derivation");
  assert.equal(r.revision, env.revision);
  assert.equal(r.payload.accounts[0].secret, syntheticSecret(1)); // internal only, never a message
  assert.deepEqual(await env.sess(), before, "verification is not user activity and does not unlock anything new");
});

test("C3.3 authorizeSensitive: a wrong or missing password fails without writing or locking", async () => {
  const env = await ready();
  const vault = snapshot(env.local), d0 = derivations;
  for (const bad of ["definitely not the right password", PW.normalize("NFD") + "x", "", undefined, 42]) {
    await assert.rejects(env.svc.authorizeSensitive(bad), (e) => e.reason === "current-password");
  }
  assert.equal(derivations - d0, 2, "only non-empty strings reach PBKDF2");
  assert.equal(snapshot(env.local), vault);
  ok(await env.call("getCodes"));
});

test("C3.3 authorizeSensitive: an unlocked session key alone is never enough", async () => {
  const env = await ready();
  const { key } = await env.sess();
  // The session's own key, offered in place of a password, is rejected before any crypto.
  await assert.rejects(env.svc.authorizeSensitive(key), (e) => e.reason === "current-password");
  // Not reachable through the message boundary at all.
  assert.equal(err(await env.call("authorizeSensitive", { password: PW })), "invalid:cmd");
});

test("C3.3 authorizeSensitive: locked or expired session fails before PBKDF2", async () => {
  const env = await ready({ minutes: 5 });
  ok(await env.call("lock"));
  let d0 = derivations;
  await assert.rejects(env.svc.authorizeSensitive(PW), (e) => e.code === "locked");
  ok(await env.call("unlock", { password: PW }));
  env.clk.advance(5 * MIN);
  d0 = derivations;
  await assert.rejects(env.svc.authorizeSensitive(PW), (e) => e.code === "locked");
  assert.equal(derivations - d0, 0);
});

test("C3.3 authorizeSensitive: lock during PBKDF2 aborts; stale generation locks", async () => {
  const env = await ready();
  const pending = env.svc.authorizeSensitive(PW);
  await env.call("lock");
  await assert.rejects(pending, (e) => e.code === "locked");
  // Session of an older key generation (password changed by another instance).
  const e2 = await ready();
  const stale = await e2.sess();
  ok(await e2.call("changePassword", { current: PW, next: PW2, confirm: PW2 }));
  await e2.session.set({ session: stale });
  await assert.rejects(e2.svc.authorizeSensitive(PW2), (e) => e.reason === "generation");
  assert.equal(await e2.sess(), undefined);
});

test("C3.3 password change keeps requiring the current password", async () => {
  const env = await ready();
  const vault = snapshot(env.local);
  assert.equal(err(await env.call("changePassword", { next: PW2, confirm: PW2 })), "invalid:password");
  assert.equal(snapshot(env.local), vault);
});

test("C3.4 idle lock: only when enabled, only on idle/locked states", async () => {
  const env = await ready();
  await env.svc.onIdleState("idle");
  assert.ok(await env.sess(), "disabled by default");
  await env.settings({ idleLock: true, idleLockMinutes: 5 });
  await env.svc.onIdleState("active");
  assert.ok(await env.sess());
  await env.svc.onIdleState("idle");
  assert.equal(await env.sess(), undefined);
  assert.equal(err(await env.call("getCodes")), "locked:none");
  assert.equal(env.alarms.alarms.has("autolock"), false);
});

test("C3.5 restore never replaces a valid current vault, even with the right password", async () => {
  const env = await ready();
  ok(await env.call("lock"));
  const vault = snapshot(env.local);
  assert.equal(err(await env.call("restore", { password: PW, confirmed: true })), "invalid:restore");
  assert.equal(err(await env.call("restore", { password: PW, confirmed: false })), "invalid:confirmation");
  assert.equal(snapshot(env.local), vault);
  assert.equal(await env.sess(), undefined);
});
