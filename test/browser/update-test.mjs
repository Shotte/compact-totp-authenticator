// C6.2 – extension update test through Firefox's real add-on update path.
//
// What this is: a LOCAL, UNSIGNED upgrade simulation. Version 0.1.0 is installed PERMANENTLY
// (AddonManager, not a temporary add-on) and updated to 0.1.1 by AddonManager.findUpdates():
// update_url → updates.json → download → install, the same path a signed self-distributed
// update takes. It needs a Firefox build that honours xpinstall.signatures.required=false
// (ESR, Developer Edition, Nightly). Release Firefox refuses unsigned permanent installs; the
// script then reports NOT_TESTED instead of guessing.
//
// What this is not: a signed-extension update. Signature verification is switched off in
// this throwaway profile, so the release-blocking signed-update test (PLAN-C4-C6.md §4)
// stays NOT_TESTED until signed builds exist (Phase D, needs operator authorization).
//
// Synthetic accounts and passwords only. Writes results to $RESULTS_DIR/update-results.json.
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { launchFirefox, sleep } from "./bidi.mjs";
import { exportRoundTripAccounts } from "../helpers/fixtures.mjs";
import { totp } from "../../src/lib/totp.js";
import { decodeBase32 } from "../../src/lib/base32.js";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.RESULTS_DIR ? resolve(process.env.RESULTS_DIR) : join(root, "docs/evidence/phase-c6");
const FIREFOX = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.FIREFOX_BIN
  ?? { win32: "C:/Program Files/Mozilla Firefox/firefox.exe", darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const PW = "update test passphrase 2026 ✓"; // synthetic
const ACCOUNTS = exportRoundTripAccounts();
const SETTINGS = { ...DEFAULT_SETTINGS, theme: "dark", fontSize: 14, rowHeight: 25, autoLockMinutes: 30 };
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";
const AM = "ChromeUtils.importESModule(\"resource://gre/modules/AddonManager.sys.mjs\").AddonManager";

const results = [];
const record = (id, name, pass, details) => { results.push({ id, name, verdict: pass ? "PASS" : "FAIL", details }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}`); };
const notTested = (id, name, reason) => { results.push({ id, name, verdict: "NOT_TESTED", details: { reason } }); console.log(`NOT_TESTED  ${id}  ${name} (${reason})`); };

// 1. Two unsigned packages from src/, differing only in version; both carry the test update_url.
const work = mkdtempSync(join(tmpdir(), "cta-update-"));
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const UPDATE_URL = `http://127.0.0.1:${PORT}/updates.json`;
function build(version) {
  const dir = join(work, `src-${version}`);
  cpSync(join(root, "src"), dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  m.version = version;
  m.browser_specific_settings.gecko.update_url = UPDATE_URL;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2));
  const out = join(work, "xpi");
  const name = `cta-${version}.xpi`;
  const r = spawnSync(process.execPath, [join(root, "node_modules/web-ext/bin/web-ext.js"), "build", "--source-dir", dir,
    "--artifacts-dir", out, "--filename", name, "--overwrite-dest"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`web-ext build ${version}: ${r.stderr || r.stdout}`);
  return join(out, name);
}
const OLD = build("0.1.0"), NEW = build("0.1.1");
const newBytes = readFileSync(NEW);
let updateRequests = 0, xpiRequests = 0;
server.on("request", (req, res) => {
  if (req.url.startsWith("/updates.json")) {
    updateRequests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ addons: { [EXT_ID]: { updates: [{ version: "0.1.1",
      update_link: `http://127.0.0.1:${PORT}/cta-0.1.1.xpi`,
      update_hash: `sha256:${createHash("sha256").update(newBytes).digest("hex")}` }] } } }));
  } else if (req.url === "/cta-0.1.1.xpi") {
    xpiRequests++;
    res.setHeader("Content-Type", "application/x-xpinstall");
    res.end(newBytes);
  } else { res.statusCode = 404; res.end(); }
});

const PREFS = {
  "xpinstall.signatures.required": false,         // honoured by ESR/Developer/Nightly only
  "extensions.checkUpdateSecurity": false,        // plain-http update_url on 127.0.0.1
  "extensions.install.requireBuiltInCerts": false,
  "extensions.update.requireBuiltInCerts": false,
  "extensions.update.enabled": true,
  "extensions.autoDisableScopes": 0,
  "extensions.background.idle.timeout": 3000,
  "intl.locale.requested": "de",
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.sessionstore.resume_from_crash": false,
};

