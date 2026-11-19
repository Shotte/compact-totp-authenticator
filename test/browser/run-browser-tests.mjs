// Phase B browser tests against the real extension (src/) in Firefox.
// Usage: node test/browser/run-browser-tests.mjs [path-to-firefox.exe]
// Writes docs/evidence/phase-b/browser-results.json and popup screenshots.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { startOsInput } from "./os-input.mjs";
import { syntheticAccounts, syntheticSecret } from "../helpers/fixtures.mjs";
import { contrast, rowHeightPx, themeTokens } from "../../src/lib/appearance.js";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.RESULTS_DIR ? resolve(process.env.RESULTS_DIR) : join(root, "docs/evidence/phase-b");
const DEFAULT_FIREFOX = { win32: "C:/Program Files/Mozilla Firefox/firefox.exe",
  darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN ?? DEFAULT_FIREFOX;
// MOZ_HEADLESS=1 (CI): no graphical desktop. Tests that need real browser UI are reported
// as NOT_TESTED, never skipped silently and never counted as passed.
const HEADLESS = process.env.MOZ_HEADLESS === "1";
// --os-input: real Windows mouse input for the toolbar popup (moves the cursor briefly).
const OS_INPUT = process.argv.includes("--os-input") && process.platform === "win32";
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c"; // fixed test-profile UUID
const BASE = `moz-extension://${UUID}/`;
const IDLE_MS = 3000;
const LEGACY_PATH = join(root, "test/fixtures/legacy-synthetic.json");
const LEGACY_TEXT = readFileSync(LEGACY_PATH, "utf8");
// Synthetic test passwords (C2). Never real credentials.
const PW = "correct horse battery staple 2026", PW2 = "zweites Passwort für den Wechsel ✓", PW3 = "dritte Passphrase für Absturztests";
const SECRETS = [...syntheticAccounts(100).map((a) => a.secret),
  ...JSON.parse(LEGACY_TEXT).otp_list.map((e) => e?.key).filter((k) => typeof k === "string" && k.length >= 16)];
const leaks = (text) => [...SECRETS, PW, PW2, PW3].filter((s) => text.includes(s) || text.includes(s.toLowerCase()));

// Chrome-scope access to Services: a global in current Firefox, a module import in ESR 140.
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";
const results = [];
function notTested(id, name, reason) {
  results.push({ id, name, verdict: "NOT_TESTED", details: { reason } });
  console.log(`NOT_TESTED  ${id}  ${name} (${reason})`);
}
function record(id, name, pass, details) {
  results.push({ id, name, verdict: pass ? "PASS" : "FAIL", details });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}`);
}

const PREFS = {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "extensions.background.idle.timeout": IDLE_MS,
  "intl.locale.requested": "de",
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.startup.homepage_override.mstone": "ignore",
  // Restart tests: keep extension storage and UUID when the temporary add-on is reinstalled.
  "extensions.webextensions.keepStorageOnUninstall": true,
  "extensions.webextensions.keepUuidOnUninstall": true,
  // Repeated hard kills must not trigger the startup safe-mode prompt or session restore
  // (that prompt blocks a restarted browser after about three crashes).
  "toolkit.startup.max_resumed_crashes": -1,
  "browser.sessionstore.resume_from_crash": false,
};
let ff = await launchFirefox({ firefox: FIREFOX, prefs: PREFS });
const call = (method, params) => ff.call(method, params);

async function evalJson(ctx, fnSource) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true,
    expression: `(${fnSource})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}
