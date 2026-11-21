// C4 manual-review evidence on Windows: Firefox's native Save dialog (completed and
// cancelled), a reproducible download failure, the native Open dialog and restoring the
// saved file, and (C6, issue #5) the legacy import through the native Open dialog. Visible (non-headless) Firefox; the dialogs are driven through Windows UI
// Automation (uia-dialog.ps1) restricted to this Firefox's main process: no mouse moves,
// no keystrokes, no clipboard. Synthetic accounts and passwords only; all files live in a
// fresh temporary directory that is removed afterwards. Not part of CI.
// Usage: node test/browser/native-dialogs.mjs [path-to-firefox.exe]
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { launchFirefox, sleep } from "./bidi.mjs";
import { exportRoundTripAccounts, syntheticSecret } from "../helpers/fixtures.mjs";
import { parseExport, openExport } from "../../src/lib/export.js";
import { deriveKey } from "../../src/lib/kdf.js";

if (process.platform !== "win32") { console.log("Windows only"); process.exit(0); }
delete process.env.MOZ_HEADLESS; // native dialogs need a real window
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.RESULTS_DIR ? resolve(process.env.RESULTS_DIR) : join(root, "docs/evidence/phase-c4");
const FIREFOX = process.argv[2] ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c", EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const PW = "correct horse battery staple 2026", PW2 = "zweites Passwort für den Wechsel ✓", EXP = "Export-Passphrase für Tests ✓";
const WORK = mkdtempSync(join(tmpdir(), "cta-native-"));
const SAVE = join(WORK, "saved"), RO = join(WORK, "readonly");
mkdirSync(SAVE); mkdirSync(RO);
const USER = process.env.USERNAME;
const userDownloads = join(homedir(), "Downloads");
const ctaFilesInUserDownloads = () => (existsSync(userDownloads) ? readdirSync(userDownloads).filter((f) => /^cta-/.test(f)) : []);
const downloadsBefore = ctaFilesInUserDownloads();

const ff = await launchFirefox({ firefox: FIREFOX, port: 9336, prefs: {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "browser.download.useDownloadDir": false,              // "Always ask where to save files"
  "browser.download.dir": SAVE, "browser.download.folderList": 2,
  "browser.download.always_ask_before_handling_new_types": false,
  "browser.shell.checkDefaultBrowser": false, "datareporting.policy.dataSubmissionEnabled": false,
  "intl.locale.requested": "de",
} });
const { call } = ff;
const results = [];
const record = (id, name, verdict, details) => { results.push({ id, name, verdict, details }); console.log(`${verdict}  ${id}  ${name}`); };
async function evalJson(ctx, src) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true, expression: `(${src})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}
const msg = (ctx, cmd, args = {}) => evalJson(ctx, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`);
async function clickAt(ctx, selector) {
  await evalJson(ctx, `async () => { document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }`);
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: false,
    expression: `document.querySelector(${JSON.stringify(selector)})`, resultOwnership: "root" });
  await call("input.performActions", { context: ctx, actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" },
    actions: [{ type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: { sharedId: r.result.sharedId } } },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }] });
}
let pid;
const uia = (action, path = "") => {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "test/browser/uia-dialog.ps1"),
    "-Action", action, "-ProcessId", String(pid), "-Path", path], { encoding: "utf8", windowsHide: true });
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return { error: (r.stderr || r.stdout).trim().slice(0, 300) }; }
};
const icacls = (...a) => spawnSync("icacls", a, { encoding: "utf8", windowsHide: true }).status;
const files = (dir) => readdirSync(dir).filter((f) => !f.endsWith(".part"));
async function waitFile(dir, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = files(dir)[0];
    if (f) { const a = statSync(join(dir, f)).size; await sleep(400); if (a > 0 && statSync(join(dir, f)).size === a) return f; }
    await sleep(250);
  }
  return null;
}

