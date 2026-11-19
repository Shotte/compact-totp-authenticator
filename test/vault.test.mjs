import { test } from "node:test";
import assert from "node:assert/strict";
import { sealVault, openVault, validateVault, createVaultStore, aad, VaultError, sameGeneration,
  MIN_ITERATIONS, MAX_ITERATIONS, MAX_CIPHERTEXT_LENGTH } from "../src/lib/vault.js";
import { newAesKey, toB64, fromB64 } from "../src/lib/crypto.js";
import { syntheticAccounts } from "./helpers/fixtures.mjs";
import { fakeArea } from "./helpers/fakes.mjs";

const KDF = { iterations: MIN_ITERATIONS, salt: toB64(new Uint8Array(16).fill(7)) };
const payload = (n = 3) => ({ accounts: syntheticAccounts(n) });
const reason = (r) => (e) => e instanceof VaultError && e.reason === r;
const clone = (o) => structuredClone(o);

test("seal/open round trip with strict header", async () => {
  const key = await newAesKey();
  const v = await sealVault(key, payload(), { revision: 1, kdf: KDF });
  assert.deepEqual(Object.keys(v), ["format", "version", "revision", "kdf", "cipher", "ciphertext"]);
  assert.equal(v.format, "cta-vault");
  assert.equal(v.version, 1);
  assert.equal(fromB64(v.cipher.iv).length, 12);
  assert.deepEqual(await openVault(key, v), payload());
  assert.ok(!JSON.stringify(v).includes(payload().accounts[0].secret), "no plaintext secret in the stored object");
});

test("wrong key is rejected", async () => {
  const v = await sealVault(await newAesKey(), payload(), { revision: 1, kdf: KDF });
  await assert.rejects(openVault(await newAesKey(), v), reason("decrypt"));
});

test("every authenticated header field is bound to the ciphertext (AAD)", async () => {
  const key = await newAesKey();
  const v = await sealVault(key, payload(), { revision: 5, kdf: KDF });
  const otherSalt = toB64(new Uint8Array(16).fill(9));
  const otherIv = toB64(new Uint8Array(12).fill(1));
  const flip = (s) => { const b = fromB64(s); b[0] ^= 1; return toB64(b); };
  const tamper = {
    revision: (x) => { x.revision = 6; },                          // rollback/replay of a different revision
    iterations: (x) => { x.kdf.iterations = MIN_ITERATIONS + 1; }, // KDF downgrade/upgrade
    salt: (x) => { x.kdf.salt = otherSalt; },
    iv: (x) => { x.cipher.iv = otherIv; },                         // authenticated by GCM itself
    ciphertext: (x) => { x.ciphertext = flip(x.ciphertext); },
    truncated: (x) => { x.ciphertext = toB64(fromB64(x.ciphertext).slice(0, -1)); },
  };
  for (const [name, fn] of Object.entries(tamper)) {
    const t = clone(v); fn(t);
    await assert.rejects(openVault(key, t), reason("decrypt"), name);
  }
});

