// AMO listing screenshots (1280 x 800) in real Firefox with synthetic accounts only.
// Usage: node test/browser/amo-screenshots.mjs [path-to-firefox] [--lang=de|en] [--src=dir]
// --src: the extension directory (default src/). Final listing images come from the 1.0.0
// release source (dist/signing/1.0.0/source), which has no development notice.
// Runs in the harness's own temporary profile. Writes docs/amo/screenshots/<lang>-*.png.
// 1-2: the popup document (270 px, real zoom 1.5) on a plain backdrop, light and dark.
// 3-4: the options page (account list, appearance) in a 1280 x 800 viewport.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { syntheticSecret } from "../helpers/fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(root, "docs/amo/screenshots");
mkdirSync(OUT, { recursive: true });
const LANG = process.argv.find((a) => a.startsWith("--lang="))?.slice(7) ?? "en";
const SRC = resolve(root, process.argv.find((a) => a.startsWith("--src="))?.slice(6) ?? "src");
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6d";
const BASE = `moz-extension://${UUID}/`;
const PW = "Synthetic-Screenshot-Master-2026";
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";
// Fictional names; secrets are the CTA-SYNTHETIC-* test values.
const NAMES = {
  en: ["Mail", "Bank", "Cloud Storage Plus", "City Services Portal", "Code Hosting", "Family Password Vault",
    "Photo Archive", "Tax Portal", "Online Shop North", "Music Streaming", "Chat", "Domain Registrar",
    "Office VPN", "University Student Portal", "Forum", "Server Administration"],
  de: ["Mail", "Bank", "Wolkenspeicher Plus", "Bürgerportal Musterstadt", "Code-Hosting", "Passwort-Tresor Familie",
    "Fotoarchiv", "Steuerportal", "Versandhändler Nord", "Musik-Streaming", "Chat", "Domain-Registrar",
    "VPN Büro", "Universität – Studierendenportal", "Forum Gärtnerei", "Server-Administration"],
}[LANG];

const ff = await launchFirefox({ firefox: FIREFOX, port: 9337, prefs: {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "intl.locale.requested": LANG === "en" ? "en-US" : "de",
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.zoom.siteSpecific": false,
} });
const call = (m, p) => ff.call(m, p);
async function evalJson(ctx, src) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true, expression: `(${src})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}
const msg = (ctx, cmd, args = {}) => evalJson(ctx, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`);
async function waitFor(ctx, cond, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await evalJson(ctx, `async () => (${cond})`)) return true; } catch { /* loading */ } await sleep(50); }
  return false;
}

