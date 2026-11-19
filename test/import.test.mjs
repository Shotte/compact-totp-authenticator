// C5: applying a legacy totp.json or cta-plain v1 import through preview → apply.
// Synthetic secrets only. Real PBKDF2 for setup/unlock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createService } from "../src/lib/service.js";
import { PLAIN_FORMAT } from "../src/lib/export.js";
import { planImport } from "../src/lib/legacy.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "correct horse battery staple";
const LEGACY = readFileSync(new URL("./fixtures/legacy-synthetic.json", import.meta.url), "utf8");
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snap = (area) => JSON.stringify([...area.map]);
const S = (i) => syntheticSecret(i);

async function ready(existing = []) {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.svc = createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  ok(await env.call("setup", { password: PW, confirm: PW }));
  let revision = 1;
  for (const account of existing) ({ revision } = ok(await env.call("addAccount", { revision, account })));
  env.revision = revision;
  return env;
}
const list = async (env) => ok(await env.call("listAccounts")).accounts;
const legacy = (entries) => JSON.stringify({ otp_list: entries });

test("legacy totp.json: appends new, name-conflict and named needs-name rows; skips duplicates and invalid rows", async () => {
  const env = await ready([{ name: "Kept", secret: S(500), url: "kept.example" }]);
  const before = await list(env);
  const p = ok(await env.call("importPreview", { text: LEGACY }));
  assert.equal(p.revision, env.revision);
  assert.match(p.fileHash, /^[0-9a-f]{64}$/);
  const unnamed = p.rows.find((r) => r.status === "needs-name");
  const r = ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash, names: { [unnamed.index]: "Named later" } }));
  assert.deepEqual([r.imported, r.revision, r.locked], [6, env.revision + 1, false]);
  const after = await list(env);
  assert.deepEqual(after.slice(0, 1), before, "existing accounts unchanged and first");
  assert.deepEqual(after.slice(1).map((a) => a.name),
    ["Example Mail", "Demo Cloud", "Padded Key", "example mail", "Short Secret", "Named later"]);
  assert.ok(after.every((a) => a.algorithm === "SHA-1" && a.digits === 6 && a.period === 30));
  assert.equal(ok(await env.call("getCodes")).codes.length, 7); // 1 existing + 6 imported
});

test("preview and apply responses carry no secrets", async () => {
  const env = await ready();
  const p = ok(await env.call("importPreview", { text: LEGACY }));
  const r = ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash, names: { 10: "x" } }));
  const json = JSON.stringify([p, r]);
  for (const e of JSON.parse(LEGACY).otp_list) {
    if (typeof e?.key === "string" && e.key.length >= 10) assert.ok(!json.includes(e.key.replace(/[\s=]/g, "").toUpperCase()));
  }
  assert.ok(!("candidates" in p));
});

test("empty name: never dropped silently; apply without a valid replacement name writes nothing", async () => {
  const env = await ready();
  const text = legacy([{ name: "", key: S(1) }, { key: S(2) }, { name: "   ", key: S(3) }]);
  const p = ok(await env.call("importPreview", { text }));
  assert.deepEqual(p.rows.map((r) => r.status), ["needs-name", "needs-name", "needs-name"]);
  const before = snap(env.local);
  for (const names of [{}, { 0: "a", 1: "b" }, { 0: "a", 1: "b", 2: " " }, { 0: "a", 1: "b", 2: "x".repeat(101) }]) {
    assert.match(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash, names })), /^invalid:(import-name|name)$/);
    assert.equal(snap(env.local), before, "nothing written");
  }
  ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash, names: { 0: "a", 1: "b", 2: "c" } }));
  assert.deepEqual((await list(env)).map((a) => a.name), ["a", "b", "c"]);
});

test("same-name entries are kept; duplicates of existing secrets are skipped, never overwritten", async () => {
  const env = await ready([{ name: "Mail", secret: S(1), url: "old.example" }]);
  const text = legacy([{ name: "Mail", key: S(1), url: "new.example" }, { name: "Mail", key: S(2) }, { name: "Mail", key: S(3) }]);
  const p = ok(await env.call("importPreview", { text }));
  assert.deepEqual(p.rows.map((r) => r.status), ["duplicate", "name-conflict", "name-conflict"]);
  ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash }));
  const after = await list(env);
  assert.deepEqual(after.map((a) => [a.name, a.url]), [["Mail", "old.example"], ["Mail", ""], ["Mail", ""]]);
});

test("apply exactly what the preview showed: changed vault, other file, no preview, cancel → conflict, nothing written", async () => {
  const env = await ready();
  const text = legacy([{ name: "A", key: S(1) }]);
  // vault changed after the preview
  let p = ok(await env.call("importPreview", { text }));
  ok(await env.call("addAccount", { revision: p.revision, account: { name: "B", secret: S(2) } }));
  let before = snap(env.local);
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "conflict");
  assert.equal(snap(env.local), before);
  // the current revision sent with a preview made before the change: still a conflict
  const now = ok(await env.call("listAccounts")).revision;
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: now, fileHash: p.fileHash })), "conflict");
  assert.equal(snap(env.local), before);
  // a different file hash, a stale revision, a replaced preview
  p = ok(await env.call("importPreview", { text }));
  before = snap(env.local);
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: "0".repeat(64) })), "conflict");
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision - 1, fileHash: p.fileHash })), "conflict");
  const other = ok(await env.call("importPreview", { text: legacy([{ name: "C", key: S(3) }]) }));
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "conflict");
  // cancel drops the pending import
  ok(await env.call("importCancel"));
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: other.revision, fileHash: other.fileHash })), "conflict");
  assert.equal(snap(env.local), before, "nothing written");
});

