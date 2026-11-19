// Page helpers shared by popup and options: messaging, i18n, appearance. No secrets here.
import { themeTokens, rowHeightPx, lineHeightPx } from "./appearance.js";

// Commands that change nothing: safe to send again (C4 review, decision 3).
const REPEATABLE = new Set(["status", "getCodes", "listAccounts", "importPreview", "lock"]);

// Calls the background. Throws an Error whose .code is locked|conflict|invalid|malformed|
// unknown|internal. A message that reaches no listener (event page restarting) is sent
// again only for REPEATABLE commands, at most twice. Any other command is never repeated:
// a failed delivery is reported as "unknown" and the caller reloads the real state.
export async function call(cmd, args = {}) {
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await browser.runtime.sendMessage({ cmd, ...args }); break; }
    catch (e) {
      const repeat = REPEATABLE.has(cmd);
      if (repeat && attempt < 2 && /Receiving end does not exist/.test(e?.message)) {
        await new Promise((ok) => setTimeout(ok, 200 * (attempt + 1)));
        continue;
      }
      throw Object.assign(new Error("transport"), { code: repeat ? "internal" : "unknown" });
    }
  }
  if (!r?.ok) {
    throw Object.assign(new Error(r?.error ?? "internal"), { code: r?.error ?? "internal", reason: r?.reason });
  }
  return r.result;
}

export const t = (key, subs) => browser.i18n.getMessage(key, subs) || key;

// data-i18n="key" sets textContent; data-i18n-attr="title:key;aria-label:key2" sets attributes.
export function localize(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      el.setAttribute(attr, t(key));
    }
  }
  document.documentElement.lang = browser.i18n.getUILanguage();
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

// Applies colors (contrast-checked tokens), font size and row height. Returns the tokens.
export function applyAppearance(settings, root = document.documentElement) {
  const tokens = themeTokens(settings, darkQuery.matches);
  for (const k of ["bg", "fg", "muted", "hover", "active", "line", "current", "ok", "err"]) {
    root.style.setProperty(`--${k}`, tokens[k]);
  }
  root.style.setProperty("--current-hover", tokens.currentHover);
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  root.style.setProperty("--line-height", `${lineHeightPx(settings.fontSize)}px`);
  root.style.setProperty("--row-height", `${rowHeightPx(settings.fontSize, settings.rowHeight)}px`);
  root.style.colorScheme = tokens.scheme;
  root.dataset.theme = tokens.mode;
  return tokens;
}

// Re-applies when the Firefox/system color scheme changes (theme "auto").
export function followSystemScheme(getSettings) {
  darkQuery.addEventListener("change", () => applyAppearance(getSettings()));
}

// Localized text for an error thrown by call().
export function errorText(e) {
  if (e.code === "invalid" && e.reason) {
    const key = `reason_${e.reason.replace(/-/g, "_")}`;
    const reason = browser.i18n.getMessage(key) || e.reason;
    return t("errInvalid", [reason]);
  }
  const key = { locked: "errLocked", conflict: "errConflict", malformed: "errMalformed", unknown: "errUnknown" }[e.code];
  return t(key ?? "errInternal");
}
