// Keyboard shortcut checks shared by run-browser-tests.mjs (C6-2) and shortcut-probe.mjs (F3-2).
// All functions run their DOM part in Firefox's chrome scope through evalJson(chromeContext, fn).

const SVC = `(typeof Services !== "undefined" ? Services : ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services)`;
const WIN = `${SVC}.wm.getMostRecentWindow("navigator:browser")`;

// Firefox's own bindings in the browser window after localization: every <key> (all keysets)
// and the access keys of the menu bar (Alt+letter opens a menu on Windows and Linux; the
// letters depend on the UI language, e.g. "Ansicht" = A in German, "View" = V in English).
export const readBindings = (evalJson, chrome) => evalJson(chrome, `async () => { const d = ${WIN}.document;
  await d.l10n?.ready;
  return { locale: ${SVC}.locale.appLocaleAsBCP47,
    menus: [...d.querySelectorAll("#main-menubar > menu")].map((m) => ({ label: m.getAttribute("label"), accesskey: m.getAttribute("accesskey") })),
    keys: [...d.querySelectorAll("key")].map((k) => ({ id: k.id, keyset: k.parentElement?.id ?? "",
      key: k.getAttribute("key"), keycode: k.getAttribute("keycode"), modifiers: k.getAttribute("modifiers") || "",
      disabled: k.hasAttribute("disabled") })) }; }`);

// What in Firefox already uses `shortcut` (manifest syntax, e.g. "Ctrl+Shift+2").
export function conflicts(bindings, shortcut, platform = process.platform) {
  const parts = shortcut.split("+"), key = parts.at(-1), mods = parts.slice(0, -1);
  const mac = platform === "darwin", accel = mac ? "meta" : "control";
  const want = mods.map((m) => ({ Ctrl: accel, Command: "meta", MacCtrl: "control", Alt: "alt", Shift: "shift" })[m]).sort().join(",");
  const norm = (s) => s.split(/[ ,]+/).filter(Boolean).map((m) => (m === "accel" ? accel : m === "os" ? "meta" : m)).sort().join(",");
  const name = (k) => (k.key ? k.key.toUpperCase() : { VK_COMMA: "COMMA", VK_PERIOD: "PERIOD" }[k.keycode] ?? k.keycode);
  const ours = (k) => k.keyset.startsWith("ext-keyset-id-") || k.id.startsWith("ext-key-id-"); // extensions' keysets
  const firefoxKeys = bindings.keys.filter((k) => !ours(k) && !k.disabled && norm(k.modifiers) === want && name(k) === key.toUpperCase())
    .map((k) => k.id || `${k.keyset}:${k.key ?? k.keycode}`);
  const menuAccessKeys = !mac && mods.includes("Alt") && !mods.includes("Ctrl") && /^[A-Z]$/i.test(key)
    ? bindings.menus.filter((m) => (m.accesskey || "").toUpperCase() === key.toUpperCase()).map((m) => m.label) : [];
  // Ctrl+Alt is AltGr on Windows: with many layouts it types a character instead (German AltGr+Q = @).
  const altGr = platform === "win32" && mods.includes("Ctrl") && mods.includes("Alt");
  return { firefoxKeys, menuAccessKeys, altGr, free: !firefoxKeys.length && !menuAccessKeys.length && !altGr };
}

// Windows only: press `shortcut` as a native key event with a keyboard layout (0x407 German,
// 0x409 US) in the test browser and report what opened. The event goes through the OS key
// path of the browser window (menu access keys included), not to other applications.
const VK = (key) => (/^[A-Z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : { Comma: 0xbc, Period: 0xbe }[key]);
const FLAG = { Shift: 0x100, Ctrl: 0x400, Alt: 0x1000 }; // nsIWidget native modifier flags
export function pressNative(evalJson, chrome, shortcut, layout) {
  const parts = shortcut.split("+"), key = parts.at(-1), mods = parts.slice(0, -1);
  const plain = /^[A-Z]$/i.test(key) ? key.toLowerCase() : key.length === 1 ? key : "";
  // Ctrl+letter generates a control character (WM_CHAR 0x01 for A), as a real keyboard does.
  const char = mods.includes("Ctrl") && /^[A-Z]$/i.test(key) ? String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64) : plain;
  return evalJson(chrome, `async () => { const w = ${WIN}, d = w.document, wm = ${SVC}.wm;
    const tabs0 = w.gBrowser.tabs.length, wins0 = [...wm.getEnumerator("navigator:browser")].length;
    w.focus(); w.gBrowser.selectedBrowser.focus();
    w.windowUtils.sendNativeKeyEvent(${layout}, ${VK(key)}, ${mods.reduce((f, m) => f | FLAG[m], 0)}, ${JSON.stringify(char)}, ${JSON.stringify(plain)}, null);
    await new Promise((r) => w.setTimeout(r, 900));
    const open = (p) => p.state === "open" || p.state === "showing";
    const menus = [...d.querySelectorAll("#main-menubar menupopup")].filter(open).map((p) => p.parentElement?.getAttribute("label"));
    const panels = [...d.querySelectorAll("panel, menupopup")].filter((p) => open(p) && !p.closest("#main-menubar")).map((p) => p.id || p.className);
    const out = { popup: panels.some((id) => /widget-panel|webext/i.test(id)), menus, panels,
      newTabs: w.gBrowser.tabs.length - tabs0, newWindows: [...wm.getEnumerator("navigator:browser")].length - wins0,
      selectedTab: w.gBrowser.selectedBrowser.currentURI?.spec?.slice(0, 40) };
    for (const p of d.querySelectorAll("panel, menupopup")) if (open(p)) try { p.hidePopup(); } catch {}
    w.windowUtils.sendNativeKeyEvent(${layout}, 0x1b, 0, "", "", null); // Escape leaves an active menu bar
    while (w.gBrowser.tabs.length > tabs0) w.gBrowser.removeTab(w.gBrowser.tabs[w.gBrowser.tabs.length - 1]);
    for (const o of [...wm.getEnumerator("navigator:browser")]) if (o !== w) o.close();
    await new Promise((r) => w.setTimeout(r, 300));
    return out; }`);
}
export const LAYOUTS = { de: 0x407, us: 0x409 };
export const opensPopupOnly = (p) => !!p && p.popup && !p.menus.length && !p.newTabs && !p.newWindows;
