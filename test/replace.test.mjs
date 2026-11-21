// #25: restore or replace the vault from an encrypted backup (preview, fresh master password,
// explicit confirmation, verified copy of the previous vault, truthful outcomes, crash
// safety). Synthetic secrets only; real PBKDF2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
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
let backupText;
async function backup() {
  if (!backupText) {
    const src = await vault(OLD, BACKUP);
    backupText = ok(await src.call("exportVault", { kind: "encrypted", password: OLD, exportPassword: EXP, confirm: EXP })).text;
  }
  return backupText;
}
async function previewed(accounts = CURRENT) {
  const env = await vault(PW, accounts);
  env.text = await backup();
  env.p = ok(await env.call("replacePreview", { text: env.text, password: EXP }));
  return env;
}
const apply = (env, extra = {}) => env.call("replaceApply", { revision: env.p.revision, fileHash: env.p.fileHash,
  text: env.text, password: EXP, masterPassword: PW, confirmed: true, ...extra });

test("empty vault: restore without the destructive confirmation; the destination keeps its master password", async () => {
  const env = await previewed([]);
  assert.deepEqual([env.p.currentCount, env.p.backupCount, env.p.onlyCurrent.count], [0, 3, 0]);
  const r = ok(await apply(env, { confirmed: false }));
  assert.deepEqual([r.replaced, r.previous, r.keptPrevious, r.locked], [3, 0, false, false]);
  assert.deepEqual(await names(env), ["Backup Mail", "Backup Bank", "Shared"]);
  assert.equal(ok(await env.call("previousStatus")).exists, false);
  ok(await env.call("lock"));
  assert.equal(err(await env.call("unlock", { password: OLD })), "invalid:unlock", "the backup's old password does not open it");
  ok(await env.call("unlock", { password: PW }));
});

test("populated vault: preview shows counts and names without secrets; confirmation required; replaced; previous vault kept", async () => {
  const env = await previewed();
  assert.deepEqual([env.p.currentCount, env.p.backupCount, env.p.inBoth], [3, 3, 1]);
  assert.deepEqual(env.p.onlyCurrent, { count: 2, names: ["Current Chat", "Current Cloud"] });
  assert.deepEqual(env.p.onlyBackup, { count: 2, names: ["Backup Mail", "Backup Bank"] });
  assert.ok(!JSON.stringify(env.p).includes(syntheticSecret(1)) && !JSON.stringify(env.p).includes(syntheticSecret(10)));
  const before = snap(env.local);
  assert.equal(err(await apply(env, { confirmed: false })), "invalid:replace-confirmation");
  assert.equal(snap(env.local), before, "nothing written without the confirmation");
  const r = ok(await apply(env));
  assert.deepEqual([r.replaced, r.previous, r.keptPrevious, r.revision], [3, 3, true, env.revision + 1]);
  assert.deepEqual(await names(env), ["Backup Mail", "Backup Bank", "Shared"]);
  const prev = ok(await env.call("previousStatus"));
  assert.deepEqual([prev.exists, prev.count], [true, 3]);
  ok(await env.call("lock"));
  ok(await env.call("unlock", { password: PW }));
  assert.equal(err(await env.call("unlock", { password: OLD })), "invalid:unlock");
});

test("review A: the export password is not kept; the apply re-authenticates the backup and needs it again", async () => {
  const env = await previewed();
  assert.ok(!JSON.stringify([...env.session.map]).includes(EXP), "no export password in storage.session");
  assert.equal(err(await apply(env, { password: undefined })), "invalid:password", "missing export password refused");
  assert.equal(err(await apply(env, { password: "another export password" })), "invalid:import-decrypt");
  assert.deepEqual(await names(env), ["Current Chat", "Current Cloud", "Shared here"]);
  ok(await apply(env));
});

