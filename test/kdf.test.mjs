import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKey, pbkdf2Bits, newKdf, checkNewPassword, normalizePassword,
  MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, DEFAULT_ITERATIONS } from "../src/lib/kdf.js";
import { encryptJson, decryptJson, toB64 } from "../src/lib/crypto.js";
import { MAX_ITERATIONS } from "../src/lib/vault.js";

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s) => new TextEncoder().encode(s);

test("PBKDF2-HMAC-SHA-256 reference vectors (RFC 7914 §11)", async () => {
  assert.equal(hex(await pbkdf2Bits("passwd", enc("salt"), 1, 512)),
    "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783");
  assert.equal(hex(await pbkdf2Bits("Password", enc("NaCl"), 80000, 512)),
    "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d");
});

test("deriveKey yields exactly the PBKDF2 output as a non-extractable AES-256-GCM key", async () => {
  const kdf = newKdf();
  const key = await deriveKey("correct horse battery staple", kdf);
  assert.equal(key.extractable, false);
  assert.deepEqual([key.algorithm.name, key.algorithm.length], ["AES-GCM", 256]);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
  // Same parameters via deriveBits → importable reference key; both must interoperate.
  const bits = await pbkdf2Bits("correct horse battery staple", Uint8Array.from(atob(kdf.salt), (c) => c.charCodeAt(0)), kdf.iterations, 256);
  const ref = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
  const sealed = await encryptJson(key, { ok: 1 }, "aad");
  assert.deepEqual(await decryptJson(ref, sealed, "aad"), { ok: 1 });
});

test("new KDF parameters: 600,000 iterations and a fresh 16-byte salt each time", () => {
  const a = newKdf(), b = newKdf();
  assert.deepEqual([a.name, a.hash, a.iterations], ["PBKDF2", "SHA-256", DEFAULT_ITERATIONS]);
  assert.equal(atob(a.salt).length, 16);
  assert.notEqual(a.salt, b.salt);
});

test("NFC normalization: composed and decomposed input derive the same key", async () => {
  const kdf = newKdf();
  const composed = "Passwört-Grüße-12", decomposed = composed.normalize("NFD");
  assert.notEqual(composed, decomposed);
  assert.equal(normalizePassword(decomposed), composed);
  const k1 = await deriveKey(composed, kdf), k2 = await deriveKey(decomposed, kdf);
  assert.deepEqual(await decryptJson(k2, await encryptJson(k1, { x: 1 }, "a"), "a"), { x: 1 });
});

test("new password rules: at least 12 code points, long passphrases, confirmation, no class rules", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.throws(() => checkNewPassword("elevenchars"), { reason: "password-short" });
  assert.equal(checkNewPassword("twelve chars"), "twelve chars", "lowercase-only passphrase is fine");
  assert.equal(checkNewPassword("🔑".repeat(12)).length, 24, "12 code points (astral) accepted");
  assert.throws(() => checkNewPassword("🔑".repeat(11)), { reason: "password-short" });
  const passphrase = "a long passphrase with many words ".repeat(20);
  assert.equal(checkNewPassword(passphrase), passphrase);
  assert.throws(() => checkNewPassword("x".repeat(MAX_PASSWORD_LENGTH + 1)), { reason: "password-long" });
  assert.throws(() => checkNewPassword("long enough pass", "long enough pasS"), { reason: "password-mismatch" });
  assert.equal(checkNewPassword("Grüße und mehr", "Grüße und mehr".normalize("NFD")), "Grüße und mehr");
  assert.throws(() => checkNewPassword(12345678901234), { reason: "password" });
});

test("A1: malformed, oversized or manipulated KDF metadata is rejected before deriving", async () => {
  const ok = newKdf();
  const bad = [
    { ...ok, iterations: MAX_ITERATIONS + 1 }, { ...ok, iterations: 1e12 }, { ...ok, iterations: 599_999 },
    { ...ok, iterations: "600000" }, { ...ok, iterations: NaN }, { ...ok, iterations: -1 },
    { ...ok, salt: toB64(new Uint8Array(4096)) }, { ...ok, salt: "A".repeat(1_000_000) }, { ...ok, salt: "%%" },
    { ...ok, hash: "SHA-1" }, { ...ok, name: "scrypt" }, { ...ok, extra: 1 }, null, "x", [],
  ];
  for (const kdf of bad) {
    const t0 = performance.now();
    await assert.rejects(deriveKey("a valid password", kdf), { reason: "header" }, JSON.stringify(kdf)?.slice(0, 60));
    assert.ok(performance.now() - t0 < 100, "rejected without running PBKDF2");
  }
  await assert.rejects(deriveKey("x".repeat(MAX_PASSWORD_LENGTH + 1), ok), { reason: "password" });
});
