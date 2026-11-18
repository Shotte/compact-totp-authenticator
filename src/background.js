// Event page wiring. All logic lives in lib/service.js. This is the only file that hands
// browser.storage.session to code; pages never read it (they would receive the key).
import { createService } from "./lib/service.js";

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

const OWN_ORIGIN = browser.runtime.getURL("");
browser.runtime.onMessage.addListener((msg, sender) => {
  // Only our own extension pages; no content scripts, no external senders.
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(OWN_ORIGIN)) return undefined;
  return service.handle(msg);
});
