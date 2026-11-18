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
  // reason: format | version | header | decrypt | payload | conflict | write | corrupt |
  //         auth (key does not open the current vault) | exists | generation | refused
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

// The KDF salt identifies a key generation (every password gets a new salt; the salt is
// authenticated in the header). It is an identifier only: a key counts as verified solely
// after it has authenticated a ciphertext of that generation.
export const sameGeneration = (a, b) => !!a && !!b && a.name === b.name && a.hash === b.hash &&
  a.iterations === b.iterations && a.salt === b.salt;

async function tryOpen(key, v) {
  try { return { payload: await openVault(key, v) }; } catch (e) { return { error: e }; }
}

// Storage protocol over a StorageArea-like object (storage.local in C2). Keys:
//   vault         current vault
//   vault_backup  verified earlier copy (normally the previous revision, same generation)
//   vault_next    staged new-generation vault, present only while a rotation is in progress
// Properties (docs/SECURITY.md §7):
// - load() is read-only; a failed decryption never changes storage.
// - Every write first authenticates the key against the current vault (create excepted).
// - Recovery is explicit (restoreBackup), re-checked at write time, only from a copy of the
//   SAME key generation as the current vault, and refused while the current vault opens.
//   A current vault whose generation cannot be read needs { allowUnverifiedGeneration }.
export function createVaultStore(area) {
  let chain = Promise.resolve();
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  const read = async () => {
    const r = await area.get(["vault", "vault_backup", "vault_next"]);
    return { vault: r.vault, backup: r.vault_backup, staged: r.vault_next };
  };
  const writeError = (e) => (e instanceof VaultError && e.reason === "write" ? e : new VaultError("write", e?.message ?? "write"));

  async function verifyStored(storageKey, key, expected, payload) {
    const back = (await area.get(storageKey))[storageKey];
    const again = await openVault(key, back);
    if (back.revision !== expected.revision || JSON.stringify(again) !== JSON.stringify(payload)) {
      throw new VaultError("write", "verify");
    }
  }

  // Compare-and-set on the revision, then authenticate the key against the current vault.
  async function authenticated(key, expectedRevision) {
    const state = await read();
    if (!state.vault || state.vault.revision !== expectedRevision) throw new VaultError("conflict");
    if ((await tryOpen(key, state.vault)).error) throw new VaultError("auth"); // wrong key or damage: never overwrite
    return state;
  }

  // Which copy could replace an unreadable current vault, for this key. Read-only.
  async function recoveryCandidate(key, state) {
    const { vault } = state;
    if (vault && (await tryOpen(key, vault)).payload) return { refused: "current-valid" };
    let headerOk = false;
    try { validateVault(vault); headerOk = true; } catch { /* missing or structurally broken */ }
    const found = [];
    for (const [source, copy] of [["backup", state.backup], ["staged", state.staged]]) {
      if (!copy) continue;
      try { validateVault(copy); } catch { continue; }
      if (headerOk && !sameGeneration(vault.kdf, copy.kdf)) continue; // never across generations
      const r = await tryOpen(key, copy);
      if (r.payload) found.push({ source, copy, payload: r.payload });
    }
    if (!found.length) return { refused: headerOk ? "no-same-generation-copy" : "no-copy" };
    found.sort((a, b) => b.copy.revision - a.copy.revision); // newest verified copy first
    return { ...found[0], generationVerified: headerOk, damage: headerOk ? "decrypt" : "header" };
  }

  return {
    read,

    // First vault only (revision 1). Refuses if any vault copy already exists.
    create(key, payload, { kdf }) {
      return exclusive(async () => {
        const s = await read();
        if (s.vault || s.backup || s.staged) throw new VaultError("exists");
        const next = await sealVault(key, payload, { revision: 1, kdf });
        try {
          await area.set({ vault: next });
          await verifyStored("vault", key, next, payload);
        } catch (e) {
          try { await area.remove("vault"); } catch { /* nothing valid existed before */ }
          throw writeError(e);
        }
        return 1;
      });
    },

    // Regular write within the current key generation: the key must open the current vault
    // and the new vault reuses its KDF parameters, so a commit can never change the key.
    // backup = current, vault = next, read-back verify, rollback on failure.
    commit(key, payload, { expectedRevision }) {
      return exclusive(async () => {
        const { vault: current, staged } = await authenticated(key, expectedRevision);
        const next = await sealVault(key, payload, { revision: expectedRevision + 1, kdf: current.kdf });
        await area.set({ vault_backup: current }); // crash after this: vault == backup
        try {
          await area.set({ vault: next });
          await verifyStored("vault", key, next, payload);
        } catch (e) {
          try { await area.set({ vault: current }); } catch { /* storage gone; backup still holds current */ }
          throw writeError(e);
        }
        if (staged) { try { await area.remove("vault_next"); } catch { /* leftover is harmless */ } }
        return next.revision;
      });
    },

    // Password rotation. Old key must open the current vault; the new generation needs a
    // new salt. Sequence (each step is one single-key write):
    //   1 vault_next   = new vault (new key), verified       – stage
    //   2 vault_backup = current (old generation)            – rollback copy
    //   3 vault        = new vault, verified                 – switch (completion point)
    //   4 vault_backup = new vault                           – drop the old generation
    //   5 remove vault_next
    // Before 3 the old password opens the vault; from 3 on the new one. A damaged switch
    // leaves the verified staged copy, recoverable with the new password.
    rotate(oldKey, newKey, { expectedRevision, kdf }) {
      return exclusive(async () => {
        const { vault: current } = await authenticated(oldKey, expectedRevision);
        if (kdf.salt === current.kdf.salt) throw new VaultError("generation");
        const payload = await openVault(oldKey, current);
        const next = await sealVault(newKey, payload, { revision: expectedRevision + 1, kdf });
        try {
          await area.set({ vault_next: next });
          await verifyStored("vault_next", newKey, next, payload);
        } catch (e) {
          try { await area.remove("vault_next"); } catch { /* ignored by recovery: other generation */ }
          throw writeError(e);
        }
        await area.set({ vault_backup: current });
        try {
          await area.set({ vault: next });
          await verifyStored("vault", newKey, next, payload);
        } catch (e) {
          try { await area.set({ vault: current }); } catch { /* staged copy still recovers with newKey */ }
          throw writeError(e);
        }
        let backupRefreshed = true;
        try { await area.set({ vault_backup: next }); } catch { backupRefreshed = false; }
        try { await area.remove("vault_next"); } catch { /* leftover is harmless */ }
        return { revision: next.revision, backupRefreshed };
      });
    },

    // Read-only. "ok": the current vault opened. "recoverable": the current vault does not
    // open, but a copy of the same key generation does – the key is thereby verified and the
    // current copy is damaged; recovery requires restoreBackup() after user confirmation.
    // Everything else throws and changes nothing (a wrong key is indistinguishable from damage).
    load(key) {
      return exclusive(async () => {
        const state = await read();
        if (!state.vault && !state.backup && !state.staged) return null;
        if (state.vault) {
          const cur = await tryOpen(key, state.vault);
          if (cur.payload) return { status: "ok", revision: state.vault.revision, payload: cur.payload };
        }
        const c = await recoveryCandidate(key, state);
        if (c.refused) {
          let headerOk = false;
          try { validateVault(state.vault); headerOk = true; } catch { /* broken */ }
          throw new VaultError(headerOk ? "decrypt" : "corrupt");
        }
        return { status: "recoverable", source: c.source, revision: c.copy.revision, payload: c.payload,
          damage: c.damage, generationVerified: c.generationVerified };
      });
    },

    // Explicit recovery after user confirmation. All checks are repeated at write time; a
    // valid current vault is never replaced; copies of another generation are never used;
    // an unreadable-generation current vault additionally needs allowUnverifiedGeneration.
    restoreBackup(key, { allowUnverifiedGeneration = false } = {}) {
      return exclusive(async () => {
        const c = await recoveryCandidate(key, await read());
        if (c.refused) throw new VaultError("refused", c.refused);
        if (!c.generationVerified && !allowUnverifiedGeneration) throw new VaultError("refused", "generation-unverified");
        await area.set({ vault: c.copy });
        await verifyStored("vault", key, c.copy, c.payload);
        return { revision: c.copy.revision, source: c.source };
      });
    },
  };
}
