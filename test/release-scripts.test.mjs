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

const CASES = [
  ["changed extension ID", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.id = "other@example"; }), /FAIL\s+extension ID/],
  ["extra permission", (d) => manifest(d, (m) => { m.permissions.push("tabs"); }), /FAIL\s+permissions exactly/],
  ["host permissions", (d) => manifest(d, (m) => { m.host_permissions = ["<all_urls>"]; }), /FAIL\s+no host_permissions/],
  ["plain-http update_url", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.update_url = "http://example.org/u.json"; }), /FAIL\s+update_url/],
  ["lower strict_min_version", (d) => manifest(d, (m) => { m.browser_specific_settings.gecko.strict_min_version = "128.0"; }), /FAIL\s+strict_min_version/],
  ["console call", (d) => append(d, "lib/ui.js", "\nconsole.log(1);\n"), /FAIL\s+no console/],
  ["remote fetch", (d) => append(d, "lib/ui.js", "\nfetch(\"https://example.org\");\n"), /FAIL\s+no remote resources/],
  ["Base32 secret in code", (d) => append(d, "lib/ui.js", `\nconst s = "${"MZXW6YTB".repeat(3)}";\n`), /FAIL\s+no Base32/],
  ["synthetic fixture marker", (d) => append(d, "lib/ui.js", "\n// CTA-SYNTHETIC-000001\n"), /FAIL\s+no synthetic test markers/],
  ["test file in the package", (d) => { mkdirSync(join(d, "test")); writeFileSync(join(d, "test/a.test.js"), ""); }, /FAIL\s+no test, fixture/],
  ["changed LICENSE", (d) => append(d, "LICENSE", "\nextra\n"), /FAIL\s+LICENSE identical/],
  ["development notice removed in 0.x", (d) => writeFileSync(join(d, "options/options.html"),
    readFileSync(join(d, "options/options.html"), "utf8").replace(/<p id="devNotice"[^>]*><\/p>/, "")), /FAIL\s+0\.x: development notice/],
  ["1.0 with the development notice still present", (d) => manifest(d, (m) => { m.version = "1.0.0"; }), /FAIL\s+1\.x: development notice/],
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

test("release:source refuses unsafe parameters and never signs", () => {
  const run = (...a) => spawnSync(process.execPath, [join(root, "scripts/release-source.mjs"), ...a], { encoding: "utf8" });
  for (const [args, msg] of [
    [["--version", "0.9"], /--version major\.minor\.patch/],
    [["--version", "0.9.0"], /choose exactly one/],
    [["--version", "0.9.0", "--update-url", "http://example.org/u.json"], /HTTPS/],
    [["--version", "1.0.0", "--test-update"], /below 1\.0\.0/],
    [["--version", "0.0.1", "--no-update-url"], /lower than src/],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, msg, args.join(" "));
  }
  const src = readFileSync(join(root, "scripts/release-source.mjs"), "utf8");
  assert.doesNotMatch(src.replace(/console\.log\([^)]*\);/g, ""), /web-ext\.js"\),?\s*"sign"|\["sign"/, "the script itself never runs web-ext sign");
});
