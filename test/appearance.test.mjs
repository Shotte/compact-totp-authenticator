import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSettings, DEFAULT_SETTINGS, APPEARANCE_KEYS, ROW_HEIGHTS } from "../src/lib/settings.js";
import { themeTokens, contrast, luminance, mix, bestText, resolveMode, rowHeightPx, minRowHeight,
  TEXT_CONTRAST, UI_CONTRAST } from "../src/lib/appearance.js";

test("defaults: auto theme, 16 px, auto rows (25 px), no custom colors", () => {
  assert.deepEqual(validateSettings(), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.theme, "auto");
  assert.equal(DEFAULT_SETTINGS.fontSize, 16);
  assert.equal(DEFAULT_SETTINGS.rowHeight, "auto");
  assert.equal(rowHeightPx(16, "auto"), 25);
  assert.deepEqual(APPEARANCE_KEYS.sort(), ["bg", "customColors", "fg", "fontSize", "rowHeight", "theme"]);
});

test("each setting accepts valid and rejects invalid values", () => {
  for (const theme of ["auto", "light", "dark"]) assert.equal(validateSettings({ theme }).theme, theme);
  for (const theme of ["blue", "", 1, null]) assert.equal(validateSettings({ theme }).theme, "auto");
  assert.equal(validateSettings({ customColors: true }).customColors, true);
  assert.equal(validateSettings({ customColors: "yes" }).customColors, false);
  assert.equal(validateSettings({ fg: "#ABCDEF" }).fg, "#abcdef");
  for (const fg of ["#abc", "red", "#gggggg", "javascript:x"]) assert.equal(validateSettings({ fg }).fg, DEFAULT_SETTINGS.fg);
  for (let f = 12; f <= 20; f++) assert.equal(validateSettings({ fontSize: f }).fontSize, f);
  for (const f of [11, 21, 16.5, "x"]) assert.equal(validateSettings({ fontSize: f }).fontSize, 16);
  assert.equal(validateSettings({ fontSize: "18" }).fontSize, 18, "form values arrive as strings");
  for (const r of ROW_HEIGHTS) assert.equal(validateSettings({ rowHeight: r }).rowHeight, r);
  assert.equal(validateSettings({ rowHeight: "22" }).rowHeight, 22);
  for (const r of [24, "big", 0]) assert.equal(validateSettings({ rowHeight: r }).rowHeight, "auto");
});

test("pre-B7 settings migrate (theme 'custom' → custom colors)", () => {
  const s = validateSettings({ theme: "custom", fg: "#111111", bg: "#eeeeee" });
  assert.equal(s.customColors, true);
  assert.equal(s.theme, "auto");
});

test("auto follows the system scheme", () => {
  assert.equal(resolveMode("auto", true), "dark");
  assert.equal(resolveMode("auto", false), "light");
  assert.equal(resolveMode("dark", false), "dark");
  assert.equal(resolveMode("light", true), "light");
  assert.equal(themeTokens({ theme: "auto" }, true).bg, themeTokens({ theme: "dark" }).bg);
  assert.equal(themeTokens({ theme: "auto" }, false).bg, themeTokens({ theme: "light" }).bg);
});

test("contrast math matches WCAG reference values", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff") * 100) / 100, 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.ok(contrast(bestText("#777777"), "#777777") >= 4.58);
});

function assertReadable(tok, label) {
  assert.ok(contrast(tok.fg, tok.bg) >= TEXT_CONTRAST, `${label}: fg/bg ${contrast(tok.fg, tok.bg)}`);
  assert.ok(contrast(tok.muted, tok.bg) >= TEXT_CONTRAST, `${label}: muted`);
  for (const back of ["hover", "active", "current", "currentHover"]) {
    assert.ok(contrast(tok.fg, tok[back]) >= TEXT_CONTRAST, `${label}: fg on ${back}`);
  }
  assert.ok(contrast(tok.ok, tok.bg) >= UI_CONTRAST, `${label}: ok icon`);
  assert.ok(contrast(tok.err, tok.bg) >= UI_CONTRAST, `${label}: err icon`);
}

test("built-in themes meet WCAG contrast for every token", () => {
  for (const [theme, dark] of [["dark", false], ["light", false], ["auto", true], ["auto", false]]) {
    assertReadable(themeTokens({ theme }, dark), `${theme}/${dark}`);
  }
});

test("custom colors: unreadable text color is replaced; all tokens stay readable", () => {
  const t = themeTokens({ theme: "dark", customColors: true, fg: "#777777", bg: "#808080" });
  assert.equal(t.fgAdjusted, true);
  assertReadable(t, "gray on gray");
  const ok = themeTokens({ theme: "dark", customColors: true, fg: "#ffffff", bg: "#003366" });
  assert.equal(ok.fgAdjusted, false);
  assert.equal(ok.fg, "#ffffff");
  // Deterministic sweep over 2000 random color pairs.
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const color = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`;
  for (let i = 0; i < 2000; i++) {
    const fg = color(), bg = color();
    assertReadable(themeTokens({ theme: "light", customColors: true, fg, bg }), `${fg} on ${bg}`);
  }
});

test("hover is subtle: lighter in dark, light gray in light; current row keeps its tint", () => {
  const hexRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  for (const [theme, sys] of [["dark", false], ["light", false], ["auto", true], ["auto", false]]) {
    const t = themeTokens({ theme }, sys);
    const step = contrast(t.hover, t.bg);
    assert.ok(step > 1.05 && step < 1.4, `${theme}/${sys}: visible but restrained (${step.toFixed(2)})`);
    if (t.mode === "dark") assert.ok(luminance(t.hover) > luminance(t.bg), "dark: lighter");
    else {
      assert.ok(luminance(t.hover) < luminance(t.bg), "light: darker");
      const [r, g, b] = hexRgb(t.hover);
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 4, "light: neutral gray");
    }
    assert.notEqual(t.currentHover, t.current);
    assert.notEqual(t.currentHover, t.hover, "active-site highlight stays distinguishable on hover");
  }
});

test("rows.css: background-only hover, <=100 ms transition, reduced motion, inset focus ring", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/rows.css", import.meta.url), "utf8");
  const ms = [...css.matchAll(/transition:[^;]*?(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(ms.length && ms.every((v) => v <= 100), `transitions ${ms}`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*button\.row \{ transition: none; \}/);
  for (const rule of css.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)) {
    const props = rule[2].split(";").map((p) => p.split(":")[0].trim()).filter(Boolean);
    assert.deepEqual(props, ["background"], `${rule[1].trim()} only changes the background`);
  }
  assert.match(css, /button\.row:focus-visible \{ outline: 2px solid var\(--fg\); outline-offset: -2px; \}/);
});

test("row heights: auto scales; fixed heights never clip text", () => {
  assert.deepEqual([12, 16, 20].map((f) => rowHeightPx(f, "auto")), [19, 25, 31]);
  assert.equal(rowHeightPx(16, 22), 22);
  assert.equal(rowHeightPx(16, 30), 30);
  assert.equal(rowHeightPx(20, 22), minRowHeight(20), "raised to the minimum");
  assert.equal(rowHeightPx(12, 30), 30);
  for (let f = 12; f <= 20; f++) {
    for (const r of ROW_HEIGHTS) assert.ok(rowHeightPx(f, r) >= Math.ceil(f * 1.25) + 2, `${f}px/${r}`);
  }
});
