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
// general vault status at the top.
function say(text, kind = "ok", where = "message") {
  let target = $(where);
  if (!target || target.closest("[hidden]")) target = $("message");
  for (const el of document.querySelectorAll(".status")) {
    if (el !== target) { el.textContent = ""; delete el.dataset.kind; }
  }
  target.textContent = text;
  target.dataset.kind = kind;
}
const areaOf = (el) => el.closest("section")?.querySelector(".status")?.id ?? "message";

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
  $("unlockedView").hidden = true;
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
  $("unlockedView").hidden = false;
  $("lockBtn").hidden = false;
  renderAccounts();
  updateExportForm();
  document.body.dataset.state = "unlocked";
  await showPrevious();
}

function cell(cls, text) {
  const td = document.createElement("td");
  td.className = cls;
  td.textContent = text;
  return td;
}
function button(key, name, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = t(key);
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
      button("moveUp", a.name, () => move(a, i - 1), i === 0),
      button("moveDown", a.name, () => move(a, i + 1), i === state.accounts.length - 1),
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
  form.addEventListener("input", () => showAppearance(readSettingsForm())); // live preview while dragging
  form.addEventListener("change", async (ev) => {
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

// Restore or replace from an encrypted backup (#25). Step 1 opens the backup and shows what
// would change; afterwards the page keeps only the File reference (until the apply, a cancel
// or a lock). The export password is discarded after the check and entered again for the
// replacement (architecture review, condition A); no backup contents are kept.
let replacePlan = null;

function clearReplace() {
  replacePlan = null;
  $("replacePreview").hidden = true;
  $("replaceForm").reset();
  $("replaceLoseList").replaceChildren();
}

async function previewReplace({ file, password }, where) {
  clearReplace();
  $("restoreExportForm").elements.file.value = "";
  if (!file) return;
  const p = await call("replacePreview", { text: await file.text(), password });
  const populated = p.currentCount > 0;
  replacePlan = { file, revision: p.revision, fileHash: p.fileHash, populated };
  $("replaceSummary").textContent = t("replaceSummary", [String(p.backupCount)]);
  $("replaceWarning").hidden = !populated;
  $("replaceConfirmLabel").hidden = !populated;
  $("replaceForm").elements.confirmed.required = populated;
  $("replaceButton").textContent = t(populated ? "replaceButton" : "restoreExportButton");
  if (populated) {
    $("replaceWarningText").textContent = t("replaceWarning", [String(p.currentCount), String(p.backupCount), String(p.inBoth)]);
    $("replaceLoseIntro").textContent = p.onlyCurrent.count ? t("replaceLoseIntro", [String(p.onlyCurrent.count)]) : t("replaceLoseNone");
    $("replaceLoseList").replaceChildren(...p.onlyCurrent.names.map((n) => { const li = document.createElement("li"); li.textContent = n; return li; }));
    if (p.onlyCurrent.count > p.onlyCurrent.names.length) {
      const li = document.createElement("li");
      li.textContent = t("replaceMore", [String(p.onlyCurrent.count - p.onlyCurrent.names.length)]);
      $("replaceLoseList").append(li);
    }
    $("replaceConfirmText").textContent = t("replaceConfirm", [String(p.currentCount)]);
    $("replaceOverwritesCopy").hidden = !p.keptCopy.exists; // exactly one kept copy (review B)
    if (p.keptCopy.exists) $("replaceOverwritesCopy").textContent = t("replaceOverwritesCopy", [when(p.keptCopy.replacedAt)]);
  }
  $("replacePreview").hidden = false;
  say(t("replaceChecked"), "ok", where);
}

const when = (ms) => new Date(ms).toLocaleString(browser.i18n.getUILanguage());

async function applyReplace({ confirmed, exportPassword: password, masterPassword }, where) {
  if (!replacePlan) return;
  const { file, revision, fileHash, populated } = replacePlan;
  let text;
  try { text = await file.text(); } catch { clearReplace(); say(t("importReread"), "error", where); return; }
  const r = await call("replaceApply", { revision, fileHash, text, password, masterPassword, confirmed });
  clearReplace();
  const done = populated ? t("replaceDone", [String(r.replaced), String(r.previous)]) : t("restoreExportDone", [String(r.replaced)]);
  if (r.locked) { await showLocked(); say(`${done} ${t("errLocked")}`); return; }
  await refresh(false);
  say(done, "ok", where);
}

async function showPrevious() {
  let p = { exists: false };
  try { p = await call("previousStatus"); } catch { /* locked: the box stays hidden */ }
  $("previousBox").hidden = !p.exists;
  $("changePrevious").hidden = !p.exists; // a password change would drop it: say so first
  $("changeForm").elements.discardPrevious.required = p.exists;
  if (p.exists) {
    $("previousText").textContent = t("previousText", [when(p.replacedAt), p.count === null ? "?" : String(p.count)]);
    $("changePreviousText").textContent = t("changePreviousText", [when(p.replacedAt)]);
  }
}

async function submitPrevious({ action, confirmed, masterPassword }, where) {
  if (action === "discard") {
    await call("discardPrevious", { masterPassword, confirmed });
    await showPrevious();
    say(t("previousDiscarded"), "ok", where);
    return;
  }
  const r = await call("restorePrevious", { masterPassword, confirmed });
  if (r.locked) { await showLocked(); say(`${t("previousRestored", [String(r.replaced)])} ${t("errLocked")}`); return; }
  await refresh(false);
  say(t("previousRestored", [String(r.replaced)]), "ok", where);
}

async function init() {
  localize();
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
  const replaceErrors = { "current-password": "restoreWrongMaster", "import-decrypt": "restoreDecryptFailed",
    "replace-confirmation": "replaceNeedConfirm", "replace-failed": "replaceFailed", "import-too-many": "replaceTooMany",
    conflict: "replaceConflict", malformed: "replaceInvalidFile", "no-previous": "previousGone" };
  passwordForm("restoreExportForm", previewReplace, { progress: "replaceChecking", errors: replaceErrors });
  passwordForm("replaceForm", applyReplace, { progress: "replacing", errors: { ...replaceErrors, onError: (e) => {
    if (e.code !== "invalid") clearReplace(); // conflict or unknown: a new check is needed
    if (e.code === "unknown") refresh(false).catch(() => {});
  } } });
  passwordForm("previousForm", submitPrevious, { progress: "replacing", errors: replaceErrors });
  $("replaceCancel").addEventListener("click", async () => {
    clearReplace();
    await call("replaceCancel").catch(() => {});
    say(t("replaceCancelled"), "ok", "restoreStatus");
  });
  $("exportForm").addEventListener("change", updateExportForm);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  await refresh();
}

init();
