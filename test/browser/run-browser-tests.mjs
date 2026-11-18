// Phase B browser tests against the real extension (src/) in Firefox.
// Usage: node test/browser/run-browser-tests.mjs [path-to-firefox.exe]
// Writes docs/evidence/phase-b/browser-results.json and popup screenshots.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox, sleep } from "./bidi.mjs";
import { syntheticAccounts, syntheticSecret } from "../../src/lib/fixtures.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(root, "docs/evidence/phase-b");
const FIREFOX = process.argv[2] ?? "C:/Program Files/Mozilla Firefox/firefox.exe";
const EXT_ID = "{f587432b-b553-483e-b08d-4feac6378113}";
const UUID = "6f1c2a7e-0b5d-4c3e-9a8f-1d2e3f4a5b6c"; // fixed test-profile UUID
const BASE = `moz-extension://${UUID}/`;
const IDLE_MS = 3000;
const LEGACY_PATH = join(root, "test/fixtures/legacy-synthetic.json");
const LEGACY_TEXT = readFileSync(LEGACY_PATH, "utf8");
const SECRETS = [...syntheticAccounts(100).map((a) => a.secret),
  ...JSON.parse(LEGACY_TEXT).otp_list.map((e) => e?.key).filter((k) => typeof k === "string" && k.length >= 16)];
const leaks = (text) => SECRETS.filter((s) => text.includes(s) || text.includes(s.toLowerCase()));

