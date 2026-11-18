// Background service: the only code that touches the session key, the vault and secrets.
// Storage areas and the clock are injected so the same code runs in Node tests.
//
// Phase B: the vault is an AES-GCM encrypted working copy in storage.session (memory
// only), filled with synthetic fixtures by devUnlock. Nothing is persisted (B0-3).
import { newSession, checkSession, touch } from "./session-policy.js";
import { newAesKey, encryptJson, decryptJson } from "./crypto.js";
import { totp } from "./totp.js";
import { decodeBase32 } from "./base32.js";
import * as acc from "./accounts.js";
import { previewImport, MAX_IMPORT_BYTES } from "./legacy.js";
import { syntheticAccounts } from "./fixtures.js";
import { loadSettings } from "./settings.js";

export class LockedError extends Error {
  constructor(reason) { super(`locked:${reason}`); this.code = "locked"; }
}
export class ConflictError extends Error {
  constructor() { super("conflict"); this.code = "conflict"; }
}

const aad = (revision) => `cta-working-v1:${revision}`;

export function createService({ session, local, alarms, now = Date.now,
  randomId = () => crypto.randomUUID() }) {
  const startedAt = now();
  // Bumped synchronously by lock/unlock. An operation that started under another epoch
  // must not write or return anything, even if storage still looks valid.
  let epoch = 0;
  // Serializes read-modify-write sequences inside this event page instance.
  let chain = Promise.resolve();
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  async function wipe() {
    epoch++;
    await session.remove(["session", "vault"]);
    await alarms.clear("autolock");
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

  // Re-validates after async work: same epoch, same session id, deadline not passed.
  async function recheck({ s, e }) {
    const cur = await requireSession();
    if (e !== epoch || cur.s.id !== s.id) throw new LockedError("changed");
    return cur;
  }

  async function readVault(ctx) {
    const { vault } = await session.get("vault");
    if (!vault) throw new LockedError("no-vault");
    return { revision: vault.revision, accounts: await decryptJson(ctx.s.key, vault, aad(vault.revision)) };
  }

  // Compare-and-set: refuses to overwrite a revision other than the one that was read.
  async function writeVault(ctx, expectedRevision, accounts) {
    const revision = expectedRevision + 1;
    const enc = await encryptJson(ctx.s.key, accounts, aad(revision));
    await recheck(ctx);
    const { vault } = await session.get("vault");
    if (!vault || vault.revision !== expectedRevision) throw new ConflictError();
    if (ctx.e !== epoch) throw new LockedError("changed"); // no await between check and set
    await session.set({ vault: { revision, ...enc } });
    return revision;
  }

  // Qualifying user activity: moves the deadline of a still-valid session.
  async function activity(ctx) {
    const { session: s } = await session.get("session");
    const next = s && s.id === ctx.s.id ? touch(s, now()) : null;
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
      const newRevision = await writeVault(ctx, revision, next);
      await activity(ctx);
      return { revision: newRevision };
    });
  }

  const api = {
    async status() {
      const { session: s } = await session.get("session");
      return { unlocked: checkSession(s, now()) === "ok", startedAt };
    },

    // Phase B only: unlock with synthetic fixtures. Replaced by the master password in C.
    devUnlock({ count = 25 } = {}) {
      if (!Number.isInteger(count) || count < 0 || count > 500) throw new acc.InputError("count");
      return exclusive(async () => {
        epoch++;
        const { autoLockMinutes } = await loadSettings(local);
        const key = await newAesKey();
        const s = { ...newSession(key, now(), autoLockMinutes * 60_000), id: randomId() };
        const vault = { revision: 1, ...(await encryptJson(key, syntheticAccounts(count), aad(1))) };
        await session.set({ session: s, vault });
        await alarms.create("autolock", { when: s.deadline });
        return { unlocked: true };
      });
    },

    async lock() { await wipe(); return { unlocked: false }; },

    activity() {
      return exclusive(async () => { await activity(await requireSession()); return {}; });
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

    // Preview only; nothing is stored (B5, B0-3).
    async importPreview({ text }) {
      const ctx = await requireSession();
      const { accounts } = await readVault(ctx);
      const preview = previewImport(text, accounts);
      await recheck(ctx);
      return preview;
    },
  };

  const ARGS = {
    devUnlock: (m) => ({ count: m.count ?? 25 }),
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
  };
}
