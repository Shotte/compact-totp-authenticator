// Phase D1/D2: the release audit fails on each kind of violation, and the signing-source
// preparation refuses unsafe parameters. No network; temporary copies of src/ only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const audit = (dir) => spawnSync(process.execPath, [join(root, "scripts/check-release.mjs"), dir], { encoding: "utf8" });

function copy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "cta-release-"));
  cpSync(join(root, "src"), dir, { recursive: true });
  mutate?.(dir);
  return dir;
}
const manifest = (dir, change) => {
  const f = join(dir, "manifest.json"), m = JSON.parse(readFileSync(f, "utf8"));
  change(m);
  writeFileSync(f, JSON.stringify(m));
};
const append = (dir, file, text) => writeFileSync(join(dir, file), readFileSync(join(dir, file), "utf8") + text);

test("release audit passes on src/", () => {
  const r = audit(join(root, "src"));
  assert.equal(r.status, 0, r.stdout);
});

const lint = (dir) => spawnSync(process.execPath, [join(root, "scripts/lint.mjs"), dir], { encoding: "utf8" });

test("lint accepts only the desktop-only Android note", () => {
  const ok = lint(join(root, "src"));
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /accepted: 1/);
  const other = copy((d) => append(d, "lib/ui.js", "\neval(\"1\");\n"));
  try {
    const r = lint(other);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL DANGEROUS_EVAL/);
  } finally { rmSync(other, { recursive: true, force: true }); }
});

