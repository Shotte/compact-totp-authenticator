// Release package audit (Phase D1). Checks an extension source directory (default: src/, or
// the output of scripts/release-source.mjs) before building or signing. No network, no
// dependencies. Exit code 1 on any failure; every check is printed.
// Usage: node scripts/check-release.mjs [dir]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2] ?? join(root, "src"));
export const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` – ${detail}` : ""}`); };

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p); else files.push(relative(dir, p).replace(/\\/g, "/"));
  }
})(dir);
const text = (f) => readFileSync(join(dir, f), "utf8");
const m = JSON.parse(text("manifest.json"));
const g = m.browser_specific_settings?.gecko ?? {};

// Manifest
check("manifest_version 3", m.manifest_version === 3);
check("extension ID unchanged", g.id === EXT_ID, g.id);
check("version is numeric major.minor.patch", /^\d+\.\d+\.\d+$/.test(m.version), m.version);
check("strict_min_version 140.0 (data_collection_permissions needs 140)", g.strict_min_version === "140.0", g.strict_min_version);
check("desktop only: no gecko_android (Android is not supported)", !("gecko_android" in (m.browser_specific_settings ?? {})));
check("data_collection_permissions: required none", JSON.stringify(g.data_collection_permissions) === JSON.stringify({ required: ["none"] }));
check("permissions exactly storage, alarms, activeTab", JSON.stringify(m.permissions) === JSON.stringify(["storage", "alarms", "activeTab"]), JSON.stringify(m.permissions));
check("optional_permissions exactly idle", JSON.stringify(m.optional_permissions ?? []) === JSON.stringify(["idle"]));
for (const k of ["host_permissions", "content_scripts", "web_accessible_resources", "externally_connectable", "content_security_policy"]) {
  check(`no ${k}`, !(k in m));
}
check("update_url absent or HTTPS", g.update_url === undefined || /^https:\/\//.test(g.update_url), g.update_url ?? "absent");
// Only the 0.9.x signed-update test builds carry an update_url (127.0.0.1). 1.x is AMO Listed
// with Mozilla-managed updates (distribution decision, RELEASE.md §4), so it must have none.
const major = Number(m.version.split(".")[0]);
if (major >= 1) check("1.x: no update_url (AMO Listed, Mozilla-managed updates)", g.update_url === undefined, g.update_url ?? "absent");
check("localized name and description", m.name === "__MSG_extName__" && m.description === "__MSG_extDescription__");

// Files
const allowed = new Set([".js", ".html", ".css", ".json", ".svg"]);
const odd = files.filter((f) => f !== "LICENSE" && !allowed.has(extname(f)));
check("only extension files (js, html, css, json, svg, LICENSE)", odd.length === 0, odd.join(", "));
const devPaths = files.filter((f) => /(^|\/)(test|tests|fixtures|spikes|helpers|node_modules)\/|\.test\.|\.map$|(^|\/)\./.test(f));
check("no test, fixture, source-map or hidden files", devPaths.length === 0, devPaths.join(", "));
check("LICENSE identical to the repository MIT license", files.includes("LICENSE") && text("LICENSE") === readFileSync(join(root, "LICENSE"), "utf8"));
check("MIT license with both copyright notices", /MIT License/.test(text("LICENSE")) && /Rayquaza01/.test(text("LICENSE")));

// Content
const code = files.filter((f) => /\.(js|html|css|json)$/.test(f)).map((f) => [f, text(f)]);
const hits = (re) => code.filter(([, s]) => re.test(s)).map(([f]) => f);
check("no console or debugger statements", hits(/\bconsole\.|\bdebugger\b/).length === 0, hits(/\bconsole\.|\bdebugger\b/).join(", "));
check("no eval or new Function", hits(/\beval\(|new Function\(/).length === 0);
// Remote loading or network calls (a URL used only for hostname matching is not one).
const REMOTE = /(src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|import\s[^;]*from\s*["']https?:|import\(\s*["']https?:|\bfetch\(|XMLHttpRequest|new WebSocket\(|sendBeacon\(/;
check("no remote resources or network calls", hits(REMOTE).length === 0, hits(REMOTE).join(", "));
check("no synthetic test markers", hits(/CTA-SYNTHETIC|fixture-\d|correct horse battery/i).length === 0, hits(/CTA-SYNTHETIC|fixture-\d|correct horse battery/i).join(", "));
const b32 = code.flatMap(([f, s]) => (s.match(/\b[A-Z2-7]{16,}={0,6}\b/g) ?? []).filter((x) => x !== "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567").map((x) => `${f}:${x.slice(0, 6)}…`));
check("no Base32 secret-like strings (16+ chars)", b32.length === 0, b32.join(", "));
check("no keys, certificates or credentials", hits(/BEGIN [A-Z ]*PRIVATE KEY|BEGIN CERTIFICATE|WEB_EXT_API_(KEY|SECRET)\s*[=:]\s*\S|jwt[_-]?secret/i).length === 0);
check("no development unlock", hits(/devUnlock|unlockDemo/).length === 0);

// Release gate: the 0.x development notice
const notice = /id="devNotice"/.test(text("options/options.html"));
if (major === 0) check("0.x: development notice shown on the options page", notice);
else check("1.x: development notice removed by an explicit release decision", !notice, notice ? "still present: remove it only with the 1.0 release decision (RELEASE.md §5)" : "");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks OK (${relative(root, dir) || "."}, version ${m.version})`);
process.exitCode = failed ? 1 : 0;
