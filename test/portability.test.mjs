// Cross-platform portability: a vault sealed once (fixed synthetic key, committed fixture)
// must open identically on Windows, Linux and macOS (CI matrix). Covers base64 handling,
// UTF-8 of non-ASCII names, AAD serialization and AES-GCM interoperability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openVault, aad, validateVault } from "../src/lib/vault.js";
import { toB64, fromB64 } from "../src/lib/crypto.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/vault-v1-portable.json", import.meta.url), "utf8"));
const rawKey = Uint8Array.from({ length: 32 }, (_, i) => i); // synthetic, see fixture note
const key = () => crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);

test("committed vault fixture opens with identical content on this platform", async () => {
  validateVault(fixture.vault);
  assert.deepEqual(await openVault(await key(), fixture.vault), fixture.payload);
});

test("AAD serialization is byte-identical across platforms", () => {
  assert.equal(aad(fixture.vault), fixture.aad);
  assert.equal(fixture.aad, `["cta-vault",1,7,"PBKDF2","SHA-256",600000,"${fixture.vault.kdf.salt}","AES-GCM",128]`);
});

test("base64 round trip is canonical for every byte value", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(toB64(fromB64(toB64(all))), toB64(all));
  assert.deepEqual(fromB64(fixture.vault.cipher.iv).length, 12);
});

test("non-ASCII account names survive the round trip unchanged (UTF-8)", async () => {
  const p = await openVault(await key(), fixture.vault);
  assert.ok(p.accounts.every((a) => a.name.endsWith("– Ünïcödé ✓")));
  assert.equal(p.accounts[0].name.normalize("NFC"), p.accounts[0].name);
});

// Password-based workflow (C2): same password + KDF header → same key on every platform.
const pw = JSON.parse(readFileSync(new URL("./fixtures/vault-v1-password.json", import.meta.url), "utf8"));

test("password-based vault opens with the same password on this platform (NFC and NFD input)", async () => {
  const { deriveKey } = await import("../src/lib/kdf.js");
  assert.notEqual(pw.passwordNfc, pw.passwordNfd, "fixture really contains two encodings");
  for (const password of [pw.passwordNfc, pw.passwordNfd]) {
    const key = await deriveKey(password, pw.vault.kdf);
    assert.deepEqual(await openVault(key, pw.vault), pw.payload);
  }
  assert.equal(aad(pw.vault), pw.aad);
  await assert.rejects(openVault(await deriveKey(pw.passwordNfc + "x", pw.vault.kdf), pw.vault));
});
