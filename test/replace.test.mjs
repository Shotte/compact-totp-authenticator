// #25 V2: restore or replace the vault from an encrypted backup. One check with the export
// password and a fresh master password; the backup is sealed in storage.session with a key
// that lives only in the session record; the page's single-use token alone authorizes the
// replacement for at most 180 s. Verified copy of the previous vault, truthful outcomes,
// crash safety. Synthetic secrets only; real PBKDF2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService, REPLACE_TTL_MS, MAX_STAGED_CHARS } from "../src/lib/service.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "destination master password", OLD = "backup source master pass", EXP = "export password for the test";
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snap = (area) => JSON.stringify([...area.map]);

function makeEnv() {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.make = () => createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.svc = env.make();
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  return env;
}
async function vault(password, accounts) {
  const env = makeEnv();
  ok(await env.call("setup", { password, confirm: password }));
  let revision = 1;
  for (const account of accounts) ({ revision } = ok(await env.call("addAccount", { revision, account })));
  env.revision = revision;
  return env;
}
const names = async (env) => ok(await env.call("listAccounts")).accounts.map((a) => a.name);
const acct = (name, i) => ({ name, secret: syntheticSecret(i) });

// The backup: three entries, one of them also in the destination (same secret).
const BACKUP = [acct("Backup Mail", 1), acct("Backup Bank", 2), acct("Shared", 3)];
const CURRENT = [acct("Current Chat", 10), acct("Current Cloud", 11), acct("Shared here", 3)];
const OLDN = ["Current Chat", "Current Cloud", "Shared here"], NEWN = ["Backup Mail", "Backup Bank", "Shared"];
let backupText;
async function backup() {
  if (!backupText) {
    const src = await vault(OLD, BACKUP);
    backupText = ok(await src.call("exportVault", { kind: "encrypted", password: OLD, exportPassword: EXP, confirm: EXP })).text;
  }
  return backupText;
}
const check = (env, extra = {}) => env.call("replacePreview", { text: env.text, password: EXP, masterPassword: PW, ...extra });
async function checked(accounts = CURRENT) {
  const env = await vault(PW, accounts);
  env.text = await backup();
  env.p = ok(await check(env));
  return env;
}
const apply = (env, token = env.p.token) => env.call("replaceApply", { token });
const pendingState = async (env) => {
  const { session: s, pendingReplace: p } = await env.session.get(["session", "pendingReplace"]);
  return { pending: !!p, key: !!s?.replaceKey };
};

test("empty vault: restored with the token alone; the destination keeps its master password", async () => {
  const env = await checked([]);
  assert.deepEqual([env.p.currentCount, env.p.backupCount, env.p.onlyCurrent.count], [0, 3, 0]);
  const r = ok(await apply(env));
  assert.deepEqual([r.replaced, r.previous, r.keptPrevious, r.locked], [3, 0, false, false]);
  assert.deepEqual(await names(env), NEWN);
  assert.equal(ok(await env.call("previousStatus")).exists, false);
  ok(await env.call("lock"));
  assert.equal(err(await env.call("unlock", { password: OLD })), "invalid:unlock", "the backup's old password does not open it");
  ok(await env.call("unlock", { password: PW }));
});

