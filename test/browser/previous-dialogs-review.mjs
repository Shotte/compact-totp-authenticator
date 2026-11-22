// Visual and keyboard review of the previous-vault dialogs (#25 V2 §7, PR #38) in real Firefox.
// Usage: node test/browser/previous-dialogs-review.mjs [path-to-firefox] [--lang=de|en]
// Synthetic data only. Real browser zoom (ZoomManager in the chrome window, not CSS zoom),
// real window sizes, light and dark via prefers-color-scheme, keyboard input via WebDriver.
// Writes docs/evidence/previous-dialogs/review-<lang>.json and screenshots.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { syntheticSecret } from "../helpers/fixtures.mjs";
import { sealExport, accountsFromPortable } from "../../src/lib/export.js";
import { deriveKey, newKdf } from "../../src/lib/kdf.js";
import { contrast } from "../../src/lib/appearance.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(root, "docs/evidence/previous-dialogs");
mkdirSync(OUT, { recursive: true });
const LANG = process.argv.find((a) => a.startsWith("--lang="))?.slice(7) ?? "de";
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c";
const BASE = `moz-extension://${UUID}/`;
const PW = "Review-Passwort für Dialoge ✓", WRONG = "not the master password", EXP = "Export-Passphrase Review";
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";

const ff = await launchFirefox({ firefox: FIREFOX, port: 9336, prefs: {
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
const key = (ctx, k, shift = false) => call("input.performActions", { context: ctx, actions: [{ type: "key", id: "kb", actions: [
  ...(shift ? [{ type: "keyDown", value: "\uE008" }] : []), { type: "keyDown", value: k }, { type: "keyUp", value: k }, ...(shift ? [{ type: "keyUp", value: "\uE008" }] : [])] }] });
async function node(ctx, sel) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: false, expression: `document.querySelector(${JSON.stringify(sel)})`, resultOwnership: "root" });
  return { sharedId: r.result.sharedId };
}
async function click(ctx, sel, times = 1) {
  const el = await node(ctx, sel);
  const acts = [{ type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: el } }];
  for (let i = 0; i < times; i++) acts.push({ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 });
  await call("input.performActions", { context: ctx, actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: acts }] });
}

