// Background service: the only code that touches the session key, the vault and secrets.
// Storage areas and the clock are injected so the same code runs in Node tests.
//
// C2: the vault lives encrypted in storage.local (createVaultStore); the session in
// storage.session holds only the non-extractable key, its key generation and deadlines.
import { newSession, checkSession, touch } from "./session-policy.js";
import { totp } from "./totp.js";
import { decodeBase32 } from "./base32.js";
import * as acc from "./accounts.js";
import { previewImport, MAX_IMPORT_BYTES } from "./legacy.js";
import { loadSettings } from "./settings.js";
import { createVaultStore, validateVault, isValidKdf, VaultError } from "./vault.js";
import { deriveKey, newKdf, checkNewPassword, MAX_PASSWORD_LENGTH } from "./kdf.js";

export class LockedError extends Error {
  constructor(reason) { super(`locked:${reason}`); this.code = "locked"; this.reason = reason; }
}
export class ConflictError extends Error {
  constructor() { super("conflict"); this.code = "conflict"; }
}

export function createService({ session, local, alarms, now = Date.now,
  randomId = () => crypto.randomUUID() }) {
  const startedAt = now();
  const store = createVaultStore(local);
  // Bumped synchronously by lock/unlock/password change. An operation that started under
  // another epoch must not write or return anything, even if storage still looks valid.
  let epoch = 0;
  let chain = Promise.resolve();
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  async function wipe() {
    epoch++;
    await session.remove("session");
    await alarms.clear("autolock");
  }

  async function startSession(key, generation) {
    epoch++;
    const { autoLockMinutes } = await loadSettings(local);
    const s = { ...newSession(key, now(), autoLockMinutes * 60_000), id: randomId(), generation };
    await session.set({ session: s });
    await alarms.create("autolock", { when: s.deadline });
  }

  // Gate: every sensitive operation starts here (B0-2). Fails closed and wipes.
  async function requireSession() {
    const e = epoch;
    const { session: s } = await session.get("session");
    const state = checkSession(s, now());
    if (state !== "ok") {
      if (s) await wipe();
      throw new LockedError(state);
    }
    if (e !== epoch) throw new LockedError("changed");
    return { s, e };
  }

  async function recheck({ s, e }) {
    const cur = await requireSession();
    if (e !== epoch || cur.s.id !== s.id) throw new LockedError("changed");
    return cur;
  }

  // Opens the vault with the session key. A different key generation (password changed
  // elsewhere) or a vault that no longer opens locks the session: no stale key keeps working.
  async function readVault(ctx) {
    let r;
    try { r = await store.load(ctx.s.key); } catch { r = null; }
    if (r?.status !== "ok") { await wipe(); throw new LockedError("vault"); }
    const { vault } = await store.read();
    if (vault?.kdf?.salt !== ctx.s.generation) { await wipe(); throw new LockedError("generation"); }
    return { revision: r.revision, accounts: r.payload.accounts };
  }

  // Qualifying user activity. A changed auto-lock setting takes effect here (C3.1).
  async function activity(ctx) {
    const { autoLockMinutes } = await loadSettings(local);
    const { session: s } = await session.get("session");
    const next = s && s.id === ctx.s.id ? touch(s, now(), autoLockMinutes * 60_000) : null;
    if (!next || ctx.e !== epoch) { await wipe(); throw new LockedError("expired"); }
    await session.set({ session: next });
    await alarms.create("autolock", { when: next.deadline });
  }

  function mutate(expectedRevision, change) {
    return exclusive(async () => {
      const ctx = await requireSession();
      const { revision, accounts } = await readVault(ctx);
      if (revision !== expectedRevision) throw new ConflictError();
      const next = change(accounts);
      await recheck(ctx);
      if (ctx.e !== epoch) throw new LockedError("changed");
      let newRevision;
      try { newRevision = await store.commit(ctx.s.key, { accounts: next }, { expectedRevision: revision }); }
      catch (e) { if (e instanceof VaultError && e.reason === "conflict") throw new ConflictError(); throw e; }
      await activity(ctx);
      return { revision: newRevision };
    });
  }

  // KDF parameters for unlocking: from the current vault header, or – if that header is
  // unreadable – from a structurally valid copy. Untrusted until a ciphertext authenticates.
  function unlockKdf(state) {
    for (const v of [state.vault, state.backup, state.staged]) {
      try { validateVault(v); return v.kdf; } catch { /* next */ }
    }
    return null;
  }

  async function passwordToKey(password) {
    if (typeof password !== "string" || !password || [...password].length > MAX_PASSWORD_LENGTH) {
      throw new acc.InputError("password");
    }
    const state = await store.read();
    const kdf = unlockKdf(state);
    if (!kdf || !isValidKdf(kdf)) throw new acc.InputError("no-vault");
    try { return await deriveKey(password, kdf); } // bounded parameters validated before PBKDF2 (C2-A1)
    catch { throw new acc.InputError("unlock"); }
  }

  // Fresh password verification for sensitive operations (C3.3), e.g. the C4 export.
  // Requires a valid session AND the password: the key is derived anew from the password
  // and must open the CURRENT vault of the session's key generation. The session key is
  // never consulted, so holding an unlocked session is not enough. A wrong password does
  // not write and does not lock. Call it inside exclusive(); returns the verified state.
  async function authorizeSensitive(password) {
    const ctx = await requireSession();
    if (typeof password !== "string" || !password || [...password].length > MAX_PASSWORD_LENGTH) {
      throw new acc.InputError("current-password");
    }
    const { vault } = await store.read();
    try { validateVault(vault); } catch { await wipe(); throw new LockedError("vault"); }
    if (vault.kdf.salt !== ctx.s.generation) { await wipe(); throw new LockedError("generation"); }
    let key, r;
    try { key = await deriveKey(password, vault.kdf); r = await store.load(key); } catch { r = null; }
    await recheck(ctx); // lock, expiry or re-unlock during PBKDF2 aborts the operation
    if (r?.status !== "ok") throw new acc.InputError("current-password");
    const cur = await store.read();
    if (cur.vault?.kdf?.salt !== ctx.s.generation || r.revision !== cur.vault.revision) {
      throw new LockedError("changed");
    }
    return { ctx, key, revision: r.revision, payload: r.payload };
  }

  const api = {
    async status() {
      const { session: s } = await session.get("session");
      const valid = checkSession(s, now()) === "ok"; // read-only; sensitive commands wipe via the gate
      const st = await store.read();
      return { initialized: !!(st.vault || st.backup || st.staged), unlocked: valid, startedAt };
    },

    setup({ password, confirm }) {
      return exclusive(async () => {
        const p = checkNewPassword(password, confirm ?? ""); // confirmation is mandatory
        const kdf = newKdf();
        const key = await deriveKey(p, kdf);
        try { await store.create(key, { accounts: [] }, { kdf }); }
        catch (e) { if (e instanceof VaultError && e.reason === "exists") throw new acc.InputError("exists"); throw e; }
        await startSession(key, kdf.salt);
        return { unlocked: true };
      });
    },

    // Wrong password and damaged vault are indistinguishable; both report "unlock" and
    // never write. A damaged vault with a verifiable same-generation copy reports
    // recoverable (no session, no write); restore() needs explicit confirmation.
    unlock({ password }) {
      return exclusive(async () => {
        const key = await passwordToKey(password);
        let r;
        try { r = await store.load(key); } catch { throw new acc.InputError("unlock"); }
        if (!r) throw new acc.InputError("no-vault");
        if (r.status === "recoverable") {
          return { unlocked: false, recoverable: true, damage: r.damage, generationVerified: r.generationVerified };
        }
        const { vault } = await store.read();
        await startSession(key, vault.kdf.salt);
        return { unlocked: true };
      });
    },

    // Explicit, confirmed recovery (same key generation only). The unverified-generation
    // path stays disabled until its dedicated warning UX exists (issue #8).
    restore({ password, confirmed }) {
      return exclusive(async () => {
        if (confirmed !== true) throw new acc.InputError("confirmation");
        const key = await passwordToKey(password);
        try { await store.restoreBackup(key); } catch { throw new acc.InputError("restore"); }
        const { vault } = await store.read();
        await startSession(key, vault.kdf.salt);
        return { unlocked: true };
      });
    },

    async lock() { await wipe(); return { unlocked: false }; },

    activity() {
      return exclusive(async () => { await activity(await requireSession()); return {}; });
    },

    // Password change: requires a valid session AND the current password (re-derived from
    // the vault header). On success the session is locked (C2-A3): no key of the old
    // generation stays usable; the user unlocks again with the new password. On failure the
    // session is locked too, so it never looks unlocked while the vault state is uncertain.
    changePassword({ current, next, confirm }) {
      return exclusive(async () => {
        const ctx = await requireSession();
        const p = checkNewPassword(next, confirm ?? "");
        const { revision } = await readVault(ctx);
        // Lock before any key work: operations racing the change can no longer use the
        // old session key (their re-check fails); the user unlocks again afterwards.
        await wipe();
        const oldKey = await passwordToKey(current);
        const kdf = newKdf();
        const newKey = await deriveKey(p, kdf);
        try {
          await store.rotate(oldKey, newKey, { expectedRevision: revision, kdf });
        } catch (e) {
          if (e instanceof VaultError && e.reason === "auth") throw new acc.InputError("current-password");
          if (e instanceof VaultError && e.reason === "conflict") throw new ConflictError();
          throw e;
        }
        return { locked: true };
      });
    },

    // Codes only; secrets never leave this function.
    async getCodes() {
      const ctx = await requireSession();
      const { revision, accounts } = await readVault(ctx);
      const time = now();
      const codes = await Promise.all(accounts.map(async (a) => {
        const { code, validUntil } = await totp(decodeBase32(a.secret),
          { time, period: a.period, digits: a.digits, algorithm: a.algorithm });
        return { id: a.id, name: a.name, url: a.url, period: a.period, code, validUntil };
      }));
      await recheck(ctx);
      return { revision, codes };
    },

    async listAccounts() {
      const ctx = await requireSession();
      const { revision, accounts } = await readVault(ctx);
      await recheck(ctx);
      return { revision, accounts: accounts.map(acc.publicView) };
    },

    addAccount({ account, revision }) {
      return mutate(revision, (list) => acc.addAccount(list, account, randomId()));
    },
    updateAccount({ id, patch, revision }) {
      return mutate(revision, (list) => acc.updateAccount(list, id, patch));
    },
    deleteAccount({ id, revision }) {
      return mutate(revision, (list) => acc.deleteAccount(list, id));
    },
    moveAccount({ id, toIndex, revision }) {
      return mutate(revision, (list) => acc.moveAccount(list, id, toIndex));
    },

    // Preview only; nothing is stored (production import arrives in C5).
    async importPreview({ text }) {
      const ctx = await requireSession();
      const { accounts } = await readVault(ctx);
      const preview = previewImport(text, accounts);
      await recheck(ctx);
      return preview;
    },
  };

  const str = (v) => (typeof v === "string" ? v : undefined);
  const ARGS = {
    setup: (m) => ({ password: str(m.password), confirm: str(m.confirm) }),
    unlock: (m) => ({ password: str(m.password) }),
    restore: (m) => ({ password: str(m.password), confirmed: m.confirmed === true }),
    changePassword: (m) => ({ current: str(m.current), next: str(m.next), confirm: str(m.confirm) }),
    addAccount: (m) => ({ account: m.account, revision: rev(m) }),
    updateAccount: (m) => ({ id: id(m), patch: m.patch, revision: rev(m) }),
    deleteAccount: (m) => ({ id: id(m), revision: rev(m) }),
    moveAccount: (m) => ({ id: id(m), toIndex: m.toIndex, revision: rev(m) }),
    importPreview: (m) => {
      if (typeof m.text !== "string" || m.text.length > MAX_IMPORT_BYTES) throw new acc.InputError("text");
      return { text: m.text };
    },
  };
  function rev(m) {
    if (!Number.isInteger(m.revision)) throw new acc.InputError("revision");
    return m.revision;
  }
  function id(m) {
    if (typeof m.id !== "string" || !m.id) throw new acc.InputError("id");
    return m.id;
  }

  return {
    // Message entry point. Errors are reduced to a code; messages never carry data.
    async handle(msg) {
      try {
        if (!msg || typeof msg.cmd !== "string" || !Object.hasOwn(api, msg.cmd)) {
          throw new acc.InputError("cmd");
        }
        const args = ARGS[msg.cmd] ? ARGS[msg.cmd](msg) : undefined;
        return { ok: true, result: await api[msg.cmd](args) };
      } catch (e) {
        const known = ["locked", "conflict", "invalid", "malformed"].includes(e?.code);
        return { ok: false, error: known ? e.code : "internal", reason: known ? e.reason : undefined };
      }
    },

    async onAlarm() {
      const { session: s } = await session.get("session");
      if (checkSession(s, now()) !== "ok") await wipe();
      else await alarms.create("autolock", { when: s.deadline });
    },

    // Settings changed (storage.onChanged, C3.1): a shorter auto-lock time applies to the
    // running session at once, measured from the last activity; a longer one only from the
    // next qualifying activity, so a settings write never extends a session by itself.
    onSettingsChanged() {
      return exclusive(async () => {
        const e = epoch;
        const { session: s } = await session.get("session");
        if (!s) return;
        if (checkSession(s, now()) !== "ok") { await wipe(); return; }
        const timeoutMs = (await loadSettings(local)).autoLockMinutes * 60_000;
        if (timeoutMs >= s.timeoutMs) return;
        const next = { ...s, timeoutMs, deadline: s.lastActivity + timeoutMs };
        if (checkSession(next, now()) !== "ok") { await wipe(); return; }
        if (e !== epoch) return; // locked or re-unlocked meanwhile
        await session.set({ session: next });
        await alarms.create("autolock", { when: next.deadline });
      });
    },

    // System idle (C3.4, optional "idle" permission): locks if the user enabled it.
    // Only ever shortens a session; the deadline gate stays the security boundary.
    async onIdleState(state) {
      if (state !== "idle" && state !== "locked") return;
      if ((await loadSettings(local)).idleLock) await wipe();
    },

    // Not reachable by messages (handle() dispatches only api); for sensitive features.
    authorizeSensitive: (password) => exclusive(() => authorizeSensitive(password)),
  };
}
