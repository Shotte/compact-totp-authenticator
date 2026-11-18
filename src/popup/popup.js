import { call, t, localize, applyAppearance, followSystemScheme } from "../lib/ui.js";
import { loadSettings } from "../lib/settings.js";
import { sortForView, matchesSite } from "../lib/accounts.js";

const $ = (id) => document.getElementById(id);
let settings, tabUrl = null, codes = [], timer = null, refreshing = false;

function showLocked() {
  clearInterval(timer);
  timer = null;
  codes = [];
  $("list").replaceChildren();
  $("unlocked").hidden = true;
  $("locked").hidden = false;
  document.body.dataset.state = "locked";
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
      li.append(btn);
      return li;
    }));
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

  $("unlockDemo").addEventListener("click", async () => {
    await call("devUnlock", { count: 25 });
    await showUnlocked();
  });
  $("lock").addEventListener("click", async () => { await call("lock"); showLocked(); });
  $("settings").addEventListener("click", () => { browser.runtime.openOptionsPage(); window.close(); });

  if ((await call("status")).unlocked) {
    await call("activity").catch(() => {}); // opening the popup is user activity
    await showUnlocked();
  } else {
    showLocked();
  }
}

init();