test("header validation rejects before decrypting", async () => {
  const key = await newAesKey();
  const v = await sealVault(key, payload(), { revision: 1, kdf: KDF });
  const bad = [
    ["format", (x) => { x.format = "cta-export"; }, "format"],
    ["version 2", (x) => { x.version = 2; }, "version"],
    ["version string", (x) => { x.version = "1"; }, "version"],
    ["revision 0", (x) => { x.revision = 0; }, "header"],
    ["revision float", (x) => { x.revision = 1.5; }, "header"],
    ["kdf name", (x) => { x.kdf.name = "scrypt"; }, "header"],
    ["kdf hash", (x) => { x.kdf.hash = "SHA-1"; }, "header"],
    ["iterations too low", (x) => { x.kdf.iterations = MIN_ITERATIONS - 1; }, "header"],
    ["iterations too high", (x) => { x.kdf.iterations = MAX_ITERATIONS + 1; }, "header"],
    ["salt length", (x) => { x.kdf.salt = toB64(new Uint8Array(8)); }, "header"],
    ["salt not base64", (x) => { x.kdf.salt = "%%%"; }, "header"],
    ["iv length", (x) => { x.cipher.iv = toB64(new Uint8Array(16)); }, "header"],
    ["cipher name", (x) => { x.cipher.name = "AES-CBC"; }, "header"],
    ["tag length", (x) => { x.cipher.tagLength = 96; }, "header"],
    ["empty ciphertext", (x) => { x.ciphertext = ""; }, "header"],
    ["oversized ciphertext", (x) => { x.ciphertext = "A".repeat(MAX_CIPHERTEXT_LENGTH + 4); }, "header"],
    ["oversized salt string", (x) => { x.kdf.salt = "A".repeat(1_000_000); }, "header"],
    ["unknown top-level key", (x) => { x.extra = 1; }, "header"],
    ["unknown kdf key", (x) => { x.kdf.extra = 1; }, "header"],
    ["missing cipher", (x) => { delete x.cipher; }, "header"],
  ];
  for (const [name, fn, r] of bad) {
    const t = clone(v); fn(t);
    assert.throws(() => validateVault(t), reason(r), name);
    await assert.rejects(openVault(key, t), reason(r), name);
  }
  for (const junk of [null, undefined, 1, "x", [], {}]) assert.throws(() => validateVault(junk), VaultError);
});

test("AAD covers all security-relevant metadata", () => {
  const v = { format: "cta-vault", version: 1, revision: 3, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "s" },
    cipher: { name: "AES-GCM", iv: "i", tagLength: 128 } };
  assert.equal(aad(v), JSON.stringify(["cta-vault", 1, 3, "PBKDF2", "SHA-256", 600000, "s", "AES-GCM", 128]));
});

test("invalid payloads are never sealed or returned", async () => {
  const key = await newAesKey();
  for (const p of [null, {}, { accounts: {} }, { accounts: [{ id: 1, name: "n", secret: "s" }] }]) {
    await assert.rejects(sealVault(key, p, { revision: 1, kdf: KDF }), reason("payload"));
  }
});

test("nonce: a fresh random 96-bit IV for every seal (10,000 seals, no repeats)", async () => {
  const key = await newAesKey();
  const ivs = new Set(), cts = new Set();
  const p = payload(1);
  for (let i = 0; i < 10_000; i++) {
    const v = await sealVault(key, p, { revision: 1, kdf: KDF });
    ivs.add(v.cipher.iv); cts.add(v.ciphertext);
  }
  assert.equal(ivs.size, 10_000);
  assert.equal(cts.size, 10_000, "same payload never yields the same ciphertext");
});

// ---- storage protocol -------------------------------------------------------

