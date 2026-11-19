// C4 export/import: cta-export v1 format, plaintext and legacy exports, gating through
// fresh master-password verification, round trip into a clean vault, tampering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createService } from "../src/lib/service.js";
import { deriveKey, newKdf } from "../src/lib/kdf.js";
import { encryptJson } from "../src/lib/crypto.js";
import { validateVault } from "../src/lib/vault.js";
import { parseExport, openExport, sealExport, accountsFromPortable, portable, legacyExport, MAX_EXPORT_BYTES,
  EXPORT_FORMAT } from "../src/lib/export.js";
import { legacyCompatibility } from "../src/lib/accounts.js";
import { exportRoundTripAccounts, syntheticSecret, syntheticAccounts } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const MIN = 60_000;
const PW = "correct horse battery staple", OTHER = "a different master password";
const EXP = "export passphrase – Ünïcödé ✓", WRONG = "definitely not the export password";
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snap = (area) => JSON.stringify([...area.map]);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/export-v1-portable.json", import.meta.url), "utf8"));

const subtle = globalThis.crypto.subtle, realDerive = subtle.deriveKey.bind(subtle);
let derivations = 0, onDerive = null;
subtle.deriveKey = (alg, ...rest) => {
  if (alg?.name === "PBKDF2") { derivations++; onDerive?.(derivations); }
  return realDerive(alg, ...rest);
};

async function vault(accounts = [], { password = PW, minutes } = {}) {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.svc = createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  if (minutes) await env.local.set({ settings: { autoLockMinutes: minutes } });
  ok(await env.call("setup", { password, confirm: password }));
  let revision = 1;
  for (const a of accounts) ({ revision } = ok(await env.call("addAccount", { revision, account: a })));
  env.full = async () => portable((await env.svc.authorizeSensitive(password)).payload.accounts);
  return env;
}
const encrypted = (env, extra = {}) => env.call("exportVault",
  { kind: "encrypted", password: PW, exportPassword: EXP, confirm: EXP, ...extra });

test("format: committed fixture opens on this platform with every parameter, order and Unicode intact", async () => {
  const f = parseExport(JSON.stringify(fixture.file));
  for (const pw of [fixture.password, fixture.password.normalize("NFD")]) {
    const p = await openExport(await deriveKey(pw, f.kdf), f);
    assert.deepEqual(p.accounts, exportRoundTripAccounts());
    assert.equal(p.exportedAt, fixture.exportedAt);
  }
  const nfd = exportRoundTripAccounts().find((a) => a.name.includes("NFD"));
  assert.notEqual(nfd.name, nfd.name.normalize("NFC"), "NFD account name kept byte-for-byte");
});

test("format: fresh salt and IV per export; vault and export are mutually unreadable", async () => {
  const env = await vault(exportRoundTripAccounts().slice(0, 2));
  const a = JSON.parse(ok(await encrypted(env)).text), b = JSON.parse(ok(await encrypted(env)).text);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.throws(() => validateVault(a), /format/);
  const { vault: v } = await env.local.get("vault");
  assert.throws(() => parseExport(JSON.stringify(v)), (e) => e.reason === "format");
});

