// Investigation of the intermittent C4-6 seeding conflict (Windows CI): repeats the
// 1,000-entry seeding loop and classifies every anomaly by what storage actually holds.
// Each round starts with a hard kill and restart of Firefox (like R-2 before C4-6). Writes are
// never repeated blindly: after a delivery error the stored revision decides.
//   node test/browser/stress-seed.mjs [firefox] [rounds=5]
// Synthetic data only; throwaway profile. Writes $RESULTS_DIR/stress-seed.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { syntheticAccounts } from "../helpers/fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.RESULTS_DIR ? resolve(process.env.RESULTS_DIR) : join(root, "docs/evidence/replace-25");
const args = process.argv.slice(2);
const FIREFOX = args.find((a) => !/^\d+$/.test(a)) ?? process.env.FIREFOX_BIN ??
  { win32: "C:/Program Files/Mozilla Firefox/firefox.exe", darwin: "/Applications/Firefox.app/Contents/MacOS/firefox", linux: "firefox" }[process.platform];
const ROUNDS = Number(args.find((a) => /^\d+$/.test(a)) ?? 5);
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}", UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c";
const PW = "stress test master password", N = 1000;
const SVC = "(typeof Services !== \"undefined\" ? Services : ChromeUtils.importESModule(\"resource://gre/modules/Services.sys.mjs\").Services)";
const PREFS = {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "extensions.background.idle.timeout": 3000, // as in run-browser-tests.mjs
  "extensions.webextensions.keepStorageOnUninstall": true,
  "extensions.webextensions.keepUuidOnUninstall": true,
  "toolkit.startup.max_resumed_crashes": -1,
  "browser.sessionstore.resume_from_crash": false,
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
};

let ff, opt;
async function start(profile) {
  ff = await launchFirefox({ firefox: FIREFOX, prefs: PREFS, profile });
  await ff.call("session.new", { capabilities: {} });
  await ff.call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  opt = (await ff.call("browsingContext.create", { type: "tab" })).context;
  await ff.call("browsingContext.navigate", { context: opt, url: `moz-extension://${UUID}/options/options.html`, wait: "complete" });
}
async function send(message) { // one attempt; a delivery error is returned, not retried
  const r = await ff.call("script.evaluate", { target: { context: opt }, awaitPromise: true,
    expression: `browser.runtime.sendMessage(${JSON.stringify(message)}).then((v) => JSON.stringify(v), (e) => JSON.stringify({ ok: false, error: "delivery", reason: String(e.message) }))` });
  if (r.type === "exception") return { ok: false, error: "delivery", reason: r.exceptionDetails.text };
  return JSON.parse(r.result.value);
}
const stored = async () => (await send({ cmd: "listAccounts" })).result ?? null;

const rounds = [];
await start();
try {
  for (let round = 1; round <= ROUNDS; round++) {
    // hard kill and restart with the same profile, as R-2 does before C4-6
    const profile = ff.profile;
    // the main browser process (on Windows the spawned process can be a launcher)
    let pid = ff.pid;
    try {
      const chrome = (await ff.call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0]?.context;
      const r = await ff.call("script.evaluate", { target: { context: chrome }, awaitPromise: false, expression: `${SVC}.appinfo.processID` });
      if (r.type === "success") pid = r.result.value;
    } catch { /* no chrome scope: the spawned process */ }
    await ff.kill(pid);
    await start(profile);
    await ff.call("script.evaluate", { target: { context: opt }, awaitPromise: true,
      expression: `browser.storage.local.remove(["vault", "vault_backup", "vault_next", "vault_previous"]).then(() => browser.storage.session.clear())` });
    await send({ cmd: "setup", password: PW, confirm: PW });
    const anomalies = [];
    let revision = 1;
    const t0 = Date.now();
    const accounts = syntheticAccounts(N);
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      const res = await send({ cmd: "addAccount", revision, account: { name: a.name, secret: a.secret, url: a.url, algorithm: a.algorithm, digits: a.digits, period: a.period } });
      if (res.ok) { revision = res.result.revision; continue; }
      await sleep(2000); // let a delayed delivery settle; the resend below relies on the revision check, not on this read
      const now = await stored();
      const applied = now?.revision === revision + 1 && now.accounts.at(-1)?.name === a.name;
      const untouched = now?.revision === revision;
      const kind = res.error === "delivery"
        ? (applied ? "delivered despite a delivery error" : untouched ? "not delivered" : "UNEXPLAINED")
        : res.error === "conflict" ? (applied ? "delayed delivery landed first; the resend was refused by the revision check (safe)" : "COMPETING WRITE OR PRODUCT REVISION ERROR") : `OTHER: ${res.error}`;
      anomalies.push({ i, sentRevision: revision, answer: res.error, reason: res.reason ?? null, stored: now ? { revision: now.revision, count: now.accounts.length, last: now.accounts.at(-1)?.name } : null, kind });
      if (applied) revision = now.revision;
      else if (untouched && res.error === "delivery") i--; // provably not applied: send again
      else break;
    }
    const final = await stored();
    rounds.push({ round, ms: Date.now() - t0, finalCount: final?.accounts.length ?? null, finalRevision: final?.revision ?? null,
      complete: final?.accounts.length === N && final.revision === N + 1, anomalies });
    console.log(`round ${round}: ${final?.accounts.length} entries, revision ${final?.revision}, ${anomalies.length} anomalies ${JSON.stringify(anomalies.map((x) => x.kind))}`);
  }
} finally {
  await ff.close().catch(() => {});
}
const bad = rounds.flatMap((r) => r.anomalies).filter((a) => /COMPETING|UNEXPLAINED|OTHER/.test(a.kind));
const result = { startedAt: new Date().toISOString(), firefox: FIREFOX, platform: process.platform, rounds,
  verdict: bad.length ? "INVESTIGATE" : rounds.every((r) => r.complete) ? "PASS" : "INCOMPLETE" };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "stress-seed.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`verdict: ${result.verdict}`);
process.exitCode = result.verdict === "PASS" ? 0 : 1;