test("wrong master password or export password: precise errors, nothing written, the preview stays usable", async () => {
  const env = await previewed();
  const before = snap(env.local);
  assert.equal(err(await apply(env, { masterPassword: "not the master password" })), "invalid:current-password");
  assert.equal(err(await apply(env, { password: "wrong export password!!" })), "invalid:import-decrypt");
  assert.equal(snap(env.local), before);
  ok(await apply(env));
  const fresh = await vault(PW, CURRENT);
  assert.equal(err(await fresh.call("replacePreview", { text: await backup(), password: "wrong export password!!" })), "invalid:import-decrypt");
});

test("damaged or malformed backup: refused at the preview, nothing written", async () => {
  const env = await vault(PW, CURRENT);
  const before = snap(env.local);
  const t = JSON.parse(await backup());
  t.ciphertext = (t.ciphertext[0] === "A" ? "B" : "A") + t.ciphertext.slice(1);
  assert.equal(err(await env.call("replacePreview", { text: JSON.stringify(t), password: EXP })), "invalid:import-decrypt");
  assert.match(err(await env.call("replacePreview", { text: "{not json", password: EXP })), /^(malformed|invalid)/);
  assert.equal(snap(env.local), before);
});

test("cancel, another file, a changed vault or a reused preview: conflict, nothing written", async () => {
  let env = await previewed();
  ok(await env.call("replaceCancel"));
  assert.equal(err(await apply(env)), "conflict");
  env = await previewed();
  assert.equal(err(await apply(env, { text: env.text.replace(/"exportedAt":"[^"]*"/, '"exportedAt":"x"') + " " })), "conflict");
  env = await previewed();
  const before = snap(env.local);
  ok(await env.make().handle({ cmd: "addAccount", revision: env.p.revision, account: acct("Other tab", 50) }));
  const changed = snap(env.local);
  assert.equal(err(await apply(env)), "conflict", "a vault that changed after the preview is never overwritten");
  assert.equal(snap(env.local), changed);
  assert.notEqual(changed, before);
  env = await previewed();
  ok(await apply(env));
  assert.equal(err(await apply(env)), "conflict", "a used preview cannot be applied twice");
});

test("session expired between preview and apply: locked, nothing written, never revived; after unlock the preview is gone", async () => {
  const env = await previewed();
  const before = snap(env.local);
  env.svc = env.make(); // event page restarted meanwhile
  env.clk.advance(16 * 60_000);
  assert.match(err(await apply(env)), /^locked/);
  assert.equal(snap(env.local), before);
  assert.deepEqual(await env.session.get(["session", "pendingReplace"]), {});
  ok(await env.call("unlock", { password: PW }));
  assert.equal(err(await apply(env)), "conflict");
  assert.deepEqual(await names(env), ["Current Chat", "Current Cloud", "Shared here"]);
});

test("the preview is not an activity: it never extends the session", async () => {
  const env = await vault(PW, CURRENT);
  const { session: s1 } = await env.session.get("session");
  env.clk.advance(60_000);
  ok(await env.call("replacePreview", { text: await backup(), password: EXP }));
  const { session: s2 } = await env.session.get("session");
  assert.equal(s2.deadline, s1.deadline);
});

test("storage failure while keeping the previous vault: nothing replaced, the preview stays, a retry works", async () => {
  const env = await previewed();
  const set = env.local.set.bind(env.local);
  env.local.set = async (o) => { if ("vault_previous" in o) throw new Error("quota"); return set(o); };
  assert.equal(err(await apply(env)), "invalid:replace-failed");
  env.local.set = set;
  assert.deepEqual(await names(env), ["Current Chat", "Current Cloud", "Shared here"]);
  ok(await apply(env));
  assert.deepEqual(await names(env), ["Backup Mail", "Backup Bank", "Shared"]);
});

test("storage failure while writing the new vault: rolled back, reported as failed without data loss, previous copy present", async () => {
  const env = await previewed();
  const set = env.local.set.bind(env.local);
  let n = 0;
  env.local.set = async (o) => { if ("vault" in o && n++ === 0) throw new Error("quota"); return set(o); };
  assert.equal(err(await apply(env)), "invalid:replace-failed");
  env.local.set = set;
  assert.deepEqual(await names(env), ["Current Chat", "Current Cloud", "Shared here"]);
  assert.equal(ok(await env.call("previousStatus")).count, 3);
});

test("browser terminated at every write boundary: the vault opens with the destination password and the old contents stay recoverable", async () => {
  for (let crashAt = 1; crashAt <= 6; crashAt++) {
    const env = await previewed();
    const set = env.local.set.bind(env.local), remove = env.local.remove.bind(env.local);
    let writes = 0, dead = false;
    const die = () => { dead = true; throw new Error("terminated"); };
    env.local.set = async (o) => { if (dead || ++writes >= crashAt) die(); return set(o); };
    env.local.remove = async (k) => { if (dead) die(); return remove(k); };
    await apply(env).catch(() => {});
    env.local.set = set; env.local.remove = remove;
    // restart: new service on the same storage, session storage gone
    env.session = fakeArea(); env.svc = env.make();
    let r = ok(await env.call("unlock", { password: PW }));
    if (r.recoverable) { ok(await env.call("restore", { password: PW, confirmed: true })); r = { unlocked: true }; }
    const now = await names(env);
    const OLDN = ["Current Chat", "Current Cloud", "Shared here"], NEWN = ["Backup Mail", "Backup Bank", "Shared"];
    assert.ok([OLDN, NEWN].some((x) => JSON.stringify(x) === JSON.stringify(now)), `crash at write ${crashAt}: ${now}`);
    if (JSON.stringify(now) === JSON.stringify(NEWN)) {
      assert.equal(ok(await env.call("previousStatus")).count, 3, `crash at write ${crashAt}: replaced, old copy kept`);
    }
  }
});

test("restore the previous vault (swap, nothing lost), discard it only explicitly, a password change drops it", async () => {
  const env = await previewed();
  ok(await apply(env));
  assert.equal(err(await env.call("restorePrevious", { masterPassword: PW })), "invalid:replace-confirmation");
  assert.equal(err(await env.call("restorePrevious", { masterPassword: "wrong master password!!", confirmed: true })), "invalid:current-password");
  ok(await env.call("restorePrevious", { masterPassword: PW, confirmed: true }));
  assert.deepEqual(await names(env), ["Current Chat", "Current Cloud", "Shared here"]);
  assert.equal(ok(await env.call("previousStatus")).count, 3, "the backup contents are now the kept copy");
  assert.equal(err(await env.call("discardPrevious", { masterPassword: PW })), "invalid:confirmation");
  ok(await env.call("discardPrevious", { masterPassword: PW, confirmed: true }));
  assert.equal(ok(await env.call("previousStatus")).exists, false);
  assert.equal(err(await env.call("restorePrevious", { masterPassword: PW, confirmed: true })), "invalid:no-previous");
  // a password change drops a kept copy (it belongs to the old generation)
  const env2 = await previewed();
  ok(await apply(env2));
  const NEWPW = "a brand new master password";
  const before = snap(env2.local);
  assert.equal(err(await env2.call("changePassword", { current: PW, next: NEWPW, confirm: NEWPW })), "invalid:previous-exists",
    "never dropped silently: the user must agree first (review B)");
  assert.equal(snap(env2.local), before, "password not changed, copy kept");
  assert.equal(ok(await env2.call("previousStatus")).exists, true);
  ok(await env2.call("changePassword", { current: PW, next: NEWPW, confirm: NEWPW, discardPrevious: true }));
  ok(await env2.call("unlock", { password: NEWPW }));
  assert.equal(ok(await env2.call("previousStatus")).exists, false);
  assert.equal(env2.local.map.has("vault_previous"), false);
});

test("no secret in storage.session, responses or the kept copy in plain text", async () => {
  const env = await previewed();
  const r = ok(await apply(env));
  const plain = JSON.stringify([...env.session.map, ...env.local.map, env.p, r]);
  for (const a of [...BACKUP, ...CURRENT]) assert.ok(!plain.includes(a.secret), a.name);
});