const CASES = [
  ["changed extension ID", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.id = "other@example"; }), /FAIL\s+extension ID/],
  ["extra permission", (d) => manifest(d, (m) => { m.permissions.push("tabs"); }), /FAIL\s+permissions exactly/],
  ["host permissions", (d) => manifest(d, (m) => { m.host_permissions = ["<all_urls>"]; }), /FAIL\s+no host_permissions/],
  ["plain-http update_url", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.update_url = "http://example.org/u.json"; }), /FAIL\s+update_url/],
  ["lower strict_min_version", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.strict_min_version = "128.0"; }), /FAIL\s+strict_min_version/],
  ["Android declaration", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko_android = {}; }), /FAIL\s+desktop only/],
  ["console call", (d) => append(d, "lib/ui.js", "\nconsole.log(1);\n"), /FAIL\s+no console/],
  ["remote fetch", (d) => append(d, "lib/ui.js", "\nfetch(\"https://example.org\");\n"), /FAIL\s+no remote resources/],
  ["Base32 secret in code", (d) => append(d, "lib/ui.js", `\nconst s = "${"MZXW6YTB".repeat(3)}";\n`), /FAIL\s+no Base32/],
  ["synthetic fixture marker", (d) => append(d, "lib/ui.js", "\n// CTA-SYNTHETIC-000001\n"), /FAIL\s+no synthetic test markers/],
  ["test file in the package", (d) => { mkdirSync(join(d, "test")); writeFileSync(join(d, "test/a.test.js"), ""); }, /FAIL\s+no test, fixture/],
  ["changed LICENSE", (d) => append(d, "LICENSE", "\nextra\n"), /FAIL\s+LICENSE identical/],
  ["0.x without the development notice", (d) => manifest(d, (m) => { m.version = "0.9.9"; }), /FAIL\s+0\.x: development notice/],
  ["1.0 with the localhost test update_url", (d) => manifest(d, (m) => { m.version = "1.0.0"; m.browser_specific_settings.gecko.update_url = "https://127.0.0.1:47811/updates.json"; }), /FAIL\s+1\.x: no update_url/],
  ["1.0 with any self-hosted update_url", (d) => manifest(d, (m) => { m.version = "1.0.0"; m.browser_specific_settings.gecko.update_url = "https://example.org/u.json"; }), /FAIL\s+1\.x: no update_url/],
  ["embedded certificate", (d) => append(d, "lib/ui.js", "\n// -----BEGIN CERTIFICATE-----\n"), /FAIL\s+no keys, certificates/],
  ["1.0 with the development notice still present", (d) => writeFileSync(join(d, "options/options.html"),
    readFileSync(join(d, "options/options.html"), "utf8").replace("</header>", "</header>\n    <p id=\"devNotice\" class=\"note\" data-i18n=\"devNotice\"></p>")), /FAIL\s+1\.x: development notice/],
];
for (const [label, mutate, expected] of CASES) {
  test(`release audit fails: ${label}`, () => {
    const dir = copy(mutate);
    try {
      const r = audit(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, expected);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("verify-signed accepts the prepared files plus AMO signature files and nothing else", async () => {
  const { default: JSZip } = await import("jszip");
  const { createHash } = await import("node:crypto");
  const base = mkdtempSync(join(tmpdir(), "cta-signed-"));
  try {
    const src = join(base, "source");
    cpSync(join(root, "src"), src, { recursive: true });
    manifest(src, (m) => { m.version = "0.9.0"; m.browser_specific_settings.gecko.update_url = "https://127.0.0.1:47811/updates.json"; });
    const files = ["manifest.json", "LICENSE", "popup/popup.js"]; // a subset is enough for the check
    const sum = (f) => createHash("sha256").update(readFileSync(join(src, f))).digest("hex");
    writeFileSync(join(base, "SHA256SUMS"), files.map((f) => `${sum(f)}  ${f}`).join("\n") + "\n");
    writeFileSync(join(base, "release-source.json"), JSON.stringify({ version: "0.9.0", updateUrl: "https://127.0.0.1:47811/updates.json", sourceCommit: "x", purpose: "test" }));
    const xpi = async (change = (z) => z) => {
      const z = new JSZip();
      for (const f of files) z.file(f, readFileSync(join(src, f)));
      z.file("META-INF/mozilla.rsa", "sig"); z.file("META-INF/cose.sig", "sig"); z.file("META-INF/manifest.mf", "mf");
      change(z);
      const p = join(base, `t${Math.random()}.xpi`);
      writeFileSync(p, await z.generateAsync({ type: "nodebuffer" }));
      return spawnSync(process.execPath, [join(root, "scripts/verify-signed.mjs"), p, base], { encoding: "utf8" });
    };
    const ok = await xpi();
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /SHA-256 [0-9a-f]{64}/);
    // Signing strips the manifest's trailing whitespace: accepted, the JSON is identical.
    const mText = readFileSync(join(src, "manifest.json"), "utf8");
    const ws = await xpi((z) => z.file("manifest.json", JSON.stringify(JSON.parse(mText), null, 2)));
    assert.equal(ws.status, 0, ws.stdout);
    for (const [label, change, expected] of [
      ["changed manifest value", (z) => z.file("manifest.json", JSON.stringify({ ...JSON.parse(mText), permissions: ["storage", "alarms", "activeTab", "tabs"] })), /FAIL\s+every prepared file/],
      ["changed file", (z) => z.file("popup/popup.js", "changed"), /FAIL\s+every prepared file/],
      ["missing file", (z) => z.remove("LICENSE"), /FAIL\s+every prepared file/],
      ["extra file", (z) => z.file("extra.js", "x"), /FAIL\s+no extra files/],
      ["unsigned", (z) => z.remove("META-INF/mozilla.rsa"), /FAIL\s+AMO signature files/],
    ]) {
      const r = await xpi(change);
      assert.equal(r.status, 1, label);
      assert.match(r.stdout, expected, label);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("release:source refuses unsafe parameters and never signs", () => {
  const run = (...a) => spawnSync(process.execPath, [join(root, "scripts/release-source.mjs"), ...a], { encoding: "utf8" });
  for (const [args, msg] of [
    [["--version", "0.9"], /--version major\.minor\.patch/],
    [["--version", "0.9.0"], /choose exactly one/],
    [["--version", "1.0.0", "--update-url", "https://127.0.0.1:47811/updates.json"], /choose exactly one/],
    [["--version", "1.0.0", "--test-update"], /below 1\.0\.0/],
    [["--version", "0.0.1", "--no-update-url"], /lower than src/],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, msg, args.join(" "));
  }
  // Signed artifacts of a version are never deleted by preparing it again.
  const signedDir = join(root, "dist/signing/9.9.99/signed");
  mkdirSync(signedDir, { recursive: true });
  writeFileSync(join(signedDir, "keep.xpi"), "signed");
  try {
    const r = run("--version", "9.9.99", "--no-update-url");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /signed artifacts are kept/);
    assert.equal(readFileSync(join(signedDir, "keep.xpi"), "utf8"), "signed");
  } finally { rmSync(join(root, "dist/signing/9.9.99"), { recursive: true, force: true }); }
  const src = readFileSync(join(root, "scripts/release-source.mjs"), "utf8");
  assert.doesNotMatch(src.replace(/console\.log\([^)]*\);/g, ""), /web-ext\.js"\),?\s*"sign"|\["sign"/, "the script itself never runs web-ext sign");
});
