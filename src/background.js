// Event page wiring. All logic lives in lib/service.js. This is the only file that hands
// browser.storage.session to code; pages never read it (they would receive the key).
import { createService } from "./lib/service.js";
import { loadSettings } from "./lib/settings.js";

const service = createService({
  session: browser.storage.session,
  local: browser.storage.local,
  alarms: browser.alarms,
});

// Belt and braces: session storage is memory-only, but never trust it across restarts.
browser.runtime.onStartup.addListener(() => browser.storage.session.clear());

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autolock") service.onAlarm();
});

// C3.1: a shorter auto-lock time applies to the running session at once.
// C3.4: the idle detection interval follows the settings.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  service.onSettingsChanged();
  configureIdle();
});

// C3.4: optional system-idle lock. browser.idle exists only while the optional "idle"
// permission is granted. Registered synchronously at startup so the persistent listener
// wakes the event page; registered on grant for the running page.
const onIdle = (state) => service.onIdleState(state);
function watchIdle() {
  if (!browser.idle || browser.idle.onStateChanged.hasListener(onIdle)) return;
  browser.idle.onStateChanged.addListener(onIdle);
}
async function configureIdle() {
  if (!browser.idle) return;
  const { idleLockMinutes } = await loadSettings(browser.storage.local);
  browser.idle.setDetectionInterval(idleLockMinutes * 60);
}
watchIdle();
configureIdle();
browser.permissions.onAdded.addListener((p) => {
  if (p.permissions?.includes("idle")) { watchIdle(); configureIdle(); }
});

const OWN_ORIGIN = browser.runtime.getURL("");
browser.runtime.onMessage.addListener((msg, sender) => {
  // Only our own extension pages; no content scripts, no external senders.
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(OWN_ORIGIN)) return undefined;
  return service.handle(msg);
});
