// Plaintext UI settings in storage.local. Contains no secrets.
export const DEFAULT_SETTINGS = Object.freeze({
  theme: "dark", fg: "#e8e6e3", bg: "#1c1b22", sort: "manual", autoLockMinutes: 15,
});
const COLOR = /^#[0-9a-f]{6}$/i;

export function validateSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (["dark", "light", "custom"].includes(input.theme)) s.theme = input.theme;
  if (COLOR.test(input.fg)) s.fg = input.fg;
  if (COLOR.test(input.bg)) s.bg = input.bg;
  if (["manual", "alpha", "revalpha"].includes(input.sort)) s.sort = input.sort;
  const m = Number(input.autoLockMinutes);
  if (Number.isInteger(m) && m >= 1 && m <= 240) s.autoLockMinutes = m;
  return s;
}

export async function loadSettings(area) {
  const { settings } = await area.get("settings");
  return validateSettings(settings ?? {});
}