let ff = await launchFirefox({ firefox: FIREFOX, prefs: PREFS, port: 9336 });
const call = (m, p) => ff.call(m, p);
async function evalIn(ctx, src) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true,
    expression: `(${src})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}
const chrome = async () => (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0]?.context;
const addonInfo = (ctx) => evalIn(ctx, `async () => { const a = await ${AM}.getAddonByID(${JSON.stringify(EXT_ID)});
  if (!a) return null;
  const uuids = JSON.parse(${SVC}.prefs.getStringPref("extensions.webextensions.uuids", "{}"));
  return { id: a.id, version: a.version, isActive: a.isActive, temporary: a.temporarilyInstalled, signedState: a.signedState,
    scope: a.scope, uuid: uuids[${JSON.stringify(EXT_ID)}] ?? null }; }`);
let page;
async function openPage(uuid) {
  page ??= (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.navigate", { context: page, url: `moz-extension://${uuid}/options/options.html`, wait: "complete" });
}
async function msg(cmd, args = {}) {
  for (let i = 1; ; i++) {
    try { return await evalIn(page, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`); }
    catch (e) { if (i >= 5 || !/Receiving end does not exist|eval:/.test(e.message)) throw e; await sleep(500); }
  }
}
const storageLocal = () => evalIn(page, "async () => browser.storage.local.get()");
const plain = async () => (await msg("exportVault", { kind: "plain", password: PW, confirmed: true })).result;
// Codes from the extension must equal RFC 6238 codes computed here for the same instant.
async function codesMatch() {
  const r = await msg("getCodes");
  if (!r.ok) return { ok: false, error: r.error };
  const list = (await msg("listAccounts")).result.accounts;
  const byId = new Map(list.map((a) => [a.id, a]));
  const bad = [];
  for (const c of r.result.codes) {
    const a = byId.get(c.id), src = ACCOUNTS.find((x) => x.name === a.name);
    const t = c.validUntil - 1; // inside the window the extension used
    const want = (await totp(decodeBase32(src.secret), { time: t, period: a.period, digits: a.digits, algorithm: a.algorithm })).code;
    if (want !== c.code) bad.push(a.name);
  }
  return { ok: bad.length === 0 && r.result.codes.length === ACCOUNTS.length, count: r.result.codes.length, mismatches: bad };
}

const evidence = { startedAt: new Date().toISOString(), kind: "local unsigned upgrade via the AddonManager update path (not a signed update)" };
try {
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = { version: s.capabilities.browserVersion, platform: s.capabilities.platformName };
  let top = await chrome();
  const privileged = top ? await evalIn(top, "async () => typeof ChromeUtils !== \"undefined\"").catch(() => false) : false;
  if (!privileged) throw Object.assign(new Error("chrome scope unavailable"), { notTested: "harness: privileged chrome scope unavailable in this Firefox version" });

  // 2. Permanent install of 0.1.0 (no temporary add-on).
  const installed = await evalIn(top, `async () => { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(${JSON.stringify(OLD)});
    try { const i = await ${AM}.getInstallForFile(f); if (i.error) return { error: i.error };
      const a = await i.install(); return { ok: true, version: a.version }; }
    catch (e) { return { error: String(e?.message ?? e) }; } }`);
  const before = await addonInfo(top);
  if (!installed?.ok || !before) {
    throw Object.assign(new Error("install"), { notTested: `this Firefox refuses an unsigned permanent install (${JSON.stringify(installed)}); needs ESR, Developer Edition or Nightly` });
  }
  record("U-1", "0.1.0 installed permanently (not a temporary add-on), unsigned, active",
    before.version === "0.1.0" && before.temporary === false && before.isActive && !!before.uuid, { addon: before });

  // 3. Synthetic vault, custom order and settings.
  await openPage(before.uuid);
  await sleep(500);
  if (!(await msg("setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
  let revision = 1;
  for (const account of ACCOUNTS) revision = (await msg("addAccount", { revision, account })).result.revision;
  const ids = (await msg("listAccounts")).result.accounts.map((a) => a.id);
  revision = (await msg("moveAccount", { id: ids.at(-1), toIndex: 0, revision })).result.revision; // non-default order
  await evalIn(page, `async () => browser.storage.local.set({ settings: ${JSON.stringify(SETTINGS)} })`);
  const listBefore = (await msg("listAccounts")).result;
  const storeBefore = await storageLocal();
  const plainBefore = await plain();

  // 4. The update itself: AddonManager.findUpdates → updates.json → download → install.
  const upd = await evalIn(top, `async () => { const AM = ${AM}; const a = await AM.getAddonByID(${JSON.stringify(EXT_ID)});
    const install = await new Promise((res) => a.findUpdates({
      onUpdateAvailable: (_a, i) => res(i), onNoUpdateAvailable: () => res(null) }, AM.UPDATE_WHEN_USER_REQUESTED));
    if (!install) return { found: false };
    try { const n = await install.install(); return { found: true, version: n?.version, state: install.state, error: install.error }; }
    catch (e) { return { found: true, error: String(e?.message ?? e), state: install.state }; } }`);
  let after = null;
  for (let i = 0; i < 40; i++) { after = await addonInfo(top); if (after?.version === "0.1.1" && after.isActive) break; await sleep(250); }
  record("U-2", "update found through update_url and installed by AddonManager (updates.json fetched, XPI downloaded, hash checked)",
    upd.found === true && after?.version === "0.1.1" && after.isActive && updateRequests > 0 && xpiRequests > 0,
    { update: upd, addon: after, updateRequests, xpiRequests });
  record("U-3", "extension ID and moz-extension UUID unchanged; still a permanent install",
    after?.id === before.id && after.uuid === before.uuid && after.temporary === false, { before, after });

  // 5. Data after the update (event page restarted with the new code). Firefox closes the
  // extension's tabs when it replaces the add-on, so a new tab is opened.
  page = undefined;
  await openPage(after.uuid);
  await sleep(800);
  const storeAfter = await storageLocal();
  record("U-4", "storage.local unchanged by the update: encrypted vault, backup and settings byte-identical, nothing reinitialized",
    same(storeAfter, storeBefore) && !!storeAfter.vault && same(storeAfter.settings, SETTINGS),
    { keysBefore: Object.keys(storeBefore).sort(), keysAfter: Object.keys(storeAfter).sort(), vaultRevision: storeAfter.vault?.revision });
  const statusAfter = (await msg("status")).result;
  const wrong = await msg("unlock", { password: PW + "x" });
  const unlock = await msg("unlock", { password: PW });
  const listAfter = (await msg("listAccounts")).result;
  record("U-5", "after the update: initialized, a wrong password is refused, the master password unlocks; accounts, order and revision unchanged",
    statusAfter?.initialized === true && wrong.ok === false && unlock.ok === true && same(listAfter, listBefore),
    { status: statusAfter, wrongPassword: wrong.error, unlock: unlock.ok, accounts: listAfter?.accounts.length });
  const codes = await codesMatch();
  const plainAfter = await plain();
  record("U-6", "TOTP codes after the update equal RFC 6238 codes computed outside Firefox; all secrets and parameters intact",
    codes.ok && same(plainAfter.text && JSON.parse(plainAfter.text).accounts, JSON.parse(plainBefore.text).accounts), codes);

  // 6. Graceful browser restart with the updated permanent add-on (issue #4 behaviour).
  const profile = ff.profile;
  await ff.close({ keepProfile: true });
  ff = await launchFirefox({ firefox: FIREFOX, prefs: PREFS, port: 9336, profile });
  await call("session.new", { capabilities: {} });
  page = undefined;
  top = await chrome();
  const restarted = await addonInfo(top);
  await openPage(restarted.uuid);
  await sleep(800);
  const st = (await msg("status")).result;
  const lockedCodes = await msg("getCodes");
  const sessionArea = await evalIn(page, "async () => Object.keys(await browser.storage.session.get())");
  const unlock2 = await msg("unlock", { password: PW });
  const listRestart = (await msg("listAccounts")).result;
  const settingsRestart = (await storageLocal()).settings;
  record("U-7", "browser restart after the update: 0.1.1 still installed and active, session locked with no key in storage.session, master password unlocks, data and settings intact",
    restarted?.version === "0.1.1" && restarted.isActive && st?.initialized && st.unlocked === false && lockedCodes.error === "locked" &&
      sessionArea.length === 0 && unlock2.ok && same(listRestart, listBefore) && same(settingsRestart, SETTINGS),
    { addon: restarted, status: st, sessionKeys: sessionArea, unlock: unlock2.ok });
} catch (e) {
  if (e.notTested) for (const id of ["U-1", "U-2", "U-3", "U-4", "U-5", "U-6", "U-7"]) notTested(id, "update test", e.notTested);
  else { console.error(e); record("U-error", "update test aborted", false, { error: String(e?.stack ?? e) }); }
} finally {
  notTested("U-signed", "signed extension update (AMO-signed 0.1.0 → signed 0.1.1)", "needs signed builds; signing requires operator authorization (Phase D)");
  try { await ff.close(); } catch { /* gone */ }
  server.close();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* locked */ }
}
evidence.results = results;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "update-results.json"), JSON.stringify(evidence, null, 2));
const n = (v) => results.filter((r) => r.verdict === v).length;
console.log(`${n("PASS")}/${results.length} passed, ${n("NOT_TESTED")} not tested, ${n("FAIL")} failed`);
process.exitCode = n("FAIL") ? 1 : 0;
