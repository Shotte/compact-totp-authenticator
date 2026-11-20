// C6.1: end-to-end security regression on the background boundary. One complete lifecycle
// (setup, accounts, import, exports, restore, password change, lock, expiry, crash restart,
// write faults) while every response and every storage area is checked for secrets and
// passwords. Only the explicitly confirmed unencrypted exports may carry secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { exportRoundTripAccounts, syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "regression passphrase one ✓", PW2 = "regression passphrase two ✓", EXP = "regression export passphrase ✓";
const ACCOUNTS = exportRoundTripAccounts();
const SECRETS = [...ACCOUNTS.map((a) => a.secret), syntheticSecret(4000), syntheticSecret(4001)];
const SENSITIVE = [...SECRETS, PW, PW2, EXP];
const leaksIn = (text) => SENSITIVE.filter((s) => text.includes(s) || text.includes(s.toLowerCase()));
const MAY_CARRY_SECRETS = new Set(["exportVault:plain", "exportVault:legacy"]);

test("full lifecycle: no secret or password in any response (except confirmed plaintext exports) or in storage", async () => {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  let svc = createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  const log = [];
  const call = async (cmd, args = {}, tag = cmd) => {
    const r = await svc.handle({ cmd, ...args });
    log.push({ tag, r });
    if (!r.ok) assert.deepEqual(Object.keys(r).sort().filter((k) => k !== "reason"), ["error", "ok"], `${tag}: error carries data`);
    return r;
  };
  const storage = () => JSON.stringify([[...env.local.map], [...env.session.map].map(([k, v]) => [k, { ...v, key: "[CryptoKey]" }])]);
  const sweep = (step) => {
    assert.deepEqual(leaksIn(storage()), [], `storage after ${step}`);
    assert.doesNotMatch(JSON.stringify([...env.local.map]), /"(secret|otp_list)"\s*:/, `plaintext fields after ${step}`);
  };

  // setup with a wrong confirmation first, then accounts
  await call("setup", { password: PW, confirm: PW + "x" });
  await call("setup", { password: PW, confirm: PW });
  let revision = 1;
  for (const account of ACCOUNTS) revision = (await call("addAccount", { revision, account })).result.revision;
  await call("addAccount", { revision: revision - 1, account: { name: "stale", secret: syntheticSecret(4002) } }); // conflict
  sweep("accounts");
  await call("getCodes");
  await call("listAccounts");

  // import with preview, wrong master password, then the right one
  const text = JSON.stringify({ otp_list: [{ name: "Imp", key: syntheticSecret(4000) }, { name: "", key: syntheticSecret(4001) }] });
  const p = (await call("importPreview", { text })).result;
  await call("importApply", { revision: p.revision, fileHash: p.fileHash, text, names: { 1: "Ohne Namen 1" }, masterPassword: PW2 });
  revision = (await call("importApply", { revision: p.revision, fileHash: p.fileHash, text, names: { 1: "Ohne Namen 1" }, masterPassword: PW })).result.revision;
  sweep("import");

  // exports: encrypted (no secrets in the text), plaintext and legacy only when confirmed
  const enc = await call("exportVault", { kind: "encrypted", password: PW, exportPassword: EXP, confirm: EXP }, "exportVault:encrypted");
  await call("exportVault", { kind: "plain", password: PW }, "exportVault:plain-unconfirmed");
  await call("exportVault", { kind: "plain", password: PW, confirmed: true }, "exportVault:plain");
  await call("exportVault", { kind: "legacy", password: PW, confirmed: true }, "exportVault:legacy");
  await call("exportVault", { kind: "encrypted", password: PW2, exportPassword: EXP, confirm: EXP }, "exportVault:wrong-master");
  sweep("exports");

  // password change, lock, expiry, a crash restart (new service instance, session area kept
  // as Firefox would only on a crash before onStartup cleared it)
  await call("changePassword", { current: PW, next: PW2, confirm: PW2 });
  await call("unlock", { password: PW });
  await call("unlock", { password: PW2 });
  await call("lock");
  await call("getCodes");
  await call("unlock", { password: PW2 });
  env.clk.advance(31 * 60_000);
  await call("listAccounts");
  svc = createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  await call("unlock", { password: PW2 });
  sweep("password change, lock, expiry, restart");

  // restore into an empty vault in a second profile
  const dst = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms() };
  const svc2 = createService({ ...dst, now: env.clk.now });
  const r2 = async (cmd, args, tag) => { const r = await svc2.handle({ cmd, ...args }); log.push({ tag: tag ?? `restore:${cmd}`, r }); return r; };
  await r2("setup", { password: PW, confirm: PW });
  await r2("importExport", { text: enc.result.text, password: EXP + "x", masterPassword: PW });
  await r2("importExport", { text: enc.result.text, password: EXP, masterPassword: PW });
  assert.deepEqual(leaksIn(JSON.stringify([...dst.local.map])), [], "restored storage");

  // write faults: a failing write and an unreadable store answer without data
  const set = env.local.set.bind(env.local);
  env.local.set = async (o) => { if ("vault" in o) throw new Error("quota"); return set(o); };
  const list = (await call("listAccounts")).result;
  await call("moveAccount", { id: list.accounts[0].id, toIndex: 1, revision: list.revision }, "moveAccount:fault");
  env.local.set = set;
  sweep("write fault");

  for (const { tag, r } of log) {
    const found = leaksIn(JSON.stringify(r));
    if (MAY_CARRY_SECRETS.has(tag)) continue;
    assert.deepEqual(found, [], `${tag} leaks`);
  }
  // the confirmed plaintext exports really are the only carriers, and they are complete
  const plain = log.find((x) => x.tag === "exportVault:plain").r.result.text;
  for (const s of ACCOUNTS.map((a) => a.secret)) assert.ok(plain.includes(s));
  assert.equal(log.find((x) => x.tag === "exportVault:plain-unconfirmed").r.reason, "confirmation");
  assert.equal(log.find((x) => x.tag === "exportVault:wrong-master").r.reason, "current-password");
  assert.equal(log.find((x) => x.tag === "moveAccount:fault").r.error, "internal");
});

test("unknown commands, malformed arguments and prototype keys answer with a code only", async () => {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms() };
  const svc = createService(env);
  for (const msg of [null, 42, "x", {}, { cmd: "__proto__" }, { cmd: "constructor" }, { cmd: "toString" },
    { cmd: "authorizeSensitive", password: PW }, { cmd: "hasPendingImport" }, { cmd: "addAccount", revision: "1" },
    { cmd: "importPreview", text: 5 }, { cmd: "importExport", text: "x".repeat(9_000_000) }, { cmd: "importApply", fileHash: 1 }]) {
    const r = await svc.handle(msg);
    assert.equal(r.ok, false, JSON.stringify(msg)?.slice(0, 80));
    assert.deepEqual(Object.keys(r).filter((k) => r[k] !== undefined).sort().filter((k) => k !== "reason"), ["error", "ok"]);
    assert.ok(["invalid", "locked"].includes(r.error), `${r.error} for ${JSON.stringify(msg)?.slice(0, 60)}`);
  }
});
