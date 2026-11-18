// Persistent vault format v1 (C1): AES-256-GCM with authenticated metadata, plus a
// storage protocol with backup, read-back verification and rollback.
// Background only. Key derivation (PBKDF2) and wiring to storage.local follow in C2.
// Spec: docs/SECURITY.md §6–7.
import { encryptJson, decryptJson, fromB64 } from "./crypto.js";

export const FORMAT = "cta-vault";
export const VERSION = 1;
export const MIN_ITERATIONS = 600_000;     // OWASP 2023 for PBKDF2-HMAC-SHA-256
export const MAX_ITERATIONS = 10_000_000;  // sanity cap against unlock-time DoS
const KEYS = ["format", "version", "revision", "kdf", "cipher", "ciphertext"];

export class VaultError extends Error {
  // reason: format | version | header | decrypt | payload | conflict | write | corrupt
  constructor(reason, message = reason) { super(`vault:${message}`); this.code = "vault"; this.reason = reason; }
}

const b64Len = (s, n) => { try { return typeof s === "string" && fromB64(s).length === n; } catch { return false; } };
const exactKeys = (o, keys) => o && typeof o === "object" && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

// Strict header check before any decryption. Throws VaultError.
export function validateVault(v) {
  if (!v || typeof v !== "object" || v.format !== FORMAT) throw new VaultError("format");
  if (v.version !== VERSION) throw new VaultError("version");
  const { revision, kdf, cipher, ciphertext } = v;
  const ok = exactKeys(v, KEYS) &&
    Number.isSafeInteger(revision) && revision >= 1 &&
    exactKeys(kdf, ["name", "hash", "iterations", "salt"]) && kdf.name === "PBKDF2" && kdf.hash === "SHA-256" &&
    Number.isSafeInteger(kdf.iterations) && kdf.iterations >= MIN_ITERATIONS && kdf.iterations <= MAX_ITERATIONS &&
    b64Len(kdf.salt, 16) &&
    exactKeys(cipher, ["name", "iv", "tagLength"]) && cipher.name === "AES-GCM" && cipher.tagLength === 128 &&
    b64Len(cipher.iv, 12) &&
    typeof ciphertext === "string" && ciphertext.length > 0;
  if (!ok) throw new VaultError("header");
  return v;
}

// Every security-relevant header field is authenticated. The IV is not repeated here:
// AES-GCM already authenticates it (a changed IV fails the tag check).
export const aad = (v) => JSON.stringify([v.format, v.version, v.revision, v.kdf.name, v.kdf.hash,
  v.kdf.iterations, v.kdf.salt, v.cipher.name, v.cipher.tagLength]);

function validatePayload(p) {
  const ok = p && typeof p === "object" && Array.isArray(p.accounts) &&
    p.accounts.every((a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.secret === "string");
  if (!ok) throw new VaultError("payload");
  return p;
}

// Encrypts payload into a new vault object. A fresh random 96-bit IV per call (crypto.js).
export async function sealVault(key, payload, { revision, kdf }) {
  validatePayload(payload);
  const head = { format: FORMAT, version: VERSION, revision,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt } };
  const probe = { ...head, cipher: { name: "AES-GCM", iv: "", tagLength: 128 } };
  const { iv, ct } = await encryptJson(key, payload, aad(probe));
  return validateVault({ ...head, cipher: { name: "AES-GCM", iv, tagLength: 128 }, ciphertext: ct });
}

export async function openVault(key, vault) {
  validateVault(vault);
  let payload;
  try { payload = await decryptJson(key, { iv: vault.cipher.iv, ct: vault.ciphertext }, aad(vault)); }
  catch { throw new VaultError("decrypt"); }
  return validatePayload(payload);
}

// Storage protocol over a StorageArea-like object (storage.local in C2).
// Keys: "vault" (current), "vault_backup" (previous revision). Never deletes a vault
// it could not replace with a verified one.
export function createVaultStore(area) {
  let chain = Promise.resolve();
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  const read = async () => { const r = await area.get(["vault", "vault_backup"]); return { vault: r.vault, backup: r.vault_backup }; };

  return {
    read,

    // Writes payload as revision expectedRevision+1. expectedRevision 0 = no vault yet.
    commit(key, payload, { expectedRevision, kdf }) {
      return exclusive(async () => {
        const { vault: current } = await read();
        if ((current?.revision ?? 0) !== expectedRevision) throw new VaultError("conflict");
        const next = await sealVault(key, payload, { revision: expectedRevision + 1, kdf });
        if (current) await area.set({ vault_backup: current }); // a crash after this leaves vault == backup
        try {
          await area.set({ vault: next });
          const { vault: back } = await read();
          const again = await openVault(key, back);
          if (back.revision !== next.revision || JSON.stringify(again) !== JSON.stringify(payload)) {
            throw new VaultError("write", "verify");
          }
        } catch (e) {
          // Roll back to the last verified state; keep the original error for the caller.
          try { current ? await area.set({ vault: current }) : await area.remove("vault"); } catch { /* reported below */ }
          throw e instanceof VaultError && e.reason !== "decrypt" ? e : new VaultError("write", e?.message ?? "write");
        }
        return next.revision;
      });
    },

    // Opens the vault; falls back to (and restores) the backup if the current copy is
    // unreadable. Never removes anything. Throws VaultError("corrupt") if neither opens.
    load(key) {
      return exclusive(async () => {
        const { vault, backup } = await read();
        if (!vault && !backup) return null;
        try { return { revision: vault.revision, payload: await openVault(key, vault), restored: false }; }
        catch (first) {
          if (!backup) throw new VaultError("corrupt", first.reason);
          let payload;
          try { payload = await openVault(key, backup); } catch { throw new VaultError("corrupt", first.reason); }
          await area.set({ vault: backup });
          return { revision: backup.revision, payload, restored: true };
        }
      });
    },

    // C2 password change: drop the backup once the new vault is verified (it is
    // encrypted with the old key).
    dropBackup() { return exclusive(() => area.remove("vault_backup")); },
  };
}