const KDF2 = { iterations: MIN_ITERATIONS, salt: toB64(new Uint8Array(16).fill(8)) }; // second key generation
const gen = (v) => v.kdf.salt;
const damage = (v) => { v.ciphertext = v.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A")); };
const snapshot = (area) => clone([...area.map]);
function fakeAreaFrom(map) { const a = fakeArea(); for (const [k, v] of map) a.map.set(k, clone(v)); return a; }

async function setup(n = 2) {
  const area = fakeArea(), key = await newAesKey(), store = createVaultStore(area);
  await store.create(key, payload(n), { kdf: KDF });
  return { area, key, store };
}

// Area wrapper with fault injection on the n-th set() call. Modes:
// throw – set fails, storage stays usable; dead – set fails, storage unusable afterwards;
// corrupt – value lands damaged; corrupt-then-dead / write-then-dead – value lands
// (damaged / intact), then storage becomes unusable (process "crash" right after the write).
function faulty(area, failOn) {
  let n = 0, dead = false;
  const kill = () => { dead = true; throw new Error("storage gone (simulated crash)"); };
  return { map: area.map, get: (k) => area.get(k),
    async remove(k) { if (dead) throw new Error("storage gone"); return area.remove(k); },
    async set(obj) {
      if (dead) throw new Error("storage gone");
      const f = failOn(++n, obj);
      const [k, v] = Object.entries(obj)[0];
      if (f === "throw") throw new Error("QuotaExceededError (simulated)");
      if (f === "dead") kill();
      if (f === "corrupt" || f === "corrupt-then-dead") { const d = clone(v); damage(d); await area.set({ [k]: d }); if (f === "corrupt-then-dead") kill(); return; }
      if (f === "write-then-dead") { await area.set(obj); kill(); }
      return area.set(obj);
    } };
}

// After a "restart": which key opens the vault (directly or via explicit recovery)?
async function whoOpens(map, oldKey, newKey) {
  const out = {};
  for (const [name, key] of [["old", oldKey], ["new", newKey]]) {
    try { const r = await createVaultStore(fakeAreaFrom(map)).load(key); out[name] = r.status + (r.source ? `:${r.source}` : ""); }
    catch (e) { out[name] = e.reason; }
  }
  return out;
}

test("create: first vault only; refuses when any vault copy exists", async () => {
  const { area, key, store } = await setup(2);
  assert.deepEqual(await store.load(key), { status: "ok", revision: 1, payload: payload(2) });
  await assert.rejects(store.create(key, payload(3), { kdf: KDF }), reason("exists"));
  for (const k of ["vault_backup", "vault_next"]) {
    const a = fakeArea(); a.map.set(k, clone(area.map.get("vault")));
    await assert.rejects(createVaultStore(a).create(key, payload(3), { kdf: KDF }), reason("exists"), k);
  }
});

test("commit: next revision, same key generation, backup holds the previous vault", async () => {
  const { area, key, store } = await setup(2);
  const before = clone(area.map.get("vault"));
  assert.equal(await store.commit(key, payload(4), { expectedRevision: 1 }), 2);
  assert.deepEqual(area.map.get("vault_backup"), before);
  assert.ok(sameGeneration(area.map.get("vault").kdf, before.kdf), "commit keeps the KDF parameters");
  assert.deepEqual(await store.load(key), { status: "ok", revision: 2, payload: payload(4) });
});

test("R2: an unrelated key cannot replace the vault, even with the correct revision", async () => {
  const { area, store } = await setup(2);
  const snap = snapshot(area);
  await assert.rejects(store.commit(await newAesKey(), payload(9), { expectedRevision: 1 }), reason("auth"));
  await assert.rejects(store.rotate(await newAesKey(), await newAesKey(), { expectedRevision: 1, kdf: KDF2 }), reason("auth"));
  assert.deepEqual(snapshot(area), snap);
});

test("R2: a damaged current vault is never overwritten by a regular commit", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  damage(area.map.get("vault"));
  const snap = snapshot(area);
  await assert.rejects(store.commit(key, payload(9), { expectedRevision: 2 }), reason("auth"));
  assert.deepEqual(snapshot(area), snap);
});

test("revision conflicts are preserved; concurrent commit/rotate on one revision: one wins", async () => {
  const { area, key, store } = await setup(2);
  const snap = snapshot(area);
  for (const r of [0, 2, 7]) await assert.rejects(store.commit(key, payload(5), { expectedRevision: r }), reason("conflict"));
  assert.deepEqual(snapshot(area), snap);
  const newKey = await newAesKey();
  const results = await Promise.allSettled([
    store.commit(key, payload(4), { expectedRevision: 1 }),
    store.rotate(key, newKey, { expectedRevision: 1, kdf: KDF2 }),
    store.commit(key, payload(6), { expectedRevision: 1 }),
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "rejected"]);
  assert.ok(results.slice(1).every((r) => r.reason.reason === "conflict"));
  assert.equal(gen(area.map.get("vault")), KDF.salt, "the losing rotation changed nothing");
});

test("R1: wrong keys never write and never restore (intact or damaged vault)", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  const wrong = await newAesKey();
  for (const broken of [false, true]) {
    if (broken) damage(area.map.get("vault"));
    const snap = snapshot(area);
    await assert.rejects(store.load(wrong), reason("decrypt"));
    await assert.rejects(store.restoreBackup(wrong), reason("refused"));
    await assert.rejects(store.restoreBackup(wrong, { allowUnverifiedGeneration: true }), reason("refused"));
    assert.deepEqual(snapshot(area), snap);
  }
});

