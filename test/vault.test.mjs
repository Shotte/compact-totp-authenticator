import { test } from "node:test";
import assert from "node:assert/strict";
import { sealVault, openVault, validateVault, createVaultStore, aad, VaultError,
  MIN_ITERATIONS, MAX_ITERATIONS } from "../src/lib/vault.js";
import { newAesKey, toB64, fromB64 } from "../src/lib/crypto.js";
import { syntheticAccounts } from "../src/lib/fixtures.js";
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

async function setup(n = 3) {
  const area = fakeArea(), key = await newAesKey(), store = createVaultStore(area);
  await store.commit(key, payload(n), { expectedRevision: 0, kdf: KDF });
  return { area, key, store };
}

test("commit: first write, next revision, backup holds the previous vault", async () => {
  const { area, key, store } = await setup(2);
  const before = clone(area.map.get("vault"));
  assert.equal(await store.commit(key, payload(4), { expectedRevision: 1, kdf: KDF }), 2);
  assert.deepEqual(area.map.get("vault_backup"), before);
  assert.deepEqual(await store.load(key), { revision: 2, payload: payload(4), restored: false });
});

test("commit: stale revision is a conflict and writes nothing", async () => {
  const { area, key, store } = await setup();
  const snap = clone([...area.map]);
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 0, kdf: KDF }), reason("conflict"));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 7, kdf: KDF }), reason("conflict"));
  assert.deepEqual([...area.map], snap);
});

test("concurrent commits on the same revision: exactly one wins", async () => {
  const { key, store } = await setup();
  const results = await Promise.allSettled([4, 5, 6].map((n) => store.commit(key, payload(n), { expectedRevision: 1, kdf: KDF })));
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected", "rejected"]);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.reason === "conflict"));
  assert.equal((await store.load(key)).revision, 2);
});

// Area wrapper that fails selected set() calls.
function faulty(area, failOn) {
  let n = 0;
  return { ...area, map: area.map, async set(obj) {
    n++;
    const f = failOn(n, obj);
    if (f === "throw") throw new Error("QuotaExceededError (simulated)");
    if (f === "corrupt") { const v = clone(obj.vault); v.ciphertext = v.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A")); return area.set({ vault: v }); }
    if (f === "dead") { area.set = async () => { throw new Error("storage gone"); }; throw new Error("storage gone"); }
    if (f === "corrupt-then-dead") { // bad new vault lands on disk, then storage fails for good
      const v = clone(obj.vault); v.ciphertext = v.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A"));
      await area.set({ vault: v });
      const real = area.set; area.set = async () => { throw new Error("storage gone"); }; area.restore = () => { area.set = real; };
      return undefined;
    }
    return area.set(obj);
  } };
}

test("storage failure writing the new vault: rolled back, old vault intact", async () => {
  const { area, key } = await setup(2);
  const old = clone(area.map.get("vault"));
  const store = createVaultStore(faulty(area, (n, obj) => ("vault" in obj && n === 2 ? "throw" : null)));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 1, kdf: KDF }), reason("write"));
  assert.deepEqual(area.map.get("vault"), old);
  assert.deepEqual((await store.load(key)).payload, payload(2));
});

test("storage failure writing the backup: nothing changed", async () => {
  const { area, key } = await setup(2);
  const snap = clone([...area.map]);
  const store = createVaultStore(faulty(area, (n, obj) => ("vault_backup" in obj ? "throw" : null)));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 1, kdf: KDF }));
  assert.deepEqual([...area.map], snap);
});

test("silent corruption detected by read-back verification: rolled back", async () => {
  const { area, key } = await setup(2);
  const old = clone(area.map.get("vault"));
  const store = createVaultStore(faulty(area, (n, obj) => ("vault" in obj && n === 2 ? "corrupt" : null)));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 1, kdf: KDF }), reason("write"));
  assert.deepEqual(area.map.get("vault"), old);
});

test("crash mid-commit (storage dies, rollback impossible): next load still recovers", async () => {
  const { area, key } = await setup(2);
  const store = createVaultStore(faulty(area, (n, obj) => ("vault" in obj && n === 2 ? "dead" : null)));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 1, kdf: KDF }));
  const fresh = createVaultStore(fakeAreaFrom(area.map)); // "browser restarted", storage readable again
  assert.deepEqual((await fresh.load(key)).payload, payload(2));
});

test("crash after a bad new vault reached disk (rollback impossible): backup saves the data", async () => {
  const { area, key } = await setup(2);
  const store = createVaultStore(faulty(area, (n, obj) => ("vault" in obj && n === 2 ? "corrupt-then-dead" : null)));
  await assert.rejects(store.commit(key, payload(5), { expectedRevision: 1, kdf: KDF }), reason("write"));
  assert.notEqual(area.map.get("vault").ciphertext, area.map.get("vault_backup").ciphertext, "bad copy is on disk");
  area.restore();
  const r = await createVaultStore(fakeAreaFrom(area.map)).load(key); // restarted
  assert.deepEqual([r.revision, r.restored, r.payload], [1, true, payload(2)]);
});

function fakeAreaFrom(map) { const a = fakeArea(); for (const [k, v] of map) a.map.set(k, clone(v)); return a; }

test("corrupted current vault on disk: backup restored and reported", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1, kdf: KDF });
  const v = area.map.get("vault"); v.ciphertext = v.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  const r = await store.load(key);
  assert.deepEqual([r.revision, r.restored], [1, true]);
  assert.deepEqual(r.payload, payload(2));
  assert.equal(area.map.get("vault").revision, 1, "backup written back as current");
});

test("both copies unreadable: corrupt error, nothing deleted", async () => {
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1, kdf: KDF });
  for (const k of ["vault", "vault_backup"]) area.map.get(k).version = 9;
  const snap = clone([...area.map]);
  await assert.rejects(store.load(key), reason("corrupt"));
  assert.deepEqual([...area.map], snap);
  await assert.rejects(store.load(await newAesKey()), reason("corrupt"), "wrong key is never 'repaired'");
});

test("empty storage loads as null; dropBackup removes only the backup", async () => {
  assert.equal(await createVaultStore(fakeArea()).load(await newAesKey()), null);
  const { area, key, store } = await setup(2);
  await store.commit(key, payload(3), { expectedRevision: 1, kdf: KDF });
  await store.dropBackup();
  assert.equal(area.map.has("vault_backup"), false);
  assert.equal((await store.load(key)).revision, 2);
});
