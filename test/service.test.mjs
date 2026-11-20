// Regression tests for the background boundary on the persistent vault (C2): setup,
// unlock, wrong passwords, locking, expiry during async work, restarts, revision
// conflicts, password change and recovery. Real PBKDF2 (600,000 iterations) throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { openVault } from "../src/lib/vault.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const MIN = 60_000;
const PW = "correct horse battery staple", PW2 = "a completely different passphrase";
const SECRETS = Array.from({ length: 5 }, (_, i) => syntheticSecret(i + 1));
const leaks = (value) => { const j = JSON.stringify(value); return [...SECRETS, PW, PW2].filter((s) => j.includes(s)); };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snapshot = (area) => structuredClone([...area.map]);

function setup() {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.make = () => createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.svc = env.make();
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  return env;
}
async function ready(n = 3) {
  const env = setup();
  ok(await env.call("setup", { password: PW, confirm: PW }));
  let revision = 1;
  for (let i = 0; i < n; i++) {
    ({ revision } = ok(await env.call("addAccount", { revision, account: { name: `Account ${i + 1}`, secret: SECRETS[i], url: "example.com" } })));
  }
  env.revision = revision;
  return env;
}

test("fresh install: not initialized, everything locked", async () => {
  const env = setup();
  assert.deepEqual(ok(await env.call("status")).initialized, false);
  for (const cmd of ["getCodes", "listAccounts", "activity"]) assert.match(err(await env.call(cmd)), /^locked/);
  assert.equal(err(await env.call("unlock", { password: PW })), "invalid:no-vault");
  assert.equal(err(await env.call("devUnlock", { count: 3 })), "invalid:cmd", "development unlock is gone");
});

test("setup: 12+ characters, confirmation, creates an encrypted vault and unlocks", async () => {
  const env = setup();
  assert.equal(err(await env.call("setup", { password: "short pass", confirm: "short pass" })), "invalid:password-short");
  assert.equal(err(await env.call("setup", { password: PW, confirm: PW + "x" })), "invalid:password-mismatch");
  assert.equal(err(await env.call("setup", { password: PW })), "invalid:password-mismatch", "confirmation required");
  assert.equal(env.local.map.size, 0, "rejected setups write nothing");
  ok(await env.call("setup", { password: PW, confirm: PW }));
  const st = ok(await env.call("status"));
  assert.deepEqual([st.initialized, st.unlocked], [true, true]);
  const { session: s } = await env.session.get("session");
  assert.equal(s.key.extractable, false);
  assert.equal(s.generation, env.local.map.get("vault").kdf.salt);
  assert.equal(err(await env.call("setup", { password: PW2, confirm: PW2 })), "invalid:exists");
});

test("no plaintext persistence: storage holds no secret, name or password", async () => {
  const env = await ready(5);
  ok(await env.call("getCodes"));
  assert.deepEqual(leaks([...env.local.map.values()]), []);
  assert.ok(!JSON.stringify([...env.local.map.values()]).includes("Account 1"), "names are encrypted too");
  assert.deepEqual(leaks([...env.session.map.values()]), []);
});

test("wrong password: unlock fails and storage is byte-identical", async () => {
  const env = await ready();
  ok(await env.call("lock"));
  const snap = snapshot(env.local);
  for (const p of ["wrong password!!", PW + " ", PW.toUpperCase()]) {
    assert.equal(err(await env.call("unlock", { password: p })), "invalid:unlock");
  }
  assert.equal(err(await env.call("unlock", { password: "" })), "invalid:password");
  assert.deepEqual(snapshot(env.local), snap);
  assert.deepEqual(await env.session.get("session"), {});
  ok(await env.call("unlock", { password: PW.normalize("NFD") }), "NFC-equal password unlocks");
});

test("unlock after restart (new service instance, session storage cleared)", async () => {
  const env = await ready(3);
  await env.session.clear();
  env.svc = env.make();
  assert.match(err(await env.call("getCodes")), /^locked/);
  ok(await env.call("unlock", { password: PW }));
  assert.equal(ok(await env.call("getCodes")).codes.length, 3);
});

test("responses never contain secrets or passwords", async () => {
  const env = await ready(5);
  const codes = ok(await env.call("getCodes"));
  assert.match(codes.codes[0].code, /^\d{6}$/);
  const list = ok(await env.call("listAccounts"));
  assert.ok(list.accounts.every((a) => !("secret" in a)));
  const preview = ok(await env.call("importPreview", { text: JSON.stringify({ otp_list: [{ name: "n", key: SECRETS[0] }] }) }));
  const bad = await env.call("addAccount", { account: { name: "x", secret: "!!" }, revision: list.revision });
  const st = await env.call("status");
  assert.deepEqual(leaks([codes, list, preview, bad, st]), []);
});

