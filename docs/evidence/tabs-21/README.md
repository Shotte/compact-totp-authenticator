# #21: three-tab options page (1.0.0 scope)

Operator decision CTA-UI-TABS-100: the tabbed options page is required for 1.0.0. This is a
UI restructuring only. Vault encryption, master-password handling, storage, import and export
formats, session rules, conflict protection and recovery guarantees are unchanged; no service
code was touched.

## Structure

| Tab | Content |
|---|---|
| **2FA-Einträge / 2FA entries** (default) | entries table (reorder, edit, delete), add/edit form |
| **Darstellung / Appearance** | live preview, theme, custom colors with the contrast warning, font size, row height with effective heights, popup sorting with its note, reset to defaults |
| **Allgemein / General** | sections "Master-Passwort ändern", "Automatische Sperre", "Import", "Export und Sicherung", "Aus verschlüsselter Sicherung wiederherstellen" (with the previous vault state) |

**Design decision for the review.** The setup, unlock and damaged-vault recovery forms stay
**above the tabs** while the vault is locked, instead of inside "General". Unlocking is the
precondition for every vault-dependent part of every tab, so the user never has to find a tab
first. In each tab, the vault-dependent parts are hidden while locked, with a hint pointing to
the form above. Changing the master password is in General. The appearance and lock settings
work while locked.

## Behaviour

- WAI-ARIA tabs pattern:
  - `role="tablist"`, `tab` and `tabpanel`;
  - `aria-selected`, `aria-controls`, `aria-labelledby`;
  - roving `tabindex`;
  - automatic activation with ArrowLeft, ArrowRight (wrapping), Home and End;
  - Tab moves into the panel;
  - a visible focus ring on tab and panel.
- The selected tab is kept in the location hash (`#entries`, `#appearance`, `#general`).
  Re-rendering, saving, importing, exporting or an error never switches it. A newly opened
  settings page starts on "2FA entries".
- Messages appear in the status region of the section of the action, inside the visible tab;
  a region in a hidden part falls back to the top.
- Leaving a tab clears its password fields. Unsaved non-secret input (for example a half-typed
  entry) is kept. No sensitive field is duplicated.
- The lock settings live in General but belong to the settings form (`form="settingsForm"`).
  Their events are handled on the document.
- The tabs use the theme tokens and follow automatic, light and dark.

## Fixes found by the new size and zoom check (T-5)

- The entries table was up to 330 px wider than the viewport at 1024 px and 200 % zoom:
  - `td.actions` shared the flex rule `.actions` of the form button rows, without wrapping;
  - `td.name` inherited `white-space: nowrap` from the popup's `.name` rule.

  The action buttons now wrap, and names and sites wrap.
- The font-size slider overflowed by 20 px; it is now constrained to its column.

## Evidence

| Check | Result |
|---|---|
| T-1 default tab and ARIA semantics | PASS (local) |
| T-2 keyboard: arrows, Home, End, wrapping, Tab into the panel, visible focus | Locally: selection and focus movement PASS. The focus ring is NOT_TESTED locally because the operator worked in another window, so the test window was not active; the test reports that honestly. CI (headless): see the PR checks |
| T-3 tab kept after reload, saved setting and error; messages in the originating section | PASS (local) |
| T-4 unsaved input kept, passwords cleared on leaving a tab | PASS (local) |
| T-5 1024, 1280 and 1920 px × 100/150/200 % zoom, all tabs: no horizontal overflow | PASS (local, 27 combinations) |
| Screenshots (de, synthetic entries) | [`tabs-entries-de.png`](tabs-entries-de.png), [`tabs-appearance-de.png`](tabs-appearance-de.png), [`tabs-general-de.png`](tabs-general-de.png) |
| Local browser run, Firefox 160.0.1, Windows ([`browser-results-local.json`](browser-results-local.json)) | 104/108 PASS, 2 MANUAL, 2 NOT_TESTED (T-2 focus ring, C3-4 system idle: both because the operator was working at the computer), 0 FAIL |
