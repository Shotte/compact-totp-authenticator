# Operator acceptance 0.9.3: fixes F3-1, F3-2, F3-3 (before 1.0.0)

Ralf's acceptance of the signed 0.9.3 confirmed #2, #3, #21 and #25 and reported three findings.
This directory holds the evidence for the fixes. All data is synthetic. No real TOTP secret was
used, exported or logged. The signed 0.9.3 is unchanged. Nothing was signed, tagged or
published.

Vault format, encryption, master-password handling, conflict detection and recovery are
unchanged. The replacement still needs:

- the export password entered again;
- the current master password;
- the explicit confirmation;
- the revision and hash check.

Crash recovery and the encrypted previous vault state also work as before.

## F3-1 (P2): account actions wrapped onto two lines when an account had a website

**Cause.** The actions cell could wrap, and the table gave the width to the website column.

**Fix** (`src/options/options.css`, `options.js`):

- The actions cell keeps the four buttons on one line, right-aligned in every row. Long names
  and URLs wrap instead.
- The move buttons are compact arrows (↑ ↓). The tooltip is "Hoch"/"Runter", and the
  accessible name per entry is unchanged ("Hoch: Kurz").
- Container queries on `main` measure the real content width, including zoom:
  - at 560 px and below, the hash-type column is hidden;
  - at 380 px and below, the buttons may wrap.
- Manual ordering, edit and delete are unchanged.

**Test F3-1** (`run-browser-tests.mjs`, local run on Windows): four entries, one with a 113-character URL and one with
a long name. Checked at 1024 and 1280 px (100/150/200 % zoom), 1920 px (100/200 %), 480 px and
360 px. PASS. In every case:

- the four buttons are on one line and their right edges are aligned (360 px may wrap);
- there is no horizontal overflow;
- the accessible names are present.

Screenshot: `f31-accounts-de.png` (1280 px). T-5, the tab layout at all sizes and zoom levels,
still passes.

## F3-2 (P1): default shortcut Alt+Shift+A opened the "Ansicht" menu

**Cause.** On Windows and Linux, Alt+letter opens a menu-bar access key. These letters depend on
the UI language: in German "Ansicht" uses A, Datei D, Bearbeiten B, Chronik C, Lesezeichen L,
Extras x and Hilfe H. The shortcut manager in about:addons only rejects Firefox key bindings
("Firefox-Tastenkombinationen können nicht überschrieben werden") and duplicates of other
add-ons ("Bereits durch … belegt"). It does not check menu access keys, so Alt+Shift+A was
accepted. Ctrl+Alt is AltGr on German Windows and types characters with many letters.

**Probe** (`test/browser/shortcut-probe.mjs`, Firefox 160.0.1, German UI, Windows 11).

How it works:

- For each candidate, the probe lists Firefox's own `<key>` bindings and the menu access keys.
- It assigns the candidate through `browser.commands.update`.
- It presses the candidate as a native key event with the German (0x407) and US (0x409)
  keyboard layouts.

Result file: `shortcut-probe-win32.json`.

| Shortcut | Firefox binding / menu | Native press (de, us) | Verdict |
|---|---|---|---|
| Alt+Shift+A (0.9.3) | menu "Ansicht" | opens the Ansicht menu | conflict (reproduces the report) |
| Ctrl+Shift+F (control) | `key_openAddons` | opens about:addons | conflict |
| Ctrl+Alt+A | AltGr on Windows | popup | conflict (AltGr) |
| Ctrl+Shift+A | `key_searchTabs` | nothing | conflict |
| Alt+Shift+Z / 1 / 2 | – | popup | works |
| Ctrl+Shift+L / U / Y / 1 / 2 / 8 / 9 / Comma / Period, Ctrl+Comma / Period | – | popup | works |

**Decision: Ctrl+Shift+2** ("2" for 2FA; Command+Shift+2 on macOS).

- No Firefox binding uses it, and it is not a menu access key in any language. It is not AltGr,
  and with both layouts it opens only the popup.
- Rejected:
  - Ctrl+Shift+L: password managers use it.
  - Ctrl+Shift+U: Unicode input under Linux IBus.
  - Ctrl+Shift+Y: the Downloads library under Linux.
  - Alt+letter: menu access keys depend on the language.
  - Ctrl+Comma and Ctrl+Period: Command+, and Command+. are common on macOS.
- No new permission is needed. Users can still change the shortcut in about:addons → gear →
  "Erweiterungs-Tastenkombinationen verwalten".

**Test C6-2:**

- On all platforms, the default from the manifest is registered and has no Firefox, menu or
  AltGr conflict for the platform.
- On visible Windows only, it is also pressed natively with both layouts and opens the popup and
  nothing else.

Local: PASS.

### Shortcut on upgrade

`test/browser/shortcut-upgrade.mjs` (Firefox 160.0.1, German UI, Windows 11) uses two copies of
the same add-on ID. "Old" is git main with Alt+Shift+A, set to version 0.9.3. "New" is this
branch with Ctrl+Shift+2, set to version 0.9.99. Each scenario runs in a fresh profile. The
effective shortcut is read with `browser.commands.getAll()` and pressed natively with the
German and US layouts. Result file: `shortcut-upgrade-win32.json`.