test("populated vault: one check shows counts and names without secrets; the token replaces; previous vault kept", async () => {
  const env = await checked();
  assert.deepEqual([env.p.currentCount, env.p.backupCount, env.p.inBoth], [3, 3, 1]);
  assert.deepEqual(env.p.onlyCurrent, { count: 2, names: ["Current Chat", "Current Cloud"] });
  assert.deepEqual(env.p.onlyBackup, { count: 2, names: ["Backup Mail", "Backup Bank"] });
  assert.match(env.p.token, /^[0-9a-f]{32}$/, "128-bit random token");
  assert.equal(env.p.expiresAt, env.clk.now() + REPLACE_TTL_MS);
  assert.ok(!JSON.stringify(env.p).includes(syntheticSecret(1)) && !JSON.stringify(env.p).includes(syntheticSecret(10)));
  assert.deepEqual(await names(env), OLDN, "the check writes nothing");
  const r = ok(await apply(env));
  assert.deepEqual([r.replaced, r.previous, r.keptPrevious, r.revision], [3, 3, true, env.revision + 1]);
  assert.deepEqual(await names(env), NEWN);
  const prev = ok(await env.call("previousStatus"));
  assert.deepEqual([prev.exists, prev.count], [true, 3]);
  assert.deepEqual(await pendingState(env), { pending: false, key: false }, "consumed: no pending data, no key");
  ok(await env.call("lock"));
  ok(await env.call("unlock", { password: PW }));
  assert.equal(err(await env.call("unlock", { password: OLD })), "invalid:unlock");
});

test("wrong or missing passwords at the check: precise errors, nothing staged or written; master password checked first", async () => {
  const env = await vault(PW, CURRENT);
  env.text = await backup();
  const before = snap(env.local);
  assert.equal(err(await check(env, { masterPassword: "not the master password" })), "invalid:current-password");
  assert.equal(err(await check(env, { password: "wrong export password!!" })), "invalid:import-decrypt");
  assert.equal(err(await check(env, { masterPassword: "not the master password", password: "wrong export password!!" })), "invalid:current-password");
  assert.equal(err(await check(env, { masterPassword: undefined })), "invalid:current-password");
  assert.equal(err(await check(env, { password: undefined })), "invalid:password");
  assert.equal(snap(env.local), before);
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  ok(await check(env), "the same file text works once both passwords are right");
});

test("damaged, malformed or oversized backup: refused at the check, nothing staged or written", async () => {
  const env = await vault(PW, CURRENT);
  const before = snap(env.local);
  const t = JSON.parse(await backup());
  t.ciphertext = (t.ciphertext[0] === "A" ? "B" : "A") + t.ciphertext.slice(1);
  const c = (text) => env.call("replacePreview", { text, password: EXP, masterPassword: PW });
  assert.equal(err(await c(JSON.stringify(t))), "invalid:import-decrypt");
  assert.match(err(await c("{not json")), /^(malformed|invalid)/);
  assert.equal(snap(env.local), before);
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
});

test("payload limit: a backup whose sealed copy exceeds 2 MB is refused at the check; nothing staged", async () => {
  // One synthetic entry with a huge (valid Base32) secret: allowed in a vault, too big to stage.
  const big = "A".repeat(1_700_000);
  const src = await vault(OLD, [{ name: "Huge", secret: big }]);
  const text = ok(await src.call("exportVault", { kind: "encrypted", password: OLD, exportPassword: EXP, confirm: EXP })).text;
  const env = await vault(PW, CURRENT);
  const before = snap(env.local);
  assert.equal(err(await env.call("replacePreview", { text, password: EXP, masterPassword: PW })), "invalid:replace-too-large");
  assert.equal(snap(env.local), before);
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  assert.ok(MAX_STAGED_CHARS === 2 * 1024 * 1024);
});

test("expiry: valid until 180 s, refused from then on, never valid again (also if the clock goes back)", async () => {
  let env = await checked();
  env.clk.advance(REPLACE_TTL_MS - 1);
  ok(await apply(env), "still valid 1 ms before the expiry");
  env = await checked();
  const before = snap(env.local);
  env.clk.advance(REPLACE_TTL_MS);
  assert.equal(err(await apply(env)), "invalid:replace-expired");
  assert.equal(snap(env.local), before);
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  env.clk.advance(-REPLACE_TTL_MS);
  assert.equal(err(await apply(env)), "conflict", "gone for good, even with the clock set back");
  // clock moved back between check and replace: the pending operation is from the future
  env = await checked();
  const unchanged = snap(env.local);
  env.clk.advance(-1000);
  assert.match(err(await apply(env)), /^(locked|invalid:replace-expired)/, "the session gate locks first (clock)");
  assert.equal(snap(env.local), unchanged);
});

