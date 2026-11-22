import { call, t, localize, applyAppearance, errorText } from "../lib/ui.js";
import { loadSettings, validateSettings, DEFAULT_SETTINGS, APPEARANCE_KEYS } from "../lib/settings.js";
import { rowHeightPx, contrast, TEXT_CONTRAST } from "../lib/appearance.js";
import { MAX_IMPORT_BYTES } from "../lib/legacy.js";
import { legacyCompatibility, secretWarnings } from "../lib/accounts.js";

const $ = (id) => document.getElementById(id);
let state = { revision: 0, accounts: [] };
let editingId = null;

// Contextual status (operator feedback 01): every section has its own live region and the
// message appears where the user acts. Only one region holds text at a time, so a message is
// announced once. A region inside a hidden view (e.g. after a lock) falls back to the
// first status of its section (e.g. step 2 of a replacement that was just closed, F3-3),
// otherwise to the general vault status at the top.
function say(text, kind = "ok", where = "message") {
  let target = $(where);
  if (target?.closest("[hidden]")) target = target.closest("section")?.querySelector(".status");
  if (!target || target.closest("[hidden]")) target = $("message");
  for (const el of document.querySelectorAll(".status")) {
    if (el !== target) { el.textContent = ""; delete el.dataset.kind; }
  }
  target.textContent = text;
  target.dataset.kind = kind;
}
// A step with its own buttons names its status region (data-status), else the section's first.
const areaOf = (el) => el.closest("[data-status]")?.dataset.status ?? el.closest("section")?.querySelector(".status")?.id ?? "message";
// Bring a newly shown part into view and move the focus there (F3-3). Instant on purpose: it
// follows the user's own click, and Firefox stalls smooth scrolling in a covered window.
function reveal(focusEl, viewEl = focusEl) {
  focusEl.focus({ preventScroll: true });
  viewEl.scrollIntoView({ block: viewEl === focusEl ? "start" : "center" });
}

