// Parser and import plan for the original extension's totp.json and CTA's own unencrypted
// cta-plain v1 export (C5). Pure: never writes anything. Pages import only the size limit.
import { checkSecret, addAccount, InputError } from "./accounts.js";

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ENTRIES = 1000;
// Same value as PLAIN_FORMAT in export.js (tested); not imported so that pages loading this
// module never pull in the export crypto.
const PLAIN = "cta-plain";

export class ImportError extends Error {
  constructor(reason) { super(`malformed:${reason}`); this.code = "malformed"; this.reason = reason; }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Returns { format, entries: [{ name, key, url, algorithm?, digits?, period? }] } with raw
// (unvalidated) field values. Legacy entries carry no TOTP parameters: the original
// extension always used SHA-1, 6 digits, 30 s. cta-plain entries must carry all three.
export function parseLegacy(text) {
  if (typeof text !== "string") throw new ImportError("type");
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError("too-large");
  let data;
  try { data = JSON.parse(text); } catch { throw new ImportError("json"); }
  if (!isPlainObject(data)) throw new ImportError("structure");

  let format, entries;
  if (data.format === PLAIN) {
    if (data.version !== 1) throw new ImportError("version");
    if (!Array.isArray(data.accounts)) throw new ImportError("structure");
    format = PLAIN;
    entries = data.accounts.map((a) => (isPlainObject(a)
      ? { name: a.name, key: a.secret, url: a.url, params: { algorithm: a.algorithm, digits: a.digits, period: a.period } }
      : { invalid: true }));
  } else if (Object.hasOwn(data, "otp_list")) {
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

const LEGACY_PARAMS = { algorithm: "SHA-1", digits: 6, period: 30 };
const PLACEHOLDER = "-"; // validates the other fields of a row whose name is still missing

// existing: decrypted vault accounts (background only). Returns the preview rows (no
// secrets) and, separately, the candidates to append (with secrets; background only).
// status: new | name-conflict | needs-name (importable) | duplicate | invalid (skipped).
// warnings: ["short-secret"]. Validation is the same as manual entry (addAccount).
export function planImport(text, existing) {
  const { format, entries } = parseLegacy(text);
  const secrets = new Set(existing.map((a) => a.secret));
  const names = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a.secret]));
  const candidates = [];
  const rows = entries.map((e, index) => {
    const row = { index, name: typeof e.name === "string" ? e.name.trim().slice(0, 100) : "",
      url: typeof e.url === "string" ? e.url.slice(0, 200) : "", warnings: [] };
    if (e.invalid) return { ...row, status: "invalid", reason: "entry" };
    if (e.name !== undefined && e.name !== null && typeof e.name !== "string") return { ...row, status: "invalid", reason: "name" };
    if (typeof e.key !== "string") return { ...row, status: "invalid", reason: "secret-format" };
    const params = e.params ?? LEGACY_PARAMS;
    // Never invent security-sensitive parameters: a cta-plain entry without them is invalid.
    if (Object.values(params).some((v) => v === undefined || v === null)) return { ...row, status: "invalid", reason: "parameters" };
    const name = typeof e.name === "string" ? e.name.trim() : "";
    let account;
    try {
      [account] = addAccount([], { name: name || PLACEHOLDER, url: e.url, secret: e.key, ...params }, "");
      row.warnings = checkSecret(e.key).warnings;
    } catch (err) {
      if (err instanceof InputError) return { ...row, status: "invalid", reason: err.reason };
      throw err;
    }
    if (secrets.has(account.secret)) return { ...row, status: "duplicate" };
    secrets.add(account.secret);
    let status = "needs-name"; // an empty name is never dropped silently; the user names it
    if (name) {
      const key = name.toLowerCase();
      status = names.has(key) && names.get(key) !== account.secret ? "name-conflict" : "new";
      names.set(key, account.secret);
    }
    const { id, ...fields } = account;
    candidates.push({ index, needsName: !name, ...fields, name });
    return { ...row, algorithm: account.algorithm, digits: account.digits, period: account.period, status };
  });
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { format, rows, counts, candidates };
}

// The preview as pages see it: no candidates, no secrets.
export function previewImport(text, existing) {
  const { candidates, ...preview } = planImport(text, existing);
  return preview;
}
