// Visual and keyboard check of the 1.0.0 icons in a real, visible Firefox (Windows).
// Usage: node test/browser/icon-check.mjs <path-to-firefox> <label> [--src=dir]
// Per theme (light, dark) it starts a throwaway profile with Firefox's built-in light or dark
// theme, installs the extension and writes to docs/evidence/phase-d/icons-1.0.0/<label>/:
//   window-<theme>.png   the whole window from the screen (toolbar icon + about:addons list)
//   toolbar-<theme>.png  the toolbar strip of that capture
//   popup-<theme>.png    the popup footer with the settings button focused by Tab
// and results.json (toolbar image Firefox chose is visible only in the captures; the popup
// part also checks focus by Tab and activation by Enter). Synthetic accounts only.
// The window must stay in front for the screen captures (about 30 s per Firefox).
// --unpinned=<dx>: the toolbar button as after unpinning it (a temporary copy of the source with
// default_area "menupanel"); clicks the extensions button <dx> px left of the window's right
// edge (y 65) and writes panel-<theme>.png instead of the popup part.
import { writeFileSync, mkdirSync, mkdtempSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { syntheticSecret } from "../helpers/fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [FIREFOX, LABEL] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!FIREFOX || !LABEL) throw new Error("usage: icon-check.mjs <firefox> <label> [--src=dir]");
let SRC = resolve(root, process.argv.find((a) => a.startsWith("--src="))?.slice(6) ?? "src");
const UNPINNED = process.argv.find((a) => a.startsWith("--unpinned="))?.slice(11);
const SRC_LABEL = relative(root, SRC).replace(/\\/g, "/") +(UNPINNED ? " (copy with default_area menupanel)" : "");
if (UNPINNED) {
  const copy = join(mkdtempSync(join(tmpdir(), "cta-unpinned-")), "src");
  cpSync(SRC, copy, { recursive: true });
  const m = JSON.parse(readFileSync(join(copy, "manifest.json"), "utf8"));
  m.action.default_area = "menupanel";
  writeFileSync(join(copy, "manifest.json"), JSON.stringify(m, null, 2));
  SRC = copy;
}
const OUT = join(root, "docs/evidence/phase-d/icons-1.0.0", LABEL);
mkdirSync(OUT, { recursive: true });
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6d";
const BASE = `moz-extension://${UUID}/`;
const PW = "Synthetic-Icon-Check-Master-2026";
const THEMES = { light: ["firefox-compact-light@mozilla.org", 1], dark: ["firefox-compact-dark@mozilla.org", 0] };

// Screen capture of the Firefox window (DPI aware): whole window and its top strip.
function captureWindow(pid, file, stripFile, click) {
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int s);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  public struct R { public int L, T, Ri, B; } }
"@
[W]::SetProcessDPIAware() | Out-Null
# Windows launcher process: the window belongs to the started process or one of its children.
$ids = @(${pid}) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { $_.ProcessId })
$h = (Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle
if (-not $h) { throw "no Firefox window" }
[W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 800
# Visible frame without the drop shadow (DWMWA_EXTENDED_FRAME_BOUNDS).
$r = New-Object W+R; [W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
$w = $r.Ri - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
$sh = [Math]::Min(130, $hh); $strip = $bmp.Clone((New-Object System.Drawing.Rectangle 0, 0, $w, $sh), $bmp.PixelFormat)
$strip.Save('${stripFile}', [System.Drawing.Imaging.ImageFormat]::Png)
${click ? `[W]::SetCursorPos($r.Ri - ${click.dx}, $r.T + 65) | Out-Null; [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0)
Start-Sleep -Milliseconds 1500
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size); $bmp.Save('${click.file}', [System.Drawing.Imaging.ImageFormat]::Png)` : ""}
Write-Output "$w x $hh"`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("capture: " + r.stderr);
  return r.stdout.trim();
}

const results = { label: LABEL, src: SRC_LABEL, themes: {} };
for (const [theme, [themeId, scheme]] of Object.entries(THEMES)) {
  const ff = await launchFirefox({ firefox: FIREFOX, port: 9339, prefs: {
    "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
    "extensions.activeThemeID": themeId,
    "layout.css.prefers-color-scheme.content-override": scheme,
    "extensions.ui.lastCategory": "addons://list/extension",
    "extensions.getAddons.showPane": false,
    "browser.shell.checkDefaultBrowser": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "browser.aboutwelcome.enabled": false,
  } });
  const call = (m, p) => ff.call(m, p);
  const evalJson = async (ctx, src) => {
    const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true, expression: `(${src})().then((v) => JSON.stringify(v ?? null))` });
    if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
    return JSON.parse(r.result.value);
  };
  const msg = (ctx, cmd, args = {}) => evalJson(ctx, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`);
  const r = { };
  try {
    const s = await call("session.new", { capabilities: {} });
    r.browser = s.capabilities.browserVersion;
    await call("webExtension.install", { extensionData: { type: "path", path: SRC } });

    // Popup: synthetic vault, footer with the settings button focused by Tab, then Enter.
    if (!UNPINNED) {
    const opt = (await call("browsingContext.create", { type: "tab" })).context;
    await call("browsingContext.navigate", { context: opt, url: BASE + "options/options.html", wait: "complete" });
    await evalJson(opt, `async () => { await browser.storage.local.clear(); await browser.storage.session.clear(); }`);
    if (!(await msg(opt, "setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
    let revision = 1;
    for (const [i, name] of ["Mail", "Bank", "Forum"].entries()) {
      revision = (await msg(opt, "addAccount", { revision, account: { name, secret: syntheticSecret(900 + i) } })).result.revision;
    }
    await call("browsingContext.close", { context: opt });
    const pop = (await call("browsingContext.create", { type: "tab" })).context;
    await call("browsingContext.setViewport", { context: pop, viewport: { width: 270, height: 200 } });
    await call("browsingContext.navigate", { context: pop, url: BASE + "popup/popup.html", wait: "complete" });
    await sleep(800);
    let tabs = 0;
    for (; tabs < 12; tabs++) {
      if (await evalJson(pop, `async () => document.activeElement?.id === "settings"`)) break;
      await call("input.performActions", { context: pop, actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: "\uE004" }, { type: "keyUp", value: "\uE004" }] }] });
      await sleep(120);
    }
    r.settingsButton = await evalJson(pop, `async () => { const b = document.getElementById("settings"); const cs = getComputedStyle(b);
      return { focused: document.activeElement === b, focusVisible: b.matches(":focus-visible"), title: b.title, ariaLabel: b.getAttribute("aria-label"),
        background: cs.backgroundColor, color: cs.color, svgHidden: b.querySelector("svg").getAttribute("aria-hidden") }; }`);
    r.settingsButton.tabPresses = tabs;
    const foot = await evalJson(pop, `async () => { const f = document.querySelector("footer").getBoundingClientRect(); return { x: 0, y: f.y - 4, width: 270, height: f.height + 8 }; }`);
    const shot = await call("browsingContext.captureScreenshot", { context: pop, clip: { type: "box", ...foot } });
    writeFileSync(join(OUT, `popup-${theme}.png`), Buffer.from(shot.data, "base64"));
    await call("input.performActions", { context: pop, actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: "\uE007" }, { type: "keyUp", value: "\uE007" }] }] }).catch(() => {}); // the popup closes itself after opening the options
    let opened = false;
    for (let i = 0; i < 30 && !opened; i++) {
      await sleep(200);
      opened = (await call("browsingContext.getTree", {})).contexts.some((c) => c.url.startsWith(BASE + "options/options.html"));
    }
    r.settingsButton.enterOpensOptions = opened;
    }

    // Window capture: about:addons list (neutral icon) and the toolbar button.
    const { contexts } = await call("browsingContext.getTree", {});
    const addons = (await call("browsingContext.create", { type: "tab" })).context;
    await call("browsingContext.navigate", { context: addons, url: "about:addons", wait: "complete" }).catch(() => {});
    for (const c of contexts) if (c.url.startsWith(BASE)) await call("browsingContext.close", { context: c.context }).catch(() => {});
    await sleep(2500);
    r.window = captureWindow(ff.pid, join(OUT, `window-${theme}.png`), join(OUT, `toolbar-${theme}.png`),
      UNPINNED ? { dx: Number(UNPINNED), file: join(OUT, `panel-${theme}.png`) } : undefined);
  } finally {
    await ff.close();
  }
  results.themes[theme] = r;
  console.log(theme, JSON.stringify(r));
}
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
