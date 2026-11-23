// web-ext lint with warnings treated as errors, except one known false positive.
//
//   node scripts/lint.mjs [source-dir] [extra web-ext lint args, e.g. --self-hosted]
//
// CTA is desktop only: the manifest has no gecko_android, so AMO does not list it for
// Firefox for Android. The linter still applies gecko.strict_min_version (140, kept for
// ESR 140) to Android, where data_collection_permissions needs 142, and warns. Only that
// exact warning is accepted, and only while gecko_android is absent. Any other warning or
// error fails.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [dir = "src", ...extra] = process.argv.slice(2);
const src = resolve(root, dir);
const m = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const desktopOnly = !("gecko_android" in (m.browser_specific_settings ?? {}));

const r = spawnSync(process.execPath, [join(root, "node_modules/web-ext/bin/web-ext.js"), "lint",
  "--source-dir", src, "--output", "json", ...extra], { cwd: root, encoding: "utf8" });
let report;
try { report = JSON.parse(r.stdout); } catch { console.error(`lint: no JSON report\n${r.stdout}${r.stderr}`); process.exit(1); }

const accepted = (w) => desktopOnly && w.code === "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION"
  && /data_collection_permissions/.test(w.description ?? "");
const failing = [...report.errors, ...report.warnings.filter((w) => !accepted(w))];
const skipped = report.warnings.length - (failing.length - report.errors.length);

console.log(`errors ${report.errors.length}, warnings ${report.warnings.length} (accepted: ${skipped}, desktop-only Android min version), notices ${report.notices.length}`);
for (const x of failing) console.log(`FAIL ${x.code} ${x.file ?? ""}: ${x.message}`);
process.exit(failing.length ? 1 : 0);