test("lock between preview and apply: apply refused; after unlock the old preview is gone", async () => {
  const env = await ready();
  const p = ok(await env.call("importPreview", { text: legacy([{ name: "A", key: S(1) }]) }));
  ok(await env.call("lock"));
  assert.match(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), /^locked/);
  ok(await env.call("unlock", { password: PW }));
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "conflict");
  assert.equal((await list(env)).length, 0);
});

test("one commit: a failing write leaves the vault unchanged; a lock during the write reports the import", async () => {
  {
    const env = await ready([{ name: "Kept", secret: S(500) }]);
    const p = ok(await env.call("importPreview", { text: legacy([{ name: "A", key: S(1) }, { name: "B", key: S(2) }]) }));
    const set = env.local.set.bind(env.local);
    let writes = 0;
    env.local.set = async (o) => { if ("vault" in o) { writes++; throw new Error("quota"); } return set(o); };
    assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "internal");
    env.local.set = set;
    assert.equal(writes, 2, "one write and the store's rollback attempt");
    assert.deepEqual((await list(env)).map((a) => a.name), ["Kept"]);
  }
  {
    const env = await ready();
    const p = ok(await env.call("importPreview", { text: legacy([{ name: "A", key: S(1) }]) }));
    const set = env.local.set.bind(env.local);
    let locked = null;
    env.local.set = async (o) => { if ("vault" in o && !locked) locked = env.call("lock"); return set(o); };
    const r = ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash }));
    env.local.set = set;
    await locked;
    assert.deepEqual([r.imported, r.locked], [1, true]);
    ok(await env.call("unlock", { password: PW }));
    assert.deepEqual((await list(env)).map((a) => a.name), ["A"]);
  }
});

test("upper bound: the resulting vault may hold at most 1,000 accounts", async () => {
  const env = await ready();
  const first = legacy(Array.from({ length: 999 }, (_, i) => ({ name: `N${i}`, key: S(i + 1) })));
  let p = ok(await env.call("importPreview", { text: first }));
  ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash }));
  const before = snap(env.local);
  p = ok(await env.call("importPreview", { text: legacy([{ name: "X", key: S(5000) }, { name: "Y", key: S(5001) }]) }));
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "invalid:import-too-many");
  assert.equal(snap(env.local), before);
  p = ok(await env.call("importPreview", { text: legacy([{ name: "X", key: S(5000) }]) }));
  ok(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash }));
  assert.equal((await list(env)).length, 1000);
});

test("nothing importable (only duplicates or invalid rows): refused, nothing written", async () => {
  const env = await ready([{ name: "A", secret: S(1) }]);
  const p = ok(await env.call("importPreview", { text: legacy([{ name: "A", key: S(1) }, { name: "B", key: "!!" }]) }));
  const before = snap(env.local);
  assert.equal(err(await env.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash })), "invalid:import-nothing");
  assert.equal(snap(env.local), before);
});

test("cta-plain v1 (C4 export) imports through the same preview with every parameter kept", async () => {
  const src = await ready([
    { name: "Sha256", secret: S(1), algorithm: "SHA-256", digits: 8, period: 60, url: "a.example" },
    { name: "Short", secret: "MZXW6YTBOI" },
  ]);
  const { text } = ok(await src.call("exportVault", { kind: "plain", password: PW, confirmed: true }));
  const dst = await ready([{ name: "Existing", secret: S(9) }]);
  const p = ok(await dst.call("importPreview", { text }));
  assert.equal(p.format, PLAIN_FORMAT);
  assert.deepEqual(p.rows.map((r) => [r.status, r.warnings]), [["new", []], ["new", ["short-secret"]]]);
  ok(await dst.call("importApply", { masterPassword: PW, revision: p.revision, fileHash: p.fileHash }));
  const want = (await list(src)).map(({ id, ...a }) => a);
  assert.deepEqual((await list(dst)).slice(1).map(({ id, ...a }) => a), want);
});

test("cta-plain: missing or invalid parameters are never invented", () => {
  const file = (a) => JSON.stringify({ format: PLAIN_FORMAT, version: 1, accounts: [a] });
  const base = { name: "A", secret: S(1), url: "", algorithm: "SHA-1", digits: 6, period: 30 };
  for (const [patch, reason] of [[{ digits: undefined }, "parameters"], [{ algorithm: null }, "parameters"],
    [{ period: undefined }, "parameters"], [{ digits: 9 }, "digits"], [{ algorithm: "MD5" }, "algorithm"], [{ period: 5 }, "period"]]) {
    const { rows, candidates } = planImport(file({ ...base, ...patch }), []);
    assert.deepEqual([rows[0].status, rows[0].reason, candidates.length], ["invalid", reason, 0], JSON.stringify(patch));
  }
  assert.throws(() => planImport(JSON.stringify({ format: PLAIN_FORMAT, version: 2, accounts: [] }), []), { reason: "version" });
});

test("legacy.js keeps the cta-plain format name in sync with export.js", () => {
  const { rows } = planImport(JSON.stringify({ format: PLAIN_FORMAT, version: 1, accounts: [] }), []);
  assert.deepEqual(rows, []);
});