test("R1: damaged primary + valid same-generation backup: 'recoverable' read-only, explicit restore", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  damage(area.map.get("vault"));
  const snap = snapshot(area);
  const r = await store.load(key);
  assert.deepEqual([r.status, r.source, r.revision, r.damage, r.generationVerified], ["recoverable", "backup", 1, "decrypt", true]);
  assert.deepEqual(snapshot(area), snap, "load is read-only");
  assert.deepEqual(await store.restoreBackup(key), { revision: 1, source: "backup" });
  assert.deepEqual(await store.load(key), { status: "ok", revision: 1, payload: payload(2) });
});

test("valid primary + stale backup: load uses the primary; restore refused", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  await store.commit(key, payload(4), { expectedRevision: 2 });
  const snap = snapshot(area);
  assert.equal((await store.load(key)).revision, 3);
  await assert.rejects(store.restoreBackup(key), (e) => e.reason === "refused" && /current-valid/.test(e.message));
  assert.deepEqual(snapshot(area), snap);
});

test("corrupted backup: valid primary unaffected; with a damaged primary too, nothing is written", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  damage(area.map.get("vault_backup"));
  assert.equal((await store.load(key)).status, "ok");
  damage(area.map.get("vault"));
  const snap = snapshot(area);
  await assert.rejects(store.load(key), reason("decrypt"));
  await assert.rejects(store.restoreBackup(key), reason("refused"));
  assert.deepEqual(snapshot(area), snap);
});

test("different salts: recovery never crosses key generations", async () => {
  const { area, key } = await setup(2);
  const otherKey = await newAesKey();
  // backup of another generation that opens with otherKey; primary damaged
  area.map.set("vault_backup", await sealVault(otherKey, payload(5), { revision: 1, kdf: KDF2 }));
  damage(area.map.get("vault"));
  const store = createVaultStore(area);
  const snap = snapshot(area);
  for (const k of [key, otherKey]) {
    await assert.rejects(store.load(k), reason("decrypt"));
    await assert.rejects(store.restoreBackup(k, { allowUnverifiedGeneration: true }), reason("refused"));
  }
  assert.deepEqual(snapshot(area), snap);
});

test("structurally destroyed primary: recoverable only with explicit unverified-generation consent", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  area.map.set("vault", { garbage: true });
  const r = await store.load(key);
  assert.deepEqual([r.status, r.damage, r.generationVerified], ["recoverable", "header", false]);
  await assert.rejects(store.restoreBackup(key), (e) => /generation-unverified/.test(e.message));
  assert.deepEqual(area.map.get("vault"), { garbage: true });
  await assert.rejects(store.load(await newAesKey()), reason("corrupt"));
  assert.equal((await store.restoreBackup(key, { allowUnverifiedGeneration: true })).revision, 1);
  assert.equal((await store.load(key)).status, "ok");
});

test("rotate: old key and new salt required; afterwards only the new password opens", async () => {
  const { area, key, store } = await setup(2);
  const newKey = await newAesKey();
  await assert.rejects(store.rotate(key, newKey, { expectedRevision: 1, kdf: KDF }), reason("generation"));
  assert.deepEqual(await store.rotate(key, newKey, { expectedRevision: 1, kdf: KDF2 }), { revision: 2, backupRefreshed: true });
  assert.deepEqual([gen(area.map.get("vault")), gen(area.map.get("vault_backup")), area.map.has("vault_next")],
    [KDF2.salt, KDF2.salt, false], "no old-generation copy remains");
  assert.deepEqual(await whoOpens(area.map, key, newKey), { old: "decrypt", new: "ok" });
  await assert.rejects(store.restoreBackup(key, { allowUnverifiedGeneration: true }), reason("refused"));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 2 }), reason("auth"));
});

