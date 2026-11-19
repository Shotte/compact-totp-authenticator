// Parser and preview for the original extension's totp.json. Never writes anything.
import { checkSecret } from "./accounts.js";

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ENTRIES = 1000;

export class ImportError extends Error {
  constructor(reason) { super(`malformed:${reason}`); this.code = "malformed"; this.reason = reason; }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Returns { format, entries: [{ name, key, url }] } with raw (unvalidated) field values.
export function parseLegacy(text) {
  if (typeof text !== "string") throw new ImportError("type");
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError("too-large");
  let data;
  try { data = JSON.parse(text); } catch { throw new ImportError("json"); }
  if (!isPlainObject(data)) throw new ImportError("structure");

  let format, entries;
  if (Object.hasOwn(data, "otp_list")) {
    if (!Array.isArray(data.otp_list)) throw new ImportError("structure");
    format = "otp_list";
    entries = data.otp_list.map((e) => (isPlainObject(e) ? { name: e.name, key: e.key, url: e.url }
      : { invalid: true }));
  } else {
    // Pre-1.0.4 format: { "<name>": "<key>" }
    const pairs = Object.entries(data);
    if (!pairs.length || !pairs.every(([, v]) => typeof v === "string")) throw new ImportError("structure");
    format = "flat";
    entries = pairs.map(([name, key]) => ({ name, key, url: "" }));
  }
  if (entries.length > MAX_IMPORT_ENTRIES) throw new ImportError("too-many");
  return { format, entries };
}

// existing: decrypted vault accounts (background only). Returned rows contain no secrets.
// status: new | duplicate | name-conflict | invalid; warnings: ["short-secret"]
export function previewImport(text, existing) {
  const { format, entries } = parseLegacy(text);
  const secrets = new Set(existing.map((a) => a.secret));
  const names = new Map(existing.map((a) => [a.name.toLowerCase(), a.secret]));
  const rows = entries.map((e, index) => {
    const row = { index, name: typeof e.name === "string" ? e.name.slice(0, 100) : "",
      url: typeof e.url === "string" ? e.url.slice(0, 200) : "", warnings: [] };
    if (e.invalid) return { ...row, status: "invalid", reason: "entry" };
    // Empty names were possible upstream but are rejected by CTA's account validation.
    if (typeof e.name !== "string" || !e.name.trim()) return { ...row, status: "invalid", reason: "name" };
    if (e.url !== undefined && e.url !== null && typeof e.url !== "string") {
      return { ...row, status: "invalid", reason: "url" };
    }
    if (typeof e.key !== "string") return { ...row, status: "invalid", reason: "secret-format" };
    let secret; // same policy as manual entry: malformed is invalid, short is a warning
    try { ({ secret, warnings: row.warnings } = checkSecret(e.key)); }
    catch { return { ...row, status: "invalid", reason: "secret-format" }; }
    if (secrets.has(secret)) return { ...row, status: "duplicate" };
    secrets.add(secret);
    const key = row.name.toLowerCase();
    const status = names.has(key) && names.get(key) !== secret ? "name-conflict" : "new";
    names.set(key, secret);
    return { ...row, status };
  });
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { format, rows, counts };
}