test("C2-A1: manipulated KDF metadata never unlocks, never writes, never runs unbounded", async () => {
  const env = await ready();
  ok(await env.call("lock"));
  const original = structuredClone(env.local.map.get("vault"));
  const cases = {
    "iterations raised (still in bounds)": (v) => { v.kdf.iterations = 600_001; },
    "salt substituted": (v) => { v.kdf.salt = btoa(String.fromCharCode(...new Uint8Array(16).fill(3))); },
    "iterations oversized": (v) => { v.kdf.iterations = 1e12; },
    "iterations malformed": (v) => { v.kdf.iterations = "600000"; },
    "salt oversized": (v) => { v.kdf.salt = "A".repeat(2_000_000); },
  };
  for (const [name, mutateHeader] of Object.entries(cases)) {
    const v = structuredClone(original); mutateHeader(v);
    env.local.map.set("vault", v);
    env.local.map.delete("vault_backup"); // only the manipulated header is available
    const snap = snapshot(env.local);
    const t0 = performance.now();
    const r = await env.call("unlock", { password: PW });
    const ms = performance.now() - t0;
    assert.equal(r.ok, false, name);
    assert.deepEqual(snapshot(env.local), snap, `${name}: no write`);
    if (/oversized|malformed/.test(name)) assert.ok(ms < 150, `${name}: rejected before PBKDF2 (${ms.toFixed(0)} ms)`);
  }
});

test("C2-A3: password change locks the session; old key and old password are dead", async () => {
  const env = await ready(3);
  const { session: oldSession } = await env.session.get("session");
  assert.equal(err(await env.call("changePassword", { current: "wrong password!!", next: PW2, confirm: PW2 })), "invalid:current-password");
  assert.match(err(await env.call("getCodes")), /^locked/, "a failed change also locks (no ambiguous session)");
  ok(await env.call("unlock", { password: PW }));
  assert.equal(err(await env.call("changePassword", { current: PW, next: "too short", confirm: "too short" })), "invalid:password-short");
  assert.deepEqual(ok(await env.call("changePassword", { current: PW, next: PW2, confirm: PW2 })), { locked: true });
  assert.match(err(await env.call("getCodes")), /^locked/);
  // 1. the previous session key cannot decrypt the new vault
  await assert.rejects(openVault(oldSession.key, env.local.map.get("vault")));
  // 3/4. a stale session record (old generation, still within its deadline) is rejected and wiped
  await env.session.set({ session: { ...oldSession, lastActivity: env.clk.now(), deadline: env.clk.now() + oldSession.timeoutMs } });
  assert.match(err(await env.call("getCodes")), /^locked/);
  assert.deepEqual(await env.session.get("session"), {});
  // 6. the old password opens nothing and cannot restore anything
  assert.equal(err(await env.call("unlock", { password: PW })), "invalid:unlock");
  assert.equal(err(await env.call("restore", { password: PW, confirmed: true })), "invalid:restore");
  ok(await env.call("unlock", { password: PW2 }));
  const { session: s } = await env.session.get("session");
  assert.notEqual(s.generation, oldSession.generation);
  assert.equal(s.generation, env.local.map.get("vault").kdf.salt, "session and vault generation consistent");
  assert.equal(ok(await env.call("getCodes")).codes.length, 3, "data intact");
});

test("C2-A3: popup operations racing a password change cannot use the stale key", async () => {
  const env = await ready(3);
  const change = env.call("changePassword", { current: PW, next: PW2, confirm: PW2 });
  // The change locks first and then runs two PBKDF2 derivations: probe inside that window.
  while ((await env.session.get("session")).session) await new Promise((r) => setTimeout(r, 1));
  const [during, write] = await Promise.all([
    env.call("getCodes"),
    env.call("addAccount", { revision: env.revision, account: { name: "Late", secret: SECRETS[4] } }),
  ]);
  assert.match(err(during), /^locked/, "codes during the change need a fresh unlock");
  assert.match(err(write), /^locked/, "writes during the change are rejected");
  assert.deepEqual(ok(await change), { locked: true });
  ok(await env.call("unlock", { password: PW2 }));
  assert.ok(!ok(await env.call("listAccounts")).accounts.some((a) => a.name === "Late"));
});

