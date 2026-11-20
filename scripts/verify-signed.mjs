// Checks a signed XPI returned by AMO against the prepared signing source (Phase D).
// Usage: node scripts/verify-signed.mjs <signed.xpi> <dist/signing/<version>>
//
// PASS needs: every file of the prepared source (SHA256SUMS) in the XPI with the same hash,
// no other files except AMO's signature files in META-INF/, the signature files present,
// the fixed extension ID and the expected version and update_url. Prints the XPI's SHA-256
// for the record. Whether the signature is valid is decided by Firefox itself: the signed
// update test requires signedState >= 2 for both builds (test/browser/update-test.mjs U-1).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// shortcut: jszip comes with web-ext (direct dependency); add it to devDependencies if web-ext drops it.
import JSZip from "jszip";

// The permanent ID; scripts/check-release.mjs guards that src/ keeps it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_ID = JSON.parse(readFileSync(join(root, "src/manifest.json"), "utf8")).browser_specific_settings.gecko.id;

const [xpiPath, base] = process.argv.slice(2);
if (!xpiPath || !base) { console.error("usage: node scripts/verify-signed.mjs <signed.xpi> <dist/signing/<version>>"); process.exit(2); }
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` – ${detail}` : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const xpi = readFileSync(xpiPath);
const info = JSON.parse(readFileSync(join(base, "release-source.json"), "utf8"));
const expected = new Map(readFileSync(join(base, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => { const [h, f] = l.split(/\s+/, 2); return [f, h]; }));
const zip = await JSZip.loadAsync(xpi);
const entries = Object.values(zip.files).filter((e) => !e.dir);
const actual = new Map(await Promise.all(entries.map(async (e) => [e.name, sha(await e.async("nodebuffer"))])));

const SIG = /^META-INF\/(manifest\.mf|mozilla\.sf|mozilla\.rsa|cose\.manifest|cose\.sig)$/;
const changed = [...expected].filter(([f, h]) => actual.get(f) !== h).map(([f]) => f);
const extra = [...actual.keys()].filter((f) => !expected.has(f) && !SIG.test(f));
check("every prepared file present and byte-identical", changed.length === 0, changed.join(", "));
check("no extra files besides the AMO signature", extra.length === 0, extra.join(", "));
check("AMO signature files present (META-INF/mozilla.rsa, META-INF/cose.sig)", actual.has("META-INF/mozilla.rsa") && actual.has("META-INF/cose.sig"));
let m = {};
try { m = JSON.parse(await zip.file("manifest.json").async("string")); } catch { /* reported below */ }
const g = m.browser_specific_settings?.gecko ?? {};
check("extension ID unchanged", g.id === EXT_ID, g.id);
check(`version ${info.version}`, m.version === info.version, m.version);
check("update_url as prepared", (g.update_url ?? null) === info.updateUrl, g.update_url ?? "absent");

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks OK – ${xpiPath}\nSHA-256 ${sha(xpi)}\nsource commit ${info.sourceCommit}, purpose: ${info.purpose}`);
process.exitCode = failed ? 1 : 0;
