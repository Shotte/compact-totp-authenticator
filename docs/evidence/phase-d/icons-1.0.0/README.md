# 1.0.0 icons: shield toolbar icon and settings gear

Operator requirement (2026-11-25), concept **A** selected: a shield with three code dots,
monochrome and transparent, with no colour accent. A six-tooth gear replaces the star-like
settings symbol in the popup.

## Implementation

| File | Use |
|---|---|
| `src/icons/shield-dark.svg` | toolbar on **light** themes; glyph `#7a7a85` (contrast 4.0:1 on `#f9f9fb`, 4.3:1 in Firefox 161's dark extensions menu `#171519`). Also `action.default_icon`. The 1.0.0 release candidate changed it from `#5b5b66`, see "Extensions menu" |
| `src/icons/shield-light.svg` | toolbar on **dark** themes; glyph `#fbfbfe` (contrast 13.7:1 on `#2b2a33`) |
| `src/icons/icon.svg` | `icons` 48/96 (about:addons, AMO): filled neutral shield `#8f8f9d`, with the dots cut out so the background shows through. Contrast 3.2:1 on white, 4.4:1 on `#2b2a33`, 5.4:1 on `#1c1b22` |
| `src/popup/popup.html` | `#settings`: the gear SVG (`currentColor`, `aria-hidden`). The button, its `title` and `aria-label` (i18n "settings"), the class and the handler are unchanged |

**Theme-aware toolbar artwork.** `action.theme_icons` in the manifest has 16 and 32 px entries.
Per MDN, `light` is the icon for dark themes and `dark` the one for light themes. Firefox picks
the icon from the toolbar's brightness, also for third-party themes. The behaviour was checked in
real Firefox (below), not only in the documentation. A single SVG with `context-fill` is not
used: it works only behind a preference that is off by default.

`icons` has no theme variant. That is why the neutral mid-grey version is used there.

## Results

| Check | Firefox 161.0 (Windows) | Firefox ESR 140.17.0 (Windows) |
|---|---|---|
| Toolbar, built-in light theme: dark shield | PASS ([toolbar-light](firefox-161/toolbar-light.png)) | PASS ([toolbar-light](firefox-esr-140/toolbar-light.png)) |
| Toolbar, built-in dark theme: light shield | PASS ([toolbar-dark](firefox-161/toolbar-dark.png)) | PASS ([toolbar-dark](firefox-esr-140/toolbar-dark.png)) |
| about:addons: neutral shield, light and dark | PASS ([light](firefox-161/window-light.png), [dark](firefox-161/window-dark.png)) | PASS ([light](firefox-esr-140/window-light.png), [dark](firefox-esr-140/window-dark.png)) |
| Popup: Tab reaches the settings button; `:focus-visible` ring; title and `aria-label` "Settings"/"Einstellungen"; SVG `aria-hidden` | PASS, 5 × Tab, light and dark | PASS, 5 × Tab, light and dark |
| Popup: Enter on the settings button opens the options page | PASS | PASS |
| Sizes 16, 32, 48 and 96 px | PASS ([sizes.png](sizes.png)) | – |
| Extensions menu (button unpinned), light theme | PASS ([panel-light](firefox-161-unpinned/panel-light.png)) | PASS ([panel-light](firefox-esr-140-unpinned/panel-light.png)) |
| Extensions menu (button unpinned), dark theme | **Firefox picks the light-theme variant**; with `#7a7a85` it stays legible, 4.3:1 ([panel-dark](firefox-161-unpinned/panel-dark.png), before: [`#5b5b66`, 2.7:1](firefox-161-unpinned/panel-dark-before-5b5b66.png)) | PASS, light shield ([panel-dark](firefox-esr-140-unpinned/panel-dark.png)) |

- Overview of every toolbar and menu capture: [toolbar-and-menu-overview.png](toolbar-and-menu-overview.png).
  From the top: toolbar 161 light, 161 dark, 140 light, 140 dark; then the menu in 161 light,
  dark before, dark after, and in 140 light, dark before, dark after.
- Gear with focus ring, enlarged 3×: [popup-gear-focus-x3.png](popup-gear-focus-x3.png). The rows
  are 161 light, 161 dark, 140 light and 140 dark.
- Raw data: `firefox-161/results.json` and `firefox-esr-140/results.json`.
- The operator asked for Firefox 160. The installed release browser had updated itself to 161.0
  before the run, so the release-channel evidence is from 161.0.

**Extensions menu.**
- Firefox 161.0 shows the `dark` variant (meant for light themes) also in its dark extensions
  menu. ESR 140 picks the right variant. A Mozilla forum thread reports the same behaviour
  ("Extensions panel uses wrong themed icon colour").
- With the first glyph colour `#5b5b66` the shield had only 2.7:1 there. The release candidate
  uses the mid-grey `#7a7a85`, which reaches at least 4:1 on the light toolbar and in the dark
  menu. On light toolbars the shield is therefore a little lighter than Firefox's own icons.
- The captures above are from after the change, except the files marked `before`.

**Method.** `node test/browser/icon-check.mjs <firefox> <label> [--unpinned=<dx>]`:
- Visible window, one throwaway profile per theme. The built-in theme is set by
  `extensions.activeThemeID`, the content colour scheme by its override preference.
- Synthetic accounts only.
- `--unpinned`: a temporary copy of the source with `default_area: "menupanel"` (the state after
  unpinning). The extensions button is opened by a real mouse click.
- The toolbar and about:addons are taken from the screen (the window's own frame); the popup with
  BiDi.
- Firefox ESR 140.17.0 came from Mozilla's official Windows installer, SHA-256 checked against
  the release `SHA256SUMS` and extracted into a temporary folder with 7-Zip. Nothing was
  installed, and the system Firefox was not changed.

**Automated**, at the merge of PR #47:
- `npm test`: 254/254 PASS, including two new static tests:
  - icons: theme_icons mapping, transparent, monochrome, contrast;
  - settings button: gear, unchanged attributes.
- `npm run lint`: 0 errors; only the accepted desktop-only Android note.
- `check-release`: 27/27 (28/28 with the 1.0.0 version check in the release candidate).
- `web-ext build`: the package contains the three icon files and the `theme_icons` manifest.

The browser suite runs in CI.

**AMO screenshots.** All eight images (de/en 1–4) were recreated from the 1.0.0 release source
(see RC-1.0.0.md).

## Not tested

- Third-party themes; Linux and macOS.
- **The signed package.** Signing a release candidate needs the operator's approval. The signed
  check (`verify:signed`) follows with the 1.0.0 release candidate.
- **The icon in the AMO listing.** AMO takes it from the manifest; check it in the Developer Hub
  preview before submission (`manual_review`).
