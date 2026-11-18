// Drives Firefox via its built-in WebDriver BiDi endpoint (no geckodriver, no deps).
// Usage: node spikes/b0-cryptokey/run-spike.mjs [path-to-firefox.exe]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIREFOX = process.argv[2] ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const EXT_ID = "{5821226e-579a-404a-9336-5ad61995f89c}";
const UUID = "23acf352-a72a-41a9-9b27-367fab700bf5";
const BASE = `moz-extension://${UUID}/test.html?phase=`;
const IDLE_MS = 3000; // event page idle timeout, shortened so suspension happens in the test
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "cta-b0-"));
const prefs = {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "extensions.background.idle.timeout": IDLE_MS,
  "extensions.openPopupWithoutUserGesture.enabled": true,
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.startup.homepage_override.mstone": "ignore",
};
writeFileSync(join(profile, "user.js"), Object.entries(prefs)
  .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));

const ff = spawn(FIREFOX, ["-profile", profile, "-no-remote", "-new-instance",
  `--remote-debugging-port=${PORT}`], { stdio: "ignore",
  // Test harness only: lets BiDi evaluate scripts in moz-extension:// pages of this
  // throwaway profile. It does not change extension privileges.
  env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });

let ws, nextId = 0;
const pending = new Map();
function call(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.type === "error" ? p.rej(new Error(`${p.method}: ${msg.error} ${msg.message}`)) : p.res(msg.result);
      };
      return;
    } catch { await sleep(500); }
  }
  throw new Error("BiDi endpoint not reachable");
}

let ctx, nonce = 0;
// BiDi refuses browsingContext.navigate to moz-extension:// (Firefox 160), so navigation
// happens from inside the extension page via script.evaluate.
async function runPhase(phase) {
  const search = `?phase=${phase}&n=${++nonce}`;
  await call("script.evaluate", { target: { context: ctx }, awaitPromise: false,
    expression: `location.assign(${JSON.stringify(BASE.replace("?phase=", "") + search)})` });
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: false,
      expression: `location.search === ${JSON.stringify(search)} && document.title === 'DONE'
        ? document.getElementById('out').textContent : ''` }).catch(() => null);
    if (r?.result?.value) return JSON.parse(r.result.value);
  }
  throw new Error(`phase ${phase} timed out`);
}
// Leaving a phase page = navigating to a neutral extension page (destroys the old realm).
async function blank() { await runPhase("noop"); }
// Waits for the tab the extension opens on install/reload and adopts it.
async function adoptExtensionTab(previous) {
  for (let i = 0; i < 100; i++) {
    const { contexts } = await call("browsingContext.getTree", {});
    const c = contexts.find((c) => c.url.startsWith(`moz-extension://${UUID}/`) && c.context !== previous);
    if (c) { ctx = c.context; return; }
    await sleep(100);
  }
  throw new Error("extension tab not found");
}

const evidence = { startedAt: new Date().toISOString(), prefs, phases: {} };
try {
  await connect();
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = { name: s.capabilities.browserName, version: s.capabilities.browserVersion,
    platform: s.capabilities.platformName };
  evidence.install = await call("webExtension.install",
    { extensionData: { type: "path", path: resolve(here, "extension") } });
  await adoptExtensionTab();

  const P = evidence.phases;
  P.create = await runPhase("create");
  await blank();
  P.reopen = await runPhase("reopen");
  P.popup = await runPhase("popup-driver");
  P.bgBefore = await runPhase("bg");
  await blank();
  await sleep(IDLE_MS * 3); // no extension activity → event page should suspend
  P.bgAfter = await runPhase("bg");
  P.lock = await runPhase("lock");
  await blank();
  P.verifyLock = await runPhase("verify-lock");
  P.expiry = await runPhase("expiry");
  P.alarmSet = await runPhase("alarm-set");
  await blank();
  await sleep(IDLE_MS * 3); // alarm (when = +2 s) must wake the event page and wipe the key
  P.alarmCheck = await runPhase("alarm-check");
  const before = ctx;
  await runPhase("reload-set").catch((e) => (P.reloadSetError = e.message));
  await sleep(2000);
  await adoptExtensionTab(before);
  P.reloadCheck = await runPhase("reload-check");
} catch (e) {
  evidence.fatal = e.stack;
} finally {
  evidence.finishedAt = new Date().toISOString();
  try { await call("browser.close"); } catch { ff.kill(); }
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile lock */ }
}

// ---- verdicts -------------------------------------------------------------
const P = evidence.phases;
const nonExtractable = (k) => k?.isCryptoKey && k.extractable === false &&
  k.export_raw === "InvalidAccessError" && k.export_jwk === "InvalidAccessError" &&
  k.wrapKey === "InvalidAccessError";
const works = (k) => nonExtractable(k) && k.decrypt === "OK";
const bgIds = [P.bgBefore?.probe?.instanceId, P.bgAfter?.probe?.instanceId];
const verdicts = {
  "1 create non-extractable key": nonExtractable(P.create?.created),
  "2 store in storage.session (nested + top level)": P.create?.setNested === "OK" &&
    P.create?.setTopLevel === "OK" && works(P.create?.retrievedNested) && works(P.create?.retrievedTopLevel),
  "3a retrieve after page close/reopen (tab)": works(P.reopen?.retrieved),
  "3b retrieve in real popup, opened twice": P.popup?.popupResults?.length === 2 &&
    P.popup.popupResults.every((r) => works(r.retrieved)),
  // A new instanceId within one install (no reload) proves the event page was unloaded
  // and started again.
  "4 works after event page suspend/restart": !!bgIds[0] && !!bgIds[1] && bgIds[0] !== bgIds[1] &&
    works(P.bgAfter?.probe?.key),
  "5 remains non-extractable in every context": [P.create?.retrievedNested, P.reopen?.retrieved,
    P.bgAfter?.probe?.key, ...(P.popup?.popupResults ?? []).map((r) => r.retrieved)].every(nonExtractable),
  "6 removed reliably on lock": P.lock?.afterLockPage === null && P.lock?.afterLockBg?.hasSession === false &&
    P.verifyLock?.page === null && P.verifyLock?.bg?.hasSession === false && P.verifyLock?.sensitive?.ok === false,
  "B0-2 gate rejects after deadline without alarm": P.expiry?.beforeDeadline?.ok === true &&
    P.expiry?.afterDeadline?.ok === false && P.expiry?.sessionAfter === null &&
    P.expiry?.touchAfterExpiry?.ok === false && P.expiry?.sessionAfterTouch === null,
  "B0-2 alarm wipes key while extension idle": P.alarmCheck?.session === null &&
    (P.alarmCheck?.log ?? []).some((e) => e.event === "alarm-lock"),
  "reload clears storage.session": P.reloadCheck && P.reloadCheck.reloadMarker === undefined &&
    P.reloadCheck.session === undefined,
};
// Informational, not a requirement: does an async storage write in onSuspend complete?
evidence.observations = {
  onSuspendAsyncWriteCompleted: (P.alarmCheck?.log ?? []).some((e) => e.event === "suspend"),
  backgroundStarts: (P.alarmCheck?.log ?? []).filter((e) => e.event === "start").length,
};
evidence.verdicts = Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, v ? "PASS" : "FAIL"]));

const out = join(here, "results", `firefox-${evidence.browser?.version ?? "unknown"}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence.verdicts, null, 2));
if (evidence.fatal) console.log(evidence.fatal);
console.log(`evidence: ${out}`);
process.exit(Object.values(verdicts).every(Boolean) && !evidence.fatal ? 0 : 1);