const tmp = mkdtempSync(join(tmpdir(), "cta-amo-"));
const written = [];
try {
  await call("session.new", { capabilities: {} });
  await call("webExtension.install", { extensionData: { type: "path", path: SRC } });
  const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
  const chromeEval = (body) => evalJson(chrome, `async () => { const w = ${SVC}.wm.getMostRecentWindow("navigator:browser"); ${body} }`);
  const scheme = (v) => chromeEval(`${SVC}.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", ${v}); await new Promise((r) => setTimeout(r, 300));`);
  const select = (url) => chromeEval(`const t = w.gBrowser.tabs.find((x) => x.linkedBrowser.currentURI.spec.startsWith(${JSON.stringify(url)})); w.gBrowser.selectedTab = t;
    await new Promise((r) => setTimeout(r, 200));`);
  const zoom = (z) => chromeEval(`w.ZoomManager.setZoomForBrowser(w.gBrowser.selectedBrowser, ${z}); await new Promise((r) => setTimeout(r, 300));`);
  await chromeEval(`if (w.windowState !== w.STATE_NORMAL) w.restore(); w.resizeTo(1400, 1000); await new Promise((r) => setTimeout(r, 400));`);

  const opt = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.navigate", { context: opt, url: BASE + "options/options.html#entries", wait: "complete" });
  await evalJson(opt, `async () => { await browser.storage.local.clear(); await browser.storage.session.clear(); }`);
  if (!(await msg(opt, "setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
  let revision = 1;
  for (const [i, name] of NAMES.entries()) {
    const account = { name, secret: syntheticSecret(900 + i), ...(i === 2 ? { url: "example.com" } : {}) };
    revision = (await msg(opt, "addAccount", { revision, account })).result.revision;
  }

  const capture = async (ctx, file, clip) => {
    const s = await call("browsingContext.captureScreenshot", { context: ctx, ...(clip ? { clip: { type: "box", ...clip } } : {}) });
    writeFileSync(join(OUT, file), Buffer.from(s.data, "base64"));
    written.push(file);
  };
  const viewport = (ctx) => call("browsingContext.setViewport", { context: ctx, viewport: { width: 1280, height: 800 } });

  // 1-2 popup: render the popup document in a tab, capture its body, place it on a 1280 x 800 backdrop.
  const pop = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.navigate", { context: pop, url: BASE + "popup/popup.html", wait: "complete" });
  await select(BASE + "popup/popup.html");
  await zoom(1.5);
  const backdrop = (await call("browsingContext.create", { type: "tab" })).context;
  for (const [n, theme, v, bg] of [[1, "light", 1, "#e9ecef"], [2, "dark", 0, "#1f2124"]]) {
    await scheme(v);
    await call("browsingContext.reload", { context: pop, wait: "complete" });
    if (!(await waitFor(pop, `document.querySelectorAll("#list li").length === ${NAMES.length}`))) throw new Error("popup list");
    await sleep(400);
    const r = await evalJson(pop, `async () => { const b = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: b.width, height: b.height }; }`);
    const s = await call("browsingContext.captureScreenshot", { context: pop, clip: { type: "box", ...r } });
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:800px;background:${bg};display:grid;place-items:center}
      img{width:${Math.round(r.width * 1.5)}px;box-shadow:0 6px 28px rgba(0,0,0,.35);border-radius:6px}</style><img src="data:image/png;base64,${s.data}">`;
    const f = join(tmp, `popup-${theme}.html`);
    writeFileSync(f, html);
    await call("browsingContext.navigate", { context: backdrop, url: pathToFileURL(f).href, wait: "complete" });
    await viewport(backdrop);
    await sleep(300);
    await capture(backdrop, `${LANG}-${n}-popup-${theme}.png`);
  }

  // 3-4 options page, light theme.
  await scheme(1);
  await select(BASE + "options/options.html");
  await zoom(1);
  // setViewport is unsupported for extension pages: size the window so the content area is 1280 x 800.
  const size = await chromeEval(`for (let i = 0; i < 4; i++) { const b = w.gBrowser.selectedBrowser;
      const dw = 1280 - b.clientWidth, dh = 800 - b.clientHeight; if (!dw && !dh) break;
      w.resizeTo(w.outerWidth + dw, w.outerHeight + dh); await new Promise((r) => setTimeout(r, 400)); }
    return [w.gBrowser.selectedBrowser.clientWidth, w.gBrowser.selectedBrowser.clientHeight];`);
  if (size[0] !== 1280 || size[1] !== 800) throw new Error(`content area ${size}`);
  for (const [tab, file] of [["entries", "3-accounts"], ["appearance", "4-appearance"]]) {
    await call("browsingContext.navigate", { context: opt, url: `${BASE}options/options.html#${tab}`, wait: "complete" });
    if (!(await waitFor(opt, `document.body.dataset.state === 'unlocked' && !document.getElementById("panel-${tab}").hidden`))) throw new Error(`options ${tab}`);
    await sleep(400);
    await capture(opt, `${LANG}-${file}.png`);
  }
  console.log(`Wrote ${written.length} screenshots to docs/amo/screenshots: ${written.join(", ")}`);
} finally {
  await ff.close();
  rmSync(tmp, { recursive: true, force: true });
}
