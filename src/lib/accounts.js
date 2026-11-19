// Pure account-list operations. No storage, no DOM. Lists are never mutated in place.
import { decodeBase32, normalizeBase32 } from "./base32.js";
import { ALGORITHMS } from "./totp.js";

export class InputError extends Error {
  constructor(reason) { super(`invalid:${reason}`); this.code = "invalid"; this.reason = reason; }
}

export const MIN_SECRET_CHARS = 16; // 80 bits, the shortest secret common services issue
const MAX_NAME = 100, MAX_URL = 200;

// Shared TOTP secret policy for manual entry, legacy import and restore (C4 review).
// Malformed (rejected, "secret-format"): not RFC 4648 Base32 or no key bytes at all.
// Weak but usable (accepted with warning "short-secret"): valid Base32 with fewer than
// MIN_SECRET_CHARS characters; HMAC accepts any non-empty key, so TOTP still works.
export function checkSecret(input) {
  const secret = normalizeBase32(input ?? "");
  let bytes;
  try { bytes = decodeBase32(secret); } catch { throw new InputError("secret-format"); }
  if (!bytes.length) throw new InputError("secret-format");
  return { secret, warnings: secret.length < MIN_SECRET_CHARS ? ["short-secret"] : [] };
}

export const normalizeSecret = (input) => checkSecret(input).secret;

// Warnings for a secret typed or imported, without throwing (pages use it for hints).
export function secretWarnings(input) {
  try { return checkSecret(input).warnings; } catch { return []; }
}

function str(v, max, reason, { required = false } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new InputError(reason);
  v = v.trim();
  if (v.length > max || (required && !v)) throw new InputError(reason);
  return v;
}

// Validates the non-secret fields; returns a clean object with defaults applied.
function normalizeMeta(input, base = {}) {
  const m = {
    name: str(input.name ?? base.name, MAX_NAME, "name", { required: true }),
    url: str(input.url ?? base.url, MAX_URL, "url"),
    algorithm: input.algorithm ?? base.algorithm ?? "SHA-1",
    digits: Number(input.digits ?? base.digits ?? 6),
    period: Number(input.period ?? base.period ?? 30),
  };
  if (!ALGORITHMS.includes(m.algorithm)) throw new InputError("algorithm");
  if (![6, 7, 8].includes(m.digits)) throw new InputError("digits");
  if (!Number.isInteger(m.period) || m.period < 10 || m.period > 300) throw new InputError("period");
  return m;
}

export function addAccount(list, input, id) {
  if (!input || typeof input !== "object") throw new InputError("account");
  return [...list, { id, ...normalizeMeta(input), secret: normalizeSecret(input.secret) }];
}

// Secret is write-only: replaced only when a non-empty value is supplied.
export function updateAccount(list, id, patch) {
  if (!patch || typeof patch !== "object") throw new InputError("account");
  const i = indexOf(list, id);
  const old = list[i];
  const secret = patch.secret ? normalizeSecret(patch.secret) : old.secret;
  const next = [...list];
  next[i] = { id, ...normalizeMeta(patch, old), secret };
  return next;
}

export function deleteAccount(list, id) {
  indexOf(list, id);
  return list.filter((a) => a.id !== id);
}

export function moveAccount(list, id, toIndex) {
  const from = indexOf(list, id);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= list.length) throw new InputError("index");
  const next = [...list];
  next.splice(toIndex, 0, next.splice(from, 1)[0]);
  return next;
}

function indexOf(list, id) {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) throw new InputError("unknown-account");
  return i;
}

// The original extension's totp.json stores only name, key and url; it always uses
// SHA-1, 6 digits and 30 s. Pure (no secrets needed), so pages can show the result.
export function legacyCompatibility(accounts) {
  const incompatible = accounts.map((a, index) => {
    const reasons = [];
    if (a.algorithm !== "SHA-1") reasons.push("algorithm");
    if (a.digits !== 6) reasons.push("digits");
    if (a.period !== 30) reasons.push("period");
    return { index, name: a.name, algorithm: a.algorithm, digits: a.digits, period: a.period, reasons };
  }).filter((r) => r.reasons.length);
  return { compatible: incompatible.length === 0, incompatible };
}

// The only account shape that may leave the background.
export function publicView({ id, name, url, algorithm, digits, period }) {
  return { id, name, url, algorithm, digits, period };
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export function sortForView(items, order) {
  if (order === "alpha") return [...items].sort((a, b) => collator.compare(a.name, b.name));
  if (order === "revalpha") return [...items].sort((a, b) => collator.compare(b.name, a.name));
  return [...items];
}

// Matches "example.com", "https://example.com/x" etc. against the tab's hostname,
// including subdomains. Stricter than the original substring match.
export function matchesSite(accountUrl, tabUrl) {
  if (!accountUrl || !tabUrl) return false;
  let host, tab;
  try { tab = new URL(tabUrl).hostname.toLowerCase(); } catch { return false; }
  try { host = new URL(accountUrl.includes("://") ? accountUrl : `https://${accountUrl}`).hostname.toLowerCase(); }
  catch { return false; }
  if (!host || !tab) return false;
  return tab === host || tab.endsWith(`.${host}`);
}