test("format: every header field, the ciphertext and truncation are rejected; nothing decrypts", async () => {
  const f = fixture.file;
  const key = await deriveKey(fixture.password, f.kdf);
  const mutations = {
    version: (x) => { x.version = 2; }, extraKey: (x) => { x.extra = 1; }, missingKey: (x) => { delete x.cipher; },
    iterationsDown: (x) => { x.kdf.iterations = 599_999; }, iterationsUp: (x) => { x.kdf.iterations = 10_000_001; },
    hash: (x) => { x.kdf.hash = "SHA-1"; }, salt: (x) => { x.kdf.salt = "AAAAAAAAAAAAAAAAAAAAAA=="; },
    saltLength: (x) => { x.kdf.salt = "AAAA"; }, iv: (x) => { x.cipher.iv = "AAAAAAAAAAAAAAAA"; },
    tagLength: (x) => { x.cipher.tagLength = 96; }, cipher: (x) => { x.cipher.name = "AES-CBC"; },
    ciphertextBit: (x) => { const c = [...x.ciphertext]; c[10] = c[10] === "A" ? "B" : "A"; x.ciphertext = c.join(""); },
    truncated: (x) => { x.ciphertext = x.ciphertext.slice(0, -8); },
  };
  for (const [name, m] of Object.entries(mutations)) {
    const x = structuredClone(f); m(x);
    await assert.rejects(async () => openExport(key, parseExport(JSON.stringify(x))), (e) => e.code === "malformed", name);
  }
  assert.throws(() => parseExport(JSON.stringify(f).slice(0, -5)), (e) => e.reason === "json");
  assert.throws(() => parseExport("x".repeat(MAX_EXPORT_BYTES + 1)), (e) => e.reason === "too-large");
  await assert.rejects(openExport(await deriveKey(WRONG, f.kdf), f), (e) => e.reason === "decrypt");
});

test("format: an authenticated payload with an invalid account is rejected (no partial data)", async () => {
  const kdf = newKdf(), key = await deriveKey(EXP, kdf);
  const good = await sealExport(key, kdf, accountsFromPortable(exportRoundTripAccounts().slice(0, 1)), "t");
  const bad = { type: "cta-accounts", version: 1, exportedAt: "t",
    accounts: [{ name: "x", secret: "not base32!", url: "", algorithm: "SHA-1", digits: 6, period: 30 }] };
  const aad = JSON.stringify([EXPORT_FORMAT, 1, "PBKDF2", "SHA-256", kdf.iterations, kdf.salt, "AES-GCM", 128]);
  const { iv, ct } = await encryptJson(key, bad, aad);
  const f = { ...good, cipher: { ...good.cipher, iv }, ciphertext: ct };
  await assert.rejects(openExport(key, f), (e) => e.reason === "payload");
});

test("round trip: export → import into a clean vault (other profile, other master password) is identical", async () => {
  const src = await vault(exportRoundTripAccounts());
  const { text, count, fileName } = ok(await encrypted(src));
  assert.equal(count, 18);
  assert.match(fileName, /^cta-export-\d{4}-\d{2}-\d{2}\.json$/);
  const dst = await vault([], { password: OTHER });
  assert.deepEqual(ok(await dst.call("importExport", { text, password: EXP })).imported, 18);
  dst.full = async () => portable((await dst.svc.authorizeSensitive(OTHER)).payload.accounts);
  assert.deepEqual(await dst.full(), await src.full());
  assert.deepEqual(await dst.full(), exportRoundTripAccounts());
  // Codes match too (same secrets and parameters).
  const codes = async (e) => ok(await e.call("getCodes")).codes.map((c) => [c.name, c.code]);
  assert.deepEqual(await codes(dst), await codes(src));
});

test("round trip: empty vault and a large vault (1,000 accounts)", async () => {
  const empty = await vault();
  const e = ok(await encrypted(empty));
  assert.equal(e.count, 0);
  const dst = await vault();
  assert.equal(ok(await dst.call("importExport", { text: e.text, password: EXP })).imported, 0);
  const big = syntheticAccounts(1000).map(({ id, ...a }) => a);
  const src = await vault([]);
  const { revision } = ok(await src.call("listAccounts"));
  // Seed directly through one commit for speed (same validation path as addAccount).
  const { vault: v } = await src.local.get("vault");
  const auth = await src.svc.authorizeSensitive(PW);
  const { createVaultStore } = await import("../src/lib/vault.js");
  await createVaultStore(src.local).commit(auth.key, { accounts: accountsFromPortable(big) }, { expectedRevision: revision });
  assert.ok(v);
  const x = ok(await encrypted(src));
  assert.equal(x.count, 1000);
  const d2 = await vault();
  assert.equal(ok(await d2.call("importExport", { text: x.text, password: EXP })).imported, 1000);
  assert.deepEqual(portable((await d2.svc.authorizeSensitive(PW)).payload.accounts), big);
});