test("expiry is checked again right before the write: expiring during the replacement writes nothing", async () => {
  const env = await checked();
  const before = snap(env.local);
  const get = env.local.get.bind(env.local);
  let armed = true;
  env.local.get = async (k) => { if (armed && [k].flat().includes("vault")) { armed = false; env.clk.advance(REPLACE_TTL_MS); } return get(k); };
  assert.equal(err(await apply(env)), "invalid:replace-expired");
  env.local.get = get;
  assert.equal(snap(env.local), before);
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
});

test("expiry cleanup alarm: removes the expired pending data and its key; validity never depends on it", async () => {
  const env = await checked();
  assert.equal(env.alarms.alarms.get("replace-expiry").when, env.p.expiresAt);
  await env.svc.onReplaceExpiry(); // early or spurious alarm: nothing removed
  assert.deepEqual(await pendingState(env), { pending: true, key: true });
  env.clk.advance(REPLACE_TTL_MS);
  await env.svc.onReplaceExpiry();
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  ok(await env.call("listAccounts"), "the session itself is untouched");
});

test("a lock, auto-lock, idle lock, password change or new unlock invalidates the operation; nothing written", async () => {
  for (const end of ["lock", "autolock", "idle", "unlock-again"]) {
    const env = await checked();
    if (end === "idle") await env.local.set({ settings: { idleLock: true } });
    const before = snap(env.local);
    if (end === "lock") ok(await env.call("lock"));
    if (end === "autolock") { env.clk.advance(16 * 60_000); await env.svc.onAlarm(); }
    if (end === "idle") await env.svc.onIdleState("idle");
    if (end === "unlock-again") { ok(await env.call("lock")); ok(await env.call("unlock", { password: PW })); }
    assert.deepEqual(await pendingState(env), { pending: false, key: false }, end);
    if (end !== "unlock-again") ok(await env.call("unlock", { password: PW }));
    assert.equal(err(await apply(env)), "conflict", `${end}: the token is worthless in the new session`);
    assert.equal(snap(env.local), before, end);
  }
  // password change: the session ends; the new session cannot use the old token
  const env = await checked();
  const NEWPW = "a brand new master password";
  ok(await env.call("changePassword", { current: PW, next: NEWPW, confirm: NEWPW }));
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  ok(await env.call("unlock", { password: NEWPW }));
  assert.equal(err(await apply(env)), "conflict");
  assert.deepEqual(await names(env), OLDN);
});

test("a lock makes leftover pending data unusable even if its cleanup did not run", async () => {
  const env = await checked();
  const { pendingReplace: leftover } = await env.session.get("pendingReplace");
  ok(await env.call("lock"));
  ok(await env.call("unlock", { password: PW }));
  await env.session.set({ pendingReplace: leftover }); // simulate a cleanup that never happened
  const before = snap(env.local);
  assert.equal(err(await apply(env)), "conflict", "other session, and the sealing key died with the old session");
  assert.equal(snap(env.local), before);
  // even a forged session record cannot revive it: the key is gone for good
  await env.session.set({ pendingReplace: leftover });
  const { session: s } = await env.session.get("session");
  await env.session.set({ session: { ...s, id: leftover.sessionId } });
  assert.match(err(await apply(env)), /^(conflict|locked)/);
  assert.equal(snap(env.local), before);
});

test("wrong, missing or replayed token: refused; the operation is consumed by the first attempt", async () => {
  let env = await checked();
  const before = snap(env.local);
  assert.equal(err(await apply(env, "0".repeat(32))), "conflict");
  assert.equal(err(await apply(env)), "conflict", "single use: the right token after a wrong one no longer works");
  assert.equal(snap(env.local), before);
  env = await checked();
  assert.equal(err(await env.call("replaceApply", {})), "conflict");
  env = await checked();
  ok(await apply(env));
  assert.equal(err(await apply(env)), "conflict", "replay after success");
});