| Scenario | Before | After the upgrade | Native press | Verdict |
|---|---|---|---|---|
| A: old default, then upgrade | Alt+Shift+A | Ctrl+Shift+2 | Ctrl+Shift+2 opens the popup; Alt+Shift+A no longer does | PASS |
| B: shortcut customized (Ctrl+Shift+9), then upgrade | Ctrl+Shift+9 | Ctrl+Shift+9 (kept) | Ctrl+Shift+9 opens the popup | PASS |
| C: fresh installation | – | Ctrl+Shift+2 | opens the popup | PASS |

Firefox keeps a shortcut that the user changed in the shortcut manager as a stored setting, and
an update does not overwrite it. A shortcut that was never changed follows the new
`suggested_key`.

**Limitation.** Release Firefox installs unsigned add-ons only temporarily. The upgrade here is a
temporary reinstall with a higher version, which Firefox reports to the extension as an update.
The update of a signed, permanently installed add-on through its update manifest uses the same
shortcut storage, but it was not run. It stays NOT_TESTED until a signed test build exists. The
customization in scenario B was made with `browser.commands.update`, the API behind the shortcut
manager, not by clicking in about:addons.

## F3-3 (P1 UX): vault replacement flow

**Cause.** After the check, step 2 opened out of view. The reason for entering the export
password again was not explained. Messages appeared far from their buttons, and stale messages
remained. The Master Password hint looked like an error (`role=alert`, red border). Import and
replacement were easy to confuse.

**Fix** (`options.html`, `options.js`, `options.css`, both locales):

- The titles separate the two actions: "Import: Einträge hinzufügen" (additive) and
  "Wiederherstellen: Tresor durch eine verschlüsselte Sicherung ersetzen" (destructive).
- The flow has two steps:
  1. "Sicherung prüfen – ändert noch nichts".
  2. "Ersetzen bestätigen".
- After the check, step 2 is scrolled into view and the focus moves to its heading.
- Step 2 explains why the export password and the confirmation are asked again: the check reads
  the file, the replacement authorizes it.
- Every step reports in its own status region next to its buttons (`data-status`). `say()`
  clears the other regions, so only one message is live at a time, without `role=alert`.
- On success, step 2 closes and the message appears below step 1. It gives both counts and says
  the previous vault state can be brought back. The focus moves to the section heading.
- The Master Password hint is now a neutral `.notice` and only matters when the password is
  changed. The text is unchanged in substance.

**Tests** (local run on Windows):

- F3-3 (new, inside the R-1 replacement run). PASS. Checked:
  - after the check: focus on the step 2 heading, which is in view; exactly one filled status;
    no `role=alert`; the explanation present;
  - after success: focus on the section title, status in view; only that status filled; step 2
    hidden; both counts in the text; the hint has class `notice`;
  - restoring the previous state reports next to its buttons.
- F2-2: wrong master password, wrong export password and damaged file each report next to the
  step. PASS.
- R-1: replacement guarantees. PASS.
- N4: native open dialog with the complete replacement. PASS.

## Test runs

| Run | Result |
|---|---|
| `npm test` (unit) | 236/236 pass |
| `run-browser-tests.mjs`, local Windows, Firefox 160.0.1, visible | 107/111 pass, 0 fail, 2 manual, 2 not tested (see below); `browser-results.json` |
| `native-dialogs.mjs`, local Windows | N1–N5 5/5 pass; `native-dialogs-windows.json` |
| `shortcut-upgrade.mjs`, local Windows | A, B, C 3/3 pass; `shortcut-upgrade-win32.json` |
| CI (5 platforms), run 44946512574 | 8/8 checks pass |

Manual and not tested items in the local run:

- B3-real-4 (real popup click-to-copy, needs `--os-input`): MANUAL.
- C4-8 (native save dialog): MANUAL. It is covered by N1–N3.
- C3-4 (idle lock): NOT_TESTED. The system never reported idle while the operator was working.
- T-2 (focus ring): NOT_TESTED. The test window was not active. Selection and focus movement
  pass.

The other screenshots in this directory are the suite's regular output from the same run.

## Still needs manual verification (operator)

- Ctrl+Shift+2 with a real keyboard on the operator's Firefox, including other add-ons and
  OS-wide shortcuts (other tools, keyboard drivers), which the probe cannot see.
- macOS (Command+Shift+2) and Linux with a real key press: CI checks only the static conflict
  list.
- The signed update path from 0.9.3 (permanent installation, update manifest): NOT_TESTED. Only
  the temporary-reinstall upgrade was tested; see "Shortcut on upgrade". It should be checked
  with the next signed test build: the old default should become Ctrl+Shift+2, and a
  customized shortcut should be kept.
- Screen-reader announcements of the replacement flow: NOT_TESTED.
- The look of the new replacement flow and of the hint, and real Ctrl+Plus zoom. The tests use
  CSS zoom.