const checks = [];
const record = (id, name, pass, details) => { checks.push({ id, name, verdict: pass ? "PASS" : "FAIL", details }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}`); };
const evidence = { lang: LANG, startedAt: new Date().toISOString() };
try {
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = s.capabilities.browserVersion;
  await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
  const opt = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.navigate", { context: opt, url: BASE + "options/options.html#general", wait: "complete" });
  evidence.uiLanguage = await evalJson(opt, `async () => browser.i18n.getUILanguage()`);

  // Synthetic vault: 2 local entries; a backup with 3 entries replaces them, so the kept
  // previous state holds 2 entries and the current state 3.
  await evalJson(opt, `async () => { await browser.storage.local.clear(); await browser.storage.session.clear(); }`);
  if (!(await msg(opt, "setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
  let revision = 1;
  for (const [i, name] of ["Lokal Eta", "Lokal Theta"].entries()) revision = (await msg(opt, "addAccount", { revision, account: { name, secret: syntheticSecret(960 + i) } })).result.revision;
  const kdf = newKdf();
  const backup = ["Sicherung Alpha", "Sicherung Beta", "Sicherung Gamma"].map((name, i) => ({ name, secret: syntheticSecret(970 + i) }));
  const text = JSON.stringify(await sealExport(await deriveKey(EXP, kdf), kdf, accountsFromPortable(backup), "review"));
  const pv = await msg(opt, "replacePreview", { text, password: EXP, masterPassword: PW });
  if (!pv.ok) throw new Error("replacePreview " + JSON.stringify(pv));
  if (!(await msg(opt, "replaceApply", { token: pv.result.token })).ok) throw new Error("replaceApply");
  const names = async () => (await msg(opt, "listAccounts")).result.accounts.map((a) => a.name);
  const previous = async () => (await msg(opt, "previousStatus")).result;

  const win = (w, h) => evalJson(chrome, `async () => { const w = ${SVC}.wm.getMostRecentWindow("navigator:browser");
    if (w.windowState !== w.STATE_NORMAL) w.restore(); w.resizeTo(${w}, ${h}); await new Promise((r) => setTimeout(r, 400)); return [w.outerWidth, w.outerHeight]; }`);
  const zoom = (z) => evalJson(chrome, `async () => { const w = ${SVC}.wm.getMostRecentWindow("navigator:browser");
    w.ZoomManager.setZoomForBrowser(w.gBrowser.selectedBrowser, ${z}); await new Promise((r) => setTimeout(r, 300)); return w.ZoomManager.getZoomForBrowser(w.gBrowser.selectedBrowser); }`);
  const scheme = (v) => evalJson(chrome, `async () => { ${SVC}.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", ${v}); await new Promise((r) => setTimeout(r, 300)); }`);
  // Select the options tab in the window (BiDi cannot activate extension pages); zoom applies to it.
  await evalJson(chrome, `async () => { const w = ${SVC}.wm.getMostRecentWindow("navigator:browser");
    const t = w.gBrowser.tabs.find((x) => x.linkedBrowser.currentURI.spec.startsWith(${JSON.stringify(BASE)})); w.gBrowser.selectedTab = t; w.focus(); }`);
  await call("browsingContext.reload", { context: opt, wait: "complete" });
  await waitFor(opt, `document.body.dataset.state === 'unlocked' && !document.getElementById("previousBox").hidden`);

  const openDialog = async (action, password = PW) => {
    await evalJson(opt, `async () => { const d = document.getElementById("previousDialog"); if (d.open) d.close();
      const f = document.getElementById("previousForm"); f.elements.masterPassword.value = ${JSON.stringify(password)};
      document.getElementById("${action === "discard" ? "previousDiscardButton" : "previousRestoreButton"}").scrollIntoView({ block: "center" }); }`);
    await click(opt, action === "discard" ? "#previousDiscardButton" : "#previousRestoreButton");
    return waitFor(opt, `document.getElementById("previousDialog").open`, 3000);
  };
  // Layout of the open dialog: inside the viewport, nothing clipped, no horizontal page scroll; colours.
  const measure = () => evalJson(opt, `async () => {
    const d = document.getElementById("previousDialog"), r = d.getBoundingClientRect(), cs = (e) => getComputedStyle(e);
    const hex = (c) => "#" + c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
    const parts = ["previousDialogTitle", "previousDialogText", "previousDialogCancel", "previousDialogConfirm"].map((id) => document.getElementById(id));
    const clipped = parts.filter((e) => { const b = e.getBoundingClientRect(); return b.left < r.left - 0.5 || b.right > r.right + 0.5 || e.scrollWidth > e.clientWidth + 1 || b.width === 0; }).map((e) => e.id);
    const cancel = document.getElementById("previousDialogCancel"), confirm = document.getElementById("previousDialogConfirm"), cb = confirm.getBoundingClientRect();
    const btnBg = (e) => { const c = cs(e).backgroundColor; return /rgba\\(.*, 0\\)$/.test(c) || c === "transparent" ? cs(d).backgroundColor : c; };
    return { zoomDpr: devicePixelRatio, innerWidth, innerHeight, dialog: { x: r.x, y: r.y, w: r.width, h: r.height },
      inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      confirmReachable: cb.bottom <= Math.min(r.bottom, innerHeight) + 0.5 && cb.right <= innerWidth,
      dialogScrolls: d.scrollHeight > d.clientHeight + 1, clipped,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflowX: d.scrollWidth - d.clientWidth,
      // what sticks out on the right (diagnosis of a page overflow)
      offenders: [...document.querySelectorAll("body *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && ![...e.children].some((c) => c.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5))
        .slice(0, 6).map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : "") + ":" + Math.round(e.getBoundingClientRect().right)),
      colors: { bg: hex(cs(d).backgroundColor), fg: hex(cs(d).color), cancelFg: hex(cs(cancel).color), cancelBg: hex(btnBg(cancel)),
        confirmFg: hex(cs(confirm).color), confirmBg: hex(btnBg(confirm)), confirmBorder: hex(cs(confirm).borderTopColor), cancelBorder: hex(cs(cancel).borderTopColor) },
      confirmClass: confirm.className, title: document.getElementById("previousDialogTitle").textContent, text: document.getElementById("previousDialogText").textContent,
      confirmLabel: confirm.textContent, cancelLabel: cancel.textContent };
  }`);
  const shot = async (file) => {
    const b = await evalJson(opt, `async () => { const r = document.getElementById("previousDialog").getBoundingClientRect(); return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), w: Math.min(innerWidth, r.width + 24), h: Math.min(innerHeight, r.height + 24) }; }`);
    const s = await call("browsingContext.captureScreenshot", { context: opt, clip: { type: "box", x: b.x, y: b.y, width: b.w, height: b.h } });
    writeFileSync(join(OUT, file), Buffer.from(s.data, "base64"));
    return file;
  };

  // V-1: matrix of window widths × real zoom × theme × dialog.
  const matrix = [], shots = [];
  for (const [w, h] of [[1280, 900], [520, 800]]) {
    await win(w, h);
    for (const z of [1, 1.5, 2]) {
      await zoom(z);
      for (const [theme, v] of [["light", 1], ["dark", 0]]) {
        await scheme(v);
        for (const action of ["restore", "discard"]) {
          const opened = await openDialog(action);
          const m = await measure();
          const c = m.colors;
          m.contrast = { text: +contrast(c.fg, c.bg).toFixed(2), cancel: +contrast(c.cancelFg, c.cancelBg).toFixed(2), confirm: +contrast(c.confirmFg, c.confirmBg).toFixed(2) };
          matrix.push({ window: w, zoom: z, theme, action, opened, ...m });
          if ((w === 1280 && z === 1) || (w === 520 && z === 2 && theme === "light")) shots.push(await shot(`previous-${action}-${theme}-${w}px-${z * 100}pct-${LANG}.png`));
          await evalJson(opt, `async () => document.getElementById("previousDialog").close()`);
        }
      }
    }
  }
  await scheme(1); await zoom(1); await win(1280, 900);
  const bad = matrix.filter((m) => !m.opened || m.clipped.length || m.pageOverflowX > 0 || m.dialogOverflowX > 0 || !m.confirmReachable ||
    m.contrast.text < 4.5 || m.contrast.cancel < 4.5 || m.contrast.confirm < 4.5);
  record("V-1", `both dialogs at 1280 and 520 px window width, real zoom 100/150/200 %, light and dark: open, nothing clipped, no horizontal overflow, confirm button reachable, text and button contrast ≥ 4.5 (${matrix.length} combinations)`,
    bad.length === 0, { combinations: matrix.length, failures: bad, notInViewportButScrollable: matrix.filter((m) => !m.inViewport).map((m) => `${m.window}/${m.zoom}/${m.theme}/${m.action}`), realZoomDpr: [...new Set(matrix.map((m) => m.zoomDpr))] });

  // V-2: contents: counts and consequences; discard visually destructive, restore not.
  const r1 = matrix.find((m) => m.action === "restore" && m.window === 1280 && m.zoom === 1 && m.theme === "light");
  const d1 = matrix.find((m) => m.action === "discard" && m.window === 1280 && m.zoom === 1 && m.theme === "light");
  const d2 = matrix.find((m) => m.action === "discard" && m.window === 1280 && m.zoom === 1 && m.theme === "dark");
  record("V-2", "dialog texts: restore names both counts (current 3, previous 2) and that nothing is lost; discard names the count and that it cannot be undone; discard confirm is red (error colour, differs from Cancel) in light and dark, restore confirm is the primary button",
    /\b3\b/.test(r1.text) && /\b2\b/.test(r1.text) && /\b2\b/.test(d1.text) && d1.confirmClass === "danger" && r1.confirmClass === "primary" &&
    d1.colors.confirmFg !== d1.colors.cancelFg && d1.colors.confirmBorder !== d1.colors.cancelBorder && d2.colors.confirmFg !== d2.colors.cancelFg,
    { restore: { title: r1.title, text: r1.text, confirm: r1.confirmLabel, cancel: r1.cancelLabel }, discard: { title: d1.title, text: d1.text, confirm: d1.confirmLabel },
      discardColors: { light: d1.colors, dark: d2.colors } });

  // K-1: keyboard only: Tab to the button, Enter opens; focus on Cancel with a visible focus ring;
  // Tab to confirm (ring visible), Shift+Tab back, Escape closes and returns the focus.
  const focus = () => evalJson(opt, `async () => { const e = document.activeElement, c = getComputedStyle(e);
    return { id: e.id || e.name || e.tagName, visible: e.matches(":focus-visible"), outline: c.outlineStyle + " " + c.outlineWidth }; }`);
  const kb = {};
  for (const action of ["restore", "discard"]) {
    const btn = action === "discard" ? "previousDiscardButton" : "previousRestoreButton";
    await evalJson(opt, `async () => { document.getElementById("previousForm").elements.masterPassword.value = ${JSON.stringify(PW)};
      const f = document.getElementById("previousForm").elements.masterPassword; f.focus(); f.scrollIntoView({ block: "center" }); }`);
    await key(opt, "\uE004"); if (action === "discard") await key(opt, "\uE004");
    const onButton = await focus();
    await key(opt, "\uE007");
    await waitFor(opt, `document.getElementById("previousDialog").open`, 3000);
    const initial = await focus();
    if (action === "restore") shots.push(await shot(`previous-restore-focus-cancel-${LANG}.png`));
    await key(opt, "\uE004");
    const tab = await focus();
    if (action === "discard") shots.push(await shot(`previous-discard-focus-confirm-${LANG}.png`));
    await key(opt, "\uE004", true);
    const back = await focus();
    await key(opt, "\uE00C");
    await waitFor(opt, `!document.getElementById("previousDialog").open`, 3000);
    kb[action] = { onButton, initial, tab, back, afterEscape: await focus() };
  }
  const ring = (f) => f.visible && /^solid [2-9]/.test(f.outline);
  record("K-1", "keyboard only: Enter on the button opens the dialog; focus starts on Cancel with a visible 2 px ring; Tab reaches the confirm button (ring visible); Shift+Tab returns to Cancel; Escape closes and returns the focus to the opening button",
    ["restore", "discard"].every((a) => { const k = kb[a], b = a === "discard" ? "previousDiscardButton" : "previousRestoreButton";
      return k.onButton.id === b && k.initial.id === "previousDialogCancel" && ring(k.initial) && k.tab.id === "previousDialogConfirm" && ring(k.tab) && k.back.id === "previousDialogCancel" && k.afterEscape.id === b; }), kb);

  // A-1: accessibility tree data: role, labelled/described, accessible names of the buttons.
  const a11y = await evalJson(opt, `async () => { const d = document.getElementById("previousDialog");
    return { role: d.getAttribute("role"), labelledby: !!document.getElementById(d.getAttribute("aria-labelledby"))?.textContent, describedby: !!document.getElementById(d.getAttribute("aria-describedby"))?.textContent,
      buttons: [...d.querySelectorAll("button")].map((b) => ({ id: b.id, name: b.textContent.trim(), type: b.type })), formButtons: [...document.querySelectorAll("#previousForm button")].map((b) => b.textContent.trim()),
      passwordLabelled: !!document.querySelector("#previousForm input[name=masterPassword]").closest("label")?.textContent.trim(), checkboxes: document.querySelectorAll("#previousBox input[type=checkbox]").length }; }`);
  record("A-1", "roles and names: alertdialog with label and description; dialog buttons and form buttons have non-empty names; password field has a label; no checkbox",
    a11y.role === "alertdialog" && a11y.labelledby && a11y.describedby && a11y.buttons.every((b) => b.name) && a11y.formButtons.every(Boolean) && a11y.passwordLabelled && a11y.checkboxes === 0, a11y);

  // F-1: wrong master password: nothing changes, exactly one visible message beside the buttons,
  // field cleared, focused and marked invalid.
  const before = { names: await names(), previous: await previous() };
  await openDialog("restore", WRONG);
  await click(opt, "#previousDialogConfirm");
  await waitFor(opt, `document.getElementById("previousStatus").dataset.kind === "error"`, 15000);
  const wrong = await evalJson(opt, `async () => { const f = document.getElementById("previousForm").elements.masterPassword, s = document.getElementById("previousStatus"), r = s.getBoundingClientRect(),
    b = document.getElementById("previousRestoreButton").getBoundingClientRect();
    return { filled: [...document.querySelectorAll(".status")].filter((e) => e.textContent.trim() && e.getClientRects().length).map((e) => e.id), alerts: document.querySelectorAll("[role=alert]:not(:empty)").length,
      inView: r.top >= 0 && r.bottom <= innerHeight, gapToButtons: Math.round(r.top - b.bottom), focus: document.activeElement === f, empty: f.value === "", invalid: f.getAttribute("aria-invalid") }; }`);
  if (wrong.inView) shots.push(await (async () => { const s = await call("browsingContext.captureScreenshot", { context: opt }); writeFileSync(join(OUT, `previous-wrong-password-${LANG}.png`), Buffer.from(s.data, "base64")); return `previous-wrong-password-${LANG}.png`; })());
  const afterWrong = { names: await names(), previous: await previous() };
  record("F-1", "wrong master password: neither vault state changes; exactly one visible message, directly below the buttons and in view; field cleared, focused and aria-invalid",
    JSON.stringify(before) === JSON.stringify(afterWrong) && wrong.filled.length === 1 && wrong.filled[0] === "previousStatus" && wrong.alerts === 0 && wrong.inView && wrong.gapToButtons >= 0 && wrong.gapToButtons < 40 &&
    wrong.focus && wrong.empty && wrong.invalid === "true", { ...wrong, unchanged: JSON.stringify(before) === JSON.stringify(afterWrong) });

  // D-1: real double click on the confirm button: the swap runs once; focus after success.
  await openDialog("restore");
  await click(opt, "#previousDialogConfirm", 2);
  await waitFor(opt, `document.getElementById("previousStatus").dataset.kind === "ok"`, 15000);
  await sleep(500);
  const swapped = { names: await names(), previous: await previous() };
  const success = await evalJson(opt, `async () => ({ focus: document.activeElement?.id || document.activeElement?.tagName, dialogOpen: document.getElementById("previousDialog").open,
    filled: [...document.querySelectorAll(".status")].filter((e) => e.textContent.trim() && e.getClientRects().length).map((e) => e.id),
    statusInView: (() => { const r = document.getElementById("previousStatus").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })() })`);
  record("D-1", "real double click on the confirm button: one swap (current = the 2 previous entries, previous = 3), dialog stays closed; exactly one visible success message in view; focus back on the restore button",
    JSON.stringify(swapped.names.sort()) === JSON.stringify(["Lokal Eta", "Lokal Theta"]) && swapped.previous.count === 3 && !success.dialogOpen && success.filled.length === 1 && success.statusInView &&
    success.focus === "previousRestoreButton",
    { swapped, success });

  // C-1: change from another tab while the dialog is open: the restore still swaps (both states
  // kept, nothing lost); the change is part of the state that becomes the previous one.
  await openDialog("restore");
  const rev = (await msg(opt, "listAccounts")).result.revision;
  await msg(opt, "addAccount", { revision: rev, account: { name: "Anderer Tab Review", secret: syntheticSecret(980) } });
  await click(opt, "#previousDialogConfirm");
  await waitFor(opt, `["ok", "error"].includes(document.getElementById("previousStatus").dataset.kind)`, 15000);
  const conc = { kind: await evalJson(opt, `async () => document.getElementById("previousStatus").dataset.kind`), names: await names(), previous: await previous() };
  record("C-1", "change in another tab while the restore dialog is open: no entry is lost (the changed state becomes the previous state)",
    conc.previous.count === 3 && conc.names.length === 3, conc);

  // F-2: discard via the dialog; the box closes; the message stays visible in the section.
  await openDialog("discard");
  await click(opt, "#previousDialogConfirm");
  await waitFor(opt, `document.getElementById("previousBox").hidden`, 15000);
  const disc = await evalJson(opt, `async () => ({ focus: document.activeElement?.id || document.activeElement?.tagName,
    filled: [...document.querySelectorAll(".status")].filter((e) => e.textContent.trim() && e.getClientRects().length).map((e) => e.id) })`);
  record("F-2", "discard via the dialog: previous state deleted, box closes, exactly one visible message; current entries unchanged",
    (await previous()).exists === false && disc.filled.length === 1 && JSON.stringify(await names()) === JSON.stringify(conc.names), disc);

  evidence.shots = shots;
} catch (e) {
  record("RUN", "review run", false, { error: String(e?.stack ?? e) });
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, `review-${LANG}.json`), JSON.stringify({ ...evidence, checks }, null, 2) + "\n");
  await ff.close();
}
process.exit(checks.every((c) => c.verdict === "PASS") ? 0 : 1);
