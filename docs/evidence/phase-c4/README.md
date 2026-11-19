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
visible window (final run after the final review corrections, write outcomes and message
retries). Result 82/85 PASS, 0 failed, 2 MANUAL (C4-8; B3-real-4 needs `--os-input`),
1 NOT_TESTED (C3-4: the workstation was in use, so the system never reported idle).

| Check | Result | Details |
|---|---|---|
| C4-1 encrypted export through the options UI; the downloaded file decrypts **in Node, outside Firefox**, to identical accounts; no secrets, blob links or download anchors left in the page; password fields cleared | PASS | `cta-export-YYYY-MM-DD.json`, 18 accounts |
| C4-2 wrong master password, export password equal to the master password, confirmation mismatch: error message, no file | PASS | |
| C4-3 lock while the export runs (sent 26/51/89 ms after the export started; the export answered after 116–130 ms): `locked`, no result, no file | PASS | |
| C4-4 hard kill + browser restart, then restore through the UI into a clean vault with another master password; file with a Unicode name; a wrong export password first changes nothing | PASS | 18 accounts restored, identical |
| C4-5 restore into a non-empty vault refused; one changed ciphertext character fails authentication; nothing written | PASS | |
| C4-6 empty vault and 1,000 accounts: export and restore identical | PASS | 1,000 accounts: export 154 ms, restore 50 ms, file 186 KB |
| C4-7 plaintext export only after warning and confirmation, complete and versioned; lossy `totp.json` refused with 17 affected accounts listed and the button disabled; lossless `totp.json` produced exactly | PASS | |
| C4-8 native save dialog, cancelling it, download failures | MANUAL_REVIEW in the headless suite | verified on Windows below (N1–N4) |

Note on file selection: WebDriver BiDi `input.setFiles` is not supported for privileged
(extension) pages, so C4-4 hands a `File` with a Unicode name to the real file input
through `DataTransfer`. The OS file chooser itself is MANUAL_REVIEW together with C4-8.

### CI matrix (run 44574857571, head `71a6b0c`, headless)

| Platform / Firefox | PASS | NOT_TESTED | MANUAL | FAIL | C4-1…C4-7, C4-9 | C4-9 attempts (lock sent / restore answered ms → result) |
|---|---|---|---|---|---|---|
| Ubuntu / 160.0 | 79 | 5 | 1 | 0 | all PASS | 22/104, 52/103, 83/104 → locked, nothing written; 122/114 → ok, written |
| Ubuntu / ESR 153.7 | 79 | 5 | 1 | 0 | all PASS | 21/122, 51/120, 81/120, 122/124 → locked, nothing written |
| Ubuntu / ESR 140.17 | 77 | 8 | 1 | 0 | all PASS | 22/102, 51/101, 82/101 → locked; 155/159 → ok, written |
| Windows / 159.0.1 | 79 | 5 | 1 | 0 | all PASS | 22/116, 59/115, 94/115 → locked; 123/120 → ok, written |
| macOS / 160.0 | 79 | 5 | 1 | 0 | all PASS | 29/75, 54/82 → locked; 83/85 → locked; 129/91 → ok, written |

Every answer matches the stored state. MANUAL is C4-8 (native dialogs, verified below on
Windows). NOT_TESTED is the real toolbar popup (headless), plus three checks on ESR 140
that need the privileged chrome scope. C3-4 (idle lock) passed on all five CI browsers;
locally it was NOT_TESTED because the workstation was in use.

An earlier CI run (44573011153) failed C4-9 on three platforms. Two causes:

- The test assumed every attempt would be aborted, but on fast runners the restore
  finished before the lock.
- On macOS a restore answered `locked` although it had written. This was a real defect,
  fixed in `71a6b0c` (SECURITY.md §13.4 step 7).

## Review follow-up (after head `25049f7`)

### Restore authentication

Unit tests (`test/export.test.mjs`, 17 tests in total):

- Restore requires the destination's master password through `authorizeSensitive`.
  Rejected: missing, empty or wrong master password, the export password given as the
  master password, the session's `CryptoKey` instead of a password.
- The master password never opens the export.
- An expired session, a session of an old key generation, and a lock during the
  master-password derivation or during the export-password derivation all abort the
  restore.
- A second service instance writes between verification and commit → `conflict`, and
  only the concurrent write is in the vault.

Mutation checks:

- Restore without the fresh master password: 3 tests fail.
- No `recheck`: 1 test fails.
- No empty check: 1 test fails.
- Removing the pre-write re-read alone is still caught by the store's compare-and-set,
  which is the second layer. Removing both layers fails 1 test.

Browser:

- **C4-4** (UI): wrong export password, wrong master password, and the export password
  used as the master password each give an error and leave the vault unchanged.
- **C4-9:** missing master password → `current-password`. A lock while the restore runs
  (sent 38/66/130 ms, restore answered after 158–160 ms) → `locked`, vault unchanged. A
  file sealed in Node (outside Firefox, fresh salt) restores identically.

### Native dialogs on Windows (manual review, automated)

[`native-dialogs-windows.json`](native-dialogs-windows.json),
`node test/browser/native-dialogs.mjs`. Firefox 160.0.1 with a window, "Always ask where to
save files". The dialogs belong to this test's Firefox main process and are driven by
Win32 messages to the dialog's own controls ([`uia-dialog.ps1`](../../../test/browser/uia-dialog.ps1)):
no mouse, no keyboard, no clipboard. Synthetic data; temporary folder removed afterwards;
the user's Downloads folder was checked to be unchanged.

| Check | Result | Observed |
|---|---|---|
| N1 native Save dialog → Save | PASS | dialog "Bitte geben Sie den Dateinamen an …", buttons "Speichern"/"Abbrechen"; file "CTA Sicherung – Ünïcödé ✓.json" saved; Firefox download succeeded; the file decrypts to identical accounts |
| N2 native Save dialog → Cancel | PASS | dialog closed, no file, no new download |
| N3 download failure (target folder without write permission, direct mode) | PASS | Firefox download state failed ("target failed"); no file; nothing written to the user's Downloads folder |
| N4 native Open dialog ("Datei hochladen") → saved file → restore | PASS | file input received the Unicode file name; restore with export + master password: 18 accounts identical |

In all four cases the page shows the same, honest status. The file was created and handed
to Firefox for saving; the user is asked to check Firefox's downloads; a cancelled dialog
means no file. The page cannot know which case happened (SECURITY.md §13.5).

### Shared secret policy

`checkSecret` (accounts.js) is used by manual entry, the legacy preview and restore:

- Malformed Base32 is rejected (`secret-format`).
- Valid secrets shorter than 16 characters are accepted with `short-secret`.
- The UI warns while typing and after saving.

Tests: `accounts.test.mjs` (malformed vs short), `service.test.mjs` (warning at the
message boundary, codes generated), legacy preview unchanged.

## Manual review

- Native dialogs on macOS and Linux (only Windows was exercised, N1–N4).
- A full disk (not reproduced; the permission failure N3 covers Firefox's failure path).
- Real toolbar popup run (`npm run test:browser:os`): not run for C4; C4 changes no popup
  code.
