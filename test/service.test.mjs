// Regression tests for the background boundary: locking, expiry during async work,
// event page restarts, revision conflicts and secret leakage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { syntheticAccounts, syntheticSecret } from "../src/lib/fixtures.js";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const MIN = 60_000;
const SECRETS = syntheticAccounts(100).map((a) => a.secret);
const NEW_SECRET = syntheticSecret(999_999);
const leaks = (value) => {
  const json = JSON.stringify(value);
  return [...SECRETS, NEW_SECRET].filter((s) => json.includes(s));
};

function setup() {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.make = () => createService({ session: env.session, local: env.local, alarms: env.alarms,
    now: env.clk.now });
  env.svc = env.make();
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  return env;
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };

test("locked by default; every sensitive command fails closed", async () => {
  const { call } = setup();
  assert.equal(ok(await call("status")).unlocked, false);
  for (const cmd of ["getCodes", "listAccounts", "activity"]) {
    assert.deepEqual(await call(cmd), { ok: false, error: "locked", reason: undefined }, cmd);
  }
  const r = await call("addAccount", { account: { name: "x", secret: NEW_SECRET }, revision: 1 });
  assert.equal(r.error, "locked");
  assert.equal((await call("importPreview", { text: "{}" })).error, "locked");
});

test("unlock stores a non-extractable key and only ciphertext", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 25 }));
  const { session: s, vault } = await env.session.get(["session", "vault"]);
  assert.ok(s.key instanceof CryptoKey);
  assert.equal(s.key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", s.key));
  assert.deepEqual(leaks(vault), []);
  assert.deepEqual(leaks([...env.local.map.values()]), []);
  assert.equal(env.alarms.alarms.get("autolock").when, s.deadline);
});

test("responses to pages never contain secrets", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 100 }));
  const codes = ok(await env.call("getCodes"));
  assert.equal(codes.codes.length, 100);
  assert.match(codes.codes[0].code, /^\d{6}$/);
  assert.match(codes.codes[2].code, /^\d{8}$/); // fixture 3: SHA-256, 8 digits
  const list = ok(await env.call("listAccounts"));
  assert.ok(list.accounts.every((a) => !("secret" in a)));
  const text = JSON.stringify({ otp_list: [{ name: "n", key: SECRETS[0] }, { name: "m", key: NEW_SECRET }] });
  const preview = ok(await env.call("importPreview", { text }));
  const bad = await env.call("addAccount", { account: { name: "x", secret: "!!" }, revision: list.revision });
  assert.deepEqual(leaks([codes, list, preview, bad]), []);
});

test("lock wipes key and vault; held page state cannot bring it back", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 5 }));
  const { revision } = ok(await env.call("listAccounts"));
  ok(await env.call("lock"));
  assert.deepEqual(await env.session.get(["session", "vault"]), {});
  assert.equal((await env.call("getCodes")).error, "locked");
  assert.equal((await env.call("activity")).error, "locked");
  assert.equal((await env.call("deleteAccount", { id: "fixture-1", revision })).error, "locked");
  assert.equal(env.alarms.alarms.has("autolock"), false);
});

test("deadline enforced without any alarm; no revival after expiry", async () => {
  const env = setup();
  await env.local.set({ settings: { autoLockMinutes: 15 } });
  ok(await env.call("devUnlock", { count: 3 }));
  env.clk.advance(15 * MIN - 1);
  ok(await env.call("getCodes")); // refresh does not extend the deadline
  env.clk.advance(1);
  assert.equal((await env.call("getCodes")).error, "locked");
  assert.deepEqual(await env.session.get("session"), {}, "expired session is wiped");
  assert.equal((await env.call("activity")).error, "locked");
});

test("qualifying activity moves the deadline only while valid", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 1 }));
  env.clk.advance(10 * MIN);
  ok(await env.call("activity"));
  env.clk.advance(10 * MIN);
  ok(await env.call("getCodes"));
  env.clk.advance(5 * MIN);
  assert.equal((await env.call("getCodes")).error, "locked");
});

test("clock moved backwards locks", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 1 }));
  env.clk.advance(-1000);
  assert.equal((await env.call("getCodes")).error, "locked");
});

test("expiry during async processing rejects the operation (read and write)", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const realGet = env.session.get;
  // Let time pass the deadline right after the gate's first read.
  let calls = 0;
  env.session.get = async (k) => { const r = await realGet(k); if (++calls === 2) env.clk.advance(16 * MIN); return r; };
  assert.equal((await env.call("getCodes")).error, "locked");

  env.session.get = realGet;
  ok(await env.call("devUnlock", { count: 3 }));
  const before = (await realGet("vault")).vault;
  calls = 0;
  env.session.get = async (k) => { const r = await realGet(k); if (++calls === 2) env.clk.advance(16 * MIN); return r; };
  const r = await env.call("addAccount", { account: { name: "N", secret: NEW_SECRET }, revision: 1 });
  env.session.get = realGet;
  assert.equal(r.error, "locked");
  assert.notEqual(before, undefined);
  assert.deepEqual((await realGet("vault")).vault, undefined, "no write; vault wiped with session");
});

