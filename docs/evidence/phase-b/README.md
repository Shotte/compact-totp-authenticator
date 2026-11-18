# Phase B evidence

Firefox 160.0.1, Windows 11, 2026-11-18. Synthetic data only.

| Check | Command | Result |
|---|---|---|
| Unit, regression and static tests | `npm test` | 46/46 pass |
| Manifest/package validation | `npm run lint` (web-ext 10.8.0) | 0 errors, 0 warnings, 0 notices |
| Browser tests (real extension from `src/`) | `npm run test:browser` | 12/12 pass, [browser-results.json](browser-results.json) |

Screenshots (popup document at 270×600 px, German UI, 25 synthetic accounts):
[dark](popup-25-accounts-dark-de.png), [light](popup-25-accounts-light-de.png).

## Layout measurements

| Accounts | Rows | Row height | Body width × height | List scroll height | Last row reachable | Footer visible | Render |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 25 px | 270 × 56 | 31 | yes | yes | 199 ms |
| 25 | 25 | 25 px | 270 × 591 | 631 | yes | yes | 193 ms |
| 50 | 50 | 25 px | 270 × 591 | 1256 | yes | yes | 71 ms |
| 100 | 100 | 25 px | 270 × 591 | 2506 | yes | yes | 85 ms |

Render time = navigation start to all rows in the DOM, measured by the driver.

## Test harness notes and limits

- The popup document is rendered in a tab with a 270×600 viewport. The real toolbar popup
  uses the same document; its storage behaviour was verified in the B0 spike. Opening the
  real toolbar popup of the product is `manual_review`.
- Current-site highlight needs an `activeTab` grant from a real toolbar click; the matching
  logic is unit-tested, the browser behaviour is `manual_review`.
- `input.setFiles` is refused by BiDi for `moz-extension://` contexts; the import test
  attaches the fixture as a `File` via `DataTransfer` and fires `change` (same page code
  path, no native file dialog).
- Clipboard content is not read back (would need `clipboardRead`); the test asserts that
  `navigator.clipboard.writeText` resolved after a trusted pointer click.
- The harness reads `storage.session` from a test page to verify the key and ciphertext;
  product pages never do this (static test).
- Browser restart: `not_tested` (temporary add-ons are removed on restart).
