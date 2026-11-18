import { newSession } from "./session-policy.js";
import { encryptProbe, inspect } from "./checks.js";

const store = browser.storage.session;
const phase = new URLSearchParams(location.search).get("phase");
const send = (cmd) => browser.runtime.sendMessage({ cmd });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false,
  ["encrypt", "decrypt"]);

async function storedKey() {
  const { session, probe } = await store.get(["session", "probe"]);
  return session ? await inspect(session.key, probe) : null;
}

const phases = {
  async noop() { return {}; }, // neutral page; navigating here destroys the previous page

  async create() {
    const key = await newKey();
    const r = { created: await inspect(key, await encryptProbe(key)) };
    const probe = await encryptProbe(key);
    const session = newSession(key, Date.now(), 15 * 60 * 1000);
    try { await store.set({ session, probe }); r.setNested = "OK"; }
    catch (e) { r.setNested = `${e.name}: ${e.message}`; }
    try { await store.set({ topKey: key }); r.setTopLevel = "OK"; }
    catch (e) { r.setTopLevel = `${e.name}: ${e.message}`; }
    r.retrievedNested = await storedKey();
    const { topKey } = await store.get("topKey");
    r.retrievedTopLevel = topKey ? await inspect(topKey, probe) : null;
    await store.remove("topKey");
    return r;
  },

  async reopen() { return { retrieved: await storedKey() }; },

  // Runs inside the real browserAction popup; result goes to storage for the driver tab.
  async popup() {
    const { popupResults = [] } = await store.get("popupResults");
    popupResults.push({ t: Date.now(), url: location.href, retrieved: await storedKey() });
    await store.set({ popupResults });
    setTimeout(() => window.close(), 200);
    return { stored: true };
  },

  async "popup-driver"() {
    await store.remove("popupResults");
    const r = { opens: [] };
    for (let i = 1; i <= 2; i++) {
      try { await browser.action.openPopup(); r.opens.push("OK"); }
      catch (e) { r.opens.push(`${e.name}: ${e.message}`); continue; }
      for (let w = 0; w < 50; w++) {
        const { popupResults = [] } = await store.get("popupResults");
        if (popupResults.length >= i) break;
        await sleep(100);
      }
      await sleep(1000); // let the popup close before reopening
    }
    r.popupResults = (await store.get("popupResults")).popupResults ?? [];
    return r;
  },

  async bg() { return { probe: await send("probe"), log: await send("log") }; },

  async lock() {
    const { session, probe } = await store.get(["session", "probe"]);
    const held = session.key; // a copy an open page might still hold
    const r = { lock: await send("lock") };
    r.afterLockPage = (await store.get("session")).session ?? null;
    r.afterLockBg = await send("probe");
    r.heldCopyStillUsable = (await inspect(held, probe)).decrypt;
    return r;
  },

  async "verify-lock"() {
    return { page: (await store.get("session")).session ?? null,
      bg: await send("probe"), sensitive: await send("sensitive") };
  },

  // B0-2: missed alarm. No alarm is armed; the gate alone must reject after the deadline.
  async expiry() {
    const key = await newKey();
    await store.set({ session: newSession(key, Date.now(), 3000), probe: await encryptProbe(key) });
    const r = { beforeDeadline: await send("sensitive"), touchBefore: await send("touch") };
    await browser.alarms.clear("autolock"); // touch armed one; remove it to simulate a missed alarm
    await sleep(4000);
    r.afterDeadline = await send("sensitive");
    r.sessionAfter = (await store.get("session")).session ?? null;
    await store.set({ session: newSession(key, Date.now() - 10000, 3000) }); // stale, expired
    r.touchAfterExpiry = await send("touch");
    r.sessionAfterTouch = (await store.get("session")).session ?? null;
    return r;
  },

  // Alarm path: arm, then leave the extension idle; driver checks with alarm-check.
  async "alarm-set"() {
    const key = await newKey();
    await store.set({ session: newSession(key, Date.now(), 2000), probe: await encryptProbe(key) });
    return { arm: await send("arm") };
  },

  async "alarm-check"() {
    return { session: (await store.get("session")).session ?? null, log: await send("log") };
  },

  async "reload-set"() {
    const key = await newKey();
    await store.set({ reloadMarker: Date.now(), session: newSession(key, Date.now(), 60000) });
    setTimeout(() => browser.runtime.reload(), 300);
    return { reloading: true };
  },

  async "reload-check"() {
    return await store.get(["reloadMarker", "session", "bgLog"]);
  },
};

(async () => {
  let result;
  try { result = await phases[phase](); }
  catch (e) { result = { error: `${e.name}: ${e.message}` }; }
  document.getElementById("out").textContent = JSON.stringify(result, null, 2);
  document.title = "DONE";
})();
