// Plaintext UI settings in storage.local under "settings". Contains no secrets and is
// stored separately from the vault.
export const DEFAULT_SETTINGS = Object.freeze({
  theme: "auto",          // auto (follows prefers-color-scheme) | light | dark
  customColors: false,
  fg: "#e8e6e3",
  bg: "#1c1b22",
  fontSize: 16,           // 12–20 px
  rowHeight: "auto",      // auto | 22 | 25 | 30
  sort: "manual",
  autoLockMinutes: 15,
  idleLock: false,        // C3.4: also lock when the system is idle (optional "idle" permission)
  idleLockMinutes: 5,     // 1–60
});
export const FONT_SIZES = { min: 12, max: 20 };
export const ROW_HEIGHTS = ["auto", 22, 25, 30];
const COLOR = /^#[0-9a-f]{6}$/i;

export function validateSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (["dark", "light", "auto"].includes(input.theme)) s.theme = input.theme;
  if (input.theme === "custom") s.customColors = true; // pre-B7 value
  if (typeof input.customColors === "boolean") s.customColors = input.customColors;
  if (COLOR.test(input.fg)) s.fg = input.fg.toLowerCase();
  if (COLOR.test(input.bg)) s.bg = input.bg.toLowerCase();
  const f = Number(input.fontSize);
  if (Number.isInteger(f) && f >= FONT_SIZES.min && f <= FONT_SIZES.max) s.fontSize = f;
  const r = input.rowHeight === "auto" ? "auto" : Number(input.rowHeight);
  if (ROW_HEIGHTS.includes(r)) s.rowHeight = r;
  if (["manual", "alpha", "revalpha"].includes(input.sort)) s.sort = input.sort;
  const m = Number(input.autoLockMinutes);
  if (Number.isInteger(m) && m >= 1 && m <= 240) s.autoLockMinutes = m;
  if (typeof input.idleLock === "boolean") s.idleLock = input.idleLock;
  const i = Number(input.idleLockMinutes);
  if (Number.isInteger(i) && i >= 1 && i <= 60) s.idleLockMinutes = i;
  return s;
}

export const APPEARANCE_KEYS = ["theme", "customColors", "fg", "bg", "fontSize", "rowHeight"];

export async function loadSettings(area) {
  const { settings } = await area.get("settings");
  return validateSettings(settings ?? {});
}