const results = [];
function record(id, name, pass, details) {
  results.push({ id, name, verdict: pass ? "PASS" : "FAIL", details });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}`);
}

const ff = await launchFirefox({ firefox: FIREFOX, prefs: {
  "extensions.webextensions.uuids": JSON.stringify({ [EXT_ID]: UUID }),
  "extensions.background.idle.timeout": IDLE_MS,
  "intl.locale.requested": "de",
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.startup.homepage_override.mstone": "ignore",
} });
const { call } = ff;

async function evalJson(ctx, fnSource) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: true,
    expression: `(${fnSource})().then((v) => JSON.stringify(v ?? null))` });
  if (r.type === "exception") throw new Error(`eval: ${r.exceptionDetails.text}`);
  return JSON.parse(r.result.value);
}
const msg = (ctx, cmd, args = {}) =>
  evalJson(ctx, `async () => browser.runtime.sendMessage(${JSON.stringify({ cmd, ...args })})`);
async function waitFor(ctx, cond, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await evalJson(ctx, `async () => (${cond})`)) return true; } catch { /* navigating */ }
    await sleep(50);
  }
  return false;
}
async function open(ctx, path) {
  await call("browsingContext.navigate", { context: ctx, url: BASE + path, wait: "complete" });
}
async function node(ctx, selector) {
  const r = await call("script.evaluate", { target: { context: ctx }, awaitPromise: false,
    expression: `document.querySelector(${JSON.stringify(selector)})`, resultOwnership: "root" });
  return { sharedId: r.result.sharedId };
}
async function clickAt(ctx, selector) { // trusted input → transient user activation
  const el = await node(ctx, selector);
  await call("input.performActions", { context: ctx, actions: [{ type: "pointer", id: "mouse",
    parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: el } },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }] });
}

const evidence = { startedAt: new Date().toISOString() };
try {
  const s = await call("session.new", { capabilities: {} });
  evidence.browser = { version: s.capabilities.browserVersion, platform: s.capabilities.platformName };
  evidence.install = await call("webExtension.install", { extensionData: { type: "path", path: join(root, "src") } });
  const opt = (await call("browsingContext.create", { type: "tab" })).context;
  const pop = (await call("browsingContext.create", { type: "tab" })).context;
  await call("browsingContext.setViewport", { context: pop, viewport: { width: 270, height: 600 } });
  await open(opt, "options/options.html");

  // B6: locked by default, every sensitive command fails closed
  {
    const st = await msg(opt, "status");
    const r = await Promise.all(["getCodes", "listAccounts", "activity"].map((c) => msg(opt, c)));
    const page = await waitFor(opt, "document.body.dataset.state === 'locked'");
    record("B6-1", "locked by default; sensitive commands rejected", st.result.unlocked === false &&
      r.every((x) => x.ok === false && x.error === "locked") && page, { status: st, responses: r });
  }

  // B3: layout for 1/25/50/100 accounts
  const layouts = {};
  for (const n of [1, 25, 50, 100]) {
    await msg(opt, "devUnlock", { count: n });
    const t0 = Date.now();
    await open(pop, "popup/popup.html");
    const rendered = await waitFor(pop, `document.body.dataset.rendered === "${n}"`, 10000);
    const ms = Date.now() - t0;
    const m = await evalJson(pop, `async () => {
      const rows = [...document.querySelectorAll("#list .row")];
      const list = document.getElementById("list"), footer = document.querySelector("footer");
      const cs = getComputedStyle(rows[0]);
      const out = { rows: rows.length, rowHeights: [...new Set(rows.map((r) => r.getBoundingClientRect().height))],
        bodyWidth: document.body.getBoundingClientRect().width, bodyHeight: document.body.getBoundingClientRect().height,
        docScrollWidth: document.documentElement.scrollWidth, listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight, fontFamily: cs.fontFamily, fontSize: cs.fontSize,
        codesOk: [...document.querySelectorAll("#list .code")].every((c) => /^\\d{6,8}$/.test(c.textContent)),
        ticker: document.getElementById("ticker").textContent };
      list.scrollTop = list.scrollHeight;
      await new Promise((r) => requestAnimationFrame(r));
      const lr = list.getBoundingClientRect(), last = rows.at(-1).getBoundingClientRect(), fr = footer.getBoundingClientRect();
      out.lastRowReachable = last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5;
      out.footerVisible = fr.top >= lr.bottom - 1 && fr.bottom <= innerHeight + 0.5;
      list.scrollTop = 0;
      return out; }`);
    m.renderMs = ms;
    layouts[n] = m;
    const pass = rendered && m.rows === n && m.rowHeights.length === 1 && m.rowHeights[0] === 25 &&
      m.bodyWidth === 270 && m.docScrollWidth <= 270 && m.bodyHeight <= 600 && m.lastRowReachable &&
      m.footerVisible && /monospace/.test(m.fontFamily) && m.codesOk && ms < 3000;
    record(`B3-${n}`, `popup layout with ${n} account(s)`, pass, m);
    if (n === 25) {
      for (const theme of ["dark", "light"]) {
        await evalJson(opt, `async () => browser.storage.local.set({ settings: { theme: "${theme}" } })`);
        await open(pop, "popup/popup.html");
        await waitFor(pop, `document.body.dataset.rendered === "25"`);
        const h = Math.ceil(m.bodyHeight);
        const shot = await call("browsingContext.captureScreenshot", { context: pop,
          clip: { type: "box", x: 0, y: 0, width: 270, height: h } });
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `popup-25-accounts-${theme}-de.png`), Buffer.from(shot.data, "base64"));
      }
      await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
    }
  }

  // B3: click-to-copy with real (trusted) pointer input and confirmation indicator
  {
    await open(pop, "popup/popup.html");
    await waitFor(pop, `document.body.dataset.rendered === "100"`);
    await clickAt(pop, "#list li:first-child .row");
    const ok = await waitFor(pop, `document.querySelector("#list .row").dataset.copied === "ok"`, 2000);
    const announce = await evalJson(pop, `async () => document.getElementById("announce").textContent`);
    const cleared = await waitFor(pop, `!document.querySelector("#list .row").dataset.copied`, 2500);
    record("B3-copy", "click copies (writeText resolved), indicator shown and reset", ok && cleared && !!announce,
      { copied: ok, announce, indicatorReset: cleared });
  }

  // B6: security boundary — responses, DOM and storage contain no secrets
  {
    const resp = { status: await msg(opt, "status"), codes: await msg(opt, "getCodes"),
      list: await msg(opt, "listAccounts"), preview: await msg(opt, "importPreview", { text: LEGACY_TEXT }) };
    await open(opt, "options/options.html");
    await waitFor(opt, "document.body.dataset.state === 'unlocked'");
    const dom = { popup: await evalJson(pop, `async () => document.documentElement.outerHTML`),
      options: await evalJson(opt, `async () => document.documentElement.outerHTML`) };
    const store = await evalJson(opt, `async () => {
      const local = await browser.storage.local.get();
      const sess = await browser.storage.session.get(); // test harness only
      let exportable = "unknown";
      try { await crypto.subtle.exportKey("raw", sess.session.key); exportable = "EXPORTED"; }
      catch (e) { exportable = e.name; }
      return { local: JSON.stringify(local), vault: JSON.stringify(sess.vault ?? null),
        keyType: Object.prototype.toString.call(sess.session?.key), extractable: sess.session?.key?.extractable,
        exportable, sessionKeys: Object.keys(sess) }; }`);
    const found = {
      responses: leaks(JSON.stringify(resp)), popupDom: leaks(dom.popup), optionsDom: leaks(dom.options),
      storageLocal: leaks(store.local), sessionVault: leaks(store.vault) };
    const pass = Object.values(found).every((a) => a.length === 0) && resp.codes.ok && resp.list.ok &&
      resp.preview.ok && store.keyType === "[object CryptoKey]" && store.extractable === false &&
      store.exportable === "InvalidAccessError" && !resp.list.result.accounts.some((a) => "secret" in a);
    record("B6-2", "no secrets in responses, DOM or storage; key non-extractable", pass,
      { leaksFound: found, keyType: store.keyType, extractable: store.extractable, exportKey: store.exportable,
        sessionKeys: store.sessionKeys, previewCounts: resp.preview.result?.counts });
  }

  // B4: account management through the options UI
  {
    await msg(opt, "devUnlock", { count: 3 });
    await open(opt, "options/options.html");
    await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 3");
    const names = () => evalJson(opt, `async () => [...document.querySelectorAll("#accounts td.name")].map((t) => t.textContent)`);
    const before = await names();
    await evalJson(opt, `async () => { const f = document.getElementById("accountForm").elements;
      f.name.value = "UI Added"; f.secret.value = "${syntheticAccounts(99)[98].secret.toLowerCase()}"; f.url.value = "ui.example";
      document.getElementById("accountForm").requestSubmit(); }`);
    const added = await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 4");
    const secretCleared = await evalJson(opt, `async () => document.getElementById("accountForm").elements.secret.value === ""`);
    await evalJson(opt, `async () => { document.querySelectorAll("#accounts td.actions")[0].children[2].click();
      const f = document.getElementById("accountForm").elements; f.name.value = "UI Renamed";
      document.getElementById("accountForm").requestSubmit(); }`);
    const renamed = await waitFor(opt, `document.querySelector("#accounts td.name").textContent === "UI Renamed"`);
    await evalJson(opt, `async () => document.querySelectorAll("#accounts td.actions")[0].children[1].click()`);
    const moved = await waitFor(opt, `document.querySelectorAll("#accounts td.name")[1].textContent === "UI Renamed"`);
    await evalJson(opt, `async () => { window.confirm = () => true; // test harness: auto-confirm
      document.querySelectorAll("#accounts td.actions")[3].children[3].click(); }`);
    const deleted = await waitFor(opt, "document.querySelectorAll('#accounts tbody tr').length === 3");
    const after = await names();
    const stale = await msg(opt, "deleteAccount", { id: "fixture-1", revision: 1 });
    record("B4-1", "create, edit, reorder, delete via options UI; stale revision rejected",
      added && secretCleared && renamed && moved && deleted && stale.error === "conflict",
      { before, after, added, secretFieldClearedAfterSave: secretCleared, renamed, moved, deleted, staleWrite: stale });
  }

  // B5: legacy import preview via a real file upload; nothing persisted
  {
    const revBefore = (await msg(opt, "listAccounts")).result.revision;
    const localBefore = await evalJson(opt, `async () => JSON.stringify(await browser.storage.local.get())`);
    // BiDi input.setFiles is refused for privileged (moz-extension) contexts in Firefox 160,
    // so the fixture is attached as a File via DataTransfer; the page code path is the same.
    await evalJson(opt, `async () => { const input = document.getElementById("importFile");
      const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(LEGACY_TEXT)}], "totp.json",
        { type: "application/json" }));
      input.files = dt.files; input.dispatchEvent(new Event("change")); }`);
    const shown = await waitFor(opt, "!document.getElementById('preview').hidden");
    const p = await evalJson(opt, `async () => ({
      statuses: [...document.querySelectorAll("#preview tbody tr")].map((r) => r.dataset.status),
      summary: document.getElementById("importSummary").textContent,
      applyDisabled: document.getElementById("importApply").disabled,
      html: document.getElementById("preview").outerHTML })`);
    const revAfter = (await msg(opt, "listAccounts")).result.revision;
    const localAfter = await evalJson(opt, `async () => JSON.stringify(await browser.storage.local.get())`);
    const expected = ["new", "new", "new", "duplicate", "name-conflict", "new", "invalid", "invalid", "invalid", "invalid", "invalid"];
    const malformed = await msg(opt, "importPreview", { text: "{not json" });
    record("B5-1", "legacy preview via file upload; no persistence; apply disabled; malformed rejected",
      shown && JSON.stringify(p.statuses) === JSON.stringify(expected) && p.applyDisabled &&
      revAfter === revBefore && localAfter === localBefore && leaks(p.html).length === 0 && malformed.error === "malformed",
      { statuses: p.statuses, summary: p.summary, applyDisabled: p.applyDisabled, revisionUnchanged: revAfter === revBefore,
        storageLocalUnchanged: localAfter === localBefore, malformed });
  }

  // B3: the REAL toolbar popup, opened by a native click on the toolbar button (grants
  // activeTab like a user click). The popup DOM is read via extension.getViews() from the
  // options page; panel geometry and the clipboard are read in the browser chrome.
  {
    const srv = createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end("<title>local</title>local test page"); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      await msg(opt, "devUnlock", { count: 24 });
      const { result: { revision } } = await msg(opt, "listAccounts");
      await msg(opt, "addAccount", { revision, account: { name: "Local Test Site", secret: syntheticSecret(500), url: "localhost" } });
      const site = (await call("browsingContext.create", { type: "tab" })).context;
      await call("browsingContext.navigate", { context: site, url: `http://localhost:${srv.address().port}/`, wait: "complete" });
      await call("browsingContext.activate", { context: site });
      const chrome = (await call("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
      // Native pointer input in the browser chrome: a real click on our toolbar button.
      const mouse = (actions) => call("input.performActions", { context: chrome,
        actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions }] });
      const btn = await evalJson(chrome, `async () => { const r = document.getElementById(
        "_f587432b-b553-483e-b08d-4feac6378113_-BAP").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`);
      await mouse([{ type: "pointerMove", x: Math.round(btn.x + btn.w / 2), y: Math.round(btn.y + btn.h / 2) },
        { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
      const opened = await waitFor(opt, `browser.extension.getViews({ type: "popup" })[0]?.document.body.dataset.rendered === "25"`, 5000) &&
        await waitFor(chrome, `[...document.querySelectorAll("browser")].find((x) => x.currentURI?.spec?.endsWith("/popup/popup.html"))
          ?.closest("panel")?.state === "open"`, 5000); // wait for the open animation to finish
      const panel = await evalJson(chrome, `async () => { const b = [...document.querySelectorAll("browser")]
        .find((x) => x.currentURI?.spec?.endsWith("/popup/popup.html")); const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, panelState: b.closest("panel")?.state }; }`);
      const pv = (body) => evalJson(opt, `async () => { const w = browser.extension.getViews({ type: "popup" })[0];
        const d = w.document; ${body} }`);
      const geo = await pv(`const list = d.getElementById("list"), rows = [...d.querySelectorAll("#list .row")];
        return { inner: [w.innerWidth, w.innerHeight], rows: rows.length,
          rowHeights: [...new Set(rows.map((r) => r.getBoundingClientRect().height))],
          current: [...d.querySelectorAll("#list li.current .name")].map((n) => n.textContent),
          scrollable: list.scrollHeight > list.clientHeight };`);
      record("B3-real-1", "real toolbar popup: 25 accounts, 25 px rows, within Firefox max 800×600",
        opened && geo.rows === 25 && geo.rowHeights.length === 1 && geo.rowHeights[0] === 25 &&
        geo.inner[0] === 270 && geo.inner[0] <= 800 && geo.inner[1] <= 600 && panel.panelState === "open" &&
        panel.w === geo.inner[0] && panel.h === geo.inner[1] && geo.scrollable, { geo, panel });
      record("B3-real-2", "active-site highlight after a real toolbar click (activeTab)",
        JSON.stringify(geo.current) === JSON.stringify(["Local Test Site"]), { highlighted: geo.current });


      // Scroll to the end inside the real popup geometry. BiDi pointer/wheel input does not
      // reach the popup panel (separate native widget), so the list is scrolled via scrollTop;
      // real wheel/touchpad scrolling is a manual check.
      await pv(`const list = d.getElementById("list"); list.scrollTop = list.scrollHeight;
        await new Promise((r) => w.requestAnimationFrame(r)); return true;`);
      const sc = await pv(`const list = d.getElementById("list"), rows = [...d.querySelectorAll("#list .row")];
        const lr = list.getBoundingClientRect(), last = rows.at(-1).getBoundingClientRect(), f = d.querySelector("footer").getBoundingClientRect();
        return { scrollTop: list.scrollTop, maxScroll: list.scrollHeight - list.clientHeight,
          lastRowVisible: last.top >= lr.top - 0.5 && last.bottom <= lr.bottom + 0.5,
          footerVisible: f.top >= lr.bottom - 1 && f.bottom <= w.innerHeight + 0.5,
          lastName: rows.at(-1).querySelector(".name").textContent };`);
      record("B3-real-3", "real popup: list scrolls to the last account; footer stays visible",
        sc.scrollTop > 0 && Math.abs(sc.scrollTop - sc.maxScroll) <= 1 && sc.lastRowVisible && sc.footerVisible, sc);

      // Click the last (now visible) row inside the real popup, then read the system
      // clipboard in chrome. The click is synthetic (element.click()) because native input
      // does not reach the panel; a trusted click was verified in B3-copy, a real mouse
      // click in the toolbar popup is a manual check.
      const target = await pv(`const row = [...d.querySelectorAll("#list .row")].at(-1);
        const code = row.querySelector(".code").textContent; row.click(); return { code };`);
      await sleep(300);
      const after = await pv(`const row = [...d.querySelectorAll("#list .row")].at(-1);
        return { copied: row.dataset.copied ?? null, code: row.querySelector(".code").textContent };`);
      const clip = await evalJson(chrome, `async () => {
        const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
        t.init(null); t.addDataFlavor("text/plain");
        Services.clipboard.getData(t, Services.clipboard.kGlobalClipboard, null);
        const o = {}; t.getTransferData("text/plain", o); return o.value.QueryInterface(Ci.nsISupportsString).data; }`);
      // Expected: Firefox refuses clipboard.writeText without user activation, so the
      // synthetic click must show the error indicator and must not write the clipboard.
      // A copy with a real mouse click in the toolbar popup is therefore MANUAL.
      const expectedRefusal = after.copied === "error" && clip !== target.code;
      results.push({ id: "B3-real-4", name: "real popup click-to-copy with a real mouse click",
        verdict: expectedRefusal ? "MANUAL" : "FAIL",
        details: { syntheticClickIndicator: after.copied, clipboardWritten: clip === target.code,
          note: "synthetic click correctly refused (no user activation); trusted click verified in B3-copy" } });
      console.log(`${expectedRefusal ? "MANUAL" : "FAIL"}  B3-real-4  real popup click-to-copy with a real mouse click`);
      await call("browsingContext.close", { context: site });
    } finally {
      srv.close();
    }
  }

  // B6: lock wipes session; popup falls back to the locked view
  {
    await msg(opt, "devUnlock", { count: 25 });
    await msg(opt, "lock");
    const codes = await msg(opt, "getCodes");
    const sess = await evalJson(opt, `async () => Object.keys(await browser.storage.session.get())`);
    await open(pop, "popup/popup.html");
    const lockedView = await waitFor(pop, "document.body.dataset.state === 'locked'");
    record("B6-3", "lock wipes key and vault; popup shows locked view", codes.error === "locked" &&
      !sess.includes("session") && !sess.includes("vault") && lockedView, { getCodes: codes, sessionKeys: sess, lockedView });
  }

  // B6: event page suspension/restart keeps the session usable
  {
    await msg(opt, "devUnlock", { count: 25 });
    const a = await msg(opt, "status");
    const c1 = await msg(opt, "getCodes");
    await call("browsingContext.navigate", { context: pop, url: "about:blank", wait: "complete" });
    await sleep(IDLE_MS * 3);
    const b = await msg(opt, "status");
    const c2 = await msg(opt, "getCodes");
    const restarted = a.result.startedAt !== b.result.startedAt;
    record("B6-4", "works after event page suspension and restart", restarted && c2.ok &&
      c2.result.revision === c1.result.revision && c2.result.codes.length === 25,
      { startedAtBefore: a.result.startedAt, startedAtAfter: b.result.startedAt, restarted, revision: c2.result?.revision });
  }

  // B6: auto-lock via alarm while idle (1 minute setting)
  {
    await evalJson(opt, `async () => browser.storage.local.set({ settings: { autoLockMinutes: 1 } })`);
    await msg(opt, "devUnlock", { count: 3 });
    const before = await msg(opt, "status");
    await sleep(65_000);
    const sess = await evalJson(opt, `async () => Object.keys(await browser.storage.session.get())`);
    const after = await msg(opt, "status");
    await evalJson(opt, `async () => browser.storage.local.remove("settings")`);
    record("B6-5", "auto-lock after 1 min idle wipes the session (alarm path)", before.result.unlocked &&
      !after.result.unlocked && !sess.includes("session"), { before: before.result, after: after.result, sessionKeys: sess });
  }
  evidence.layouts = layouts;
} catch (e) {
  evidence.fatal = e.stack;
  console.log(e.stack);
} finally {
  evidence.finishedAt = new Date().toISOString();
  await ff.close();
}

evidence.results = results;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "browser-results.json"), JSON.stringify(evidence, null, 2) + "\n");
const failed = results.filter((r) => r.verdict === "FAIL").length;
const manual = results.filter((r) => r.verdict === "MANUAL").length;
console.log(`${results.length - failed - manual}/${results.length} passed, ${manual} manual, ${failed} failed${evidence.fatal ? " (fatal error)" : ""}`);
process.exit(failed || evidence.fatal ? 1 : 0);
