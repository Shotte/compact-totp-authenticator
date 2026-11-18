// Page helpers shared by popup and options: messaging, i18n, theme. No secrets here.

// Calls the background. Throws an Error whose .code is locked|conflict|invalid|malformed|internal.
export async function call(cmd, args = {}) {
  const r = await browser.runtime.sendMessage({ cmd, ...args });
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

export function applyTheme(settings, root = document.documentElement) {
  root.dataset.theme = settings.theme;
  for (const k of ["fg", "bg"]) {
    if (settings.theme === "custom") root.style.setProperty(`--${k}`, settings[k]);
    else root.style.removeProperty(`--${k}`);
  }
}

// Localized text for an error thrown by call().
export function errorText(e) {
  if (e.code === "invalid" && e.reason) {
    const key = `reason_${e.reason.replace(/-/g, "_")}`;
    const reason = browser.i18n.getMessage(key) || e.reason;
    return t("errInvalid", [reason]);
  }
  const key = { locked: "errLocked", conflict: "errConflict", malformed: "errMalformed" }[e.code];
  return t(key ?? "errInternal");
}
