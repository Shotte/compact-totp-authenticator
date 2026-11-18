// Master password → non-extractable AES-256-GCM key via PBKDF2-HMAC-SHA-256 (C2).
// The password and raw key material never leave Web Crypto or this function's scope.
import { toB64, fromB64 } from "./crypto.js";
import { isValidKdf, VaultError } from "./vault.js";
import { InputError } from "./accounts.js";

export const MIN_PASSWORD_LENGTH = 12;    // code points; passphrases encouraged, no class rules
export const MAX_PASSWORD_LENGTH = 1024;  // bounds hashing work for untrusted input
export const DEFAULT_ITERATIONS = 600_000;

// Same normalization for setup, unlock and password change (NFC).
export const normalizePassword = (password) => String(password).normalize("NFC");

// Rules for a NEW password (setup and change). Unlock only enforces the maximum length.
export function checkNewPassword(password, confirm) {
  if (typeof password !== "string") throw new InputError("password");
  const p = normalizePassword(password);
  const length = [...p].length;
  if (length < MIN_PASSWORD_LENGTH) throw new InputError("password-short");
  if (length > MAX_PASSWORD_LENGTH) throw new InputError("password-long");
  if (confirm !== undefined && normalizePassword(confirm) !== p) throw new InputError("password-mismatch");
  return p;
}

export function newKdf() {
  return { name: "PBKDF2", hash: "SHA-256", iterations: DEFAULT_ITERATIONS,
    salt: toB64(crypto.getRandomValues(new Uint8Array(16))) };
}

async function passwordKey(password) {
  if (typeof password !== "string" || [...password].length > MAX_PASSWORD_LENGTH) throw new InputError("password");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(normalizePassword(password)),
    "PBKDF2", false, ["deriveKey", "deriveBits"]);
}

// kdf comes from an untrusted header: validated (bounded) BEFORE deriving. The result is
// only trusted once it has authenticated a vault ciphertext.
export async function deriveKey(password, kdf) {
  if (!isValidKdf(kdf)) throw new VaultError("header");
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: kdf.hash, iterations: kdf.iterations, salt: fromB64(kdf.salt) },
    await passwordKey(password), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Test hook for published PBKDF2 vectors; same import path as deriveKey, arbitrary salt.
export async function pbkdf2Bits(password, salt, iterations, bits) {
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt }, await passwordKey(password), bits));
}