test("cancel and a new check invalidate the previous token", async () => {
  let env = await checked();
  ok(await env.call("replaceCancel"));
  assert.deepEqual(await pendingState(env), { pending: false, key: false });
  assert.equal(err(await apply(env)), "conflict");
  env = await checked();
  const first = env.p.token;
  env.p = ok(await check(env)); // e.g. another file chosen and checked
  assert.equal(err(await apply(env, first)), "conflict", "the first token died with the second check");
  assert.deepEqual(await names(env), OLDN);
});

test("concurrent modification: a change in another tab after the check is never overwritten", async () => {
  const env = await checked();
  ok(await env.make().handle({ cmd: "addAccount", revision: env.p.revision, account: acct("Other tab", 50) }));
  const changed = snap(env.local);
  assert.equal(err(await apply(env)), "conflict");
  assert.equal(snap(env.local), changed);
});

test("two replace requests at once: exactly one succeeds", async () => {
  const env = await checked();
  const rs = await Promise.all([apply(env), apply(env)]);
  assert.deepEqual(rs.map((r) => r.ok).sort(), [false, true]);
  assert.equal(rs.find((r) => !r.ok).error, "conflict");
  assert.deepEqual(await names(env), NEWN);
});

test("event page restarted between check and replace: still valid (state in storage.session)", async () => {
  const env = await checked();
  env.svc = env.make();
  ok(await apply(env));
  assert.deepEqual(await names(env), NEWN);
});

test("tampered pending data (contents, bindings or an extended expiry): refused, nothing written", async () => {
  for (const tamper of [
    (p) => { p.staged.ct = (p.staged.ct[0] === "A" ? "B" : "A") + p.staged.ct.slice(1); },
    (p) => { p.revision += 0; p.backupCount += 1; },
    (p) => { p.expiresAt += 60_000; },
  ]) {
    const env = await checked();
    const { pendingReplace: p } = await env.session.get("pendingReplace");
    tamper(p);
    await env.session.set({ pendingReplace: p });
    const before = snap(env.local);
    assert.equal(err(await apply(env)), "conflict");
    assert.equal(snap(env.local), before);
  }
});

test("the check is not an activity: it never extends the session", async () => {
  const env = await vault(PW, CURRENT);
  env.text = await backup();
  const { session: s1 } = await env.session.get("session");
  env.clk.advance(60_000);
  ok(await check(env));
  const { session: s2 } = await env.session.get("session");
  assert.equal(s2.deadline, s1.deadline);
});

test("storage failure while keeping the previous vault: nothing replaced; a new check and replace work", async () => {
  const env = await checked();
  const set = env.local.set.bind(env.local);
  env.local.set = async (o) => { if ("vault_previous" in o) throw new Error("quota"); return set(o); };
  assert.equal(err(await apply(env)), "invalid:replace-failed");
  env.local.set = set;
  assert.deepEqual(await names(env), OLDN);
  env.p = ok(await check(env));
  ok(await apply(env));
  assert.deepEqual(await names(env), NEWN);
});

test("storage failure while writing the new vault: rolled back, reported as failed without data loss, previous copy present", async () => {
  const env = await checked();
  const set = env.local.set.bind(env.local);
  let n = 0;
  env.local.set = async (o) => { if ("vault" in o && n++ === 0) throw new Error("quota"); return set(o); };
  assert.equal(err(await apply(env)), "invalid:replace-failed");
  env.local.set = set;
  assert.deepEqual(await names(env), OLDN);
  assert.equal(ok(await env.call("previousStatus")).count, 3);
});

