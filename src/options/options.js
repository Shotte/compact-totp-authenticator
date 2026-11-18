import { call, t, localize, applyAppearance, followSystemScheme, errorText } from "../lib/ui.js";
import { loadSettings, validateSettings, DEFAULT_SETTINGS, APPEARANCE_KEYS } from "../lib/settings.js";
import { rowHeightPx } from "../lib/appearance.js";
import { MAX_IMPORT_BYTES } from "../lib/legacy.js";

const $ = (id) => document.getElementById(id);
let state = { revision: 0, accounts: [] };
let editingId = null;

function say(text, kind = "ok") {
  $("message").textContent = text;
  $("message").dataset.kind = kind;
}

async function run(fn) {
  try { return await fn(); } catch (e) {
    say(errorText(e), "error");
    if (e.code === "locked") showLocked();
    if (e.code === "conflict") await refresh(false);
    return undefined;
  }
}

// Locked view: "setup" (no vault), "unlock" or "recover" (explicit, confirmed restore).
async function showLocked(mode) {
  if (!mode) mode = (await call("status")).initialized ? "unlock" : "setup";
  state = { revision: 0, accounts: [] };
  $("accounts").tBodies[0].replaceChildren();
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
function passwordForm(id, handler) {
  $(id).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = $(id), fields = [...form.elements];
    const values = Object.fromEntries(fields.filter((f) => f.name).map((f) => [f.name, f.type === "checkbox" ? f.checked : f.value]));
    fields.forEach((f) => { f.disabled = true; });
    say(t("unlocking"), "progress");
    try { await handler(values); }
    catch (e) { say(e.reason === "unlock" || e.reason === "restore" ? t("unlockFailed") : errorText(e), "error"); }
    finally {
      fields.forEach((f) => { f.disabled = false; if (f.type === "password") f.value = ""; });
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
  document.body.dataset.state = "unlocked";
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

const mutate = (cmd, args, done) => run(async () => {
  ({ revision: state.revision } = await call(cmd, { ...args, revision: state.revision }));
  await refresh(false);
  say(t(done ?? "saved"));
  return true;
});

const move = (a, toIndex) => mutate("moveAccount", { id: a.id, toIndex });
function remove(a) {
  if (confirm(t("confirmDelete", [a.name]))) mutate("deleteAccount", { id: a.id }, "deleted");
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
    ? mutate("updateAccount", { id: editingId, patch: account })
    : mutate("addAccount", { account }));
  f.secret.value = ""; // never keep a secret in the page longer than needed
  if (ok) resetForm();
}

async function previewFile() {
  const input = $("importFile");
  const file = input.files[0];
  input.value = "";
  $("preview").hidden = true;
  $("importSummary").textContent = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) { say(t("errMalformed"), "error"); return; }
  const text = await file.text();
  const p = await run(() => call("importPreview", { text }));
  if (!p) return;
  say("");
  const label = { new: "statusNew", duplicate: "statusDuplicate", "name-conflict": "statusNameConflict", invalid: "statusInvalid" };
  $("preview").tBodies[0].replaceChildren(...p.rows.map((r) => {
    const tr = document.createElement("tr");
    let status = t(label[r.status]);
    if (r.warnings.includes("short-secret")) status += ` (${t("warnShort")})`;
    const st = cell(`status-${r.status}`, status);
    tr.dataset.status = r.status;
    tr.append(cell("name", r.name), cell("site", r.url), st);
    return tr;
  }));
  const c = p.counts;
  $("importSummary").textContent = t("importCounts",
    [String(c.new ?? 0), String(c.duplicate ?? 0), String(c["name-conflict"] ?? 0), String(c.invalid ?? 0)]);
  $("preview").hidden = false;
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
}

function readSettingsForm() {
  const f = $("settingsForm").elements;
  return validateSettings({ theme: f.theme.value, customColors: f.customColors.checked, fg: f.fg.value,
    bg: f.bg.value, fontSize: Number(f.fontSize.value), rowHeight: f.rowHeight.value, sort: f.sort.value,
    autoLockMinutes: Number(f.autoLockMinutes.value) });
}

// Applies to this page (the preview uses the same rows.css as the popup) and shows hints.
function showAppearance(s) {
  const tokens = applyAppearance(s);
  const f = $("settingsForm").elements;
  f.fg.disabled = f.bg.disabled = !s.customColors;
  $("fontSizeOut").textContent = `${s.fontSize} px`;
  $("contrastNote").hidden = !tokens.fgAdjusted;
  const px = rowHeightPx(s.fontSize, s.rowHeight);
  $("rowNote").hidden = s.rowHeight === "auto" || px === s.rowHeight;
  $("rowNote").textContent = t("rowRaised", [String(px)]);
}

async function saveSettings(next) {
  settings = next;
  showAppearance(settings);
  await browser.storage.local.set({ settings });
  say(t("saved"));
}

async function initSettings() {
  settings = await loadSettings(browser.storage.local);
  fillSettingsForm(settings);
  showAppearance(settings);
  followSystemScheme(() => settings);
  const form = $("settingsForm");
  form.addEventListener("input", () => showAppearance(readSettingsForm())); // live preview while dragging
  form.addEventListener("change", async () => {
    const next = readSettingsForm();
    fillSettingsForm(next); // normalizes rejected values
    await saveSettings(next);
  });
  $("resetAppearance").addEventListener("click", async () => {
    const next = { ...settings };
    for (const k of APPEARANCE_KEYS) next[k] = DEFAULT_SETTINGS[k];
    fillSettingsForm(next);
    await saveSettings(next);
  });
}

async function init() {
  localize();
  await initSettings();
  $("accountForm").addEventListener("submit", submitAccount);
  $("cancelEdit").addEventListener("click", resetForm);
  $("importFile").addEventListener("change", previewFile);
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
  passwordForm("changeForm", async ({ current, next, confirm }) => {
    try { await call("changePassword", { current, next, confirm }); }
    catch (e) { if (e.code === "locked" || e.reason === "current-password") await showLocked(); throw e; }
    await showLocked("unlock"); // the old session is gone; unlock with the new password
    say(t("passwordChanged"));
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  await refresh();
}

init();
