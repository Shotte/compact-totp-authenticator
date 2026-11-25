// Static gates over the shipped extension source (src/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const ALL = files(SRC);
const code = ALL.filter((f) => /\.(js|html)$/.test(f)).map((f) => [relative(SRC, f).replace(/\\/g, "/"), readFileSync(f, "utf8")]);
// JS without line comments, for checks that must only see executable code.
const stripped = code.map(([f, src]) => [f, f.endsWith(".js") ? src.replace(/^\s*\/\/.*$/gm, "") : src]);
const json = (p) => JSON.parse(readFileSync(join(SRC, p), "utf8"));

test("manifest: MV3, approved ID, minimal permissions, no remote surface", () => {
  const m = json("manifest.json");
  assert.equal(m.manifest_version, 3);
  assert.equal(m.browser_specific_settings.gecko.id, "{f587432b-b553-483e-b08d-4feac6378113}");
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
  assert.deepEqual(Object.keys(m.browser_specific_settings), ["gecko"], "desktop only: AMO lists Android only with gecko_android");
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.deepEqual([...m.permissions].sort(), ["activeTab", "alarms", "storage"]);
  assert.deepEqual(m.optional_permissions, ["idle"], "C3.4: only the optional idle lock; no host permissions");
  for (const k of ["host_permissions", "content_scripts", "web_accessible_resources",
    "externally_connectable", "content_security_policy", "update_url"]) {
    assert.equal(k in m, false, k);
  }
});

test("no logging, no dynamic code, no HTML injection, no remote URLs", () => {
  for (const [f, src] of stripped) {
    assert.doesNotMatch(src, /\bconsole\./, `${f}: console`);
    assert.doesNotMatch(src, /\beval\(|new Function\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${f}: dynamic code/HTML`);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/, `${f}: network`);
    const urls = (src.match(/https?:\/\/[^\s"'`<>)]+/g) ?? [])
      .filter((u) => u !== "http://www.w3.org/2000/svg" && !u.startsWith("https://${"));
    assert.deepEqual(urls, [], `${f}: remote URL`);
    assert.doesNotMatch(src, /<script(?![^>]*\bsrc=)[^>]*>/, `${f}: inline script`);
  }
});

test("only background.js hands out storage.session (pages would receive the key)", () => {
  const users = stripped.filter(([, src]) => /browser\.storage\.session/.test(src)).map(([f]) => f);
  assert.deepEqual(users, ["background.js"]);
  const pages = code.filter(([f]) => /^(popup|options)\//.test(f));
  for (const [f, src] of pages) assert.doesNotMatch(src, /service\.js|crypto\.js|fixtures\.js|totp\.js|vault\.js|export\.js|kdf\.js/, f);
});

test("release gate: the development-only demo unlock cannot ship in a 1.x release", () => {
  const major = Number(json("manifest.json").version.split(".")[0]);
  const users = stripped.filter(([, src]) => /devUnlock|unlockDemo/.test(src)).map(([f]) => f);
  if (major >= 1) assert.deepEqual(users, [], "remove devUnlock (Phase C master password) before 1.0.0");
  else assert.ok(major === 0, "pre-release versions only");
});

test("release gate: 0.x shows the development notice (with the export-only recovery warning) on the options page in every state", () => {
  const major = Number(json("manifest.json").version.split(".")[0]);
  const html = code.find(([f]) => f === "options/options.html")[1];
  const notice = html.match(/<p id="devNotice"[^>]*>/)?.[0];
  if (major >= 1) return; // removing it is part of the 1.0 release decision
  assert.ok(notice && !/\bhidden\b/.test(notice), "devNotice present and not hidden");
  assert.ok(html.indexOf(notice) < html.indexOf("<section"), "devNotice sits outside the state sections");
  assert.doesNotMatch(readFileSync(join(SRC, "options/options.js"), "utf8"), /devNotice/, "options.js never toggles it");
  assert.match(json("_locales/en/messages.json").devNotice.message, /not for production use.*only be restored from an export/);
});

test("locales: identical keys, every referenced key exists", () => {
  const en = json("_locales/en/messages.json"), de = json("_locales/de/messages.json");
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const used = new Set();
  for (const [, src] of stripped) {
    for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(";").forEach((p) => used.add(p.split(":")[1]));
    for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/"(err[A-Z][A-Za-z]+|status[A-Z][A-Za-z]+)"/g)) used.add(m[1]);
  }
  used.add("extName").add("extDescription");
  for (const k of used) assert.ok(k in en, `missing locale key ${k}`);
  for (const [k, v] of Object.entries(de)) {
    assert.equal((v.message.match(/\$[A-Z]+\$/g) ?? []).sort().join(), (en[k].message.match(/\$[A-Z]+\$/g) ?? []).sort().join(), `placeholders ${k}`);
  }
});