test("browser terminated at every write boundary: old or new contents, never mixed; the old ones stay recoverable", async () => {
  for (let crashAt = 1; crashAt <= 6; crashAt++) {
    const env = await checked();
    const set = env.local.set.bind(env.local), remove = env.local.remove.bind(env.local);
    let writes = 0, dead = false;
    const die = () => { dead = true; throw new Error("terminated"); };
    env.local.set = async (o) => { if (dead || ++writes >= crashAt) die(); return set(o); };
    env.local.remove = async (k) => { if (dead) die(); return remove(k); };
    await apply(env).catch(() => {});
    env.local.set = set; env.local.remove = remove;
    // restart: new service on the same storage, session storage gone (pending data included)
    env.session = fakeArea(); env.svc = env.make();
    let r = ok(await env.call("unlock", { password: PW }));
    if (r.recoverable) { ok(await env.call("restore", { password: PW, confirmed: true })); r = { unlocked: true }; }
    const now = await names(env);
    assert.ok([OLDN, NEWN].some((x) => JSON.stringify(x) === JSON.stringify(now)), `crash at write ${crashAt}: ${now}`);
    if (JSON.stringify(now) === JSON.stringify(NEWN)) {
      assert.equal(ok(await env.call("previousStatus")).count, 3, `crash at write ${crashAt}: replaced, old copy kept`);
    }
    assert.equal(err(await apply(env)), "conflict", `crash at write ${crashAt}: nothing pending after the restart`);
  }
});

test("restore the previous vault (swap, nothing lost), discard it only explicitly, a password change drops it", async () => {
  const env = await checked();
  ok(await apply(env));
  assert.equal(err(await env.call("restorePrevious", { masterPassword: PW })), "invalid:replace-confirmation");
  assert.equal(err(await env.call("restorePrevious", { masterPassword: "wrong master password!!", confirmed: true })), "invalid:current-password");
  ok(await env.call("restorePrevious", { masterPassword: PW, confirmed: true }));
  assert.deepEqual(await names(env), OLDN);
  assert.equal(ok(await env.call("previousStatus")).count, 3, "the backup contents are now the kept copy");
  assert.equal(err(await env.call("discardPrevious", { masterPassword: PW })), "invalid:confirmation");
  ok(await env.call("discardPrevious", { masterPassword: PW, confirmed: true }));
  assert.equal(ok(await env.call("previousStatus")).exists, false);
  assert.equal(err(await env.call("restorePrevious", { masterPassword: PW, confirmed: true })), "invalid:no-previous");
  const env2 = await checked();
  ok(await apply(env2));
  const NEWPW = "a brand new master password";
  const before = snap(env2.local);
  assert.equal(err(await env2.call("changePassword", { current: PW, next: NEWPW, confirm: NEWPW })), "invalid:previous-exists",
    "never dropped silently: the user must agree first (review B)");
  assert.equal(snap(env2.local), before, "password not changed, copy kept");
  ok(await env2.call("changePassword", { current: PW, next: NEWPW, confirm: NEWPW, discardPrevious: true }));
  ok(await env2.call("unlock", { password: NEWPW }));
  assert.equal(ok(await env2.call("previousStatus")).exists, false);
  assert.equal(env2.local.map.has("vault_previous"), false);
});

test("no password, token, secret or entry name in plain text in storage.session, storage.local or responses", async () => {
  const env = await checked();
  const staged = JSON.stringify([...env.session.map]);
  for (const v of [PW, EXP, env.p.token, ...BACKUP.map((a) => a.secret), ...BACKUP.map((a) => a.name)]) {
    assert.ok(!staged.includes(v), `storage.session while pending: ${v.slice(0, 12)}`);
  }
  const r = ok(await apply(env));
  const plain = JSON.stringify([...env.session.map, ...env.local.map, env.p, r]);
  for (const a of [...BACKUP, ...CURRENT]) assert.ok(!plain.includes(a.secret), a.name);
  assert.ok(!plain.includes(PW) && !plain.includes(EXP));
});
