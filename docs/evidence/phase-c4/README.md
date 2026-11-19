# Phase C4 evidence (export and restore)

Spec: [SECURITY.md §13](../../SECURITY.md). Synthetic accounts and passwords only.

## Unit and regression tests

[`test/export.test.mjs`](../../../test/export.test.mjs), 14 tests, part of `npm test`.

| Area | Covered |
|---|---|
| Format | Committed fixture [`export-v1-portable.json`](../../../test/fixtures/export-v1-portable.json) opens with NFC and NFD password input on Windows, Linux and macOS (CI); fresh salt and IV per export; vault and export mutually unreadable; every header field, the ciphertext and truncation rejected; oversized and broken JSON rejected before parsing; an authenticated payload with one invalid account rejected as a whole |
| Round trip | 18 accounts (SHA-1/256/512 × 6/7/8 digits, periods 10–300 s, Unicode names incl. an NFD name, non-sorted order) → export → import into a clean vault with another master password: identical accounts and identical codes; empty vault; 1,000 accounts |
| Gating | No session, wrong or missing master password, the session's own `CryptoKey` instead of a password, short/mismatching export password, export password equal to the master password (after NFC), missing confirmation, unknown kind; input errors fail before any PBKDF2; lock exactly during the export-key derivation and during the self-check derivation returns nothing; expiry during an export |
| Responses | Encrypted export response contains no secret, name or password in the clear; plaintext export is complete and versioned |
| Legacy | Lossless vault → exact `totp.json`; lossy vault → incompatible accounts and reasons named, export refused, storage unchanged |
| Restore | Only into an empty vault; wrong password and modified file → `import-decrypt`; malformed JSON; oversized text; locked; lock during decryption; nothing written in any failure |
| Self-check | A corrupted encryption output is detected (`export-verify`) and no file is handed out |

Mutation checks (each must fail at least one test; all did): no final `recheck` in the
export; no self-check; import into a non-empty vault allowed; plaintext export without
confirmation; export without the fresh master password; lossy legacy export allowed;
format string removed from the AAD; payload accounts not validated.

## Firefox integration (C4-1 … C4-8)

[`browser-results-local.json`](browser-results-local.json): Firefox 160.0.1, Windows 11,
headless. Result 77/84 PASS, 0 failed, 1 MANUAL (C4-8), 6 NOT_TESTED (5 × real toolbar popup
headless; C3-4 because the workstation was in use, so the system never reported idle).

| Check | Result | Details |
|---|---|---|
| C4-1 encrypted export through the options UI; the downloaded file decrypts **in Node, outside Firefox**, to identical accounts; no secrets, blob links or download anchors left in the page; password fields cleared | PASS | `cta-export-YYYY-MM-DD.json`, 18 accounts |
| C4-2 wrong master password, export password equal to the master password, confirmation mismatch: error message, no file | PASS | |
| C4-3 lock while the export runs (sent 26/51/89 ms after the export started; the export answered after 116–130 ms): `locked`, no result, no file | PASS | |
| C4-4 hard kill + browser restart, then restore through the UI into a clean vault with another master password; file with a Unicode name; a wrong export password first changes nothing | PASS | 18 accounts restored, identical |
| C4-5 restore into a non-empty vault refused; one changed ciphertext character fails authentication; nothing written | PASS | |
| C4-6 empty vault and 1,000 accounts: export and restore identical | PASS | 1,000 accounts: export 154 ms, restore 50 ms, file 186 KB |
| C4-7 plaintext export only after warning and confirmation, complete and versioned; lossy `totp.json` refused with 17 affected accounts listed and the button disabled; lossless `totp.json` produced exactly | PASS | |
| C4-8 native save dialog, cancelling it, download failures | MANUAL_REVIEW | OS dialog and Firefox download panel; not observable without the `downloads` permission |

Note on file selection: WebDriver BiDi `input.setFiles` is not supported for privileged
(extension) pages, so C4-4 hands a `File` with a Unicode name to the real file input
through `DataTransfer`. The OS file chooser itself is MANUAL_REVIEW together with C4-8.

### CI matrix (run 44562029333, head `7c0bf56`, headless)

| Platform / Firefox | PASS | NOT_TESTED | MANUAL | FAIL | C4-1…C4-7 | Lock inside export (lock sent / export answered, ms) | 1,000 accounts export / restore |
|---|---|---|---|---|---|---|---|
| Ubuntu / 160.0 | 78 | 5 | 1 | 0 | all PASS | 23/105, 40/103, 82/106 → locked | 133 / 43 ms |
| Ubuntu / ESR 153.7 | 78 | 5 | 1 | 0 | all PASS | 22/124, 41/123, 81/123 → locked | 167 / 56 ms |
| Ubuntu / ESR 140.17 | 76 | 8 | 1 | 0 | all PASS | 22/125, 41/124, 81/123 → locked | 170 / 57 ms |
| Windows / 159.0.1 | 78 | 5 | 1 | 0 | all PASS | 30/110, 56/117, 82/109 → locked | 142 / 46 ms |
| macOS / 159.0 | 78 | 5 | 1 | 0 | all PASS | 24/100, 44/97, 85/94 → locked | 151 / 83 ms |

MANUAL is C4-8. NOT_TESTED is the real toolbar popup (headless), plus three checks on
ESR 140 that need the privileged chrome scope. C3-4 (idle lock) passed on all five CI
browsers.

## Manual review

- Native save dialog (Firefox setting "Always ask where to save files"), cancel, disk
  full or permission errors (C4-8).
- OS file chooser for restore.
- Real toolbar popup run (`npm run test:browser:os`): not run for C4; C4 changes no popup
  code.
