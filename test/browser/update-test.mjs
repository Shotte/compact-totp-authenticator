// C6.2 / D3 – extension update test through Firefox's real add-on update path.
//
// Two modes, never mixed up in the results:
//
// UNSIGNED (default): a local upgrade simulation. Two packages are built from src/ (0.1.0 →
//   0.1.1). The old one is installed PERMANENTLY (AddonManager, not a temporary add-on) and
//   updated by AddonManager.findUpdates(): update_url → updates.json → download → hash
//   check → install. Signature checks are switched off in the throwaway profile, so it needs
//   a Firefox that honours xpinstall.signatures.required=false (ESR, Developer Edition,
//   Nightly); release Firefox refuses and the script reports NOT_TESTED. U-signed stays
//   NOT_TESTED.
//
// SIGNED (--old <signed.xpi> --new <signed.xpi>, Phase D3): the two AMO-signed builds are used
//   as they are, signature checks stay ON (release Firefox works), and both builds must
//   report a signed state. Only in this mode can U-signed become PASS. Both builds must carry
//   update_url https://127.0.0.1:47811/updates.json (`npm run release:source -- --test-update`,
//   see docs/SIGNING.md).
//
// The update server is HTTPS on 127.0.0.1:UPDATE_PORT (default 47811) with a certificate made
// for this run (openssl); it is trusted only inside the throwaway profile.
// Synthetic accounts and passwords only. Writes $RESULTS_DIR/update-results.json.
//
// Popup shortcut across the update (U-S1..U-S3, issue #6):
//   --custom-shortcut <combo>  sets a user shortcut on the old version before the update (with
//                              browser.commands.update, the API behind the about:addons shortcut
//                              manager); the result file is then update-results-custom-shortcut.json.
//   U-S1 API level: before, after the update and after the restart (commands.getAll).
//   U-S2/U-S3 real key events (Windows, visible browser only, else NOT_TESTED): the active
//   shortcut opens the toolbar popup and nothing else; the replaced shortcuts no longer do.
import { createServer } from "node:https";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { launchFirefox, sleep } from "./bidi.mjs";
import { exportRoundTripAccounts, syntheticSecret } from "../helpers/fixtures.mjs";
import { totp } from "../../src/lib/totp.js";
import { decodeBase32 } from "../../src/lib/base32.js";
import { DEFAULT_SETTINGS } from "../../src/lib/settings.js";
import { pressNative, LAYOUTS, opensPopupOnly } from "./shortcuts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.RESULTS_DIR ? resolve(process.env.RESULTS_DIR) : join(root, "docs/evidence/phase-c6");
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const SIGNED_OLD = arg("--old"), SIGNED_NEW = arg("--new");
const SIGNED = !!(SIGNED_OLD && SIGNED_NEW);
const CUSTOM = arg("--custom-shortcut");
const NATIVE = process.platform === "win32" && process.env.MOZ_HEADLESS !== "1";
const FIREFOX = arg("--firefox") ?? process.env.FIREFOX_BIN
  ?? { win32: "C:/Program Files/Mozilla Firefox/firefox.exe", darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const PORT = Number(process.env.UPDATE_PORT ?? 47811);
const BASE = `https://127.0.0.1:${PORT}`;
const UPDATE_URL = `${BASE}/updates.json`;
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const PW = "update test passphrase 2026 ✓"; // synthetic
const ACCOUNTS = exportRoundTripAccounts();
const SETTINGS = { ...DEFAULT_SETTINGS, theme: "dark", fontSize: 14, rowHeight: 25, autoLockMinutes: 30 };
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";
const AM = "ChromeUtils.importESModule(\"resource://gre/modules/AddonManager.sys.mjs\").AddonManager";
const SIGNED_MIN = 2; // AddonManager.SIGNEDSTATE_SIGNED

const results = [];
const record = (id, name, pass, details) => { results.push({ id, name, verdict: pass ? "PASS" : "FAIL", details }); console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}`); };
const notTested = (id, name, reason) => { results.push({ id, name, verdict: "NOT_TESTED", details: { reason } }); console.log(`NOT_TESTED  ${id}  ${name} (${reason})`); };

// 1. Packages: unsigned mode builds both from src/ with the test update_url; signed mode uses
//    the given signed XPIs unchanged.
const work = mkdtempSync(join(tmpdir(), "cta-update-"));
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
const OLD = SIGNED ? resolve(SIGNED_OLD) : build("0.1.0");
const NEW = SIGNED ? resolve(SIGNED_NEW) : build("0.1.1");
const newBytes = readFileSync(NEW);
let OLD_VERSION = SIGNED ? null : "0.1.0", NEW_VERSION = SIGNED ? null : "0.1.1"; // signed: read from the XPIs below

// 2. HTTPS update server: a test CA made for this run signs a server certificate for
//    127.0.0.1 (Firefox refuses a CA certificate used directly as the server certificate).
//    Only the CA is trusted, and only in the throwaway profile.
const certDir = join(work, "tls");
mkdirSync(certDir);
const tls = (name) => join(certDir, name);
const openssl = (...args) => {
  const r = spawnSync("openssl", args, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (r.status !== 0) throw new Error(`openssl ${args[0]}: ${r.stderr}`);
};
writeFileSync(tls("leaf.ext"), "subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=CTA update test CA",
  "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  "-keyout", tls("ca.key"), "-out", tls("ca.pem"));
openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-keyout", tls("key.pem"), "-out", tls("leaf.csr"));
openssl("x509", "-req", "-in", tls("leaf.csr"), "-CA", tls("ca.pem"), "-CAkey", tls("ca.key"), "-CAcreateserial",
  "-days", "2", "-sha256", "-extfile", tls("leaf.ext"), "-out", tls("cert.pem"));
const certPem = readFileSync(tls("cert.pem"), "utf8");
const certB64 = readFileSync(tls("ca.pem"), "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""); // the CA is what gets trusted
let updateRequests = 0, xpiRequests = 0;
const server = createServer({ key: readFileSync(join(certDir, "key.pem")), cert: certPem }, (req, res) => {
  if (req.url.startsWith("/updates.json")) {
    updateRequests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ addons: { [EXT_ID]: { updates: [{ version: NEW_VERSION,
      update_link: `${BASE}/new.xpi`,
      update_hash: `sha256:${createHash("sha256").update(newBytes).digest("hex")}` }] } } }));
  } else if (req.url === "/new.xpi") {
    xpiRequests++;
    res.setHeader("Content-Type", "application/x-xpinstall");
    res.end(newBytes);
  } else { res.statusCode = 404; res.end(); }
});
await new Promise((r, j) => { server.once("error", j); server.listen(PORT, "127.0.0.1", r); });

const PREFS = {
  ...(SIGNED ? {} : { "xpinstall.signatures.required": false }), // unsigned mode only (ESR/Developer/Nightly)
  "extensions.install.requireBuiltInCerts": false, // the run's certificate is not a built-in CA
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
const shortcut = () => evalIn(page, `async () => ({ default: browser.runtime.getManifest().commands?._execute_action?.suggested_key?.default ?? null,
  active: (await browser.commands.getAll()).find((c) => c.name === "_execute_action")?.shortcut ?? null })`);
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

const evidence = { startedAt: new Date().toISOString(), kind: SIGNED ? "signed update via the AddonManager update path (signature checks on)" : "local unsigned upgrade via the AddonManager update path (not a signed update)" };
try {
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = { version: s.capabilities.browserVersion, platform: s.capabilities.platformName };
  let top = await chrome();
  const privileged = top ? await evalIn(top, "async () => typeof ChromeUtils !== \"undefined\"").catch(() => false) : false;
  if (!privileged) throw Object.assign(new Error("chrome scope unavailable"), { notTested: "harness: privileged chrome scope unavailable in this Firefox version" });
  // Trust the run's certificate in this throwaway profile only (update server on 127.0.0.1).
  await evalIn(top, `async () => { const db = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB);
    db.addCertFromBase64(${JSON.stringify(certB64)}, "C,,"); return true; }`);
  // TLS preflight from the privileged scope: the update check can only work if this does.
  evidence.tlsPreflight = await evalIn(top, `async () => { try { const r = await fetch(${JSON.stringify(UPDATE_URL)}, { cache: "no-store" });
    return { ok: r.ok, status: r.status }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } }`);
  updateRequests = 0; // the preflight is not part of the update
  if (!evidence.tlsPreflight.ok) throw new Error(`HTTPS update server not reachable from Firefox: ${JSON.stringify(evidence.tlsPreflight)}`);
  if (SIGNED) { // versions come from the signed packages themselves
    const v = await evalIn(top, `async () => { const out = [];
      for (const p of ${JSON.stringify([OLD, NEW])}) { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(p);
        const i = await ${AM}.getInstallForFile(f); out.push({ version: i.addon?.version ?? i.version ?? null, error: i.error }); i.cancel?.(); }
      return out; }`);
    [OLD_VERSION, NEW_VERSION] = v.map((x) => x.version);
    evidence.packages = v;
    if (!OLD_VERSION || !NEW_VERSION) throw new Error(`signed packages unreadable: ${JSON.stringify(v)}`);
  }
  evidence.mode = SIGNED ? "signed" : "unsigned";
  evidence.versions = { old: OLD_VERSION, new: NEW_VERSION };

  // 3. Permanent install of the old version (no temporary add-on).
  const installed = await evalIn(top, `async () => { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(${JSON.stringify(OLD)});
    try { const i = await ${AM}.getInstallForFile(f); if (i.error) return { error: i.error };
      const a = await i.install(); return { ok: true, version: a.version }; }
    catch (e) { return { error: String(e?.message ?? e) }; } }`);
  const before = await addonInfo(top);
  if (!installed?.ok || !before) {
    if (SIGNED) throw new Error(`signed package refused: ${JSON.stringify(installed)}`);
    throw Object.assign(new Error("install"), { notTested: `this Firefox refuses an unsigned permanent install (${JSON.stringify(installed)}); needs ESR, Developer Edition or Nightly` });
  }
  record("U-1", `${OLD_VERSION} installed permanently (not a temporary add-on), ${SIGNED ? "signed" : "unsigned"}, active`,
    before.version === OLD_VERSION && before.temporary === false && before.isActive && !!before.uuid && (!SIGNED || before.signedState >= SIGNED_MIN), { addon: before });

  // 3. Synthetic vault, custom order and settings.
  await openPage(before.uuid);
  await sleep(500);
  if (!(await msg("setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
  let revision = 1;
  for (const account of ACCOUNTS) revision = (await msg("addAccount", { revision, account })).result.revision;
  const ids = (await msg("listAccounts")).result.accounts.map((a) => a.id);
  revision = (await msg("moveAccount", { id: ids.at(-1), toIndex: 0, revision })).result.revision; // non-default order
  await evalIn(page, `async () => browser.storage.local.set({ settings: ${JSON.stringify(SETTINGS)} })`);
  if (CUSTOM) await evalIn(page, `async () => browser.commands.update({ name: "_execute_action", shortcut: ${JSON.stringify(CUSTOM)} })`);
  const keyBefore = await shortcut();
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
  for (let i = 0; i < 40; i++) { after = await addonInfo(top); if (after?.version === NEW_VERSION && after.isActive) break; await sleep(250); }
  record("U-2", "update found through update_url and installed by AddonManager (updates.json fetched, XPI downloaded, hash checked)",
    upd.found === true && after?.version === NEW_VERSION && after.isActive && updateRequests > 0 && xpiRequests > 0 && (!SIGNED || after.signedState >= SIGNED_MIN),
    { update: upd, addon: after, updateRequests, xpiRequests });
  record("U-3", "extension ID and moz-extension UUID unchanged; still a permanent install",
    after?.id === before.id && after.uuid === before.uuid && after.temporary === false, { before, after });

  // 5. Data after the update (event page restarted with the new code). Firefox closes the
  // extension's tabs when it replaces the add-on, so a new tab is opened.
  page = undefined;
  await openPage(after.uuid);
  await sleep(800);
  const keyAfterUpdate = await shortcut();
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
  record("U-7", "browser restart after the update: the new version still installed and active, session locked with no key in storage.session, master password unlocks, data and settings intact",
    restarted?.version === NEW_VERSION && restarted.isActive && st?.initialized && st.unlocked === false && lockedCodes.error === "locked" &&
      sessionArea.length === 0 && unlock2.ok && same(listRestart, listBefore) && same(settingsRestart, SETTINGS),
    { addon: restarted, status: st, sessionKeys: sessionArea, unlock: unlock2.ok });

  // U-S1..U-S3 (#6): the popup shortcut across the update and the restart.
  {
    const keyAfterRestart = await shortcut();
    const oldDefault = keyBefore.default, newDefault = keyAfterUpdate.default;
    const want = CUSTOM ?? newDefault;
    record("U-S1", CUSTOM
      ? `API level: the user shortcut ${CUSTOM} set on ${OLD_VERSION} is kept after the update and the restart (new default ${newDefault} not applied)`
      : `API level: the unchanged default ${oldDefault} of ${OLD_VERSION} becomes the new default ${newDefault} after the update and stays after the restart`,
      keyBefore.active === (CUSTOM ?? oldDefault) && keyAfterUpdate.active === want && keyAfterRestart.active === want,
      { before: keyBefore, afterUpdate: keyAfterUpdate, afterRestart: keyAfterRestart });
    const replaced = [...new Set([oldDefault, newDefault])].filter((k) => k && k !== want);
    if (!NATIVE) {
      notTested("U-S2", `real key event: ${want} opens the toolbar popup`, "native key events need Windows with a visible browser");
      notTested("U-S3", "real key event: replaced shortcuts no longer open the popup", "native key events need Windows with a visible browser");
    } else {
      const active = {};
      for (const [l, id] of Object.entries(LAYOUTS)) active[l] = await pressNative(evalIn, top, want, id).catch((e) => ({ error: String(e?.message ?? e) }));
      record("U-S2", `real key event (German and US layout): ${want} opens the toolbar popup and nothing else`,
        Object.values(active).every(opensPopupOnly), { shortcut: want, pressed: active });
      if (!replaced.length) notTested("U-S3", "real key event: replaced shortcuts no longer open the popup", "old and new default are the same in this run");
      else {
        const old = {};
        for (const k of replaced) { old[k] = {}; for (const [l, id] of Object.entries(LAYOUTS)) old[k][l] = await pressNative(evalIn, top, k, id).catch((e) => ({ error: String(e?.message ?? e) })); }
        record("U-S3", `real key event: ${replaced.join(" and ")} no longer open${replaced.length > 1 ? "" : "s"} the popup`,
          Object.values(old).every((byLayout) => Object.values(byLayout).every((p) => p && !p.error && !p.popup)), { pressed: old });
      }
    }
  }

  // U-8 (#25): restore or replace from an encrypted backup and the previous vault state, on the
  // permanently installed (in signed mode: signed) updated version. Synthetic data only.
  {
    const EXP = "update test export password ✓";
    const names = async () => (await msg("listAccounts")).result.accounts.map((a) => a.name);
    const exported = (await msg("exportVault", { kind: "encrypted", password: PW, exportPassword: EXP, confirm: EXP })).result;
    const atExport = await names();
    let rev = (await msg("listAccounts")).result.revision;
    rev = (await msg("addAccount", { revision: rev, account: { name: "Neu nach Export", secret: syntheticSecret(990) } })).result?.revision;
    // #25 V2 API when the new version has it (token), else the 0.9.x API (re-authentication)
    const p = (await msg("replacePreview", { text: exported.text, password: EXP, masterPassword: PW })).result;
    const r = p.token ? await msg("replaceApply", { token: p.token })
      : await msg("replaceApply", { revision: p.revision, fileHash: p.fileHash, text: exported.text, password: EXP, masterPassword: PW, confirmed: true });
    const afterReplace = await names();
    const prev1 = (await msg("previousStatus")).result;
    const pwChange = await msg("changePassword", { current: PW, next: "a different test passphrase ✓", confirm: "a different test passphrase ✓" });
    await msg("lock");
    const exportPwOpens = (await msg("unlock", { password: EXP })).ok;
    const masterOpens = (await msg("unlock", { password: PW })).ok;
    const back = await msg("restorePrevious", { masterPassword: PW, confirmed: true });
    const afterRestore = await names();
    const prev2 = (await msg("previousStatus")).result;
    const discard = await msg("discardPrevious", { masterPassword: PW, confirmed: true });
    const prev3 = (await msg("previousStatus")).result;
    record("U-8", "replace from an encrypted backup on the updated permanent install: preview names the local-only entry, replacement restores the export state, previous vault kept and restorable, password change refused while it exists, discard works, the export password never opens the vault",
      p.onlyCurrent?.names?.includes("Neu nach Export") && r.ok && r.result.keptPrevious && same(afterReplace, atExport) &&
        prev1?.exists && prev1.count === atExport.length + 1 && pwChange.reason === "previous-exists" && !exportPwOpens && masterOpens &&
        back.ok && afterRestore.includes("Neu nach Export") && afterRestore.length === atExport.length + 1 &&
        prev2?.exists && prev2.count === atExport.length && discard.ok && prev3?.exists === false,
      { preview: { backupCount: p.backupCount, currentCount: p.currentCount, onlyCurrent: p.onlyCurrent }, replaced: r.result ?? r,
        previousAfterReplace: prev1, passwordChange: pwChange.reason, exportPasswordOpens: exportPwOpens, masterOpens,
        afterRestore: afterRestore.length, previousAfterRestore: prev2, discarded: discard.ok, previousAfterDiscard: prev3 });
  }
} catch (e) {
  if (e.notTested) for (const id of ["U-1", "U-2", "U-3", "U-4", "U-5", "U-6", "U-7"]) notTested(id, "update test", e.notTested);
  else { console.error(e); record("U-error", "update test aborted", false, { error: String(e?.stack ?? e) }); }
} finally {
  const core = results.filter((r) => /^U-[1-7]$/.test(r.id));
  if (!SIGNED) notTested("U-signed", "signed extension update (two AMO-signed builds)", "unsigned simulation; run with --old/--new and signed XPIs (docs/SIGNING.md)");
  else record("U-signed", `signed extension update ${OLD_VERSION} → ${NEW_VERSION} with signature checks on: U-1…U-7 all PASS`,
    core.length === 7 && core.every((r) => r.verdict === "PASS"), { checks: core.map((r) => `${r.id}:${r.verdict}`) });
  try { await ff.close(); } catch { /* gone */ }
  server.close();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* locked */ }
}
evidence.results = results;
mkdirSync(OUT, { recursive: true });
evidence.customShortcut = CUSTOM ?? null;
writeFileSync(join(OUT, CUSTOM ? "update-results-custom-shortcut.json" : "update-results.json"), JSON.stringify(evidence, null, 2));
const n = (v) => results.filter((r) => r.verdict === v).length;
console.log(`${n("PASS")}/${results.length} passed, ${n("NOT_TESTED")} not tested, ${n("FAIL")} failed`);
process.exitCode = n("FAIL") ? 1 : 0;
