// F3-2 follow-up: what happens to the popup shortcut when an installation is upgraded from the
// old default (Alt+Shift+A) to the new one (Ctrl+Shift+2)?
// Usage: node test/browser/shortcut-upgrade.mjs [path-to-firefox] [--out=file.json]
//
// Scenarios, each in a fresh profile:
//  A  old version with the old default -> upgrade
//  B  old version, shortcut customized by the user (as the about:addons shortcut manager does,
//     through browser.commands.update) -> upgrade
//  C  fresh installation of the new version
// "Old" is the extension from git main (Alt+Shift+A), "new" is the working tree. Both are
// copied to a temporary folder with versions 0.9.3 and 0.9.99, so the second install is a real
// version upgrade of the same add-on ID.
//
// Limitation: release Firefox installs unsigned add-ons only temporarily, so the upgrade is a
// temporary reinstall (Firefox reports it to the extension as an update). The path of a signed,
// permanently installed add-on that updates itself through its update manifest cannot be run
// here; it needs the signed test build.
import { writeFileSync, mkdirSync, mkdtempSync, cpSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox } from "./bidi.mjs";
import { pressNative, LAYOUTS, opensPopupOnly } from "./shortcuts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_FIREFOX = { win32: "C:/Program Files/Mozilla Firefox/firefox.exe",
  darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN ?? DEFAULT_FIREFOX;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6)
  ?? join(root, `docs/evidence/acceptance-093/shortcut-upgrade-${process.platform}.json`);
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c";
const NATIVE = process.platform === "win32" && process.env.MOZ_HEADLESS !== "1";
const CUSTOM = "Ctrl+Shift+9";

// Two copies of the extension: old (git main) and new (working tree).
const work = mkdtempSync(join(tmpdir(), "cta-upgrade-"));
const OLD = join(work, "old"), NEW = join(work, "new");
execFileSync("git", ["-C", root, "worktree", "add", "--detach", join(work, "main"), "origin/main"], { stdio: "ignore" });
cpSync(join(work, "main", "src"), OLD, { recursive: true });
execFileSync("git", ["-C", root, "worktree", "remove", "--force", join(work, "main")], { stdio: "ignore" });
cpSync(join(root, "src"), NEW, { recursive: true });
const setVersion = (dir, v) => { const p = join(dir, "manifest.json"), m = JSON.parse(readFileSync(p, "utf8"));
  m.version = v; writeFileSync(p, JSON.stringify(m, null, 2)); return m.commands._execute_action.suggested_key.default; };
const oldDefault = setVersion(OLD, "0.9.3"), newDefault = setVersion(NEW, "0.9.99");

async function scenario(name, steps) {
  const ff = await launchFirefox({ firefox: FIREFOX, prefs: {
    "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }), "intl.locale.requested": "de",
    "browser.shell.checkDefaultBrowser": false, "datareporting.policy.dataSubmissionEnabled": false,
    "browser.startup.homepage_override.mstone": "ignore" } });
  const call = ff.call;
  const evalJson = async (ctx, fn) => {
    const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true, expression: `(${fn})().then((v) => JSON.stringify(v ?? null))` });
    if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
    return JSON.parse(r.result.value);
  };
  const page = async () => { const tab = (await call("browsingContext.create", { type: "tab" })).context; // the reinstall closes extension tabs
    await call("browsingContext.navigate", { context: tab, url: `moz-extension://${UUID}/options/options.html`, wait: "complete" }); return tab; };
  const api = {
    install: async (dir) => { await call("webExtension.install", { extensionData: { type: "path", path: dir } }); await new Promise((r) => setTimeout(r, 1000)); },
    state: async () => evalJson(await page(), `async () => ({ version: browser.runtime.getManifest().version,
      shortcut: (await browser.commands.getAll()).find((c) => c.name === "_execute_action").shortcut })`),
    customize: async (s) => evalJson(await page(), `async () => { await browser.commands.update({ name: "_execute_action", shortcut: ${JSON.stringify(s)} }); }`),
    press: async (s) => {
      if (!NATIVE) return null;
      const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
      const out = {};
      for (const [l, id] of Object.entries(LAYOUTS)) out[l] = opensPopupOnly(await pressNative(evalJson, chrome, s, id));
      return out;
    },
  };
  try {
    await call("session.new", { capabilities: {} });
    return await steps(api);
  } finally { await ff.close(); }
}

const evidence = { startedAt: new Date().toISOString(), platform: process.platform, nativeKeys: NATIVE, oldDefault, newDefault, custom: CUSTOM, scenarios: {} };
try {
  evidence.scenarios.A = await scenario("A", async (x) => {
    await x.install(OLD); const before = await x.state();
    await x.install(NEW); const after = await x.state();
    const pressedNew = await x.press(newDefault), pressedOld = await x.press(oldDefault);
    const pass = before.shortcut === oldDefault && after.version === "0.9.99" && after.shortcut === newDefault && (!NATIVE || (pressedNew.de && pressedNew.us && !pressedOld.de && !pressedOld.us));
    return { before, after, pressedNew, pressedOld, expected: `old default replaced by ${newDefault}`, verdict: pass ? "PASS" : "FAIL" };
  });
  evidence.scenarios.B = await scenario("B", async (x) => {
    await x.install(OLD); await x.customize(CUSTOM); const before = await x.state();
    await x.install(NEW); const after = await x.state();
    const pressedCustom = await x.press(CUSTOM);
    const pass = before.shortcut === CUSTOM && after.version === "0.9.99" && after.shortcut === CUSTOM && (!NATIVE || (pressedCustom.de && pressedCustom.us));
    return { before, after, pressedCustom, expected: `customized ${CUSTOM} kept`, verdict: pass ? "PASS" : "FAIL" };
  });
  evidence.scenarios.C = await scenario("C", async (x) => {
    await x.install(NEW); const after = await x.state();
    const pressedNew = await x.press(newDefault);
    const pass = after.shortcut === newDefault && (!NATIVE || (pressedNew.de && pressedNew.us));
    return { after, pressedNew, expected: `fresh install uses ${newDefault}`, verdict: pass ? "PASS" : "FAIL" };
  });
} catch (e) {
  evidence.error = String(e?.stack ?? e);
  console.error(e);
} finally {
  evidence.finishedAt = new Date().toISOString();
  rmSync(work, { recursive: true, force: true });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n");
  for (const [k, v] of Object.entries(evidence.scenarios)) console.log(v.verdict, k, v.expected);
  console.log("written", OUT);
}
