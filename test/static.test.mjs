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
  assert.deepEqual([...m.permissions].sort(), ["activeTab", "alarms", "storage"]);
  for (const k of ["host_permissions", "optional_permissions", "content_scripts", "web_accessible_resources",
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
  for (const [f, src] of pages) assert.doesNotMatch(src, /service\.js|crypto\.js|fixtures\.js|totp\.js|vault\.js/, f);
});

test("release gate: the development-only demo unlock cannot ship in a 1.x release", () => {
  const major = Number(json("manifest.json").version.split(".")[0]);
  const users = stripped.filter(([, src]) => /devUnlock|unlockDemo/.test(src)).map(([f]) => f);
  if (major >= 1) assert.deepEqual(users, [], "remove devUnlock (Phase C master password) before 1.0.0");
  else assert.ok(major === 0, "pre-release versions only");
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