// Options tabs (#21): WAI-ARIA tabs pattern with automatic activation (arrow keys, Home,
// End). The selected tab lives in the location hash, so re-rendering, saving, importing or an
// error never switches it; a fresh page opens on "2FA entries". Leaving a tab clears its
// password fields: no password survives a tab switch.
const TABS = ["entries", "appearance", "general"];
const currentTab = () => TABS.find((t) => $(`tab-${t}`).getAttribute("aria-selected") === "true");
function selectTab(name, { focus = false } = {}) {
  if (!TABS.includes(name)) name = "entries";
  for (const t of TABS) {
    const on = t === name, tab = $(`tab-${t}`), panel = $(`panel-${t}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (!on && !panel.hidden) for (const p of panel.querySelectorAll('input[type="password"]')) p.value = "";
    panel.hidden = !on;
  }
  if (focus) $(`tab-${name}`).focus();
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
}
function initTabs() {
  for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => selectTab(t));
  $("tabs").addEventListener("keydown", (ev) => {
    const i = TABS.indexOf(currentTab());
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    selectTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
  });
  addEventListener("hashchange", () => selectTab(location.hash.slice(1)));
  selectTab(location.hash.slice(1));
}

// Vault-dependent parts of every tab are shown only while unlocked; a hint points to the
// setup or unlock form above the tabs otherwise.
function showVault(unlocked) {
  for (const el of document.querySelectorAll(".needs-vault")) el.hidden = !unlocked;
  for (const el of document.querySelectorAll(".locked-only")) el.hidden = unlocked;
}

async function run(fn, where = "message") {
  try { return await fn(); } catch (e) {
    if (e.code === "locked") await showLocked();
    say(errorText(e), "error", where);
    if (e.code === "conflict" || e.code === "unknown") await refresh(false); // show what storage holds
    return undefined;
  }
}

// Locked view: "setup" (no vault), "unlock" or "recover" (explicit, confirmed restore).
async function showLocked(mode) {
  if (!mode) mode = (await call("status")).initialized ? "unlock" : "setup";
  state = { revision: 0, accounts: [] };
  $("accounts").tBodies[0].replaceChildren();
  clearImport();
  clearReplace();
  $("previousBox").hidden = true;
  $("lockedView").hidden = false;
  showVault(false);
  $("lockBtn").hidden = true;
  for (const [id, m] of [["setupForm", "setup"], ["unlockForm", "unlock"], ["recoveryForm", "recover"]]) {
    $(id).hidden = m !== mode;
    $(id).reset();
  }
  resetForm();
  document.body.dataset.state = "locked";
  document.body.dataset.locked = mode;
}

// Password forms: inputs are cleared after every attempt; progress shown while PBKDF2 runs.
// `errors` maps a service reason to a complete, form-specific sentence (feedback 02). A
// session that expired or was locked meanwhile switches to the locked view and says that
// the action was not carried out.
function passwordForm(id, handler, { progress = "unlocking", after, errors = {} } = {}) {
  $(id).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = $(id), fields = [...form.elements], where = areaOf(form);
    const value = (f) => (f.type === "checkbox" ? f.checked : f.type === "file" ? f.files[0] : f.value);
    const values = Object.fromEntries(fields.filter((f) => f.name && f.type !== "submit" && (f.type !== "radio" || f.checked)).map((f) => [f.name, value(f)]));
    values.action = ev.submitter?.value; // forms with more than one action (#25)
    fields.forEach((f) => { f.disabled = true; });
    say(t(progress), "progress", where);
    try { await handler(values, where); }
    catch (e) {
      if (e.code === "locked") {
        if (document.body.dataset.state === "unlocked") await showLocked();
        say(t("lockedDuringAction"), "error");
        return;
      }
      const key = (e.reason && errors[e.reason]) || errors[e.code];
      if (key && errors.onError) errors.onError(e);
      say(key ? t(key)
        : e.reason === "unlock" || e.reason === "restore" ? t("unlockFailed") : e.reason === "damaged" ? t("vaultDamaged") : errorText(e), "error", where);
      if (e.code === "unknown") await refresh(false).catch(() => {}); // show what storage holds
    }
    finally {
      fields.forEach((f) => { f.disabled = false; if (f.type === "password") f.value = ""; });
      after?.();
    }
  });
}

async function refresh(clearMessage = true) {
  try {
    state = await call("listAccounts");
  } catch (e) {
    if (e.code === "locked") { await showLocked(); return; }
    throw e;
  }
  if (clearMessage) say("");
  $("lockedView").hidden = true;
  showVault(true);
  $("lockBtn").hidden = false;
  renderAccounts();
  updateExportForm();
  await showPrevious(); // before the state flips, so "unlocked" means the page is complete
  document.body.dataset.state = "unlocked";
}

function cell(cls, text) {
  const td = document.createElement("td");
  td.className = cls;
  td.textContent = text;
  return td;
}
// icon: a compact symbol instead of the word (F3-1); name and tooltip keep the word.
function button(key, name, onClick, disabled = false, icon = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = icon || t(key);
  if (icon) { b.className = "move"; b.title = t(key); } // not .icon: rows.css styles the popup copy icon
  b.setAttribute("aria-label", `${t(key)}: ${name}`);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function renderAccounts() {
  const rows = state.accounts.map((a, i) => {
    const tr = document.createElement("tr");
    const actions = cell("actions", "");
    actions.append(
      button("moveUp", a.name, () => move(a, i - 1), i === 0, "↑"),
      button("moveDown", a.name, () => move(a, i + 1), i === state.accounts.length - 1, "↓"),
      button("edit", a.name, () => edit(a)),
      button("delete", a.name, () => remove(a)));
    tr.append(cell("name", a.name), cell("site", a.url), cell("type", `${a.algorithm} · ${a.digits} · ${a.period}s`), actions);
    return tr;
  });
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = cell("empty", t("noAccounts"));
    td.colSpan = 4;
    tr.append(td);
    rows.push(tr);
  }
  $("accounts").tBodies[0].replaceChildren(...rows);
}

const mutate = (cmd, args, done, where) => run(async () => {
  const r = await call(cmd, { ...args, revision: state.revision });
  state.revision = r.revision;
  if (r.locked) { await showLocked(); say(t("savedLocked")); return true; }
  await refresh(false);
  say(t(r.warnings?.includes("short-secret") ? "savedWeak" : done ?? "saved"), "ok", where);
  return true;
}, where);

const move = (a, toIndex) => mutate("moveAccount", { id: a.id, toIndex }, undefined, "listStatus");
function remove(a) {
  if (confirm(t("confirmDelete", [a.name]))) mutate("deleteAccount", { id: a.id }, "deleted", "listStatus");
}

function edit(a) {
  editingId = a.id;
  const f = $("accountForm").elements;
  f.name.value = a.name;
  f.url.value = a.url;
  f.secret.value = "";
  f.algorithm.value = a.algorithm;
  f.digits.value = String(a.digits);
  f.period.value = String(a.period);
  $("secretHint").hidden = false;
  $("cancelEdit").hidden = false;
  $("formTitle").textContent = t("editAccount");
  f.name.focus();
}

function resetForm() {
  editingId = null;
  $("accountForm").reset();
  $("secretHint").hidden = true;
  $("secretWeak").hidden = true;
  $("cancelEdit").hidden = true;
  $("formTitle").textContent = t("addAccount");
}

async function submitAccount(ev) {
  ev.preventDefault();
  const f = $("accountForm").elements;
  const account = { name: f.name.value, url: f.url.value, algorithm: f.algorithm.value,
    digits: Number(f.digits.value), period: Number(f.period.value) };
  if (f.secret.value) account.secret = f.secret.value;
  const ok = await (editingId
    ? mutate("updateAccount", { id: editingId, patch: account }, undefined, "accountStatus")
    : mutate("addAccount", { account }, undefined, "accountStatus"));
  f.secret.value = ""; // never keep a secret in the page longer than needed
  $("secretWeak").hidden = true;
  if (ok) resetForm();
}

// Import (C5): the page keeps the preview's revision and file hash, the replacement names the
// user types, and a reference to the chosen File (not its text). The file is read again for
// the apply; the background checks that its hash matches the preview (operator feedback 01).
let importPlan = null;

function clearImport() {
  importPlan = null;
  $("preview").hidden = true;
  $("preview").tBodies[0].replaceChildren();
  $("importSummary").textContent = "";
  $("importSkipped").hidden = true;
  $("importSkippedList").replaceChildren();
  $("importApply").disabled = true;
  $("importCancel").hidden = true;
  $("importMasterLabel").hidden = true;
  $("importMasterPassword").value = "";
}

async function previewFile() {
  const input = $("importFile");
  const file = input.files[0];
  input.value = "";
  clearImport();
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) { say(t("errMalformed"), "error", "importStatus"); return; }
  const text = await file.text();
  const p = await run(() => call("importPreview", { text }), "importStatus");
  if (!p) return;
  say("", "ok", "importStatus");
  const label = { new: "statusNew", duplicate: "statusDuplicate", "name-conflict": "statusNameConflict",
    "needs-name": "statusNeedsName", invalid: "statusInvalid" };
  let unnamed = 0;
  const nameInputs = [];
  $("preview").tBodies[0].replaceChildren(...p.rows.map((r) => {
    const tr = document.createElement("tr");
    let status = t(label[r.status]);
    if (r.status === "invalid" && r.reason) status += ` (${browser.i18n.getMessage(`reason_${r.reason.replace(/-/g, "_")}`) || r.reason})`;
    if (r.warnings.includes("short-secret")) status += ` (${t("warnShort")})`;
    const st = cell(`status-${r.status}`, status);
    tr.dataset.status = r.status;
    const name = cell("name", r.name);
    if (r.status === "needs-name") { // editable replacement name, validated again on apply
      const field = document.createElement("input");
      field.type = "text";
      field.maxLength = 100;
      field.required = true;
      field.value = t("importUnnamed", [String(++unnamed)]);
      field.setAttribute("aria-label", `${t("importNameLabel")} (${t("importGeneratedName")})`);
      field.dataset.index = String(r.index);
      nameInputs.push(field);
      const hint = document.createElement("span"); // the name was generated, not in the file
      hint.className = "generated";
      hint.textContent = t("importGeneratedName");
      name.replaceChildren(field, " ", hint);
    }
    tr.append(name, cell("site", r.url), st);
    return tr;
  }));
  const c = p.counts;
  $("importSummary").textContent = t("importCounts", [String(c.new ?? 0), String(c.duplicate ?? 0),
    String(c["name-conflict"] ?? 0), String(c["needs-name"] ?? 0), String(c.invalid ?? 0)]);
  // Skipped rows with their reasons (names and reasons only), reported again after the apply.
  const skipped = p.rows.filter((r) => r.status === "duplicate" || r.status === "invalid").map((r) => ({
    name: r.name || "—",
    why: r.status === "duplicate" ? t("statusDuplicate")
      : `${t("statusInvalid")}${r.reason ? `: ${browser.i18n.getMessage(`reason_${r.reason.replace(/-/g, "_")}`) || r.reason}` : ""}`,
  }));
  importPlan = { revision: p.revision, fileHash: p.fileHash, nameInputs, file, skipped };
  $("preview").hidden = false;
  $("importCancel").hidden = false;
  $("importMasterLabel").hidden = false;
  $("importApply").disabled = !((c.new ?? 0) + (c["name-conflict"] ?? 0) + (c["needs-name"] ?? 0));
}

async function applyImport() {
  if (!importPlan) return;
  const { revision, fileHash, nameInputs, file, skipped } = importPlan;
  const names = Object.fromEntries(nameInputs.map((f) => [f.dataset.index, f.value]));
  const masterPassword = $("importMasterPassword").value;
  $("importMasterPassword").value = ""; // never kept in the page longer than needed
  $("importApply").disabled = true;
  say(t("importing"), "progress", "importStatus");
  let text;
  try { text = await file.text(); } catch { clearImport(); say(t("importReread"), "error", "importStatus"); return; }
  let r;
  try { r = await call("importApply", { revision, fileHash, text, names, masterPassword }); } catch (e) {
    // Only a fixable input error (e.g. a missing name) keeps this preview; anything else
    // (conflict, lock, unknown outcome) needs a new preview of the current vault.
    if (e.code === "invalid") $("importApply").disabled = false; else clearImport();
    if (e.code === "locked") await showLocked();
    else if (e.code !== "invalid") await refresh(false);
    say(errorText(e), "error", "importStatus");
    return;
  }
  clearImport();
  const done = skipped.length
    ? t("importDoneSkipped", [String(r.imported), String(skipped.length)])
    : t("importDone", [String(r.imported)]);
  if (r.locked) { await showLocked(); say(`${done} ${t("errLocked")}`); return; }
  state.revision = r.revision;
  await refresh(false);
  if (skipped.length) { // never silent: each skipped entry with its reason
    $("importSkippedSummary").textContent = t("importSkippedSummary", [String(skipped.length)]);
    $("importSkippedList").replaceChildren(...skipped.map((x) => {
      const li = document.createElement("li");
      li.textContent = `${x.name}: ${x.why}`;
      return li;
    }));
    $("importSkipped").hidden = false;
  }
  say(done, "ok", "importStatus");
}

// Appearance and behaviour settings (storage.local "settings", never vault data).
let settings;

function fillSettingsForm(s) {
  const f = $("settingsForm").elements;
  f.theme.value = s.theme;
  f.customColors.checked = s.customColors;
  f.fg.value = s.fg;
  f.bg.value = s.bg;
  f.fontSize.value = String(s.fontSize);
  f.rowHeight.value = String(s.rowHeight);
  f.sort.value = s.sort;
  f.autoLockMinutes.value = String(s.autoLockMinutes);
  f.idleLock.checked = s.idleLock;
  f.idleLockMinutes.value = String(s.idleLockMinutes);
  f.idleLockMinutes.disabled = !s.idleLock;
}

function readSettingsForm() {
  const f = $("settingsForm").elements;
  return validateSettings({ theme: f.theme.value, customColors: f.customColors.checked, fg: f.fg.value,
    bg: f.bg.value, fontSize: Number(f.fontSize.value), rowHeight: f.rowHeight.value, sort: f.sort.value,
    autoLockMinutes: Number(f.autoLockMinutes.value), idleLock: f.idleLock.checked,
    idleLockMinutes: Number(f.idleLockMinutes.value) });
}

// The options page follows only the theme (auto, light, dark). Custom colors, font size and
// row height belong to the popup list and are applied only to the preview box, which uses
// the same rows.css as the popup (operator feedback 01).
function showAppearance(s) {
  applyAppearance({ ...s, customColors: false });
  const tokens = applyAppearance(s, document.querySelector("#appearance .preview"));
  const f = $("settingsForm").elements;
  f.fg.disabled = f.bg.disabled = !s.customColors;
  $("fontSizeOut").textContent = `${s.fontSize} px`;
  // The chosen text color is kept in the settings; if it is too faint on the background the
  // popup uses a readable one. Say which color is used and why (feedback 02).
  $("contrastNote").hidden = !tokens.fgAdjusted;
  if (tokens.fgAdjusted) {
    const ratio = (Math.floor(contrast(s.fg, s.bg) * 10) / 10).toLocaleString(browser.i18n.getUILanguage());
    $("contrastNote").textContent = t("contrastAdjustedDetail", [s.fg, tokens.fg, ratio, String(TEXT_CONTRAST).replace(".", t("decimalSep"))]);
  }
  // Effective height of every choice, so that equal results at large font sizes are visible.
  for (const input of f.rowHeight) {
    const choice = input.value === "auto" ? "auto" : Number(input.value);
    input.parentElement.querySelector(".eff").textContent = ` (${t("rowEffective", [String(rowHeightPx(s.fontSize, choice))])})`;
  }
  const px = rowHeightPx(s.fontSize, s.rowHeight);
  $("rowNote").hidden = false;
  $("rowNote").textContent = s.rowHeight !== "auto" && px !== s.rowHeight
    ? t("rowRaised", [String(px)]) : t("rowEffectiveNote", [String(px)]);
}

async function saveSettings(next, where = "appearanceStatus") {
  settings = next;
  showAppearance(settings);
  await browser.storage.local.set({ settings });
  say(t("saved"), "ok", where);
}

// C3.4: the idle lock needs the optional "idle" permission. permissions.request() must run
// directly in the user's change handler; a denied or revoked permission switches it off.
const IDLE = { permissions: ["idle"] };
function idlePermission(checkbox) {
  if (checkbox.checked) return browser.permissions.request(IDLE).catch(() => false);
  return browser.permissions.remove(IDLE).catch(() => true).then(() => true);
}

async function initSettings() {
  settings = await loadSettings(browser.storage.local);
  if (settings.idleLock && !(await browser.permissions.contains(IDLE))) {
    settings = { ...settings, idleLock: false };
    await browser.storage.local.set({ settings });
  }
  fillSettingsForm(settings);
  showAppearance(settings);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => showAppearance(settings));
  const form = $("settingsForm");
  // The lock settings in the General tab belong to this form through the form attribute; their
  // events do not bubble through it, so both listeners sit on the document (#21).
  const ofForm = (t) => t === form || t.form === form;
  document.addEventListener("input", (ev) => { if (ofForm(ev.target)) showAppearance(readSettingsForm()); }); // live preview while dragging
  document.addEventListener("change", async (ev) => {
    if (!ofForm(ev.target)) return;
    const denied = ev.target.name === "idleLock" && !(await idlePermission(ev.target));
    if (denied) ev.target.checked = false;
    const next = readSettingsForm();
    fillSettingsForm(next); // normalizes rejected values
    const where = areaOf(ev.target);
    await saveSettings(next, where);
    if (denied) say(t("idlePermissionDenied"), "error", where);
  });
  $("resetAppearance").addEventListener("click", async () => {
    const next = { ...settings };
    for (const k of APPEARANCE_KEYS) next[k] = DEFAULT_SETTINGS[k];
    fillSettingsForm(next);
    await saveSettings(next);
  });
}

// Export (C4). The file is created in the background after a fresh master-password check;
// the page only receives the finished text, downloads it once and keeps no copy.
function download(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0); // after the download has started
}

const LEGACY_REASONS = { algorithm: (a) => a.algorithm, digits: (a) => `${a.digits}`, period: (a) => `${a.period} s` };
function updateExportForm() {
  const f = $("exportForm").elements;
  const kind = f.kind.value, encrypted = kind === "encrypted", own = encrypted && !f.useMasterPassword.checked;
  $("exportEncryptedFields").hidden = !encrypted;
  $("exportPlainFields").hidden = encrypted;
  f.exportPassword.disabled = f.confirm.disabled = !own;
  f.exportPassword.required = f.confirm.required = own;
  f.confirmed.required = !encrypted;
  let blocked = false;
  $("legacyReport").hidden = kind !== "legacy";
  if (kind === "legacy") {
    const c = legacyCompatibility(state.accounts);
    blocked = !c.compatible;
    $("legacyStatus").textContent = c.compatible ? t("legacyCompatible", [String(state.accounts.length)]) : t("legacyIncompatible");
    $("legacyList").replaceChildren(...c.incompatible.map((r) => {
      const li = document.createElement("li");
      li.textContent = `${r.name}: ${r.reasons.map((k) => LEGACY_REASONS[k](r)).join(", ")}`;
      return li;
    }));
  }
  $("exportButton").disabled = blocked;
}

async function submitExport({ kind, password, exportPassword, confirm, useMasterPassword, confirmed }, where) {
  const r = await call("exportVault", { kind, password, exportPassword, confirm, useMasterPassword, confirmed });
  download(r.fileName, r.text);
  $("exportForm").elements.confirmed.checked = false;
  say(t(kind === "encrypted" ? "exportDone" : "exportPlainDone", [String(r.count)]), "ok", where);
}

// Restore or replace from an encrypted backup (#25 V2, docs/PLAN-25-REPLACE-V2.md). One check
// sends the file text and both passwords once; the password fields are cleared on the answer.
// The page keeps only the single-use token (this variable, never the DOM or storage) until the
// replacement, a cancel, a lock, the expiry or leaving the page; the backup contents stay in
// the background, sealed.
let replacePlan = null;
let replaceTimer = 0;
const listItems = (el, names, total) => {
  el.replaceChildren(...names.map((n) => { const li = document.createElement("li"); li.textContent = n; return li; }));
  if (total > names.length) { const li = document.createElement("li"); li.textContent = t("replaceMore", [String(total - names.length)]); el.append(li); }
};

// Forgets the checked replacement in the page; tellService also drops it in the background.
function clearReplace(tellService = false) {
  if (tellService && replacePlan) call("replaceCancel").catch(() => {});
  replacePlan = null;
  clearTimeout(replaceTimer);
  if ($("replaceDialog").open) $("replaceDialog").close();
  $("replacePreview").hidden = true;
  for (const id of ["replaceLoseList", "replaceGainList"]) $(id).replaceChildren();
}

// An error of the check: shown in view, the field at fault cleared and focused, the file kept.
function checkFailed(e) {
  const f = $("restoreExportForm").elements;
  const field = e.reason === "current-password" ? f.masterPassword
    : ["import-decrypt", "password"].includes(e.reason) ? f.password : null;
  const key = { "current-password": "restoreWrongMaster", "import-decrypt": "restoreDecryptFailed", "import-too-many": "replaceTooMany",
    "replace-too-large": "replaceTooLarge", malformed: "replaceInvalidFile" }[e.reason ?? e.code];
  say(key ? t(key) : errorText(e), "error", "restoreStatus");
  for (const x of f) x.disabled = false; // a disabled field cannot take the focus
  if (field) { field.value = ""; field.setAttribute("aria-invalid", "true"); }
  (field ?? f.file).focus({ preventScroll: true });
  // finding 1: never at or below the edge of the visible area
  const r = $("restoreStatus").getBoundingClientRect();
  if (r.top < 40 || r.bottom > innerHeight - 40) $("restoreStatus").scrollIntoView({ block: "center" });
}

async function checkReplace(ev) {
  ev.preventDefault();
  const form = $("restoreExportForm"), f = form.elements, file = f.file.files[0];
  clearReplace(); // the new check itself drops an older pending replacement in the background
  if (!file) return;
  const fields = [...f];
  fields.forEach((x) => { x.disabled = true; x.removeAttribute("aria-invalid"); });
  say(t("replaceChecking"), "progress", "restoreStatus");
  try {
    let text;
    try { text = await file.text(); } catch { say(t("importReread"), "error", "restoreStatus"); return; }
    const p = await call("replacePreview", { text, password: f.password.value, masterPassword: f.masterPassword.value });
    f.password.value = ""; f.masterPassword.value = ""; // validated: never kept in the page
    showReplacePreview(p);
  } catch (e) {
    if (e.code === "locked") { await showLocked(); say(t("lockedDuringAction"), "error"); return; }
    checkFailed(e);
  } finally {
    fields.forEach((x) => { x.disabled = false; });
  }
}

function showReplacePreview(p) {
  const populated = p.currentCount > 0;
  replacePlan = { token: p.token, expiresAt: p.expiresAt, populated, currentCount: p.currentCount, backupCount: p.backupCount };
  $("replaceSummary").textContent = populated
    ? t("replaceCounts", [String(p.currentCount), String(p.backupCount), String(p.inBoth)])
    : t("restorePreviewEmpty", [String(p.backupCount)]);
  $("replaceLoseIntro").hidden = $("replaceLoseList").hidden = !populated;
  if (populated) {
    $("replaceLoseIntro").textContent = p.onlyCurrent.count ? t("replaceLoseIntro", [String(p.onlyCurrent.count)]) : t("replaceLoseNone");
    listItems($("replaceLoseList"), p.onlyCurrent.names, p.onlyCurrent.count);
  }
  $("replaceGainIntro").hidden = $("replaceGainList").hidden = !(populated && p.onlyBackup.count);
  if (populated && p.onlyBackup.count) {
    $("replaceGainIntro").textContent = t("replaceGainIntro", [String(p.onlyBackup.count)]);
    listItems($("replaceGainList"), p.onlyBackup.names, p.onlyBackup.count);
  }
  $("replaceKeepNote").hidden = !populated;
  $("replaceKeepNote").textContent = t("replaceKeepsCopy");
  $("replaceOverwritesCopy").hidden = !(populated && p.keptCopy.exists); // exactly one kept copy (review B)
  if (populated && p.keptCopy.exists) $("replaceOverwritesCopy").textContent = t("replaceOverwritesCopy", [when(p.keptCopy.replacedAt)]);
  $("replaceButton").textContent = t(populated ? "replaceNow" : "restoreExportButton");
  $("replacePreview").hidden = false;
  for (const el of document.querySelectorAll(".status")) { el.textContent = ""; delete el.dataset.kind; } // the preview is the answer
  replaceTimer = setTimeout(replaceExpired, Math.max(0, p.expiresAt - Date.now()));
  reveal($("replacePreviewTitle"));
}

function replaceExpired() {
  if (!replacePlan) return;
  clearReplace(true);
  say(t("replaceExpired"), "error", "restoreStatus");
  reveal($("restoreTitle"), $("restoreStatus"));
}

const when = (ms) => new Date(ms).toLocaleString(browser.i18n.getUILanguage());

// "Replace vault now": the one confirmation for a populated vault; an empty vault loses
// nothing and is restored directly.
function askReplace() {
  if (!replacePlan) return;
  if (Date.now() >= replacePlan.expiresAt) { replaceExpired(); return; }
  if (!replacePlan.populated) { applyReplace(); return; }
  $("replaceDialogText").textContent = t("replaceDialogText", [String(replacePlan.currentCount), String(replacePlan.backupCount)]);
  $("replaceDialog").showModal(); // focus starts on Cancel (autofocus)
}

async function applyReplace() {
  if (!replacePlan) return;
  if (Date.now() >= replacePlan.expiresAt) { replaceExpired(); return; }
  const { token, populated } = replacePlan;
  clearReplace(); // the token is single use: gone from the page now
  say(t("replacing"), "progress", "restoreStatus");
  let r;
  try { r = await call("replaceApply", { token }); }
  catch (e) {
    if (e.code === "locked") { await showLocked(); say(t("lockedDuringAction"), "error"); return; }
    const key = { "replace-expired": "replaceExpired", "replace-failed": "replaceFailed", conflict: "replaceConflict" }[e.reason ?? e.code];
    say(key ? t(key) : errorText(e), "error", "restoreStatus");
    if (e.code === "unknown") await refresh(false).catch(() => {}); // show what storage holds
    reveal($("restoreTitle"), $("restoreStatus"));
    return;
  }
  const done = populated ? t("replaceDone", [String(r.replaced), String(r.previous)]) : t("restoreExportDone", [String(r.replaced)]);
  if (r.locked) { await showLocked(); say(`${done} ${t("errLocked")}`); return; }
  await refresh(false);
  say(done, "ok", "restoreStatus");
  reveal($("restoreTitle"), $("restoreStatus"));
}

let previousInfo = null; // what the box shows: time and count of the kept copy
async function showPrevious() {
  let p = { exists: false };
  try { p = await call("previousStatus"); } catch { /* locked: the box stays hidden */ }
  previousInfo = p.exists ? p : null;
  if (!p.exists && $("previousDialog").open) $("previousDialog").close();
  $("previousBox").hidden = !p.exists;
  $("changePrevious").hidden = !p.exists; // a password change would drop it: say so first
  $("changeForm").elements.discardPrevious.required = p.exists;
  if (p.exists) {
    $("previousText").textContent = t("previousText", [when(p.replacedAt), p.count === null ? "?" : String(p.count)]);
    $("changePreviousText").textContent = t("changePreviousText", [when(p.replacedAt)]);
  }
}

// Restore or discard the kept copy (#25 V2 §7): the master password is typed once in the box;
// the button opens one dialog (focus on Cancel); only its confirm button sends the request,
// with confirmed: true. The service still verifies the password and the confirmation.
let previousAction = null;
function askPrevious(ev) {
  ev.preventDefault();
  if (previousAction || !previousInfo) return; // a request is running, or nothing is kept
  const action = ev.submitter?.value === "discard" ? "discard" : "restore";
  const vars = [when(previousInfo.replacedAt), previousInfo.count === null ? "?" : String(previousInfo.count)];
  $("previousDialogTitle").textContent = t(action === "discard" ? "previousDiscardTitle" : "previousRestoreTitle");
  $("previousDialogText").textContent = action === "discard" ? t("previousDiscardText", vars)
    : t("previousRestoreText", [String(state.accounts.length), ...vars]);
  $("previousDialogConfirm").textContent = t(action === "discard" ? "previousDiscardConfirm" : "previousRestoreConfirm");
  $("previousDialogConfirm").className = action === "discard" ? "danger" : "primary";
  $("previousDialog").dataset.action = action;
  $("previousDialog").showModal(); // focus starts on Cancel (autofocus)
}

async function runPrevious(action) {
  const f = $("previousForm").elements, fields = [...f];
  previousAction = action;
  fields.forEach((x) => { x.disabled = true; x.removeAttribute("aria-invalid"); });
  say(t("replacing"), "progress", "previousStatus");
  try {
    const args = { masterPassword: f.masterPassword.value, confirmed: true };
    if (action === "discard") {
      await call("discardPrevious", args);
      f.masterPassword.value = "";
      await showPrevious(); // the box closes: the message falls back to the section's status
      say(t("previousDiscarded"), "ok", "previousStatus");
      reveal($("restoreTitle"), $("restoreStatus"));
      return;
    }
    const r = await call("restorePrevious", args);
    f.masterPassword.value = "";
    if (r.locked) { await showLocked(); say(`${t("previousRestored", [String(r.replaced)])} ${t("errLocked")}`); return; }
    await refresh(false);
    say(t("previousRestored", [String(r.replaced)]), "ok", "previousStatus");
    fields.forEach((x) => { x.disabled = false; });
    reveal($("previousRestoreButton"), $("previousStatus")); // back to the opening button; the message in view
  } catch (e) {
    if (e.code === "locked") { await showLocked(); say(t("lockedDuringAction"), "error"); return; }
    fields.forEach((x) => { x.disabled = false; });
    const key = { "current-password": "restoreWrongMaster", "replace-failed": "replaceFailed", conflict: "replaceConflict",
      "no-previous": "previousGone" }[e.reason ?? e.code];
    say(key ? t(key) : errorText(e), "error", "previousStatus");
    if (e.reason === "current-password") { f.masterPassword.value = ""; f.masterPassword.setAttribute("aria-invalid", "true"); }
    f.masterPassword.focus({ preventScroll: true });
    $("previousStatus").scrollIntoView({ block: "center" });
    if (e.code === "unknown") await refresh(false).catch(() => {}); // show what storage holds
  } finally {
    fields.forEach((x) => { x.disabled = false; });
    previousAction = null;
  }
}

async function init() {
  localize();
  initTabs();
  await initSettings();
  $("accountForm").addEventListener("submit", submitAccount);
  // Shared secret policy: a valid but short secret is accepted with a visible warning.
  $("accountForm").elements.secret.addEventListener("input", (ev) => {
    $("secretWeak").hidden = !secretWarnings(ev.target.value).includes("short-secret");
  });
  $("cancelEdit").addEventListener("click", resetForm);
  $("importFile").addEventListener("change", previewFile);
  $("importApply").addEventListener("click", applyImport);
  $("importCancel").addEventListener("click", async () => {
    clearImport();
    await call("importCancel").catch(() => {});
    say(t("importCancelled"), "ok", "importStatus");
  });
  $("lockBtn").addEventListener("click", async () => { await call("lock"); await showLocked("unlock"); });
  passwordForm("setupForm", async ({ password, confirm }) => {
    await call("setup", { password, confirm });
    await refresh(false);
    say(t("setupDone"));
  });
  passwordForm("unlockForm", async ({ password }) => {
    const r = await call("unlock", { password });
    if (r.recoverable) { await showLocked("recover"); say(t("recoverableText"), "error"); return; }
    await refresh();
  });
  passwordForm("recoveryForm", async ({ password, confirmed }) => {
    await call("restore", { password, confirmed });
    await refresh(false);
    say(t("restoreDone"));
  });
  passwordForm("changeForm", async ({ current, next, confirm, discardPrevious }) => {
    try { await call("changePassword", { current, next, confirm, discardPrevious: discardPrevious === true }); }
    catch (e) { if (e.code === "locked" || e.reason === "current-password") await showLocked(); throw e; }
    await showLocked("unlock"); // the old session is gone; unlock with the new password
    say(t("passwordChanged"));
  }, { errors: { "previous-exists": "changePreviousNeeded" } });
  passwordForm("exportForm", submitExport, { progress: "exporting", after: updateExportForm });
  $("previousForm").addEventListener("submit", askPrevious);
  $("previousForm").addEventListener("input", (ev) => ev.target.removeAttribute("aria-invalid"));
  $("previousDialogConfirm").addEventListener("click", () => { $("previousDialog").close("confirm"); });
  $("previousDialogCancel").addEventListener("click", () => { $("previousDialog").close(); });
  $("previousDialog").addEventListener("close", () => {
    const d = $("previousDialog"), action = d.dataset.action;
    if (d.returnValue === "confirm") { d.returnValue = ""; runPrevious(action); return; }
    // Cancel or Escape: back to the button that opened the dialog
    if (!$("previousBox").hidden) $(action === "discard" ? "previousDiscardButton" : "previousRestoreButton").focus();
  });
  $("restoreExportForm").addEventListener("submit", checkReplace);
  // A changed file or password after the check makes the preview stale (another check needed).
  $("restoreExportForm").addEventListener("input", (ev) => {
    ev.target.removeAttribute("aria-invalid");
    if (replacePlan) clearReplace(true);
  });
  $("replaceButton").addEventListener("click", askReplace);
  $("replaceDialogConfirm").addEventListener("click", () => { $("replaceDialog").close("replace"); });
  $("replaceDialogCancel").addEventListener("click", () => { $("replaceDialog").close(); });
  $("replaceDialog").addEventListener("close", () => {
    if ($("replaceDialog").returnValue === "replace") { $("replaceDialog").returnValue = ""; applyReplace(); }
    else if (replacePlan) $("replaceButton").focus(); // Cancel or Escape: back where the user was
  });
  $("replaceCancel").addEventListener("click", () => {
    clearReplace(true);
    say(t("replaceCancelled"), "ok", "restoreStatus");
    reveal($("restoreTitle"), $("restoreStatus"));
  });
  window.addEventListener("pagehide", () => clearReplace(true)); // best effort; the token dies with the page anyway
  $("exportForm").addEventListener("change", updateExportForm);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  await refresh();
}

init();
