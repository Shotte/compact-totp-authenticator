# Operator feedback 01: first acceptance session with the signed 0.9.0

Source: the operator's first visual and functional acceptance with the signed unlisted
0.9.0, in a separate test profile with synthetic data. The compact popup met the
expectations and stays visually unchanged: the popup code and `rows.css` are untouched,
and B3/B7/B8 pass.

The signed 0.9.0/0.9.1 artifacts were not modified. No new build was signed.

| # | Finding | Reproduced | Result |
|---|---|---|---|
| 1 | P1: first import failed with a conflict, the repeat worked | **Yes**: unit level, a new service instance on the same storage; browser C5-5, with a real event-page suspension | **Corrected**. Cause: an internal state defect, not a concurrent change. The preview binding lived only in event-page memory, which Firefox discards when it suspends an idle event page (about 30 s), even with the options page open. The binding (session id, revision, file hash, no text) is now kept in `storage.session`. The page re-reads the chosen file for the apply, and the hash must match. Conflict protection is unchanged: a real change after a restart and a changed file are still conflicts (unit tests). Criterion I6 is revised: proposed for the architecture review (SECURITY.md §14 import, PLAN-C4-C6 I6) |
| 2 | P1: custom colors recolored the whole options page | **Yes**: code. `applyAppearance` set the popup tokens on the options page root, and `followSystemScheme` did the same on every scheme change | **Corrected**. The options page applies only the theme (custom colors off). The full popup tokens go on the preview box, which now declares its own background and text color. The popup is unchanged. Browser check F1-1 covers light, dark, auto/dark and auto/light: page body, headings, labels, buttons and inputs keep the theme colors; preview and popup show the custom colors |
| 3 | P2: messages always at the top of the page | **Yes** | **Corrected**. One `role="status"` region per section: vault status at the top, account list, account form, import, export, restore, password change, appearance, behavior. Only one region holds text at a time, so a message is announced once. A region in a hidden view falls back to the top. Browser check C5-6 covers the import message and verifies that no other region holds text |
| 4 | P2: the invalid entry `deSEC` was skipped without a clear report | **Partly**: the preview showed it as invalid, but the completion message named only the imported count | **Corrected**. The message names imported and skipped counts. A list "Show N skipped entries and reasons" gives each skipped entry with its reason (duplicate, invalid: reason). Invalid Base32 is never imported or replaced. Browser check C5-6 |
| 5 | P2: 22 px and 25 px look the same at large font sizes | **Yes**, as designed: `rowHeightPx` raises the height to the minimum for the font size, so that no text is clipped | **Made visible**. Every row-height choice shows its effective height, for example "Klassisch – 25 px (27 px)", and a note shows the effective height in the popup. Defaults unchanged. Browser check F1-2: at 20 px font 22 and 25 give the same effective height, at 12 px they differ, and the preview row equals the effective height |
| 6 | P3: terminology "Konten" → "2FA-Einträge" | – | **Implemented for evaluation**, consistently in all UI strings (German "2FA-Eintrag/2FA-Einträge", English "2FA entry/entries"). Unchanged: `extDescription`, the AMO and store summary "eine Zeile pro Konto / one row per account". Operator decision |
| 7 | Recovery UX | – | **Explanation improved**. The restore note says that restoring works only into an empty vault, that existing entries are never overwritten or deleted, and points to the CTA-file import as the alternative. `vault-not-empty` is clearer. The future explicit choice between merge (#17) and replace (#25) is documented in SECURITY.md §13.4a. Nothing destructive was implemented |

## Evidence

| Check | Result |
|---|---|
| `npm test` | PASS 222/222 (new: 4 tests in `import-auth.test.mjs` for finding 1) |
| `web-ext lint` | PASS 0/0 |
| `npm run check:release` | PASS 26/26 |
| Local browser run, Firefox 160.0.1, Windows ([`browser-results-local.json`](browser-results-local.json)) | 96/98 PASS, 2 MANUAL, 0 NOT_TESTED, 0 FAIL. New: C5-5, C5-6, F1-1, F1-2 |
| Screenshots | [`feedback01-custom-colors-light-de.png`](feedback01-custom-colors-light-de.png), [`-dark-de.png`](feedback01-custom-colors-dark-de.png), [`-auto-dark-de.png`](feedback01-custom-colors-auto-dark-de.png), [`feedback01-import-status-de.png`](feedback01-import-status-de.png) (synthetic fixture names only) |
| Real toolbar popup with real mouse and keyboard | MANUAL_REVIEW (operator) |

## Not resolved here

- Criterion I6 needs the architecture's acceptance (finding 1).
- The terminology needs the operator's decision; `extDescription` is still open (finding 6).
- Merge (#17) and replace (#25) after 1.0 (finding 7).