const msg = (ctx, cmd, args = {}) =>
  evalJson(ctx, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`);
async function waitFor(ctx, cond, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await evalJson(ctx, `async () => (${cond})`)) return true; } catch { /* navigating */ }
    await sleep(50);
  }
  return false;
}
async function open(ctx, path) {
  await call("browsingContext.navigate", { context: ctx, url: BASE + path, wait: "complete" });
}
async function node(ctx, selector) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: false,
    expression: `document.querySelector(${JSON.stringify(selector)})`, resultOwnership: "root" });
  return { sharedId: r.result.sharedId };
}
async function clickAt(ctx, selector) { // trusted input → transient user activation
  const el = await node(ctx, selector);
  await call("input.performActions", { context: ctx, actions: [{ type: "pointer", id: "mouse",
    parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: el } },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }] });
}

const evidence = { startedAt: new Date().toISOString() };
try {
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = { version: s.capabilities.browserVersion, platform: s.capabilities.platformName };
  evidence.install = await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  let opt = (await call("browsingContext.create", { type: "tab" })).context;
  let pop = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.setViewport", { context: pop, viewport: { width: 270, height: 600 } });
  // Harness capability: privileged chrome-scope evaluation (used to flip Firefox prefs at
  // runtime). Not available in Firefox ESR 140; dependent checks are then NOT_TESTED.
  let chromeTop = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0]?.context;
  const CHROME_OK = chromeTop ? await evalJson(chromeTop, `async () => typeof Services !== "undefined" || typeof ChromeUtils !== "undefined"`).catch(() => false) : false;
  const NO_CHROME = "harness: privileged chrome scope unavailable in this Firefox version";
  evidence.chromeScopePrivileged = CHROME_OK;
  await open(opt, "options/options.html");

  // Harness helpers (C2): real master-password vaults instead of the removed demo unlock.
  const wipeVault = () => evalJson(opt, `async () => { await browser.storage.local.remove(["vault", "vault_backup", "vault_next"]);
    await browser.storage.session.clear(); }`);
  async function resetVault(n, password = PW) {
    await wipeVault();
    const r = await msg(opt, "setup", { password, confirm: password });
    if (!r.ok) throw new Error("setup failed: " + JSON.stringify(r));
    let revision = 1;
    for (const a of syntheticAccounts(n)) {
      const res = await msg(opt, "addAccount", { revision, account: { name: a.name, secret: a.secret, url: a.url,
        algorithm: a.algorithm, digits: a.digits, period: a.period } });
      if (!res.ok) throw new Error("addAccount failed: " + JSON.stringify(res));
      revision = res.result.revision;
    }
    return revision;
  }
  // Hard kill (simulated crash), relaunch with the same profile, reinstall the extension.
  async function restart() {
    const pid = CHROME_OK ? await evalJson(chromeTop, `async () => ${SVC}.appinfo.processID`).catch(() => ff.pid) : ff.pid;
    const profile = ff.profile;
    await ff.kill(pid);
    ff = await launchFirefox({ firefox: FIREFOX, prefs: PREFS, profile });
    await call("session.new", { capabilities: {} });
    await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
    opt = (await call("browsingContext.create", { type: "tab" })).context;
    pop = (await call("browsingContext.create", { type: "tab" })).context;
    await call("browsingContext.setViewport", { context: pop, viewport: { width: 270, height: 600 } });
    chromeTop = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0]?.context;
    await open(opt, "options/options.html");
  }

  // B6: locked by default, every sensitive command fails closed
  {
    const st = await msg(opt, "status");
    const r = await Promise.all(["getCodes", "listAccounts", "activity"].map((c) => msg(opt, c)));
    const page = await waitFor(opt, "document.body.dataset.state === 'locked' && document.body.dataset.locked === 'setup'");
    record("B6-1", "fresh install: not initialized, setup shown, sensitive commands rejected", st.result.unlocked === false &&
      st.result.initialized === false &&
      r.every((x) => x.ok === false && x.error === "locked") && page, { status: st, responses: r });
  }

  // B3: layout for 1/25/50/100 accounts
  const layouts = {};
  for (const n of [1, 25, 50, 100]) {
    await resetVault(n);
    const t0 = Date.now();
    await open(pop, "popup/popup.html");
    const rendered = await waitFor(pop, `document.body.dataset.rendered === "${n}"`, 10000);
    const ms = Date.now() - t0;
    const m = await evalJson(pop, `async () => {
      const rows = [...document.querySelectorAll("#list .row")];
      const list = document.getElementById("list"), footer = document.querySelector("footer");
      const cs = getComputedStyle(rows[0]);
      const out = { rows: rows.length, rowHeights: [...new Set(rows.map((r) => r.getBoundingClientRect().height))],
        bodyWidth: document.body.getBoundingClientRect().width, bodyHeight: document.body.getBoundingClientRect().height,
        docScrollWidth: document.documentElement.scrollWidth, listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight, fontFamily: cs.fontFamily, fontSize: cs.fontSize,
        codesOk: [...document.querySelectorAll("#list .code")].every((c) => /^\\d{6,8}$/.test(c.textContent)),
        ticker: document.getElementById("ticker").textContent };
      list.scrollTop = list.scrollHeight;
      await new Promise((r) => requestAnimationFrame(r));
      const lr = list.getBoundingClientRect(), last = rows.at(-1).getBoundingClientRect(), fr = footer.getBoundingClientRect();
      out.lastRowReachable = last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5;
      out.footerVisible = fr.top >= lr.bottom - 1 && fr.bottom <= innerHeight + 0.5;
      list.scrollTop = 0;
      return out; }`);
    m.renderMs = ms;
    layouts[n] = m;
    // Default appearance must keep the Phase B dimensions exactly (no unintended growth).
    const expectedBody = n === 1 ? 56 : 591;
    m.expectedBodyHeight = expectedBody;
    const pass = rendered && m.rows === n && m.rowHeights.length === 1 && m.rowHeights[0] === 25 &&
      m.bodyHeight === expectedBody && m.bodyWidth === 270 && m.docScrollWidth <= 270 && m.bodyHeight <= 600 && m.lastRowReachable &&
      m.footerVisible && /monospace/.test(m.fontFamily) && m.codesOk && ms < 3000;
    record(`B3-${n}`, `popup layout with ${n} account(s)`, pass, m);
    if (n === 25) {
      for (const theme of ["dark", "light"]) {
        await evalJson(opt, `async () => browser.storage.local.set({ settings: { theme: "${theme}" } })`);
        await open(pop, "popup/popup.html");
        await waitFor(pop, `document.body.dataset.rendered === "25"`);
        const h = Math.ceil(m.bodyHeight);
        const shot = await call("browsingContext.captureScreenshot", { context: pop,
          clip: { type: "box", x: 0, y: 0, width: 270, height: h } });
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `popup-25-accounts-${theme}-de.png`), Buffer.from(shot.data, "base64"));
      }
      await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
    }
  }

  // B7: appearance extremes with 100 accounts — no clipping/overlap, uniform rows, contrast
  {
    // Every supported layout configuration: font 12–20 px × row height auto/22/25/30, with
    // the color modes rotating (dark, light, auto, custom) so each appears at every size band.
    const combos = [];
    const colorModes = [{ theme: "dark" }, { theme: "light" }, { theme: "auto" },
      { theme: "auto", customColors: true, fg: "#1a1a1a", bg: "#f0efe6" }];
    for (let fontSize = 12; fontSize <= 20; fontSize++) for (const rowHeight of ["auto", 22, 25, 30]) {
      combos.push({ fontSize, rowHeight, ...colorModes[combos.length % colorModes.length] });
    }
    combos.push({ fontSize: 20, rowHeight: 22, theme: "dark", customColors: true, fg: "#777777", bg: "#808080" });
    for (const c of combos) {
      await evalJson(opt, `async () => browser.storage.local.set({ settings: ${JSON.stringify(c)} })`);
      await open(pop, "popup/popup.html");
      await waitFor(pop, `document.body.dataset.rendered === "100"`, 10000);
      const m = await evalJson(pop, `async () => {
        const rows = [...document.querySelectorAll("#list .row")], list = document.getElementById("list");
        const px = (el) => getComputedStyle(el).fontSize;
        const issues = [];
        const check = (row, i) => {
          const r = row.getBoundingClientRect(), [n, c, ic] = [".name", ".code", ".icon"].map((s) => row.querySelector(s));
          const [nr, cr, ir] = [n, c, ic].map((e) => e.getBoundingClientRect());
          if (nr.right > cr.left + 0.5) issues.push(i + ": name overlaps code");
          if (cr.right > ir.left + 0.5) issues.push(i + ": code overlaps icon");
          if (ir.right > r.right - 11) issues.push(i + ": icon outside padding");
          if (c.scrollWidth > c.clientWidth + 0.5) issues.push(i + ": code truncated");
          for (const [e, er] of [[n, nr], [c, cr]]) {
            if (er.top < r.top - 0.5 || er.bottom > r.bottom + 0.5) issues.push(i + ": text box exceeds row");
            if (e.scrollHeight > e.clientHeight + 0.5) issues.push(i + ": text clipped vertically");
          }
        };
        rows.slice(0, 12).forEach(check);
        list.scrollTop = list.scrollHeight;
        await new Promise((r) => requestAnimationFrame(r));
        const last = rows.at(-1), lr = list.getBoundingClientRect(), la = last.getBoundingClientRect();
        check(last, rows.length - 1);
        const f = document.querySelector("footer").getBoundingClientRect();
        const name = rows[0].querySelector(".name");
        return { rows: rows.length, rowHeights: [...new Set(rows.map((r) => r.getBoundingClientRect().height))],
          nameFont: px(name), codeFont: px(rows[0].querySelector(".code")),
          bodyWidth: document.body.getBoundingClientRect().width, bodyHeight: document.body.getBoundingClientRect().height,
          docScrollWidth: document.documentElement.scrollWidth, issues,
          lastRowVisible: la.top >= lr.top - 0.5 && la.bottom <= lr.bottom + 0.5,
          footerVisible: f.top >= lr.bottom - 1 && f.bottom <= innerHeight + 0.5,
          fg: getComputedStyle(name).color, bg: getComputedStyle(document.body).backgroundColor,
          mode: document.documentElement.dataset.theme }; }`);
      const toHex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
      m.contrast = Math.round(contrast(toHex(m.fg), toHex(m.bg)) * 100) / 100;
      m.expectedRowHeight = rowHeightPx(c.fontSize, c.rowHeight);
      const label = `${c.fontSize}px/${c.rowHeight}/${c.customColors ? (c.fg === "#777777" ? "custom-low-contrast" : "custom") : c.theme}`;
      record(`B7-${label}`, `appearance ${label} with 100 accounts`, m.rows === 100 && m.rowHeights.length === 1 &&
        m.rowHeights[0] === m.expectedRowHeight && m.nameFont === `${c.fontSize}px` && m.codeFont === `${c.fontSize}px` &&
        m.bodyWidth === 270 && m.docScrollWidth <= 270 && m.bodyHeight <= 600 && m.issues.length === 0 &&
        m.lastRowVisible && m.footerVisible && m.contrast >= 4.5, { settings: c, ...m });
      if ([["12", "auto"], ["20", "30"]].some(([f, r]) => String(c.fontSize) === f && String(c.rowHeight) === r) ||
        c.fg === "#777777") {
        await evalJson(pop, `async () => { document.getElementById("list").scrollTop = 0; }`);
        const h = Math.ceil(m.bodyHeight);
        const shot = await call("browsingContext.captureScreenshot", { context: pop, clip: { type: "box", x: 0, y: 0, width: 270, height: h } });
        writeFileSync(join(OUT, `popup-appearance-${label.replace(/\//g, "-")}.png`), Buffer.from(shot.data, "base64"));
      }
    }

    // Auto follows a live change of the Firefox color scheme (no reload)
    const chrome = chromeTop;
    const setScheme = (v) => evalJson(chrome, `async () => ${SVC}.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", ${v})`);
    if (!CHROME_OK) notTested("B7-auto", "theme auto follows live prefers-color-scheme changes", NO_CHROME);
    else {
    await evalJson(opt, `async () => browser.storage.local.set({ settings: { theme: "auto" } })`);
    await open(pop, "popup/popup.html");
    await waitFor(pop, `document.body.dataset.rendered === "100"`);
    const seen = [];
    for (const v of [0, 1, 0]) { // 0 = dark, 1 = light
      await setScheme(v);
      const want = v === 0 ? "dark" : "light";
      seen.push({ want, ok: await waitFor(pop, `document.documentElement.dataset.theme === "${want}"`, 3000),
        bg: await evalJson(pop, `async () => getComputedStyle(document.body).backgroundColor`) });
    }
    await evalJson(chrome, `async () => ${SVC}.prefs.clearUserPref("layout.css.prefers-color-scheme.content-override")`);
    record("B7-auto", "theme auto follows live prefers-color-scheme changes", seen.every((s) => s.ok) &&
      seen[0].bg !== seen[1].bg, { transitions: seen });
    }

    // Options page: live preview, persistence, contrast hint, reset to defaults
    await evalJson(opt, `async () => browser.storage.local.set({ settings: { sort: "alpha", autoLockMinutes: 7 } })`);
    await open(opt, "options/options.html");
    await waitFor(opt, "document.body.dataset.state === 'unlocked'");
    const ui = await evalJson(opt, `async () => {
      const f = document.getElementById("settingsForm"), el = f.elements, pv = document.querySelector("#appearancePreview .name");
      el.fontSize.value = "20"; f.dispatchEvent(new Event("input", { bubbles: true }));
      const livePreview = getComputedStyle(pv).fontSize;
      el.rowHeight.value = "22"; el.customColors.checked = true; el.fg.value = "#777777"; el.bg.value = "#808080";
      f.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const stored = (await browser.storage.local.get("settings")).settings;
      const hints = { contrast: !document.getElementById("contrastNote").hidden, row: !document.getElementById("rowNote").hidden,
        rowText: document.getElementById("rowNote").textContent, out: document.getElementById("fontSizeOut").textContent };
      document.getElementById("resetAppearance").click();
      await new Promise((r) => setTimeout(r, 200));
      const reset = (await browser.storage.local.get("settings")).settings;
      return { livePreview, stored, hints, reset, previewAfterReset: getComputedStyle(pv).fontSize }; }`);
    const r = ui.reset;
    record("B7-options", "options: live preview, saved separately, hints, reset keeps behaviour settings",
      ui.livePreview === "20px" && ui.stored.fontSize === 20 && ui.stored.rowHeight === 22 && ui.stored.customColors &&
      ui.hints.contrast && ui.hints.row && ui.hints.out === "20 px" && r.theme === "auto" && r.fontSize === 16 &&
      r.rowHeight === "auto" && r.customColors === false && r.sort === "alpha" && r.autoLockMinutes === 7 &&
      ui.previewAfterReset === "16px", ui);
    await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
    for (const [scheme, v] of CHROME_OK ? [["dark", 0], ["light", 1]] : []) {
      await setScheme(v);
      await sleep(300);
      const box = await evalJson(opt, `async () => { const s = document.getElementById("appearance");
        s.scrollIntoView(); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`);
      const shot = await call("browsingContext.captureScreenshot", { context: opt,
        clip: { type: "box", x: box.x, y: box.y, width: box.w, height: box.h } });
      writeFileSync(join(OUT, `options-appearance-auto-${scheme}-de.png`), Buffer.from(shot.data, "base64"));
    }
    if (CHROME_OK) await evalJson(chrome, `async () => ${SVC}.prefs.clearUserPref("layout.css.prefers-color-scheme.content-override")`);
  }

  // B8: subtle row hover (trusted BiDi pointer input in the popup document)
  {
    const chrome = chromeTop;
    const pref = async (name, v) => CHROME_OK && evalJson(chrome, v === null
      ? `async () => ${SVC}.prefs.clearUserPref("${name}")` : `async () => ${SVC}.prefs.setIntPref("${name}", ${v})`);
    const rgbHex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    // Hosted CI runners (Windows, macOS) report prefers-reduced-motion: reduce system-wide;
    // pin "no preference" for the transition check (B8-3 covers the reduced case).
    await pref("ui.prefersReducedMotion", 0);
    const move = (x, y) => call("input.performActions", { context: pop, actions: [{ type: "pointer", id: "mouse",
      parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0 }] }] });
    const state = (i) => evalJson(pop, `async () => { const row = [...document.querySelectorAll("#list .row")].at(${i});
      const r = row.getBoundingClientRect(), cs = getComputedStyle(row);
      return { hover: row.matches(":hover"), bg: cs.backgroundColor, fg: cs.color, rect: [r.x, r.y, r.width, r.height],
        transition: cs.transitionDuration }; }`);
    const parts = (i) => evalJson(pop, `async () => { const row = [...document.querySelectorAll("#list .row")].at(${i});
      const r = row.getBoundingClientRect(), c = (s) => { const e = row.querySelector(s).getBoundingClientRect(); return [e.x + e.width / 2, r.y + r.height / 2]; };
      return { name: c(".name"), code: c(".code"), free: [r.x + 4, r.y + r.height / 2], icon: c(".icon") }; }`);
    // The auto cases need a runtime color-scheme override (privileged chrome scope).
    const cases = CHROME_OK ? [["dark", null], ["light", null], ["auto", 0], ["auto", 1]] : [["dark", null], ["light", null]];
    if (!CHROME_OK) notTested("B8-1-auto", "hover in theme auto (dark/light system scheme)", NO_CHROME);
    const out = [];
    for (const [theme, override] of cases) {
      if (override !== null) await pref("layout.css.prefers-color-scheme.content-override", override);
      await evalJson(opt, `async () => browser.storage.local.set({ settings: { theme: "${theme}" } })`);
      await open(pop, "popup/popup.html");
      await waitFor(pop, `document.body.dataset.rendered === "100"`);
      const tok = themeTokens({ ...DEFAULT_SETTINGS, theme }, override === 0);
      await move(135, 595); // park the pointer on the footer
      await sleep(150);
      const idle = await state(1);
      const p = await parts(1);
      const hovered = {};
      for (const [which, [x, y]] of Object.entries(p)) {
        await move(x, y);
        await sleep(150); // > 80 ms transition
        const s = await state(1);
        hovered[which] = { hover: s.hover, bg: rgbHex(s.bg), sameRect: JSON.stringify(s.rect) === JSON.stringify(idle.rect) };
      }
      await evalJson(pop, `async () => { const l = document.getElementById("list"); l.scrollTop = l.scrollHeight; }`);
      await sleep(100);
      const lp = await parts(-1);
      await move(...lp.name);
      await sleep(150);
      const last = await state(-1);
      const fg = rgbHex(idle.fg);
      out.push({ theme, system: override === null ? "-" : override === 0 ? "dark" : "light", expectedHover: tok.hover,
        idleBg: rgbHex(idle.bg), hovered, scrolledLastRow: { hover: last.hover, bg: rgbHex(last.bg) },
        contrastOnHover: Math.round(contrast(fg, tok.hover) * 100) / 100, transition: idle.transition,
        ok: Object.values(hovered).every((h) => h.hover && h.bg === tok.hover && h.sameRect) && last.hover &&
          rgbHex(last.bg) === tok.hover && rgbHex(idle.bg) !== tok.hover && contrast(fg, tok.hover) >= 4.5 &&
          idle.transition === "0.08s" });
      if (override !== null) await pref("layout.css.prefers-color-scheme.content-override", null);
    }
    record("B8-1", "hover highlights the whole row (name/code/free space/icon, scrolled rows) in light/dark/auto, no layout shift, contrast >= 4.5",
      out.every((o) => o.ok), { cases: out });

    // Keyboard focus ring (Tab) without changing the row size
    await open(pop, "popup/popup.html");
    await waitFor(pop, `document.body.dataset.rendered === "100"`);
    const before = await state(0);
    await call("input.performActions", { context: pop, actions: [{ type: "key", id: "kb", actions: [
      { type: "keyDown", value: "" }, { type: "keyUp", value: "" }] }] });
    await sleep(150);
    const focus = await evalJson(pop, `async () => { const a = document.activeElement, cs = getComputedStyle(a), r = a.getBoundingClientRect();
      return { isRow: a.classList.contains("row"), focusVisible: a.matches(":focus-visible"), outline: cs.outlineStyle + " " + cs.outlineWidth,
        offset: cs.outlineOffset, rect: [r.x, r.y, r.width, r.height] }; }`);
    record("B8-2", "keyboard focus shows a visible inset outline without layout shift", focus.isRow && focus.focusVisible &&
      focus.outline === "solid 2px" && focus.offset === "-2px" && JSON.stringify(focus.rect) === JSON.stringify(before.rect), focus);

    // prefers-reduced-motion: no transition
    if (!CHROME_OK) notTested("B8-3", "prefers-reduced-motion disables the hover transition", NO_CHROME);
    else {
    await pref("ui.prefersReducedMotion", 1);
    await open(pop, "popup/popup.html");
    await waitFor(pop, `document.body.dataset.rendered === "100"`);
    const reduced = (await state(0)).transition;
    await pref("ui.prefersReducedMotion", null);
    record("B8-3", "prefers-reduced-motion disables the hover transition", reduced === "0s", { transitionDuration: reduced });
    }
    await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
  }

  // B3: click-to-copy with real (trusted) pointer input and confirmation indicator
  {
    await open(pop, "popup/popup.html");
    await waitFor(pop, `document.body.dataset.rendered === "100"`);
    await clickAt(pop, "#list li:first-child .row");
    const ok = await waitFor(pop, `document.querySelector("#list .row").dataset.copied === "ok"`, 2000);
    const announce = await evalJson(pop, `async () => document.getElementById("announce").textContent`);
    const cleared = await waitFor(pop, `!document.querySelector("#list .row").dataset.copied`, 2500);
    record("B3-copy", "click copies (writeText resolved), indicator shown and reset", ok && cleared && !!announce,
      { copied: ok, announce, indicatorReset: cleared });
  }

  // B6: security boundary — responses, DOM and storage contain no secrets
  {
    const resp = { status: await msg(opt, "status"), codes: await msg(opt, "getCodes"),
      list: await msg(opt, "listAccounts"), preview: await msg(opt, "importPreview", { text: LEGACY_TEXT }) };
    await open(opt, "options/options.html");
    await waitFor(opt, "document.body.dataset.state === 'unlocked'");
    const dom = { popup: await evalJson(pop, `async () => document.documentElement.outerHTML`),
      options: await evalJson(opt, `async () => document.documentElement.outerHTML`) };
    const store = await evalJson(opt, `async () => {
      const local = await browser.storage.local.get();
      const sess = await browser.storage.session.get(); // test harness only
      let exportable = "unknown";
      try { await crypto.subtle.exportKey("raw", sess.session.key); exportable = "EXPORTED"; }
      catch (e) { exportable = e.name; }
      return { local: JSON.stringify(local), session: JSON.stringify(sess),
        keyType: Object.prototype.toString.call(sess.session?.key), extractable: sess.session?.key?.extractable,
        exportable, sessionKeys: Object.keys(sess) }; }`);
    const found = {
      responses: leaks(JSON.stringify(resp)), popupDom: leaks(dom.popup), optionsDom: leaks(dom.options),
      storageLocal: leaks(store.local), storageSession: leaks(store.session) };
    const pass = Object.values(found).every((a) => a.length === 0) && resp.codes.ok && resp.list.ok &&
      resp.preview.ok && store.keyType === "[object CryptoKey]" && store.extractable === false &&
      store.exportable === "InvalidAccessError" && !resp.list.result.accounts.some((a) => "secret" in a);
    record("B6-2", "no secrets in responses, DOM or storage; key non-extractable", pass,
      { leaksFound: found, keyType: store.keyType, extractable: store.extractable, exportKey: store.exportable,
        sessionKeys: store.sessionKeys, previewCounts: resp.preview.result?.counts });
  }

  // B4: account management through the options UI
  {
    await resetVault(3);
    await open(opt, "options/options.html");
    await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 3");
    const names = () => evalJson(opt, `async () => [...document.querySelectorAll("#accounts td.name")].map((t) => t.textContent)`);
    const before = await names();
    await evalJson(opt, `async () => { const f = document.getElementById("accountForm").elements;
      f.name.value = "UI Added"; f.secret.value = "${syntheticAccounts(99)[98].secret.toLowerCase()}"; f.url.value = "ui.example";
      document.getElementById("accountForm").requestSubmit(); }`);
    const added = await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 4");
    const secretCleared = await evalJson(opt, `async () => document.getElementById("accountForm").elements.secret.value === ""`);
    await evalJson(opt, `async () => { document.querySelectorAll("#accounts td.actions")[0].children[2].click();
      const f = document.getElementById("accountForm").elements; f.name.value = "UI Renamed";
      document.getElementById("accountForm").requestSubmit(); }`);
    const renamed = await waitFor(opt, `document.querySelector("#accounts td.name").textContent === "UI Renamed"`);
    await evalJson(opt, `async () => document.querySelectorAll("#accounts td.actions")[0].children[1].click()`);
    const moved = await waitFor(opt, `document.querySelectorAll("#accounts td.name")[1].textContent === "UI Renamed"`);
    await evalJson(opt, `async () => { window.confirm = () => true; // test harness: auto-confirm
      document.querySelectorAll("#accounts td.actions")[3].children[3].click(); }`);
    const deleted = await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 3");
    const after = await names();
    const stale = await msg(opt, "deleteAccount", { id: "fixture-1", revision: 1 });
    record("B4-1", "create, edit, reorder, delete via options UI; stale revision rejected",
      added && secretCleared && renamed && moved && deleted && stale.error === "conflict",
      { before, after, added, secretFieldClearedAfterSave: secretCleared, renamed, moved, deleted, staleWrite: stale });
  }

  // B5: legacy import preview via a real file upload; nothing persisted
  {
    const revBefore = (await msg(opt, "listAccounts")).result.revision;
    const localBefore = await evalJson(opt, `async () => JSON.stringify(await browser.storage.local.get())`);
    // BiDi input.setFiles is refused for privileged (moz-extension) contexts in Firefox 160,
    // so the fixture is attached as a File via DataTransfer; the page code path is the same.
    await evalJson(opt, `async () => { const input = document.getElementById("importFile");
      const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(LEGACY_TEXT)}], "totp.json",
        { type: "application/json" }));
      input.files = dt.files; input.dispatchEvent(new Event("change")); }`);
    const shown = await waitFor(opt, "!document.getElementById('preview').hidden");
    const p = await evalJson(opt, `async () => ({
      statuses: [...document.querySelectorAll("#preview tbody tr")].map((r) => r.dataset.status),
      summary: document.getElementById("importSummary").textContent,
      applyDisabled: document.getElementById("importApply").disabled,
      html: document.getElementById("preview").outerHTML })`);
    const revAfter = (await msg(opt, "listAccounts")).result.revision;
    const localAfter = await evalJson(opt, `async () => JSON.stringify(await browser.storage.local.get())`);
    const expected = ["new", "new", "new", "duplicate", "name-conflict", "new", "invalid", "invalid", "invalid", "invalid", "invalid"];
    const malformed = await msg(opt, "importPreview", { text: "{not json" });
    record("B5-1", "legacy preview via file upload; no persistence; apply disabled; malformed rejected",
      shown && JSON.stringify(p.statuses) === JSON.stringify(expected) && p.applyDisabled &&
      revAfter === revBefore && localAfter === localBefore && leaks(p.html).length === 0 && malformed.error === "malformed",
      { statuses: p.statuses, summary: p.summary, applyDisabled: p.applyDisabled, revisionUnchanged: revAfter === revBefore,
        storageLocalUnchanged: localAfter === localBefore, malformed });
  }

  if (HEADLESS) {
    for (const [id, name] of [["B3-real-1", "real toolbar popup size and rows"], ["B3-real-2", "active-site highlight via toolbar click"],
      ["B3-real-3", "real popup scrolling"], ["B3-real-4", "real popup click-to-copy"], ["B8-real", "real popup hover"]]) {
      notTested(id, name, "headless run: no toolbar popup panel");
    }
  } else
  // B3: the REAL toolbar popup, opened by a native click on the toolbar button (grants
  // activeTab like a user click). The popup DOM is read via extension.getViews() from the
  // options page; panel geometry and the clipboard are read in the browser chrome.
  {
    const srv = createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end("<title>local</title>local test page"); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      await resetVault(24);
      const { result: { revision } } = await msg(opt, "listAccounts");
      await msg(opt, "addAccount", { revision, account: { name: "Local Test Site", secret: syntheticSecret(500), url: "localhost" } });
      const site = (await call("browsingContext.create", { type: "tab" })).context;
      await call("browsingContext.navigate", { context: site, url: `http://localhost:${srv.address().port}/`, wait: "complete" });
      await call("browsingContext.activate", { context: site });
      const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
      // --os-input: real Windows mouse input via os-input.ps1 at CSS coordinates of the
      // browser chrome viewport; refused unless the target window belongs to this Firefox.
      const ffPid = await evalJson(chrome, `async () => ${SVC}.appinfo.processID`);
      const scr = await evalJson(chrome, `async () => ({ sx: window.mozInnerScreenX, sy: window.mozInnerScreenY, dpr: window.devicePixelRatio })`);
      const osInput = OS_INPUT ? await startOsInput(join(root, "test/browser/os-input.ps1"), ffPid) : null;
      const osAt = async (action, x = 0, y = 0, delta = 0) => {
        const out = await osInput.send([action, Math.round((scr.sx + x) * scr.dpr), Math.round((scr.sy + y) * scr.dpr), delta].join(" "));
        if (out !== "OK") console.log(`os-input ${action}: ${out}`);
        return out;
      };
      const btn = await evalJson(chrome, `async () => { const r = document.getElementById(
        "_f587432b-b553-483e-b08d-4feac6378113_-BAP").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`);
      let toolbarInput = "bidi";
      if (OS_INPUT) {
        // Real user flow: foreground the test Firefox, then a real click on the toolbar button.
        toolbarInput = [await osAt("focus"), await osAt("toolbar", btn.x + btn.w / 2, btn.y + btn.h / 2)].join(",");
      } else {
        // Native BiDi pointer input in the browser chrome on our toolbar button.
        await call("input.performActions", { context: chrome, actions: [{ type: "pointer", id: "m",
          parameters: { pointerType: "mouse" }, actions: [
            { type: "pointerMove", x: Math.round(btn.x + btn.w / 2), y: Math.round(btn.y + btn.h / 2) },
            { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }] });
      }
      const opened = await waitFor(opt, `browser.extension.getViews({ type: "popup" })[0]?.document.body.dataset.rendered === "25"`, 5000) &&
        await waitFor(chrome, `[...document.querySelectorAll("browser")].find((x) => x.currentURI?.spec?.endsWith("/popup/popup.html"))
          ?.closest("panel")?.state === "open"`, 5000); // wait for the open animation to finish
      const panel = await evalJson(chrome, `async () => { const b = [...document.querySelectorAll("browser")]
        .find((x) => x.currentURI?.spec?.endsWith("/popup/popup.html")); const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, panelState: b.closest("panel")?.state }; }`);
      const pv = (body) => evalJson(opt, `async () => { const w = browser.extension.getViews({ type: "popup" })[0];
        const d = w.document; ${body} }`);
      const geo = await pv(`const list = d.getElementById("list"), rows = [...d.querySelectorAll("#list .row")];
        return { inner: [w.innerWidth, w.innerHeight], rows: rows.length,
          rowHeights: [...new Set(rows.map((r) => r.getBoundingClientRect().height))],
          current: [...d.querySelectorAll("#list li.current .name")].map((n) => n.textContent),
          scrollable: list.scrollHeight > list.clientHeight };`);
      record("B3-real-1", "real toolbar popup: 25 accounts, 25 px rows, within Firefox max 800×600",
        opened && geo.rows === 25 && geo.rowHeights.length === 1 && geo.rowHeights[0] === 25 &&
        geo.inner[0] === 270 && geo.inner[0] <= 800 && geo.inner[1] <= 600 && panel.panelState === "open" &&
        panel.w === geo.inner[0] && panel.h === geo.inner[1] && geo.scrollable, { geo, panel, toolbarInput });
      record("B3-real-2", "active-site highlight after a real toolbar click (activeTab)",
        JSON.stringify(geo.current) === JSON.stringify(["Local Test Site"]), { highlighted: geo.current });


      // Scroll to the end inside the real popup geometry. BiDi pointer/wheel input does not
      // reach the popup panel (separate native widget), so the list is scrolled via scrollTop;
      // real wheel/touchpad scrolling is a manual check.
      await pv(`const list = d.getElementById("list"); list.scrollTop = list.scrollHeight;
        await new Promise((r) => w.requestAnimationFrame(r)); return true;`);
      const sc = await pv(`const list = d.getElementById("list"), rows = [...d.querySelectorAll("#list .row")];
        const lr = list.getBoundingClientRect(), last = rows.at(-1).getBoundingClientRect(), f = d.querySelector("footer").getBoundingClientRect();
        return { scrollTop: list.scrollTop, maxScroll: list.scrollHeight - list.clientHeight,
          lastRowVisible: last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5,
          footerVisible: f.top >= lr.bottom - 1 && f.bottom <= w.innerHeight + 0.5,
          lastName: rows.at(-1).querySelector(".name").textContent };`);
      record("B3-real-3", "real popup: list scrolls to the last account; footer stays visible",
        sc.scrollTop > 0 && Math.abs(sc.scrollTop - sc.maxScroll) <= 1 && sc.lastRowVisible && sc.footerVisible, sc);

      const readClipboard = () => evalJson(chrome, `async () => {
        const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
        t.init(null); t.addDataFlavor("text/plain");
        ${SVC}.clipboard.getData(t, ${SVC}.clipboard.kGlobalClipboard, null);
        const o = {}; t.getTransferData("text/plain", o); return o.value.QueryInterface(Ci.nsISupportsString).data; }`);
      const setClipboard = (text) => evalJson(chrome, `async () => Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper).copyString(${JSON.stringify(text)})`);

      // A script-generated click has no user activation: Firefox must refuse the copy and
      // the row must show the error indicator instead of the check mark.
      await setClipboard("cta-sentinel");
      await pv(`[...d.querySelectorAll("#list .row")].at(-1).click(); return true;`);
      await sleep(300);
      const synth = await pv(`return [...d.querySelectorAll("#list .row")].at(-1).dataset.copied ?? null;`);
      record("B3-real-4a", "real popup: script click without user activation is refused (error indicator)",
        synth === "error" && (await readClipboard()) === "cta-sentinel", { indicator: synth });
      await sleep(1100); // busy/feedback window

      if (OS_INPUT) {
        // Real Windows mouse input at popup coordinates (os-input.ps1 only acts on this
        // Firefox's popup panel window).
        const os = (action, x, y, delta = 0) => osAt(action, panel.x + x, panel.y + y, delta); // async
        // Test harness: count clipboard writes made by the popup.
        await pv(`d.getElementById("list").scrollTop = 0;
          w.__copies = 0; const orig = w.navigator.clipboard.writeText.bind(w.navigator.clipboard);
          w.navigator.clipboard.writeText = (s) => { w.__copies++; return orig(s); }; return true;`);
        const part = (rowIndex, which) => pv(`const row = [...d.querySelectorAll("#list .row")].at(${rowIndex});
          const r = row.getBoundingClientRect(), el = ${JSON.stringify(which)} === "free" ? null : row.querySelector("." + ${JSON.stringify(which)});
          const e = el ? el.getBoundingClientRect() : { x: r.x + 2, width: 6 };
          return { x: e.x + e.width / 2, y: r.y + r.height / 2, code: row.querySelector(".code").textContent };`);
        const clickParts = async (rowIndex) => {
          const out = [];
          for (const which of ["name", "code", "free", "icon"]) {
            while (Date.now() % 30_000 > 26_000) await sleep(250); // avoid a code change mid-check
            await setClipboard("cta-sentinel");
            const before = await pv(`return w.__copies;`);
            const tgt = await part(rowIndex, which);
            const input = await os("click", tgt.x, tgt.y);
            await sleep(400);
            const st = await pv(`const row = [...d.querySelectorAll("#list .row")].at(${rowIndex});
              return { copied: row.dataset.copied ?? null, check: !!row.querySelector(".icon path[d^='M2.5 8.5']"), copies: w.__copies };`);
            const clip = await readClipboard();
            out.push({ which, input, indicator: st.copied, checkIcon: st.check, writes: st.copies - before,
              clipboardMatchesRow: clip === tgt.code });
            await sleep(1100);
          }
          return out;
        };
        // B8 in the real popup: real pointer hover over a normal row and (after scrolling)
        // over the current-site row; background must be the hover / current-hover token.
        const hoverRow = async (rowIndex) => {
          const tgt = await part(rowIndex, "name");
          // Two real moves (like a user approaching the row): Firefox updates :hover on mouse-move events.
          await os("hover", tgt.x - 4, tgt.y);
          const input = await os("hover", tgt.x, tgt.y);
          await sleep(200);
          return { input, ...(await pv(`const row = [...d.querySelectorAll("#list .row")].at(${rowIndex}), root = d.documentElement.style;
            const hex = (rgb) => "#" + rgb.match(/\\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
            return { hover: row.matches(":hover"), current: !!row.closest("li.current"), bg: hex(w.getComputedStyle(row).backgroundColor),
              hoverToken: root.getPropertyValue("--hover"), currentHoverToken: root.getPropertyValue("--current-hover") };`)) };
        };
        const h0 = await hoverRow(0);
        await pv(`const l = d.getElementById("list"); l.scrollTop = l.scrollHeight; return true;`);
        await sleep(150);
        const hLast = await hoverRow(-1);
        await pv(`d.getElementById("list").scrollTop = 0; return true;`);
        record("B8-real", "real popup: real pointer hover highlights rows, incl. the scrolled-in current-site row",
          h0.input === "OK" && h0.hover && !h0.current && h0.bg === h0.hoverToken &&
          hLast.input === "OK" && hLast.hover && hLast.current && hLast.bg === hLast.currentHoverToken,
          { normalRow: h0, currentSiteRow: hLast });

        const firstRow = await clickParts(0);

        // Real mouse wheel over the list down to the end
        const wheelInput = await os("wheel", panel.w / 2, 200, -120 * 15);
        await sleep(800);
        const wheel = await pv(`const list = d.getElementById("list"), rows = [...d.querySelectorAll("#list .row")];
          const lr = list.getBoundingClientRect(), last = rows.at(-1).getBoundingClientRect(), f = d.querySelector("footer").getBoundingClientRect();
          return { scrollTop: list.scrollTop, maxScroll: list.scrollHeight - list.clientHeight,
            lastRowVisible: last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5, footerVisible: f.top >= lr.bottom - 1 && f.bottom <= w.innerHeight + 0.5 };`);
        record("B3-real-6", "real popup: real mouse wheel scrolls to the last account; footer visible",
          wheelInput === "OK" && wheel.scrollTop > 0 && Math.abs(wheel.scrollTop - wheel.maxScroll) <= 1 &&
          wheel.lastRowVisible && wheel.footerVisible, { input: wheelInput, ...wheel });
        const lastRow = await clickParts(-1);
        const good = (r) => r.input === "OK" && r.indicator === "ok" && r.checkIcon && r.writes === 1 && r.clipboardMatchesRow;
        record("B3-real-4", "real popup: real mouse click copies the code (first and scrolled-in row)",
          good(firstRow[1]) && good(lastRow[1]), { firstRow: firstRow[1], lastRow: lastRow[1] });
        record("B3-real-5", "real popup: click on name, code, free space and icon copies the same code once, with check mark",
          [...firstRow, ...lastRow].every(good), { firstRow, lastRow });

        // Double-click on the copy icon: exactly one write
        while (Date.now() % 30_000 > 26_000) await sleep(250);
        const before = await pv(`return w.__copies;`);
        const icon = await part(-1, "icon");
        const dbl = [await os("click", icon.x, icon.y), await os("click", icon.x, icon.y)];
        await sleep(400);
        const writes = (await pv(`return w.__copies;`)) - before;
        record("B3-real-7", "real popup: double-click on the copy icon writes the clipboard once", dbl.every((x) => x === "OK") && writes === 1,
          { inputs: dbl, writes });
      } else {
        results.push({ id: "B3-real-4", name: "real popup click-to-copy with a real mouse click", verdict: "MANUAL",
          details: { note: "run with --os-input on Windows to automate with real mouse input" } });
        console.log("MANUAL  B3-real-4  real popup click-to-copy (run with --os-input)");
      }
      await call("browsingContext.close", { context: site });
      osInput?.close();
    } finally {
      srv.close();
    }
  }

  // B6: lock wipes session; popup falls back to the locked view
  {
    await resetVault(25);
    await msg(opt, "lock");
    const codes = await msg(opt, "getCodes");
    const sess = await evalJson(opt, `async () => Object.keys(await browser.storage.session.get())`);
    await open(pop, "popup/popup.html");
    const lockedView = await waitFor(pop, "document.body.dataset.state === 'locked'");
    record("B6-3", "lock wipes key and vault; popup shows locked view", codes.error === "locked" &&
      !sess.includes("session") && !sess.includes("vault") && lockedView, { getCodes: codes, sessionKeys: sess, lockedView });
  }

  // B6: event page suspension/restart keeps the session usable
  {
    await resetVault(25);
    const a = await msg(opt, "status");
    const c1 = await msg(opt, "getCodes");
    await call("browsingContext.navigate", { context: pop, url: "about:blank", wait: "complete" });
    await sleep(IDLE_MS * 3);
    const b = await msg(opt, "status");
    const c2 = await msg(opt, "getCodes");
    const restarted = a.result.startedAt !== b.result.startedAt;
    record("B6-4", "works after event page suspension and restart", restarted && c2.ok &&
      c2.result.revision === c1.result.revision && c2.result.codes.length === 25,
      { startedAtBefore: a.result.startedAt, startedAtAfter: b.result.startedAt, restarted, revision: c2.result?.revision });
  }

  // B6: auto-lock via alarm while idle (1 minute setting)
  {
    await evalJson(opt, `async () => browser.storage.local.set({ settings: { autoLockMinutes: 1 } })`);
    await resetVault(3);
    const before = await msg(opt, "status");
    const t0 = Date.now();
    await sleep(61_000);
    // Fail-closed right after the deadline, independent of the alarm (status does not wipe).
    const atDeadline = await msg(opt, "status");
    // Alarm cleanup: polled without touching the extension. Firefox may wake an idle event
    // page late (seen on ESR 153), so the delay is measured, bounded at 120 s.
    let wipedAfterMs = null;
    while (Date.now() - t0 < 120_000) {
      const keys = await evalJson(opt, `async () => Object.keys(await browser.storage.session.get())`);
      if (!keys.includes("session")) { wipedAfterMs = Date.now() - t0; break; }
      await sleep(5_000);
    }
    await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
    record("B6-5", "auto-lock after 1 min: locked at the deadline; alarm wipes the idle session", before.result.unlocked &&
      !atDeadline.result.unlocked && wipedAfterMs !== null,
    { before: before.result, atDeadline: atDeadline.result, alarmWipedAfterSeconds: wipedAfterMs && Math.round(wipedAfterMs / 1000) });
  }
  // ===== C2: master-password workflows on real storage.local / storage.session =====
  const localSnap = () => evalJson(opt, `async () => JSON.stringify(await browser.storage.local.get())`);
  const fill = (ctx, formId, values) => evalJson(ctx, `async () => { const f = document.getElementById(${JSON.stringify(formId)});
    for (const [k, v] of Object.entries(${JSON.stringify(values)})) { const el = f.elements[k]; if (el.type === "checkbox") el.checked = v; else el.value = v; }
    f.requestSubmit(); return true; }`);
  const accountCount = async () => (await msg(opt, "listAccounts")).result?.accounts.length;
  const sessionKeys = () => evalJson(opt, `async () => Object.keys(await browser.storage.session.get())`);
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  let current = PW;

  // C2-1: initial setup through the options UI
  {
    await wipeVault();
    await open(opt, "options/options.html");
    const setupShown = await waitFor(opt, "document.body.dataset.locked === 'setup'");
    // minlength only constrains user typing; the service enforces 12+ characters regardless.
    // Messages are compared with the extension's own strings (CI browsers run in English).
    const i18n = (key) => evalJson(opt, `async () => browser.i18n.getMessage(${JSON.stringify(key)})`);
    const msgShort = await i18n("reason_password_short"), msgMismatch = await i18n("reason_password_mismatch");
    await fill(opt, "setupForm", { password: "eleven chrs", confirm: "eleven chrs" });
    await waitFor(opt, `document.getElementById("message").textContent.includes(${JSON.stringify(msgShort)})`, 10000);
    const shortBlocked = await evalJson(opt, `async () => document.getElementById("message").textContent.includes(${JSON.stringify(msgShort)})`);
    await fill(opt, "setupForm", { password: PW, confirm: PW + "!" });
    await waitFor(opt, `document.getElementById("message").dataset.kind === "error"`, 10000);
    const mismatch = await evalJson(opt, `async () => document.getElementById("message").textContent`);
    const noVault = !(await localSnap()).includes("cta-vault");
    await fill(opt, "setupForm", { password: PW, confirm: PW });
    const unlocked = await waitFor(opt, "document.body.dataset.state === 'unlocked'", 15000);
    const cleared = await evalJson(opt, `async () => [...document.querySelectorAll("input[type=password]")].every((i) => i.value === "")`);
    const st = (await msg(opt, "status")).result;
    record("C2-1", "setup via UI: 12+ characters, confirmation required, vault created and unlocked, inputs cleared",
      setupShown && shortBlocked && mismatch.includes(msgMismatch) && noVault && unlocked && cleared && st.initialized && st.unlocked,
      { setupShown, shortBlocked, mismatch, noVaultAfterRejected: noVault, unlocked, inputsCleared: cleared });
  }

  // C2-2: popup unlock; wrong passwords never modify persistent storage
  {
    await resetVault(5);
    await msg(opt, "lock");
    await open(pop, "popup/popup.html");
    const unlockMode = await waitFor(pop, "document.body.dataset.locked === 'unlock'");
    const before = await localSnap();
    await evalJson(pop, `async () => { document.getElementById("password").value = "definitely the wrong password";
      document.getElementById("unlockForm").requestSubmit(); return true; }`);
    const msgFailed = await evalJson(pop, `async () => browser.i18n.getMessage("unlockFailed")`);
    const failShown = await waitFor(pop, `document.getElementById("lockedMsg").textContent === ${JSON.stringify(msgFailed)}`, 15000);
    const wrong = [], wrongMs = [];
    for (const p of [PW + " ", PW.toUpperCase(), "x".repeat(1025), ""]) {
      const t0 = Date.now(); wrong.push((await msg(opt, "unlock", { password: p })).ok); wrongMs.push(Date.now() - t0);
    }
    evidence.wrongPasswordMs = wrongMs; // full PBKDF2 per new guess (first two entries)
    const after = await localSnap();
    const sessAfterWrong = await sessionKeys();
    await evalJson(pop, `async () => { document.getElementById("password").value = ${JSON.stringify(PW)};
      document.getElementById("unlockForm").requestSubmit(); return true; }`);
    const rendered = await waitFor(pop, `document.body.dataset.rendered === "5"`, 15000);
    record("C2-2", "popup unlock: wrong passwords rejected, storage.local byte-identical, correct password shows codes",
      unlockMode && failShown && wrong.every((x) => x === false) && before === after && !sessAfterWrong.includes("session") && rendered,
      { unlockMode, failShown, wrongAttemptsRejected: wrong.every((x) => x === false), storageUnchanged: before === after, rendered });
  }

  // C2-3: unlock latency (600,000 iterations) and attacker-modified KDF headers
  {
    const times = [];
    for (let i = 0; i < 5; i++) {
      await msg(opt, "lock");
      const t0 = Date.now();
      const r = await msg(opt, "unlock", { password: PW });
      times.push(r.ok ? Date.now() - t0 : -1);
    }
    await msg(opt, "lock");
    const saved = await evalJson(opt, `async () => browser.storage.local.get()`);
    const forge = (iterations) => evalJson(opt, `async () => { const { vault } = await browser.storage.local.get("vault");
      vault.kdf.iterations = ${iterations}; await browser.storage.local.set({ vault }); await browser.storage.local.remove("vault_backup"); }`);
    await forge(10_000_000); // structurally valid, maximum permitted
    const forgedSnap = await localSnap();
    const tF = Date.now();
    const pending = msg(opt, "unlock", { password: PW });
    const pings = [];
    for (let i = 0; i < 6; i++) { const a = Date.now(); await evalJson(pop, `async () => document.title.length`); pings.push(Date.now() - a); await sleep(150); }
    const forged = await pending;
    const forgedMs = Date.now() - tF;
    const forgedUnchanged = (await localSnap()) === forgedSnap;
    await forge(1e12); // out of bounds: must be rejected before PBKDF2
    const tO = Date.now();
    const oversized = await msg(opt, "unlock", { password: PW });
    const oversizedMs = Date.now() - tO;
    await evalJson(opt, `async () => { await browser.storage.local.clear(); await browser.storage.local.set(${JSON.stringify(saved)}); }`);
    const restored = (await msg(opt, "unlock", { password: PW })).ok;
    evidence.unlockLatency = { iterations600kMs: times, medianMs: median(times), forged10MMs: forgedMs, oversizedRejectMs: oversizedMs, uiPingMaxMs: Math.max(...pings) };
    record("C2-3", "unlock latency measured; 10M-iteration header fails without freezing the UI; oversized rejected before PBKDF2",
      times.every((x) => x > 0) && forged.ok === false && forgedUnchanged && Math.max(...pings) < 500 && oversized.ok === false && oversizedMs < 300 && restored,
      { ...evidence.unlockLatency, forgedResult: forged.reason, oversizedResult: oversized.reason, storageUnchangedByForgedAttempt: forgedUnchanged });
  }

  // C2-4: password change via UI; immediate session invalidation; no rollback to the old generation
  {
    await open(opt, "options/options.html");
    await waitFor(opt, "document.body.dataset.state === 'unlocked'", 10000);
    await evalJson(opt, `async () => { window.__oldKey = (await browser.storage.session.get("session")).session.key; return true; }`);
    const n = await accountCount();
    await fill(opt, "changeForm", { current: PW, next: PW2, confirm: PW2 });
    const lockedAfter = await waitFor(opt, "document.body.dataset.locked === 'unlock'", 20000);
    const codes = await msg(opt, "getCodes");
    const oldKeyDead = await evalJson(opt, `async () => { const { openVault } = await import("../lib/vault.js");
      const { vault } = await browser.storage.local.get("vault"); try { await openVault(window.__oldKey, vault); return false; } catch { return true; } }`);
    const snap = await localSnap();
    const oldPw = await msg(opt, "unlock", { password: PW });
    const oldRestore = await msg(opt, "restore", { password: PW, confirmed: true });
    const untouched = (await localSnap()) === snap;
    const nfd = await msg(opt, "unlock", { password: PW2.normalize("NFD") });
    const gen = await evalJson(opt, `async () => { const s = (await browser.storage.session.get("session")).session;
      const { vault } = await browser.storage.local.get("vault"); return s.generation === vault.kdf.salt; }`);
    const nAfter = await accountCount();
    current = PW2;
    record("C2-4", "password change via UI locks at once; old key and old password dead; no rollback; new password (NFD) unlocks",
      lockedAfter && codes.ok === false && oldKeyDead && oldPw.ok === false && oldRestore.ok === false && untouched && nfd.ok && gen && nAfter === n,
      { lockedAfter, getCodesAfterChange: codes.error, oldKeyCannotDecrypt: oldKeyDead, oldPassword: oldPw.reason,
        oldPasswordRestore: oldRestore.reason, storageUnchanged: untouched, sessionGenerationMatchesVault: gen, accounts: [n, nAfter] });
  }

  // C2-5: explicit recovery from a valid same-generation backup through the UI
  {
    const n = await accountCount();
    const { result: { revision } } = await msg(opt, "listAccounts");
    await msg(opt, "addAccount", { revision, account: { name: "Newest", secret: syntheticSecret(600) } });
    await msg(opt, "lock");
    await evalJson(opt, `async () => { const { vault } = await browser.storage.local.get("vault");
      vault.ciphertext = (vault.ciphertext[0] === "A" ? "B" : "A") + vault.ciphertext.slice(1); await browser.storage.local.set({ vault }); }`);
    await open(opt, "options/options.html");
    await waitFor(opt, "document.body.dataset.locked === 'unlock'");
    const snap = await localSnap();
    await fill(opt, "unlockForm", { password: PW2 });
    const recoverShown = await waitFor(opt, "document.body.dataset.locked === 'recover'", 15000);
    const noConfirm = await msg(opt, "restore", { password: PW2 });
    const wrongPw = await msg(opt, "restore", { password: PW, confirmed: true });
    const untouched = (await localSnap()) === snap;
    await fill(opt, "recoveryForm", { password: PW2, confirmed: true });
    const unlocked = await waitFor(opt, "document.body.dataset.state === 'unlocked'", 15000);
    const nAfter = await accountCount();
    record("C2-5", "damaged vault: recovery offered without writing; confirmation and correct password required; previous revision restored",
      recoverShown && noConfirm.reason === "confirmation" && wrongPw.ok === false && untouched && unlocked && nAfter === n,
      { recoverShown, withoutConfirmation: noConfirm.reason, wrongPassword: wrongPw.reason, storageUnchangedBeforeConfirm: untouched, accounts: [n, nAfter] });
  }

  // C2-6: browser restart (hard kill): session gone, encrypted vault persists
  {
    const n = await accountCount();
    await restart();
    const st = (await msg(opt, "status")).result;
    const sess = await sessionKeys();
    await open(pop, "popup/popup.html");
    const unlockMode = await waitFor(pop, "document.body.dataset.locked === 'unlock'", 10000);
    const tCold = Date.now();
    const r = await msg(opt, "unlock", { password: current });
    evidence.coldUnlockMsAfterRestart = Date.now() - tCold; // fresh process: no PBKDF2 result cache
    const nAfter = await accountCount();
    record("C2-6", "after a hard kill and restart: locked, session storage empty, vault persists and unlocks",
      st.initialized && !st.unlocked && !sess.includes("session") && unlockMode && r.ok && nAfter === n,
      { status: st, sessionKeys: sess, unlockMode, accounts: [n, nAfter], coldUnlockMs: evidence.coldUnlockMsAfterRestart });
  }

  // C2-7: termination during a burst of vault writes
  for (const delay of [400, 1200]) {
    const n0 = await accountCount();
    await call("script.evaluate", { target: { context: opt }, awaitPromise: false, expression: `(async () => {
      let { result: { revision } } = await browser.runtime.sendMessage({ cmd: "listAccounts" });
      for (let i = 0; i < 300; i++) {
        const r = await browser.runtime.sendMessage({ cmd: "addAccount", revision,
          account: { name: "Crash " + i, secret: ${JSON.stringify(syntheticSecret(700))} } });
        if (!r.ok) break; revision = r.result.revision;
      } })()` });
    await sleep(delay);
    await restart();
    let r = (await msg(opt, "unlock", { password: current })).result;
    let restoredFromBackup = false;
    if (r?.recoverable) { r = (await msg(opt, "restore", { password: current, confirmed: true })).result; restoredFromBackup = true; }
    const nAfter = await accountCount();
    record(`C2-7-${delay}`, `kill ${delay} ms into a write burst: vault opens (directly or via confirmed restore), data consistent`,
      !!r?.unlocked && Number.isInteger(nAfter) && nAfter >= n0 && nAfter <= n0 + 300,
      { delayMs: delay, accountsBefore: n0, accountsAfter: nAfter, restoredFromBackup });
  }

  // C2-8: termination during password rotation: exactly one password works, never none, never both
  for (const delay of [100, 350, 800]) {
    const next = current === PW2 ? PW3 : PW2;
    const n0 = await accountCount();
    await call("script.evaluate", { target: { context: opt }, awaitPromise: false,
      expression: `browser.runtime.sendMessage(${JSON.stringify({ cmd: "changePassword", current, next, confirm: next })})` });
    await sleep(delay);
    await restart();
    const tryPw = async (p) => {
      const r = await msg(opt, "unlock", { password: p });
      if (r.ok && r.result.recoverable) {
        const rr = await msg(opt, "restore", { password: p, confirmed: true });
        if (rr.ok) { await msg(opt, "lock"); return "recovered"; }
      }
      if (r.ok && r.result.unlocked) { await msg(opt, "lock"); return "ok"; }
      return "no";
    };
    const oldResult = await tryPw(current), newResult = await tryPw(next);
    const works = [oldResult, newResult].filter((x) => x !== "no").length;
    const winner = newResult !== "no" ? next : current;
    await msg(opt, "unlock", { password: winner });
    const nAfter = await accountCount();
    record(`C2-8-${delay}`, `kill ${delay} ms into a password change: exactly one password opens the intact vault`,
      works === 1 && nAfter === n0, { delayMs: delay, oldPassword: oldResult, newPassword: newResult, accounts: [n0, nAfter] });
    current = winner;
  }
  // C2-9: authentication scenarios on real storage (review CTA-001 C2): every attempt is
  // validated against the current vault; failures never write; timings recorded.
  {
    let guesses = 0; // each wrong guess is a new input, so its timing shows a real PBKDF2 run
    const WRONG = () => "definitely not the right password " + ++guesses;
    const attempt = async (password) => {
      const before = await localSnap();
      const t0 = Date.now();
      const r = await msg(opt, "unlock", { password });
      const ms = Date.now() - t0;
      const unlocked = r.ok && r.result.unlocked === true;
      const unchanged = unlocked || (await localSnap()) === before;
      return { unlocked, ms, unchanged };
    };
    const rows = [];
    const scenario = async (id, fn) => { const r = await fn(); rows.push({ id, ...r }); return r; };
    const pair = async () => ({ wrong: await attempt(WRONG()), right: await attempt(current) });
    const okPair = (p) => !p.wrong.unlocked && p.wrong.unchanged && p.right.unlocked;

    await msg(opt, "lock");
    await scenario("2 wrong right after a successful unlock", async () => {
      const right = await attempt(current), wrong = await attempt(WRONG());
      return { ok: right.unlocked && !wrong.unlocked && wrong.unchanged, right, wrong };
    });
    await scenario("3/4 explicit lock, then wrong and correct", async () => { await msg(opt, "lock"); const p = await pair(); return { ok: okPair(p), ...p }; });
    await scenario("5 automatic expiration, then wrong and correct", async () => {
      await evalJson(opt, `async () => browser.storage.local.set({ settings: { autoLockMinutes: 1 } })`);
      await msg(opt, "lock"); await attempt(current);
      await sleep(61_000);
      const expired = (await msg(opt, "getCodes")).error === "locked";
      const p = await pair();
      await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
      return { ok: expired && okPair(p), expired, ...p };
    });
    await scenario("6 event page restart, then wrong and correct", async () => {
      await msg(opt, "lock");
      const a = (await msg(opt, "status")).result.startedAt;
      await call("browsingContext.navigate", { context: pop, url: "about:blank", wait: "complete" });
      await sleep(IDLE_MS * 3);
      const b = (await msg(opt, "status")).result.startedAt;
      const p = await pair();
      return { ok: a !== b && okPair(p), eventPageRestarted: a !== b, ...p };
    });
    await scenario("7 browser restart, then wrong and correct", async () => { await restart(); const p = await pair(); return { ok: okPair(p), ...p }; });
    await scenario("8 rotation, then old and new password", async () => {
      const next = current === PW2 ? PW3 : PW2;
      const ch = await msg(opt, "changePassword", { current, next, confirm: next });
      const old = await attempt(current), neu = await attempt(next);
      if (ch.ok && neu.unlocked) current = next;
      return { ok: ch.ok && !old.unlocked && old.unchanged && neu.unlocked, old, new: neu };
    });
    await scenario("9 distinct string instances, identical content", async () => {
      const results = [];
      for (let i = 0; i < 3; i++) { await msg(opt, "lock"); results.push(await attempt([...current].join(""))); }
      return { ok: results.every((r) => r.unlocked), attempts: results };
    });
    await scenario("10 NFC and NFD input", async () => {
      const results = [];
      for (const f of ["NFD", "NFC", "NFD"]) { await msg(opt, "lock"); results.push({ form: f, ...(await attempt(current.normalize(f))) }); }
      return { ok: current.normalize("NFD") !== current && results.every((r) => r.unlocked), attempts: results };
    });
    await scenario("identical wrong guess repeated (NSS-cached derivation) still fails", async () => {
      await msg(opt, "lock");
      const guess = WRONG(), results = [await attempt(guess), await attempt(guess), await attempt(guess)];
      return { ok: results.every((r) => !r.unlocked && r.unchanged), attempts: results };
    });
    record("C2-9", "authentication scenarios 2-10: wrong passwords fail without writing, correct ones open, after lock/expiry/restarts/rotation",
      rows.every((r) => r.ok), { scenarios: rows });
  }

  // C2-10: controlled experiment on the speed of repeated derivations (same page realm,
  // our deriveKey and raw Web Crypto, with a deriveKey call counter; no service involved).
  {
    const exp = await evalJson(opt, `async () => {
      const { deriveKey } = await import("../lib/kdf.js");
      const subtle = crypto.subtle, real = subtle.deriveKey.bind(subtle);
      let calls = 0; subtle.deriveKey = (a, ...x) => { if (a?.name === "PBKDF2") calls++; return real(a, ...x); };
      const salt = (b) => btoa(String.fromCharCode(...new Uint8Array(16).fill(b)));
      const kdf = (s, it = 600000) => ({ name: "PBKDF2", hash: "SHA-256", iterations: it, salt: s });
      const pw = "Grüße – experiment passphrase " + Math.random(); // fresh input for this run
      const time = async (label, fn) => { const c0 = calls, t0 = performance.now(); await fn(); return { label, ms: Math.round(performance.now() - t0), pbkdf2Calls: calls - c0 }; };
      const out = [];
      out.push(await time("first derivation", () => deriveKey(pw, kdf(salt(7)))));
      out.push(await time("identical input again", () => deriveKey(pw, kdf(salt(7)))));
      out.push(await time("same content, new string instance", () => deriveKey([...pw].join(""), kdf(salt(7)))));
      out.push(await time("NFD form (same normalized bytes)", () => deriveKey(pw.normalize("NFD"), kdf(salt(7)))));
      out.push(await time("different password", () => deriveKey(pw + "x", kdf(salt(7)))));
      out.push(await time("different salt", () => deriveKey(pw, kdf(salt(8)))));
      out.push(await time("iterations + 1", () => deriveKey(pw, kdf(salt(7), 600001))));
      subtle.deriveKey = real;
      const rawIn = new TextEncoder().encode("raw " + Math.random());
      const raw = async () => { const k = await subtle.importKey("raw", rawIn, "PBKDF2", false, ["deriveBits"]);
        return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: new Uint8Array(16).fill(9) }, k, 256); };
      out.push(await time("raw Web Crypto deriveBits (no app code), first", raw));
      out.push(await time("raw Web Crypto deriveBits, identical input again", raw));
      return out; }`);
    const by = Object.fromEntries(exp.map((r) => [r.label, r]));
    const slow = (l) => by[l].ms >= 40, fast = (l) => by[l].ms < 40;
    const everyCallDerives = exp.filter((r) => !r.label.startsWith("raw")).every((r) => r.pbkdf2Calls === 1);
    record("C2-10", "repeated-derivation speedup is inside Firefox Web Crypto for byte-identical input; the app derives every time",
      everyCallDerives && slow("first derivation") && slow("different password") && slow("different salt") && slow("iterations + 1") &&
      slow("raw Web Crypto deriveBits (no app code), first"),
      { measurements: exp, identicalInputFast: fast("identical input again") && fast("raw Web Crypto deriveBits, identical input again") });
  }

  evidence.finalPasswordIsPW = current === PW;

  evidence.layouts = layouts;
} catch (e) {
  evidence.fatal = e.stack;
  console.log(e.stack);
} finally {
  evidence.finishedAt = new Date().toISOString();
  try { await ff.close(); } catch { /* browser already gone */ }
}

evidence.results = results;
evidence.environment = { platform: process.platform, arch: process.arch, node: process.version, headless: HEADLESS };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "browser-results.json"), JSON.stringify(evidence, null, 2) + "\n");
const failed = results.filter((r) => r.verdict === "FAIL").length;
const manual = results.filter((r) => r.verdict === "MANUAL").length;
const untested = results.filter((r) => r.verdict === "NOT_TESTED").length;
console.log(`${results.length - failed - manual - untested}/${results.length} passed, ${manual} manual, ${untested} not tested, ${failed} failed${evidence.fatal ? " (fatal error)" : ""}`);
process.exit(failed || evidence.fatal ? 1 : 0);
