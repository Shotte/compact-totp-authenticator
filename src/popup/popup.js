import { call, t, localize, applyAppearance, followSystemScheme, errorText } from "../lib/ui.js";
import { loadSettings } from "../lib/settings.js";
import { sortForView, matchesSite } from "../lib/accounts.js";

const $ = (id) => document.getElementById(id);
let settings, tabUrl = null, codes = [], timer = null, refreshing = false;

// Locked view variants: "unlock" (password form), "setup" (no vault yet) and "recover"
// (damaged vault; recovery needs explicit confirmation in the settings page).
let lockedMode = "unlock";
function showLocked(mode = lockedMode, message = "") {
  clearInterval(timer);
  timer = null;
  codes = [];
  lockedMode = mode;
  $("list").replaceChildren();
  $("unlocked").hidden = true;
  $("locked").hidden = false;
  $("unlockForm").hidden = mode !== "unlock";
  $("openOptions").hidden = mode === "unlock";
  $("openOptions").textContent = t(mode === "setup" ? "setupButton" : "openRecovery");
  $("lockedMsg").textContent = message || (mode === "setup" ? t("notInitialized") : mode === "recover" ? t("recoverableText") : "");
  document.body.dataset.state = "locked";
  document.body.dataset.locked = mode;
  if (mode === "unlock") $("password").focus();
}

async function unlock(ev) {
  ev.preventDefault();
  const input = $("password");
  $("unlockBtn").disabled = input.disabled = true;
  $("lockedMsg").textContent = t("unlocking"); // PBKDF2 takes a moment
  try {
    const r = await call("unlock", { password: input.value });
    input.value = ""; // never keep the password in the page longer than needed
    if (r.recoverable) showLocked("recover");
    else await showUnlocked();
  } catch (e) {
    input.value = "";
    // Delivery failed (event page restarting): ask the background instead of guessing.
    if (e.code === "unknown" && (await call("status").catch(() => ({}))).unlocked) { await showUnlocked(); return; }
    showLocked("unlock", e.reason === "unlock" ? t("unlockFailed") : e.reason === "damaged" ? t("vaultDamagedShort") : errorText(e));
  } finally {
    $("unlockBtn").disabled = input.disabled = false;
    if (lockedMode === "unlock" && !$("locked").hidden) input.focus();
  }
}

async function showUnlocked() {
  $("locked").hidden = true;
  $("unlocked").hidden = false;
  document.body.dataset.state = "unlocked";
  await refresh();
  if (!timer && document.body.dataset.state === "unlocked") {
    tick();
    timer = setInterval(tick, 1000);
  }
}

// Codes only come from the background; this page never sees secrets or the key.
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    codes = (await call("getCodes")).codes;
    render();
  } catch (e) {
    if (e.code === "locked") showLocked();
    else throw e;
  } finally {
    refreshing = false;
  }
}

const icon = (id) => $(id).content.cloneNode(true);
function span(cls, text = "") {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

function render() {
  if (!codes.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("noAccounts");
    $("list").replaceChildren(li);
  } else {
    // The rows are rebuilt when codes expire (every period); keep the keyboard focus on the
    // same entry so that keyboard users do not lose their place (issue #3).
    const active = document.activeElement;
    const focusedId = active?.classList?.contains("row") ? active.dataset.id : null;
    $("list").replaceChildren(...sortForView(codes, settings.sort).map((c) => {
      const li = document.createElement("li");
      if (matchesSite(c.url, tabUrl)) li.className = "current";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "row";
      btn.title = c.name;
      btn.setAttribute("aria-label", t("copyCode", [c.name]));
      const ico = span("icon");
      ico.append(icon("copyIcon"));
      btn.append(span("name", c.name), span("code", c.code), ico);
      btn.addEventListener("click", () => copy(btn, ico, c));
      btn.dataset.id = c.id;
      li.append(btn);
      return li;
    }));
    if (focusedId) [...$("list").querySelectorAll(".row")].find((b) => b.dataset.id === focusedId)?.focus({ preventScroll: true });
  }
  document.body.dataset.rendered = String(codes.length);
}

// One handler on the row button; name, code, free space and icon are inert children
// (rows.css: pointer-events none), so every click fires exactly one copy. A click during
// a running copy or its 1 s confirmation is ignored (no double writes on double-click).
async function copy(btn, ico, c) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  let ok = true;
  try { await navigator.clipboard.writeText(c.code); } catch { ok = false; }
  btn.dataset.copied = ok ? "ok" : "error";
  ico.replaceChildren(icon(ok ? "checkIcon" : "copyIcon"));
  $("announce").textContent = t(ok ? "copied" : "copyFailed");
  setTimeout(() => {
    delete btn.dataset.copied;
    delete btn.dataset.busy;
    ico.replaceChildren(icon("copyIcon"));
  }, 1000);
  if (ok) call("activity").catch((e) => { if (e.code === "locked") showLocked(); });
}

function tick() {
  const now = Date.now();
  $("ticker").textContent = String(30 - (Math.floor(now / 1000) % 30));
  // Refreshing does not count as user activity, so it never extends the lock deadline.
  if (codes.some((c) => c.validUntil <= now)) refresh();
}

async function init() {
  localize();
  settings = await loadSettings(browser.storage.local);
  applyAppearance(settings);
  followSystemScheme(() => settings);
  // URL is only available when the user opened the popup (activeTab).
  try { tabUrl = (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.url ?? null; }
  catch { tabUrl = null; }

  $("unlockForm").addEventListener("submit", unlock);
  $("lock").addEventListener("click", async () => { await call("lock"); showLocked("unlock"); });
  const openOptions = () => { browser.runtime.openOptionsPage(); window.close(); };
  $("settings").addEventListener("click", openOptions);
  $("openOptions").addEventListener("click", openOptions);

  const st = await call("status");
  if (st.unlocked) {
    await call("activity").catch(() => {}); // opening the popup is user activity
    await showUnlocked();
  } else {
    showLocked(st.initialized ? "unlock" : "setup");
  }
}

init();