test("gating: no session, wrong master password, invalid export password; checks before PBKDF2", async () => {
  const env = await vault(exportRoundTripAccounts().slice(0, 3));
  const before = snap(env.local);
  let d0 = derivations;
  assert.equal(err(await encrypted(env, { exportPassword: "short", confirm: "short" })), "invalid:password-short");
  assert.equal(err(await encrypted(env, { confirm: EXP + "x" })), "invalid:password-mismatch");
  assert.equal(err(await encrypted(env, { exportPassword: PW.normalize("NFD"), confirm: PW })), "invalid:export-password-same");
  assert.equal(err(await env.call("exportVault", { kind: "plain", password: PW })), "invalid:confirmation");
  assert.equal(err(await env.call("exportVault", { kind: "legacy", password: PW, confirmed: false })), "invalid:confirmation");
  assert.equal(err(await env.call("exportVault", { kind: "csv", password: PW, confirmed: true })), "invalid:kind");
  assert.equal(derivations - d0, 0, "rejected before any PBKDF2");
  assert.equal(err(await encrypted(env, { password: "wrong master password!" })), "invalid:current-password");
  assert.equal(err(await encrypted(env, { password: undefined })), "invalid:current-password");
  ok(await env.call("lock"));
  d0 = derivations;
  assert.equal(err(await encrypted(env)), "locked:none");
  assert.equal(derivations - d0, 0);
  assert.equal(snap(env.local), before, "export never writes storage");
});

test("gating: the master password is required even while unlocked; explicit master-password export works", async () => {
  const env = await vault(exportRoundTripAccounts().slice(0, 2));
  const { session: s } = await env.session.get("session");
  assert.equal(err(await env.call("exportVault", { kind: "encrypted", password: s.key, exportPassword: EXP, confirm: EXP })),
    "invalid:current-password");
  const r = ok(await encrypted(env, { useMasterPassword: true, exportPassword: undefined, confirm: undefined }));
  const f = parseExport(r.text);
  assert.equal((await openExport(await deriveKey(PW, f.kdf), f)).accounts.length, 2);
});

test("gating: lock or expiry during an export returns nothing", async () => {
  const env = await vault(exportRoundTripAccounts().slice(0, 2), { minutes: 5 });
  // Lock while the EXPORT key is derived (after the master password was verified).
  for (const nth of [2, 3]) { // 2: export key, 3: self-check derivation
    const start = derivations;
    let locked = null;
    onDerive = (n) => { if (n === start + nth) locked = env.call("lock"); };
    const r = await encrypted(env);
    onDerive = null;
    await locked;
    assert.ok(locked, "lock fired during the export");
    assert.match(err(r), /^locked/, `lock at derivation ${nth}`);
    ok(await env.call("unlock", { password: PW }));
  }
  env.clk.advance(5 * MIN - 1);
  const get = env.local.get.bind(env.local);
  let moved = false;
  env.local.get = async (k) => { if (!moved && [k].flat().includes("vault")) { moved = true; env.clk.advance(1); } return get(k); };
  assert.match(err(await encrypted(env)), /^locked/);
});

test("responses: encrypted export contains no secret; plaintext contains every parameter, versioned", async () => {
  const accounts = exportRoundTripAccounts();
  const env = await vault(accounts);
  const enc = JSON.stringify(await encrypted(env));
  for (const a of accounts) assert.ok(!enc.includes(a.secret) && !enc.includes(a.name), "no secret or name in clear");
  assert.ok(!enc.includes(PW) && !enc.includes(EXP));
  const plain = ok(await env.call("exportVault", { kind: "plain", password: PW, confirmed: true }));
  const p = JSON.parse(plain.text);
  assert.deepEqual([p.format, p.version, typeof p.notice], ["cta-plain", 1, "string"]);
  assert.deepEqual(p.accounts, accounts);
  assert.match(plain.fileName, /^cta-plaintext-/);
  assert.ok(!plain.text.includes(PW));
});

