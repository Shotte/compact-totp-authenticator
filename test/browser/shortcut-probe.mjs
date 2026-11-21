// F3-2 (operator acceptance 0.9.3): which keyboard shortcut opens the CTA popup reliably?
// Usage: node test/browser/shortcut-probe.mjs [path-to-firefox] [--out=file.json]
//
// For every candidate the probe
//  1. lists what Firefox itself binds to it in the browser window (shortcuts.mjs: <key>
//     elements after localization, menu-bar access keys for Alt+letter, AltGr on Windows);
//  2. assigns it to the popup command (browser.commands.update, as the shortcut manager does);
//  3. on Windows with a visible browser: presses it as a native key event with the German and
//     the US keyboard layout and records what happened (popup, menu, tab, window).
// The key events go to the test browser only, not to other applications.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox } from "./bidi.mjs";
import { readBindings, conflicts, pressNative, LAYOUTS, opensPopupOnly } from "./shortcuts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_FIREFOX = { win32: "C:/Program Files/Mozilla Firefox/firefox.exe",
  darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN ?? DEFAULT_FIREFOX;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6)
  ?? join(root, `docs/evidence/acceptance-093/shortcut-probe-${process.platform}.json`);
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c";
const NATIVE = process.platform === "win32" && process.env.MOZ_HEADLESS !== "1";

const CANDIDATES = [
  "Alt+Shift+A", // 0.9.3 default (operator: opens the View menu in German Firefox)
  "Ctrl+Shift+F", // control: a Firefox shortcut (add-ons manager in this version)
  "Ctrl+Alt+A", // tried by the operator; Ctrl+Alt is AltGr on German Windows
  "Alt+Shift+Z", "Alt+Shift+1", "Alt+Shift+2",
  "Ctrl+Shift+A", "Ctrl+Shift+L", "Ctrl+Shift+U", "Ctrl+Shift+Y",
  "Ctrl+Shift+1", "Ctrl+Shift+2", "Ctrl+Shift+8", "Ctrl+Shift+9",
  "Ctrl+Shift+Comma", "Ctrl+Shift+Period", "Ctrl+Period", "Ctrl+Comma",
];

const ff = await launchFirefox({ firefox: FIREFOX, prefs: {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "intl.locale.requested": "de",
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "browser.startup.homepage_override.mstone": "ignore",
} });
const call = ff.call;
async function evalJson(ctx, fn) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true,
    expression: `(${fn})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}

const evidence = { startedAt: new Date().toISOString(), platform: process.platform, nativeKeys: NATIVE };
try {
  evidence.browser = (await call("session.new", { capabilities: {} })).capabilities.browserVersion;
  await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  const opt = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.navigate", { context: opt, url: `moz-extension://${UUID}/options/options.html`, wait: "complete" });
  const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0]?.context;
  if (!chrome) throw new Error("chrome scope unavailable");
  await new Promise((r) => setTimeout(r, 1500)); // menus and keys are localized asynchronously
  const bindings = await readBindings(evalJson, chrome);
  evidence.locale = bindings.locale;
  evidence.menuAccessKeys = bindings.menus;

  evidence.results = [];
  for (const shortcut of CANDIDATES) {
    const assigned = await evalJson(opt, `async () => { try { await browser.commands.update({ name: "_execute_action", shortcut: ${JSON.stringify(shortcut)} });
      return (await browser.commands.getAll()).find((c) => c.name === "_execute_action").shortcut; } catch (e) { return "error: " + e.message; } }`);
    const row = { shortcut, assigned, ...conflicts(bindings, shortcut), pressed: {} };
    if (NATIVE && assigned === shortcut) {
      for (const [name, id] of Object.entries(LAYOUTS)) row.pressed[name] = await pressNative(evalJson, chrome, shortcut, id).catch((e) => ({ error: e.message }));
    }
    const works = NATIVE ? Object.values(row.pressed).every(opensPopupOnly) : null;
    row.verdict = assigned !== shortcut ? "rejected" : !row.free ? "conflict" : works === null ? "free (not pressed)" : works ? "works" : "does not work";
    evidence.results.push(row);
    const seen = Object.entries(row.pressed).map(([l, p]) => `${l}:${p.error ?? (p.popup ? "popup" : p.menus?.length ? "menu " + p.menus : p.newTabs ? "tab " + p.selectedTab : p.panels?.length ? "panel " + p.panels : "nothing")}`);
    console.log(`${row.verdict.padEnd(18)} ${shortcut.padEnd(18)} firefox=${row.firefoxKeys.join("|") || "-"} menu=${row.menuAccessKeys.join("|") || "-"}${row.altGr ? " AltGr" : ""} ${seen.join(" ")}`);
  }
  // How the shortcut manager in about:addons reports a clash (localized messages).
  evidence.shortcutManagerMessages = await evalJson(chrome, `async () => { for (const l of ["de", "en-US"]) {
    try { const t = await (await fetch("resource://gre/localization/" + l + "/toolkit/about/aboutAddons.ftl")).text();
      return t.split("\\n").filter((x) => /^shortcuts-(exists|duplicate|system|invalid)/.test(x)); } catch {} } return null; }`).catch((e) => String(e));
} catch (e) {
  evidence.error = String(e?.stack ?? e);
  console.error(e);
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n");
  console.log("written", OUT);
  await ff.close();
}