test("licensing: the package ships the root MIT LICENSE unchanged", () => {
  const root = readFileSync(join(SRC, "..", "LICENSE"), "utf8");
  assert.equal(readFileSync(join(SRC, "LICENSE"), "utf8"), root, "src/LICENSE must equal the root LICENSE");
  assert.match(root, /^MIT License/);
  assert.match(root, /Copyright \(c\) 2017 Rayquaza01/, "original project's notice preserved");
  assert.equal(JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")).license, "MIT");
});

test("icons: transparent shield, theme variants for the toolbar, neutral icon for about:addons and AMO", async () => {
  const { contrast, UI_CONTRAST } = await import("../src/lib/appearance.js");
  const m = json("manifest.json");
  const svg = (p) => readFileSync(join(SRC, p), "utf8");
  const colours = (p) => [...new Set(svg(p).match(/#[0-9a-f]{6}/gi))];
  // MDN: "light" is the icon for dark themes, "dark" the one for light themes.
  assert.deepEqual(m.action.theme_icons, [16, 32].map((size) => ({ light: "icons/shield-light.svg", dark: "icons/shield-dark.svg", size })));
  assert.equal(m.action.default_icon, "icons/shield-dark.svg");
  assert.deepEqual(m.icons, { 48: "icons/icon.svg", 96: "icons/icon.svg" });
  const LIGHT_BAR = "#f9f9fb", DARK_BAR = "#2b2a33"; // Firefox default toolbar backgrounds
  for (const [file, bg] of [["icons/shield-dark.svg", LIGHT_BAR], ["icons/shield-light.svg", DARK_BAR]]) {
    assert.doesNotMatch(svg(file), /<rect/, `${file}: transparent, no tile`);
    const [c, ...rest] = colours(file);
    assert.equal(rest.length, 0, `${file}: monochrome`);
    assert.ok(contrast(c, bg) >= UI_CONTRAST, `${file}: ${c} on ${bg}`);
  }
  const [n, ...rest] = colours("icons/icon.svg");
  assert.equal(rest.length, 0, "icon.svg: one neutral colour");
  for (const bg of ["#ffffff", LIGHT_BAR, DARK_BAR, "#1c1b22"]) assert.ok(contrast(n, bg) >= UI_CONTRAST, `icon.svg: ${n} on ${bg}`);
});

test("popup settings button: gear icon, keeps its label, tooltip and button semantics", () => {
  const html = readFileSync(join(SRC, "popup/popup.html"), "utf8");
  const btn = html.match(/<button id="settings"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn, "settings button");
  assert.match(btn[0], /class="icon-btn" type="button" data-i18n-attr="title:settings;aria-label:settings"/);
  assert.match(btn[1], /aria-hidden="true"/);
  assert.match(btn[1], /fill-rule="evenodd"/, "gear with a hole");
  assert.equal((btn[1].match(/L/g) ?? []).length, 23, "six teeth: 24 outline points");
});
