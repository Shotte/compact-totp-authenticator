// Pure appearance computations: theme tokens with guaranteed contrast, row geometry.
// WCAG 2.x: text needs 4.5:1, non-text UI (icons) 3:1.
export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

const THEMES = {
  dark: { bg: "#1c1b22", fg: "#e8e6e3", ok: "#3fb950", err: "#f85149" },
  light: { bg: "#ffffff", fg: "#0c0c0d", ok: "#1a7f37", err: "#cf222e" },
};
const ACCENT = "#d9a400"; // current-site highlight hue

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// Like CSS color-mix(in srgb, a t, b): t is the share of a.
export function mix(a, b, t) {
  const [x, y] = [hex(a), hex(b)];
  return toHex(x.map((v, i) => v * t + y[i] * (1 - t)));
}

export function luminance(c) {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Black or white, whichever contrasts more with bg (always >= 4.58:1).
export const bestText = (bg) => (contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff");

// Smallest step along a mix ramp that satisfies the predicate (falls back to the end value).
function ramp(from, to, steps, ok) {
  for (const t of steps) { const c = mix(from, to, t); if (ok(c)) return c; }
  return mix(from, to, steps.at(-1));
}

export function resolveMode(theme, systemDark) {
  if (theme === "auto") return systemDark ? "dark" : "light";
  return theme === "light" ? "light" : "dark";
}

export function themeTokens(settings, systemDark = false) {
  const mode = resolveMode(settings.theme, systemDark);
  let { bg, fg } = THEMES[mode];
  let fgAdjusted = false;
  if (settings.customColors) {
    bg = settings.bg;
    fg = settings.fg;
    if (contrast(fg, bg) < TEXT_CONTRAST) { fg = bestText(bg); fgAdjusted = true; }
  }
  const dark = luminance(bg) < 0.18;
  const base = THEMES[dark ? "dark" : "light"];
  const textOn = (back) => contrast(fg, back) >= TEXT_CONTRAST;
  const up = [0.62, 0.7, 0.8, 0.9, 1];      // muted text: towards fg until readable
  const down = [0.32, 0.24, 0.16, 0.08, 0];  // tinted backgrounds: towards bg until fg is readable
  const current = ramp(ACCENT, bg, down, textOn);
  return {
    mode, fgAdjusted, bg, fg, scheme: dark ? "dark" : "light",
    muted: ramp(fg, bg, up, (c) => contrast(c, bg) >= TEXT_CONTRAST),
    // Hover: a subtle shift of the background towards the text color (lighter in dark
    // themes, light gray in light themes); the current-site row keeps its tint on hover.
    hover: ramp(fg, bg, [0.1, 0.06, 0.03, 0], textOn),
    active: ramp(fg, bg, [0.18, 0.12, 0.06, 0], textOn),
    line: mix(fg, bg, 0.18),
    current,
    currentHover: ramp(fg, current, [0.08, 0.05, 0.03, 0], textOn),
    ok: contrast(base.ok, bg) >= UI_CONTRAST ? base.ok : fg,
    err: contrast(base.err, bg) >= UI_CONTRAST ? base.err : fg,
  };
}

// Row geometry. Auto keeps the original 25 px at 16 px; fixed heights are raised to the
// minimum that fits one line of text plus 2 px, so text never clips. The line height is a
// whole number of pixels (1.25 em, rounded up): fractional line boxes round differently per
// platform/font and clipped descenders on Linux and macOS (found by the CI matrix).
export const lineHeightPx = (fontSize) => Math.ceil(fontSize * 1.25);
export const minRowHeight = (fontSize) => lineHeightPx(fontSize) + 2;
export function rowHeightPx(fontSize, rowHeight) {
  const wanted = rowHeight === "auto" ? Math.round((fontSize * 25) / 16) : rowHeight;
  return Math.max(wanted, minRowHeight(fontSize));
}