// Rotation set() order: 1 vault_next, 2 vault_backup (old), 3 vault (switch), 4 vault_backup (new).
const ROTATION_CASES = [
  // [label, set#, mode, expected { old, new } after restart]
  ["1 before writing the new vault (staging fails)", 1, "throw", { old: "ok", new: "decrypt" }],
  ["1b crash while staging", 1, "corrupt-then-dead", { old: "ok", new: "decrypt" }],
  ["2 crash after staging, before the rollback copy", 2, "dead", { old: "ok", new: "decrypt" }],
  ["2b crash after the rollback copy (backup prepared)", 3, "dead", { old: "ok", new: "decrypt" }],
  ["3 primary write fails (storage alive, rolled back)", 3, "throw", { old: "ok", new: "decrypt" }],
  ["3b primary write damaged, then crash", 3, "corrupt-then-dead", { old: "decrypt", new: "recoverable:staged" }],
  ["4 crash after writing the primary, before verifying", 3, "write-then-dead", { old: "decrypt", new: "ok" }],
  ["5 crash after verification, before updating the backup", 4, "dead", { old: "decrypt", new: "ok" }],
  ["6 backup replacement fails (storage alive)", 4, "throw", { old: "decrypt", new: "ok" }],
  ["6b backup replacement damaged", 4, "corrupt", { old: "decrypt", new: "ok" }],
];

for (const [label, at, mode, expected] of ROTATION_CASES) {
  test(`rotation interrupted – ${label}: old ${expected.old}, new ${expected.new}`, async () => {
    const { area, key } = await setup(2);
    const newKey = await newAesKey();
    const store = createVaultStore(faulty(area, (n) => (n === at ? mode : null)));
    await store.rotate(key, newKey, { expectedRevision: 1, kdf: KDF2 }).catch(() => {});
    assert.deepEqual(await whoOpens(area.map, key, newKey), expected);
    // Never locked out: at least one password opens or recovers the data, which is intact.
    const working = expected.old === "ok" ? key : newKey;
    const s = createVaultStore(fakeAreaFrom(area.map));
    if ((await s.load(working)).status === "recoverable") await s.restoreBackup(working);
    assert.deepEqual((await s.load(working)).payload, payload(2));
    // The old password can never reverse a completed switch (cases 3b–6b).
    if (expected.old !== "ok") await assert.rejects(s.restoreBackup(key, { allowUnverifiedGeneration: true }), reason("refused"));
  });
}

test("leftover old-generation backup is replaced by the next regular commit", async () => {
  const { area, key } = await setup(2);
  const newKey = await newAesKey();
  await createVaultStore(faulty(area, (n) => (n === 4 ? "throw" : null))).rotate(key, newKey, { expectedRevision: 1, kdf: KDF2 });
  assert.equal(gen(area.map.get("vault_backup")), KDF.salt);
  await createVaultStore(area).commit(newKey, payload(4), { expectedRevision: 2 });
  assert.equal(gen(area.map.get("vault_backup")), KDF2.salt);
});

test("storage failures during a regular commit: rolled back or recoverable, never lost", async () => {
  for (const [at, mode] of [[1, "throw"], [2, "throw"], [2, "corrupt"], [2, "dead"], [2, "corrupt-then-dead"], [2, "write-then-dead"]]) {
    const { area, key } = await setup(2);
    await createVaultStore(faulty(area, (n) => (n === at ? mode : null))).commit(key, payload(5), { expectedRevision: 1 }).catch(() => {});
    const s = createVaultStore(fakeAreaFrom(area.map));
    const r = await s.load(key);
    if (r.status === "recoverable") await s.restoreBackup(key);
    const final = await s.load(key);
    const ok = JSON.stringify(final.payload) === JSON.stringify(payload(2)) || JSON.stringify(final.payload) === JSON.stringify(payload(5));
    assert.ok(final.status === "ok" && ok, `set#${at} ${mode}: ${JSON.stringify(final.status)}`);
  }
});

test("both copies unreadable: error, nothing deleted; empty storage loads as null", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1 });
  for (const k of ["vault", "vault_backup"]) area.map.get(k).version = 9;
  const snap = snapshot(area);
  await assert.rejects(store.load(key), reason("corrupt"));
  await assert.rejects(store.restoreBackup(key, { allowUnverifiedGeneration: true }), reason("refused"));
  assert.deepEqual(snapshot(area), snap);
  assert.equal(await createVaultStore(fakeArea()).load(key), null);
});
