# C6.3 operator checklist (manual release checks)

For the operator before Phase D. Use **synthetic accounts only**: a fresh Firefox profile,
an import of `test/fixtures/legacy-synthetic.json` and any password made up for the test.
Never use real TOTP secrets. Each item names the issue that stays open until it is
checked. Automated checks are supporting evidence, not a substitute; the issues are not
closed because a headless check passed.

Setup for 1–4: `npm start` (`web-ext run`, temporary add-on, fresh profile), or
about:debugging → "Load Temporary Add-on" → `src/manifest.json`. Then create a vault and
import the synthetic file.

## 1. Popup appearance on your screen – issue #2 (about 5 min)

- [ ] Click the toolbar button. The popup is 270 px wide, the rows are compact (25 px by
      default), the footer stays fixed, and the list scrolls to the last account.
- [ ] In Settings: theme dark, light, auto (switch the Windows colour mode while the popup
      is open), custom colours, font size 12 and 20 px. Everything stays readable, nothing
      is cut off.
- [ ] Hovering a row and the highlight of the account for the current website are visible
      but subtle.

Supporting evidence: B3-real-1…3, B8-1…3, B7-* (screenshots in `docs/evidence/phase-b`).

## 2. Keyboard-only popup – issue #3 (about 3 min)

- [ ] Open the popup with Alt+Shift+A. Tab moves through the rows with a visible inset
      focus ring; the list itself is not a tab stop.
- [ ] Enter and Space copy the focused row's code: green check mark, and the code is in
      the clipboard (paste it into a text field to check).
- [ ] The footer buttons (lock, settings) are reachable with Tab and work with Enter.

Supporting evidence: B8-2 (focus ring), B3-copy (clipboard via script).

## 3. Toolbar placement and shortcut – issue #6 (about 2 min)

- [ ] On first install the button is in the toolbar, not hidden in the overflow menu.
- [ ] Alt+Shift+A opens the popup on your setup. Check in about:addons → gear → "Manage
      Extension Shortcuts" that no other add-on uses it.

Supporting evidence: C6-1 (widget placed in `nav-bar`), C6-2 (shortcut registered, no
built-in Firefox key uses it). Neither covers other add-ons or OS-level shortcuts.

## 4. Native file dialog for the legacy import – issue #5 (about 3 min)

- [ ] Options page → Import → "Browse…" opens the system file dialog. Pick the synthetic
      `totp.json`; the preview appears.
- [ ] The unnamed row shows "Ohne Namen 1 – erzeugter Name, änderbar". Enter the master
      password and click Import; 6 accounts are added, and the message says to delete the
      file.

Supporting evidence: N5 on Windows drives the real Open dialog
(`native-dialogs-windows.json`). For macOS and Linux, see item 7.

## 5. Browser restart clears the session (signed build) – issue #4

Needs a permanently installed build, which on release Firefox means a signed build (Phase
D).

- [ ] Install the signed build, unlock, and quit Firefox completely.
- [ ] Start Firefox again: the popup asks for the master password and shows no codes.

Supporting evidence:
- C3-1 (graceful restart, temporary add-on with storage kept);
- C2-6 (hard kill);
- U-7 (permanent unsigned install on ESR 153.7 after an update: locked, no key in
  `storage.session`).

## 6. Real storage under interrupted sessions – issue #9 (review only)

The issue asks for the vault tests on real `storage.local` with interrupted sessions.
Existing browser checks on the CI matrix:

| Check | Covers |
|---|---|
| C2-2 | wrong passwords never modify storage (byte-identical) |
| C2-5 | damaged vault: recovery without writing, confirmed restore |
| C2-6 | hard kill and restart |
| C2-7-* | kill during write bursts |
| C2-8-* | kill during password rotation: exactly one password works |
| C2-9 | authentication scenarios across lock, expiry, restart and rotation |
| C4-9, C5-3 | concurrent changes never silently overwrite |

- [ ] The architecture review decides whether this evidence satisfies #9. It is not closed
      automatically.

## 7. Native dialogs on macOS and Linux (C4 decision 2) – about 10 min per OS

- [ ] Export (encrypted) with "Always ask where to save files": the Save dialog appears and
      saving works; Cancel writes nothing.
- [ ] A target folder without write permission: Firefox's download panel shows a failure.
- [ ] Restore: the Open dialog picks the saved file, and the restore works into an empty
      vault in a new profile.
- [ ] Legacy import through the Open dialog (as item 4).

## 8. Real mouse input on the Windows popup (scheduled run)

- [ ] Run `npm run test:browser:os` on Windows at an agreed time. It moves the mouse
      briefly, so do not use the computer meanwhile. Expected: B3-real-4…7 and B8-real
      PASS.

## 9. Signed extension update – release-blocking (Phase D)

Needs operator authorization for AMO signing. Not done in C6.

- [ ] Sign 0.1.0 (unlisted) with an `update_url`, install it permanently on release
      Firefox, create a synthetic vault, a custom order and settings.
- [ ] Publish a signed 0.1.1 to the update URL, then use about:addons → "Check for Updates".
- [ ] After the update: same extension ID, vault intact, master password works, accounts,
      order and settings unchanged, codes correct, and after a restart locked.

`test/browser/update-test.mjs` automates the same assertions for the unsigned ESR
simulation (U-1…U-7) and can be adapted to signed packages.

## 10. Optional accessibility pass

- [ ] Screen reader (NVDA or Narrator): the popup rows announce name and code; the options
      page fields have labels.
- [ ] HiDPI (150 %/200 % scaling): the popup is not blurry or cut off.
