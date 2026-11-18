# Phase B evidence

Firefox 160.0.1, Windows 11, 2026-11-18. Synthetic data only.

| Check | Command | Result |
|---|---|---|
| Unit, regression and static tests | `npm test` | 56/56 pass |
| Manifest/package validation | `npm run lint` (web-ext 10.8.0) | 0 errors, 0 warnings, 0 notices |
| Browser tests incl. real OS mouse input | `npm run test:browser:os` | 33/33 pass, [browser-results.json](browser-results.json) |

Without `--os-input` (`npm run test:browser`) the five real-mouse checks (B3-real-4…7,
B8-real) are skipped and B3-real-4 is reported as MANUAL.

## Real toolbar popup (B3-real-*, B8-real)

The test focuses the test Firefox and clicks the extension's toolbar button with **real
Windows mouse input** (`test/browser/os-input.ps1`), which grants `activeTab` like a user
click. The popup DOM is read via `browser.extension.getViews({ type: "popup" })` from the
options page; panel geometry and the system clipboard are read in the browser chrome.

| Check | Result |
|---|---|
| Size 270 × 591 px (Firefox maximum 800 × 600), 25 accounts, 25 px rows | PASS |
| Active-site highlight (`localhost` account while a local test page is active) | PASS |
| Real mouse wheel scrolls to the last account; footer stays visible | PASS |
| Real click on name, code, free space and copy icon — first row and a row scrolled into view: one clipboard write each, clipboard equals the row's code, green check mark | PASS (8/8 clicks) |
| Real double-click on the copy icon writes the clipboard once | PASS |
| Script click without user activation is refused (error indicator, clipboard unchanged) | PASS |
| Real pointer hover: normal row uses `--hover`, current-site row uses `--current-hover` | PASS |

Safety of `os-input.ps1`: one long-lived hidden process (spawning processes while the popup
is open can steal focus and close it); every pointer action is refused unless the window
under the pointer belongs to the launched Firefox process **and** is its popup panel
(`MozillaDropShadowWindowClass`), or its main window for the toolbar click. The pointer
position is restored after clicks. The run briefly moves the mouse and overwrites the
system clipboard with synthetic codes.

## Screenshots

Popup document rendered at 270×600 px in a tab (German UI). The real toolbar panel is a
separate native window that BiDi screenshots cannot capture.

- 25 accounts: [dark](popup-25-accounts-dark-de.png), [light](popup-25-accounts-light-de.png)
- Appearance extremes (100 accounts): [12 px / auto / dark](popup-appearance-12px-auto-dark.png),
  [20 px / 30 px / light](popup-appearance-20px-30-light.png),
  [20 px / 22 px → 26 px / low-contrast custom colors, text auto-corrected](popup-appearance-20px-22-custom-low-contrast.png)
- Options page, appearance section with theme "auto": [dark](options-appearance-auto-dark-de.png),
  [light](options-appearance-auto-light-de.png)

## Layout measurements (popup document, default appearance)

| Accounts | Rows | Row height | Body width × height | List scroll height | Last row reachable | Footer visible |
|---|---|---|---|---|---|---|
| 1 | 1 | 25 px | 270 × 56 | 31 | yes | yes |
| 25 | 25 | 25 px | 270 × 591 | 631 | yes | yes |
| 50 | 50 | 25 px | 270 × 591 | 1256 | yes | yes |
| 100 | 100 | 25 px | 270 × 591 | 2506 | yes | yes |

## Appearance (B7) and hover (B8)

- B7: font 12/20 px × rows auto/22/30 px with 100 accounts (plus a gray-on-gray custom
  pair): uniform rows (22 px at 20 px font is raised to 26 px), names and codes at the
  chosen size, no overlap or clipping, codes never truncated, body ≤ 600 px, last row
  reachable, footer visible, text contrast ≥ 4.5:1. Theme "auto" follows live changes
  of `prefers-color-scheme`. Options: live preview, separate storage, contrast and
  row-height hints, reset restores appearance defaults and keeps behaviour settings.
- B8: hover over name, code, free space and icon (and a scrolled row) in Light, Dark and
  Auto (dark/light) sets the hover token without changing the row rectangle; transition
  80 ms, `0s` with `prefers-reduced-motion`; Tab focuses the first row with a 2 px inset
  outline and no size change.

## Remaining limits

- Browser restart clearing `storage.session`: `not_tested` (temporary add-ons are removed
  on restart in release Firefox); covered by the API contract and `onStartup` clear.
- `input.setFiles` is refused by BiDi for `moz-extension://` pages; the import test attaches
  the fixture via `DataTransfer` (same page code path, no native file dialog).
- The harness reads `storage.session` from a test page to verify key and ciphertext;
  product pages never do this (static test).