test("C2-A3: interrupted password change leaves a locked session and a working password", async () => {
  for (const failAt of [1, 2, 3]) { // rotate set(): 1 vault_next, 2 vault_backup, 3 vault
    const env = await ready(2);
    let n = 0;
    const realSet = env.local.set.bind(env.local);
    env.local.set = async (obj) => { if (++n === failAt) throw new Error("QuotaExceededError (simulated)"); return realSet(obj); };
    const r = await env.call("changePassword", { current: PW, next: PW2, confirm: PW2 });
    env.local.set = realSet;
    assert.equal(r.ok, false, `fail at ${failAt}`);
    assert.deepEqual(await env.session.get("session"), {}, "never apparently unlocked after a failed change");
    ok(await env.call("unlock", { password: PW }), `old password still works (fail at ${failAt})`);
    assert.equal(ok(await env.call("getCodes")).codes.length, 2);
  }
});

test("recovery: damaged vault -> recoverable without writing; confirmed restore unlocks", async () => {
  const env = await ready(2);
  ok(await env.call("addAccount", { revision: env.revision, account: { name: "Newest", secret: SECRETS[3] } }));
  ok(await env.call("lock"));
  const v = env.local.map.get("vault");
  v.ciphertext = v.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  const snap = snapshot(env.local);
  const r = ok(await env.call("unlock", { password: PW }));
  assert.deepEqual([r.unlocked, r.recoverable, r.generationVerified], [false, true, true]);
  assert.equal(err(await env.call("unlock", { password: "wrong password!!" })), "invalid:unlock");
  assert.equal(err(await env.call("restore", { password: PW })), "invalid:confirmation");
  assert.equal(err(await env.call("restore", { password: "wrong password!!", confirmed: true })), "invalid:restore");
  assert.deepEqual(snapshot(env.local), snap, "nothing written before a confirmed restore");
  ok(await env.call("restore", { password: PW, confirmed: true }));
  assert.equal(ok(await env.call("listAccounts")).accounts.length, 2, "previous revision restored");
});

// Issue #8: a structurally destroyed vault is reported as "damaged", the same for the right
// and a wrong password (no password oracle). The unverified-generation restore stays
// disabled, and nothing is written.
test("issue #8: destroyed vault header with an openable backup -> damaged for any password, restore refused, nothing written", async () => {
  const env = await ready(2);
  ok(await env.call("lock"));
  env.local.map.set("vault", { garbage: true });
  const snap = snapshot(env.local);
  assert.equal(err(await env.call("unlock", { password: PW })), "invalid:damaged");
  assert.equal(err(await env.call("unlock", { password: "wrong password!!" })), "invalid:damaged");
  assert.equal(err(await env.call("restore", { password: PW, confirmed: true })), "invalid:restore");
  assert.equal(err(await env.call("restore", { password: "wrong password!!", confirmed: true })), "invalid:restore");
  assert.deepEqual(snapshot(env.local), snap, "nothing written");
  assert.deepEqual(await env.session.get("session"), {}, "no session started");
});

test("issue #8: destroyed vault without any copy -> damaged for any password; intact header with bad ciphertext stays 'unlock'", async () => {
  const env = await ready(1);
  ok(await env.call("lock"));
  const good = structuredClone(env.local.map.get("vault"));
  env.local.map.delete("vault_backup"); env.local.map.delete("vault_next");
  env.local.map.set("vault", { garbage: true });
  assert.equal(err(await env.call("unlock", { password: PW })), "invalid:damaged");
  assert.equal(err(await env.call("unlock", { password: "wrong password!!" })), "invalid:damaged");
  // Intact header, damaged ciphertext, no copy: indistinguishable from a wrong password.
  good.ciphertext = (good.ciphertext[0] === "A" ? "B" : "A") + good.ciphertext.slice(1);
  env.local.map.set("vault", good);
  assert.equal(err(await env.call("unlock", { password: PW })), "invalid:unlock");
  assert.equal(err(await env.call("unlock", { password: "wrong password!!" })), "invalid:unlock");
});

test("after lock every sensitive command fails closed", async () => {
  const env = await ready();
  ok(await env.call("lock"));
  for (const cmd of ["getCodes", "listAccounts", "activity"]) assert.match(err(await env.call(cmd)), /^locked/);
  assert.match(err(await env.call("deleteAccount", { id: "x", revision: env.revision })), /^locked/);
  assert.match(err(await env.call("changePassword", { current: PW, next: PW2, confirm: PW2 })), /^locked/);
  assert.equal(env.alarms.alarms.has("autolock"), false);
});

