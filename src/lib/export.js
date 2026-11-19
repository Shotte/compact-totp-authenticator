// Export formats (C4). Background only: these functions see secrets.
// Spec: docs/SECURITY.md §13.
//
// cta-export v1  encrypted (AES-256-GCM, PBKDF2-HMAC-SHA-256 with its own salt), readable
//                without the original Firefox profile: only the file and its password.
// cta-plain v1   unencrypted, complete (every TOTP parameter), only after confirmation.
// totp.json      the original extension's format; produced only if no information is lost.
import { encryptJson, decryptJson } from "./crypto.js";
import { isValidKdf, b64Len, exactKeys, MAX_CIPHERTEXT_LENGTH } from "./vault.js";
import { addAccount, legacyCompatibility, InputError } from "./accounts.js";

export const EXPORT_FORMAT = "cta-export";
export const PLAIN_FORMAT = "cta-plain";
export const EXPORT_VERSION = 1;
export const PAYLOAD_TYPE = "cta-accounts";
export const MAX_EXPORT_BYTES = MAX_CIPHERTEXT_LENGTH + 4096; // file text, checked before parsing
const HEADER_KEYS = ["format", "version", "kdf", "cipher", "ciphertext"];
const ACCOUNT_KEYS = ["name", "secret", "url", "algorithm", "digits", "period"];

export class ExportError extends Error {
  // reason: too-large | json | format | version | header | decrypt | payload
  constructor(reason) { super(`malformed:${reason}`); this.code = "malformed"; this.reason = reason; }
}

// Portable account: every field except the vault-internal id. Order is the list order.
export const portable = (accounts) => accounts.map((a) =>
  ({ name: a.name, secret: a.secret, url: a.url, algorithm: a.algorithm, digits: a.digits, period: a.period }));

// Header fields that matter for security are authenticated; the format string makes a
// vault and an export mutually unreadable. The IV is authenticated by GCM itself.
const aad = (h) => JSON.stringify([h.format, h.version, h.kdf.name, h.kdf.hash, h.kdf.iterations, h.kdf.salt,
  h.cipher.name, h.cipher.tagLength]);

export function validateExportHeader(f) {
  if (!f || typeof f !== "object" || f.format !== EXPORT_FORMAT) throw new ExportError("format");
  if (f.version !== EXPORT_VERSION) throw new ExportError("version");
  const ok = exactKeys(f, HEADER_KEYS) && isValidKdf(f.kdf) &&
    exactKeys(f.cipher, ["name", "iv", "tagLength"]) && f.cipher.name === "AES-GCM" && f.cipher.tagLength === 128 &&
    b64Len(f.cipher.iv, 12) &&
    typeof f.ciphertext === "string" && f.ciphertext.length > 0 && f.ciphertext.length <= MAX_CIPHERTEXT_LENGTH;
  if (!ok) throw new ExportError("header");
  return f;
}

// Bounded before JSON.parse; then strict header validation (before any key derivation).
export function parseExport(text) {
  if (typeof text !== "string") throw new ExportError("format");
  if (text.length > MAX_EXPORT_BYTES) throw new ExportError("too-large");
  let f;
  try { f = JSON.parse(text); } catch { throw new ExportError("json"); }
  return validateExportHeader(f);
}

// Payload: exact shape; every account must pass the same validation as manual entry, so
// nothing malformed can enter a vault through an import.
function validatePayload(p) {
  const ok = exactKeys(p, ["type", "version", "exportedAt", "accounts"]) && p.type === PAYLOAD_TYPE &&
    p.version === EXPORT_VERSION && typeof p.exportedAt === "string" && Array.isArray(p.accounts) &&
    p.accounts.every((a) => exactKeys(a, ACCOUNT_KEYS));
  if (!ok) throw new ExportError("payload");
  try { accountsFromPortable(p.accounts); } catch { throw new ExportError("payload"); }
  return p;
}

// Portable accounts → vault accounts with new ids, validated, order preserved.
export function accountsFromPortable(list, newId = () => crypto.randomUUID()) {
  let out = [];
  for (const a of list) out = addAccount(out, a, newId());
  return out;
}

export async function sealExport(key, kdf, accounts, exportedAt) {
  const payload = validatePayload({ type: PAYLOAD_TYPE, version: EXPORT_VERSION, exportedAt, accounts: portable(accounts) });
  const head = { format: EXPORT_FORMAT, version: EXPORT_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt } };
  const { iv, ct } = await encryptJson(key, payload, aad({ ...head, cipher: { name: "AES-GCM", tagLength: 128 } }));
  return validateExportHeader({ ...head, cipher: { name: "AES-GCM", iv, tagLength: 128 }, ciphertext: ct });
}

// Wrong password and tampered file are indistinguishable (both "decrypt").
export async function openExport(key, file) {
  validateExportHeader(file);
  let payload;
  try { payload = await decryptJson(key, { iv: file.cipher.iv, ct: file.ciphertext }, aad(file)); }
  catch { throw new ExportError("decrypt"); }
  return validatePayload(payload);
}

export function plainExport(accounts, exportedAt) {
  return { format: PLAIN_FORMAT, version: EXPORT_VERSION, exportedAt,
    notice: "UNENCRYPTED: this file contains TOTP secrets in plain text. Store it offline and delete it when no longer needed.",
    accounts: portable(accounts) };
}

// Original extension's totp.json. Refused (never silently reduced) if any account uses a
// parameter that format cannot express.
export function legacyExport(accounts) {
  if (!legacyCompatibility(accounts).compatible) throw new InputError("legacy-incompatible");
  return { otp_list: accounts.map((a) => ({ name: a.name, key: a.secret, url: a.url })) };
}

export const sameAccounts = (a, b) => JSON.stringify(portable(a)) === JSON.stringify(portable(b));