test("legacy totp.json: produced only when nothing is lost; incompatible entries are named and refused", async () => {
  const compatible = [{ name: "Legacy ok", secret: syntheticSecret(1), url: "example.com", algorithm: "SHA-1", digits: 6, period: 30 }];
  const env = await vault(compatible);
  const r = ok(await env.call("exportVault", { kind: "legacy", password: PW, confirmed: true }));
  assert.equal(r.fileName, "totp.json");
  assert.deepEqual(JSON.parse(r.text), { otp_list: [{ name: "Legacy ok", key: syntheticSecret(1), url: "example.com" }] });
  const mixed = exportRoundTripAccounts().slice(0, 4);
  const c = legacyCompatibility(mixed);
  assert.equal(c.compatible, false);
  assert.deepEqual(c.incompatible.map((x) => [x.index, x.reasons]),
    [[1, ["algorithm", "period"]], [2, ["algorithm", "period"]], [3, ["digits", "period"]]]);
  assert.throws(() => legacyExport(mixed), (e) => e.reason === "legacy-incompatible");
  const env2 = await vault(mixed);
  const before = snap(env2.local);
  assert.equal(err(await env2.call("exportVault", { kind: "legacy", password: PW, confirmed: true })), "invalid:legacy-incompatible");
  assert.equal(snap(env2.local), before);
});

test("import: only into an empty vault; wrong password or tampering never writes", async () => {
  const src = await vault(exportRoundTripAccounts().slice(0, 3));
  const { text } = ok(await encrypted(src));
  const full = await vault(exportRoundTripAccounts().slice(3, 4));
  let before = snap(full.local);
  assert.equal(err(await full.call("importExport", { text, password: EXP })), "invalid:vault-not-empty");
  assert.equal(snap(full.local), before);
  const dst = await vault();
  before = snap(dst.local);
  assert.equal(err(await dst.call("importExport", { text, password: WRONG })), "invalid:import-decrypt");
  const t = JSON.parse(text); t.ciphertext = t.ciphertext.slice(0, -4) + (t.ciphertext.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(err(await dst.call("importExport", { text: JSON.stringify(t), password: EXP })), "invalid:import-decrypt");
  assert.equal(err(await dst.call("importExport", { text: "{", password: EXP })), "malformed:json");
  assert.equal(err(await dst.call("importExport", { text: "x".repeat(MAX_EXPORT_BYTES + 1), password: EXP })), "invalid:text");
  assert.equal(snap(dst.local), before);
  ok(await dst.call("lock"));
  assert.match(err(await dst.call("importExport", { text, password: EXP })), /^locked/);
  assert.equal(snap(dst.local), before);
});

test("import: lock during decryption writes nothing", async () => {
  const src = await vault(exportRoundTripAccounts().slice(0, 2));
  const { text } = ok(await encrypted(src));
  const dst = await vault();
  const before = snap(dst.local);
  const pending = dst.call("importExport", { text, password: EXP });
  await dst.call("lock");
  assert.match(err(await pending), /^locked/);
  assert.equal(snap(dst.local), before);
});

test("self-check: an export that does not decrypt back is never handed out", async () => {
  const env = await vault(exportRoundTripAccounts().slice(0, 2));
  const realEncrypt = subtle.encrypt.bind(subtle);
  let corrupt = true;
  subtle.encrypt = async (...a) => { // flip one bit of the first AES-GCM output (the export)
    const out = new Uint8Array(await realEncrypt(...a));
    if (corrupt) { corrupt = false; out[0] ^= 1; }
    return out.buffer;
  };
  try {
    const r = await encrypted(env);
    assert.equal(err(r), "invalid:export-verify");
    assert.equal(r.result, undefined);
  } finally { subtle.encrypt = realEncrypt; }
});
