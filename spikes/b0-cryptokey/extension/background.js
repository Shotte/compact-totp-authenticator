import { checkSession, touch } from "./session-policy.js";
import { inspect, decryptProbe } from "./checks.js";

const store = browser.storage.session;
const instanceId = crypto.randomUUID();

async function log(event) {
  const { bgLog = [] } = await store.get("bgLog");
  bgLog.push({ event, instanceId, t: Date.now() });
  await store.set({ bgLog });
}
const ready = log("start");

browser.runtime.onSuspend.addListener(() => { log("suspend"); });

// Spike only: the BiDi driver cannot navigate a web tab to moz-extension://, so the
// extension opens its own tab, inside which the driver then navigates between phases.
browser.runtime.onInstalled.addListener(() => {
  browser.tabs.create({ url: "test.html?phase=noop" });
});

// Gate for every sensitive operation: fails closed and wipes an invalid session.
async function requireSession() {
  const { session } = await store.get("session");
  const state = checkSession(session, Date.now());
  if (state !== "ok") {
    await store.remove("session");
    throw new Error(`locked:${state}`);
  }
  return session;
}

async function scheduleLock(session) {
  await browser.alarms.create("autolock", { when: session.deadline });
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "autolock") return;
  await ready;
  const { session } = await store.get("session");
  if (checkSession(session, Date.now()) !== "ok") {
    await store.remove("session");
    await log("alarm-lock");
  } else {
    await scheduleLock(session); // activity moved the deadline; re-arm
  }
});

const handlers = {
  async probe() {
    const { session, probe } = await store.get(["session", "probe"]);
    return { instanceId, hasSession: !!session,
      key: session ? await inspect(session.key, probe) : null };
  },
  async sensitive() {
    try {
      const s = await requireSession();
      const { probe } = await store.get("probe");
      return { ok: await decryptProbe(s.key, probe) };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async touch() {
    const { session } = await store.get("session");
    const next = touch(session, Date.now());
    if (!next) { await store.remove("session"); return { ok: false, error: "locked" }; }
    await store.set({ session: next });
    await scheduleLock(next);
    return { ok: true };
  },
  async arm() {
    const { session } = await store.get("session");
    await scheduleLock(session);
    return { ok: true };
  },
  async lock() {
    await store.remove("session");
    await browser.alarms.clear("autolock");
    return { ok: true };
  },
  async log() { return (await store.get("bgLog")).bgLog ?? []; },
};

browser.runtime.onMessage.addListener(async (msg) => {
  await ready;
  return handlers[msg.cmd]();
});