test("deadline enforced without any alarm; no revival after expiry", async () => {
  const env = await ready();
  env.clk.advance(15 * MIN - 1);
  ok(await env.call("getCodes")); // refresh does not extend the deadline
  env.clk.advance(1);
  assert.match(err(await env.call("getCodes")), /^locked/);
  assert.deepEqual(await env.session.get("session"), {});
  assert.match(err(await env.call("activity")), /^locked/);
});

test("clock moved backwards locks", async () => {
  const env = await ready();
  env.clk.advance(-1000);
  assert.match(err(await env.call("getCodes")), /^locked/);
});

test("lock during async processing rejects the operation", async () => {
  const env = await ready();
  const pending = env.call("getCodes");
  ok(await env.call("lock"));
  assert.match(err(await pending), /^locked/);
});

test("stale revision is rejected; concurrent writes cannot overwrite each other", async () => {
  const env = await ready(3);
  const { revision, accounts } = ok(await env.call("listAccounts"));
  const id = accounts[0].id;
  const [r1, r2] = await Promise.all([
    env.call("updateAccount", { id, patch: { name: "First" }, revision }),
    env.call("updateAccount", { id, patch: { name: "Second" }, revision }),
  ]);
  assert.deepEqual([r1.ok, r2.error], [true, "conflict"]);
  const after = ok(await env.call("listAccounts"));
  assert.equal(after.revision, revision + 1);
  assert.equal(after.accounts[0].name, "First");
});

test("CRUD and ordering through the service, persisted in the vault", async () => {
  const env = await ready(3);
  let { revision, accounts } = ok(await env.call("listAccounts"));
  const [a, b, c] = accounts.map((x) => x.id);
  ({ revision } = ok(await env.call("moveAccount", { id: c, toIndex: 0, revision })));
  ({ revision } = ok(await env.call("updateAccount", { id: a, patch: { name: "Renamed" }, revision })));
  ({ revision } = ok(await env.call("deleteAccount", { id: b, revision })));
  env.svc = env.make(); // restart: state comes from storage only
  const list = ok(await env.call("listAccounts"));
  assert.deepEqual(list.accounts.map((x) => x.name), ["Account 3", "Renamed"]);
  assert.equal(list.revision, revision);
});

test("alarm handler wipes an expired session and re-arms a valid one", async () => {
  const env = await ready(1);
  env.clk.advance(5 * MIN);
  ok(await env.call("activity"));
  await env.svc.onAlarm();
  assert.ok((await env.session.get("session")).session);
  env.clk.advance(15 * MIN);
  await env.svc.onAlarm();
  assert.deepEqual(await env.session.get("session"), {});
});

test("input validation at the message boundary", async () => {
  const env = await ready(1);
  assert.equal(err(await env.call("nope")), "invalid:cmd");
  assert.equal(err(await env.svc.handle(null)), "invalid:cmd");
  assert.equal(err(await env.svc.handle({ cmd: "toString" })), "invalid:cmd");
  assert.equal(err(await env.call("unlock", { password: 42 })), "invalid:password");
  assert.equal(err(await env.call("unlock", { password: "x".repeat(2000) })), "invalid:password");
  assert.equal(err(await env.call("deleteAccount", { id: "x", revision: "1" })), "invalid:revision");
  assert.equal(err(await env.call("importPreview", { text: 5 })), "invalid:text");
  assert.equal(err(await env.call("importPreview", { text: "not json" })), "malformed:json");
});

test("shared secret policy at the message boundary: short secrets stored with a warning, malformed rejected", async () => {
  const env = await ready(1);
  const r = ok(await env.call("addAccount", { revision: env.revision, account: { name: "Short", secret: "MZXW6YTBOI" } }));
  assert.deepEqual(r.warnings, ["short-secret"]);
  const codes = ok(await env.call("getCodes")).codes;
  assert.match(codes.find((c) => c.name === "Short").code, /^[0-9]{6}$/, "a short secret still generates codes");
  assert.equal(err(await env.call("addAccount", { revision: r.revision, account: { name: "Bad", secret: "M1!" } })), "invalid:secret-format");
  const { accounts } = ok(await env.call("listAccounts"));
  const u = ok(await env.call("updateAccount", { revision: r.revision, id: accounts[0].id, patch: { name: "Renamed" } }));
  assert.deepEqual(u.warnings, []);
  assert.deepEqual(ok(await env.call("addAccount", { revision: u.revision, account: { name: "Long", secret: SECRETS[4] } })).warnings, []);
});