let chrome, version = null;
const downloadsList = () => evalJson(chrome, `async () => { const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  return (await (await Downloads.getList(Downloads.ALL)).getAll()).map((d) => ({ file: d.target.path.split(/[\\\\/]/).pop(),
    succeeded: d.succeeded, canceled: d.canceled, error: d.error ? (d.error.becauseTargetFailed ? "target failed" : String(d.error.message).slice(0, 80)) : null })); }`);
const setPref = (kind, name, value) => evalJson(chrome, `async () => Services.prefs.set${kind}Pref(${JSON.stringify(name)}, ${JSON.stringify(value)})`);

try {
  let session;
  try { session = await call("session.new", { capabilities: { alwaysMatch: { unhandledPromptBehavior: { file: "ignore", default: "ignore" } } } }); }
  catch { session = await call("session.new", { capabilities: {} }); }
  version = session.capabilities.browserVersion;
  await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
  pid = await evalJson(chrome, `async () => Services.appinfo.processID`);
  const opt = (await call("browsingContext.create", { type: "tab" })).context;
  const open = async () => {
    await call("browsingContext.navigate", { context: opt, url: `moz-extension://${UUID}/options/options.html`, wait: "complete" });
    for (let i = 0; i < 100 && !(await evalJson(opt, `async () => document.body.dataset.state === "unlocked" || document.body.dataset.state === "locked"`)); i++) await sleep(100);
    await sleep(300);
  };
  await open();
  const expected = exportRoundTripAccounts();
  if (!(await msg(opt, "setup", { password: PW, confirm: PW })).ok) throw new Error("setup");
  let revision = 1;
  for (const a of expected) revision = (await msg(opt, "addAccount", { revision, account: a })).result.revision;
  await open();
  const pageMessage = () => evalJson(opt, `async () => { const s = [...document.querySelectorAll(".status")].find((e) => e.textContent); return { text: s?.textContent ?? "", kind: s?.dataset.kind, area: s?.id ?? null }; }`); // contextual status areas (feedback 01)
  const startExport = async () => {
    await evalJson(opt, `async () => { const f = document.getElementById("exportForm").elements; f.kind.value = "encrypted";
      f.password.value = ${JSON.stringify(PW)}; f.exportPassword.value = ${JSON.stringify(EXP)}; f.confirm.value = ${JSON.stringify(EXP)};
      document.getElementById("exportButton").scrollIntoView({ block: "center" }); }`);
    await clickAt(opt, "#exportButton");
  };

  // N1: native Save dialog, completed.
  const savedName = "CTA Sicherung – Ünïcödé ✓.json";
  await startExport();
  const save = uia("save", join(SAVE, savedName));
  const saved = await waitFile(SAVE);
  await sleep(500);
  const m1 = await pageMessage();
  const dl1 = await downloadsList();
  let accounts = null;
  if (saved) { const f = parseExport(readFileSync(join(SAVE, saved), "utf8")); accounts = (await openExport(await deriveKey(EXP, f.kdf), f)).accounts; }
  record("N1", "native Save dialog appears, saving completes, the saved file decrypts to identical accounts",
    save.found && saved === savedName && same(accounts, expected) && dl1.at(-1)?.succeeded === true ? "PASS" : "FAIL",
    { dialog: { title: save.title, ok: save.okButton, cancel: save.cancelButton, closed: save.closed, error: save.error }, savedFile: saved,
      firefoxDownload: dl1.at(-1), pageMessage: m1 });

  // N2: native Save dialog, cancelled.
  const before2 = files(SAVE).length, dlBefore2 = (await downloadsList()).length;
  await startExport();
  const cancel = uia("cancel");
  await sleep(2500);
  const dl2 = await downloadsList();
  const m2 = await pageMessage();
  record("N2", "native Save dialog cancelled: no file written, no completed download",
    cancel.found && cancel.closed && files(SAVE).length === before2 && !dl2.slice(dlBefore2).some((d) => d.succeeded) ? "PASS" : "FAIL",
    { dialog: { title: cancel.title, cancel: cancel.cancelButton, closed: cancel.closed, error: cancel.error }, filesBefore: before2, filesAfter: files(SAVE).length,
      newFirefoxDownloads: dl2.slice(dlBefore2), pageMessage: m2 });

  // N3: download failure: direct-download mode into a folder the user may not write to.
  const denied = icacls(RO, "/deny", `${USER}:(W,AD,WD)`);
  await setPref("Bool", "browser.download.useDownloadDir", true);
  await setPref("String", "browser.download.dir", RO);
  const dlBefore3 = (await downloadsList()).length;
  await startExport();
  await sleep(4000);
  const dl3 = (await downloadsList()).slice(dlBefore3);
  const m3 = await pageMessage();
  icacls(RO, "/remove:d", USER);
  await setPref("Bool", "browser.download.useDownloadDir", false);
  await setPref("String", "browser.download.dir", SAVE);
  const strayInUserDownloads = ctaFilesInUserDownloads().filter((f) => !downloadsBefore.includes(f));
  record("N3", "download failure (target folder not writable): Firefox reports the failure, no file, nothing written elsewhere",
    denied === 0 && dl3.length > 0 && dl3.every((d) => !d.succeeded && d.error) && files(RO).length === 0 && strayInUserDownloads.length === 0 ? "PASS"
      : denied !== 0 ? "NOT_TESTED" : "FAIL",
    { aclDenyApplied: denied === 0, firefoxDownloads: dl3, filesInTarget: files(RO).length, strayFilesInUserDownloads: strayInUserDownloads.length, pageMessage: m3 });

  // N4 (#25): native Open dialog with the complete replacement workflow. The vault already
  // holds two synthetic entries; the saved backup replaces them: choose the file in the real
  // Windows dialog, check the backup, read the preview (destructive warning, local-only
  // entries), fresh authorization (export password again, master password), explicit
  // confirmation. Then the entries equal the backup and the previous vault state is kept.
  await evalJson(opt, `async () => { await browser.storage.local.remove(["vault", "vault_backup", "vault_next", "vault_previous"]); await browser.storage.session.clear(); }`);
  await msg(opt, "setup", { password: PW2, confirm: PW2 });
  const localN4 = [{ name: "Lokal N4 Eins", secret: syntheticSecret(940) }, { name: "Lokal N4 Zwei", secret: syntheticSecret(941) }];
  let revN4 = 1;
  for (const account of localN4) revN4 = (await msg(opt, "addAccount", { revision: revN4, account })).result.revision;
  await open();
  await evalJson(opt, `async () => document.querySelector("#restoreExportForm input[type=file]").scrollIntoView({ block: "center" })`);
  await clickAt(opt, "#restoreExportForm input[type=file]");
  const pick = uia("open", join(SAVE, savedName));
  await sleep(800);
  const picked = await evalJson(opt, `async () => document.querySelector("#restoreExportForm input[type=file]").files[0]?.name ?? null`);
  await evalJson(opt, `async () => { const f = document.getElementById("restoreExportForm").elements;
    f.password.value = ${JSON.stringify(EXP)};
    document.querySelector("#restoreExportForm button").scrollIntoView({ block: "center" }); }`);
  await clickAt(opt, "#restoreExportForm button"); // step 1: check the backup
  await sleep(2500);
  const preview4 = await evalJson(opt, `async () => ({ shown: !document.getElementById("replacePreview").hidden,
    summary: document.getElementById("replaceSummary").textContent,
    warning: !document.getElementById("replaceWarning").hidden,
    lose: [...document.querySelectorAll("#replaceLoseList li")].map((li) => li.textContent),
    confirmRequired: document.getElementById("replaceForm").elements.confirmed.required,
    exportPasswordEmpty: document.getElementById("replaceForm").elements.exportPassword.value === "" })`);
  await evalJson(opt, `async () => { const g = document.getElementById("replaceForm").elements; g.confirmed.checked = true;
    g.exportPassword.value = ${JSON.stringify(EXP)}; g.masterPassword.value = ${JSON.stringify(PW2)};
    document.getElementById("replaceButton").scrollIntoView({ block: "center" }); }`);
  await clickAt(opt, "#replaceButton"); // step 2: fresh authorization and confirmation
  await sleep(3000);
  const m4 = await pageMessage();
  const back = await msg(opt, "exportVault", { kind: "plain", password: PW2, confirmed: true });
  const restored = back.ok ? JSON.parse(back.result.text).accounts : null;
  const previous4 = (await msg(opt, "previousStatus")).result;
  const previousBox4 = await evalJson(opt, `async () => !document.getElementById("previousBox").hidden && document.getElementById("previousText").textContent`);
  record("N4", "native Open dialog (Unicode name) with the complete replacement: check, preview with warning and local-only entries, export password again, master password, confirmation; entries equal the backup; previous vault state (2 entries) kept",
    pick.found && picked === savedName && preview4.shown && preview4.warning && same(preview4.lose, localN4.map((a) => a.name)) &&
      preview4.confirmRequired && preview4.exportPasswordEmpty && m4.kind === "ok" && m4.area === "restoreStatus" && same(restored, expected) &&
      previous4?.exists && previous4.count === 2 && !!previousBox4 ? "PASS" : "FAIL",
    { dialog: { title: pick.title, ok: pick.okButton, closed: pick.closed, error: pick.error }, pickedFile: picked, preview: preview4,
      pageMessage: m4, restoredAccounts: restored?.length, previousVault: previous4, previousBox: previousBox4 });

  // N5 (C6, issue #5): legacy import through the native Open dialog: pick a synthetic
  // totp.json, preview, generated name, master password, apply.
  const legacyName = "totp.json";
  writeFileSync(join(WORK, legacyName), readFileSync(join(root, "test/fixtures/legacy-synthetic.json")));
  await open();
  const before5 = (await msg(opt, "listAccounts")).result.accounts.length;
  await clickAt(opt, "#importFile");
  const pick5 = uia("open", join(WORK, legacyName));
  let preview5 = false;
  for (let i = 0; i < 50 && !preview5; i++) { preview5 = await evalJson(opt, `async () => !document.getElementById("preview").hidden`); if (!preview5) await sleep(100); }
  const rows5 = await evalJson(opt, `async () => [...document.querySelectorAll("#preview tbody tr")].map((r) => r.dataset.status)`);
  const generated5 = await evalJson(opt, `async () => document.querySelector("#preview input[type=text]")?.value ?? null`);
  await evalJson(opt, `async () => { document.getElementById("importMasterPassword").value = ${JSON.stringify(PW2)};
    document.getElementById("importApply").scrollIntoView({ block: "center" }); }`);
  await clickAt(opt, "#importApply");
  await sleep(2500);
  const m5 = await pageMessage();
  const after5 = (await msg(opt, "listAccounts")).result.accounts.length;
  record("N5", "native Open dialog for the legacy import (issue #5): synthetic totp.json picked, preview shown with a generated name, import with the master password appends the 6 importable entries",
    pick5.found && preview5 && rows5.length === 11 && !!generated5 && m5.kind === "ok" && after5 === before5 + 6 ? "PASS" : "FAIL",
    { dialog: { title: pick5.title, ok: pick5.okButton, closed: pick5.closed, error: pick5.error }, previewShown: preview5, rowStatuses: rows5,
      generatedName: generated5, pageMessage: m5, accountsBefore: before5, accountsAfter: after5 });
} catch (e) {
  record("FATAL", e.message, "FAIL", { stack: e.stack });
} finally {
  try { await ff.close(); } catch { /* gone */ }
  icacls(RO, "/remove:d", USER);
  rmSync(WORK, { recursive: true, force: true });
}

const evidence = { at: new Date().toISOString(), firefox: version, platform: "windows", note: "Paths reduced to file names; synthetic data only.", results };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "native-dialogs-windows.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(`${results.filter((r) => r.verdict === "PASS").length}/${results.length} passed`);
process.exit(results.some((r) => r.verdict === "FAIL") ? 1 : 0);
