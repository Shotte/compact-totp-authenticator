// Prepares the exact source directory that is submitted for AMO unlisted signing (Phase D2).
// It does NOT sign, upload or publish anything and needs no credentials or network.
//
//   npm run release:source -- --version 0.9.0 --test-update
//       update_url https://127.0.0.1:47811/updates.json: builds for the signed update test
//       (test/browser/update-test.mjs --old/--new). They never update from the internet.
//   npm run release:source -- --version 1.0.0 --no-update-url
//       the AMO Listed distribution build: no update_url, Mozilla manages updates
//       (distribution decision, RELEASE.md §4). check-release.mjs refuses any 1.x update_url.
//
// Output: dist/signing/<version>/source (manifest with version and update_url), a SHA-256
// list of every file, and the signing command to run by hand (docs/SIGNING.md). Then:
// web-ext lint --self-hosted and scripts/check-release.mjs on the result.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (msg) => { console.error(`release:source: ${msg}`); process.exit(1); };

const version = arg("--version");
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail("--version major.minor.patch is required");
if (argv.includes("--test-update") === argv.includes("--no-update-url") || argv.includes("--update-url")) fail("choose exactly one of --test-update, --no-update-url");
const TEST_UPDATE_URL = "https://127.0.0.1:47811/updates.json";
const updateUrl = argv.includes("--test-update") ? TEST_UPDATE_URL : undefined;

const srcManifest = JSON.parse(readFileSync(join(root, "src/manifest.json"), "utf8"));
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
if (cmp(version, srcManifest.version) < 0) fail(`version ${version} is lower than src/manifest.json (${srcManifest.version})`);
if (Number(version.split(".")[0]) >= 1 && updateUrl === TEST_UPDATE_URL) fail("test-update builds must stay below 1.0.0");

const base = join(root, "dist/signing", version);
const out = join(base, "source");
if (existsSync(base)) rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
cpSync(join(root, "src"), out, { recursive: true });
const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
m.version = version;
if (updateUrl) m.browser_specific_settings.gecko.update_url = updateUrl;
else delete m.browser_specific_settings.gecko.update_url;
writeFileSync(join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
const lint = run(process.execPath, [join(root, "node_modules/web-ext/bin/web-ext.js"), "lint", "--source-dir", out, "--self-hosted", "--warnings-as-errors"]);
process.stdout.write(lint.stdout.split("\n").filter((l) => /errors|warnings|notices/.test(l)).join("\n") + "\n");
if (lint.status !== 0) fail(`web-ext lint --self-hosted failed:\n${lint.stdout}${lint.stderr}`);
const audit = run(process.execPath, [join(root, "scripts/check-release.mjs"), out]);
process.stdout.write(audit.stdout.split("\n").filter((l) => /FAIL|checks OK/.test(l)).join("\n") + "\n");
if (audit.status !== 0) fail(`scripts/check-release.mjs failed:\n${audit.stdout}`);

const files = [];
(function walk(d) { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(out);
const sums = files.map((p) => `${createHash("sha256").update(readFileSync(p)).digest("hex")}  ${relative(out, p).replace(/\\/g, "/")}`);
writeFileSync(join(base, "SHA256SUMS"), sums.join("\n") + "\n");
const git = run("git", ["rev-parse", "HEAD"]).stdout.trim();
const dirty = run("git", ["status", "--porcelain", "--", "src"]).stdout.trim() !== "";
const info = { version, updateUrl: updateUrl ?? null, purpose: updateUrl ? "signed update test only (unlisted)" : "AMO Listed distribution",
  sourceCommit: git, srcHasUncommittedChanges: dirty, files: files.length, preparedAt: new Date().toISOString() };
writeFileSync(join(base, "release-source.json"), JSON.stringify(info, null, 2) + "\n");

console.log(`\nPrepared ${relative(root, out)} (${files.length} files, commit ${git.slice(0, 7)}${dirty ? ", src has UNCOMMITTED changes" : ""}).`);
console.log(`update_url: ${updateUrl ?? "(none)"}`);
console.log("\nNothing was signed. To sign (operator, after authorization). web-ext reads WEB_EXT_API_KEY and");
console.log("WEB_EXT_API_SECRET from the environment, so the credentials never appear on the command line:");
if (!updateUrl) console.log("  LISTED = PUBLIC SUBMISSION. Only with the operator's explicit 1.0 release approval (docs/SIGNING.md §7).");
console.log(`  npx web-ext sign --channel ${updateUrl ? "unlisted" : "listed"} --source-dir ${relative(root, out).replace(/\\/g, "/")} --artifacts-dir ${relative(root, join(base, "signed")).replace(/\\/g, "/")}`);
if (dirty) process.exitCode = 1; // never sign uncommitted sources