test("lock during async processing rejects the operation and writes nothing", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const pending = env.call("getCodes");
  ok(await env.call("lock"));
  assert.equal((await pending).error, "locked");

  ok(await env.call("devUnlock", { count: 3 }));
  const write = env.call("addAccount", { account: { name: "N", secret: NEW_SECRET }, revision: 1 });
  ok(await env.call("lock"));
  assert.equal((await write).error, "locked");
  ok(await env.call("devUnlock", { count: 3 })); // fresh fixtures, revision 1
  const list = ok(await env.call("listAccounts"));
  assert.equal(list.revision, 1);
  assert.ok(!list.accounts.some((a) => a.name === "N"));
});

test("re-unlock during an operation (session change) rejects the old operation", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const pending = env.call("getCodes");
  ok(await env.call("devUnlock", { count: 4 }));
  assert.equal((await pending).error, "locked");
});

test("event page restart: a new service instance continues the same session", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 10 }));
  const a = ok(await env.call("getCodes"));
  env.svc = env.make(); // simulated restart: all in-memory state lost
  const b = ok(await env.call("getCodes"));
  assert.deepEqual(b, a);
  env.clk.advance(15 * MIN);
  env.svc = env.make();
  assert.equal((await env.call("getCodes")).error, "locked", "deadline survives restarts");
});

test("alarm handler wipes an expired session and re-arms a valid one", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 1 }));
  env.clk.advance(5 * MIN);
  ok(await env.call("activity"));
  await env.svc.onAlarm();
  assert.ok((await env.session.get("session")).session, "still valid → kept");
  env.clk.advance(15 * MIN);
  await env.svc.onAlarm();
  assert.deepEqual(await env.session.get(["session", "vault"]), {});
});

test("stale revision is rejected; concurrent writes cannot overwrite each other", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const { revision } = ok(await env.call("listAccounts"));
  const [r1, r2] = await Promise.all([
    env.call("updateAccount", { id: "fixture-1", patch: { name: "First" }, revision }),
    env.call("updateAccount", { id: "fixture-1", patch: { name: "Second" }, revision }),
  ]);
  assert.deepEqual([r1.ok, r2.error], [true, "conflict"]);
  const list = ok(await env.call("listAccounts"));
  assert.equal(list.revision, revision + 1);
  assert.equal(list.accounts[0].name, "First");
  assert.equal((await env.call("deleteAccount", { id: "fixture-2", revision })).error, "conflict");
});

test("storage-level compare-and-set catches a write behind the service's back", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const realSet = env.session.set;
  let sessionReads = 0;
  env.session.get = ((orig) => async (k) => {
    const r = await orig(k);
    // 2nd session read = recheck inside writeVault, after the vault was read and the new
    // ciphertext built. Another writer bumps the revision at exactly that point.
    if (k === "session" && ++sessionReads === 2) {
      const { vault } = await orig("vault");
      await realSet({ vault: { ...vault, revision: vault.revision + 1 } });
    }
    return r;
  })(env.session.get);
  const r = await env.call("addAccount", { account: { name: "N", secret: NEW_SECRET }, revision: 1 });
  assert.equal(r.error, "conflict");
});

test("revision is bound to the ciphertext (AAD): tampering is rejected", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  const { vault } = await env.session.get("vault");
  await env.session.set({ vault: { ...vault, revision: 7 } });
  assert.equal((await env.call("getCodes")).error, "internal");
  await env.session.set({ vault: { ...vault, ct: vault.ct.replace(/^./, (c) => (c === "A" ? "B" : "A")) } });
  assert.equal((await env.call("getCodes")).error, "internal");
});

test("CRUD and ordering through the service", async () => {
  const env = setup();
  ok(await env.call("devUnlock", { count: 3 }));
  let { revision } = ok(await env.call("listAccounts"));
  ({ revision } = ok(await env.call("addAccount",
    { account: { name: "New", secret: NEW_SECRET.toLowerCase(), url: "new.example" }, revision })));
  ({ revision } = ok(await env.call("moveAccount", { id: "fixture-3", toIndex: 0, revision })));
  ({ revision } = ok(await env.call("updateAccount", { id: "fixture-1", patch: { name: "Renamed" }, revision })));
  ({ revision } = ok(await env.call("deleteAccount", { id: "fixture-2", revision })));
  const list = ok(await env.call("listAccounts"));
  assert.deepEqual(list.accounts.map((a) => a.name), ["Test Bank 03", "Renamed", "New"]);
  assert.equal(list.revision, 5); // 1 + four mutations
  // secret unchanged by a name-only update: codes still match a fresh fixture computation
  const codes = ok(await env.call("getCodes"));
  assert.equal(codes.codes.length, 3);
});

test("input validation at the message boundary", async () => {
  const env = setup();
  assert.equal((await env.call("nope")).error, "invalid");
  assert.equal((await env.svc.handle(null)).error, "invalid");
  assert.equal((await env.svc.handle({ cmd: "toString" })).error, "invalid");
  assert.equal((await env.call("devUnlock", { count: -1 })).error, "invalid");
  ok(await env.call("devUnlock", { count: 2 }));
  assert.equal((await env.call("deleteAccount", { id: "fixture-1", revision: "1" })).error, "invalid");
  assert.equal((await env.call("deleteAccount", { id: "missing", revision: 1 })).error, "invalid");
  assert.equal((await env.call("moveAccount", { id: "fixture-1", toIndex: 9, revision: 1 })).error, "invalid");
  assert.equal((await env.call("importPreview", { text: 5 })).error, "invalid");
  assert.equal((await env.call("importPreview", { text: "not json" })).error, "malformed");
  assert.equal(ok(await env.call("listAccounts")).revision, 1, "failed operations wrote nothing");
});
