# User guide

Applies to Compact TOTP Authenticator (CTA) from the first signed release on. Until then
CTA is a development build (0.x) and not meant for real accounts. The UI is available in
German and English and follows Firefox's language.

## 1. Installation

Requirements: Firefox 140 or newer (desktop; current release or ESR).

1. Download the signed `.xpi` file from the release page named in the release notes. Only
   use files from that page.
2. Install it in Firefox: open the file, or about:addons → gear → "Install Add-on From
   File…". Confirm the permissions:
   - store data;
   - set alarms for the auto-lock;
   - access the current tab only when you click the toolbar button, used to highlight the
     matching account.
3. The CTA button appears in the toolbar. If it is not visible, open the puzzle-piece menu
   and pin it. Keyboard shortcut: Ctrl+Shift+2 (Command+Shift+2 on macOS; until 0.9.3 it was
   Alt+Shift+A, which opens the View menu in German Firefox). You can change it under
   about:addons → gear → "Manage Extension Shortcuts". Firefox refuses its own shortcuts there,
   but it does not check menu access keys: avoid Alt+letter on Windows and Linux.
4. On first use, open the settings page from the popup and create a master password: at
   least 12 characters, entered twice. **Remember it:** without it, your accounts cannot
   be recovered (see §5).

The settings page has three tabs: **2FA entries** (the list, add, edit, delete, reorder),
**Appearance** (preview, theme, colors, font size, row height) and **General** (behaviour:
popup sorting, automatic lock and idle lock; master password; import, export, restore and
previous vault state). While the vault is locked, the setup or unlock form appears above the tabs.

## 2. Daily use

- **Unlock:** enter the master password in the popup. CTA locks again after 15 minutes
  without activity (adjustable), when you click the lock button, and when Firefox
  restarts. Optionally it also locks when the computer is idle: settings → General → "Also lock when
  the computer is idle". This asks for Firefox's optional "idle" permission.
- **Copy a code:** click a row, or select it with Tab and press Enter or Space. A green
  check mark confirms the copy.
- **Manage accounts:** add, edit, delete and reorder accounts in the settings tab "2FA entries". The
  secret key is never shown again after saving. Short keys (under 16 characters) are
  accepted with a warning.

## 3. Backup (export)

Make a backup after setting up and after every change. CTA cannot recover anything
without one.

- **Encrypted export (recommended):** Settings → General → "Export and backup" → "Encrypted CTA backup
  (recommended)". Choose an export
  password (at least 12 characters, different from the master password unless you tick
  the option) and confirm it with your master password. The file `cta-export-<date>.json`
  is handed to Firefox for saving. Check Firefox's downloads panel that it was saved.
  Store the file and the export password in different places.
- **Unencrypted export** (complete CTA format) and **`totp.json`** (for the original
  extension, only when no information would be lost) are available after a warning and
  confirmation. These files contain your secret keys in plain text. Store them offline
  and delete them when no longer needed.

## 4. Migration and restore

- **From the original extension:** export `totp.json` there, then in CTA open Settings →
  General → Import and choose the file. The preview shows each entry:
  - new, or name exists (both imported);
  - duplicate (skipped);
  - invalid (skipped, with a reason);
  - no name: an editable generated name such as "Unnamed 1".

  Enter your master password and click Import. Existing accounts are never changed.
  Afterwards, delete `totp.json`: it contains your keys in plain text. Details:
  [MIGRATION.md](MIGRATION.md).
- **CTA unencrypted export:** same import, with every parameter kept.
- **Restore an encrypted export** (new computer, new profile): set up CTA with a master
  password, then Settings → General → "Restore: replace the vault with an encrypted backup".
  Unlike the import, this replaces all current entries. Choose the file, enter its export
  password and your master password once, and click "Check backup" (nothing changes yet).
  The preview shows what would change. "Replace vault now" asks once for confirmation; an
  empty vault is restored directly. The check stays valid for at most 3 minutes and ends
  with any lock. The previous vault state is kept as an encrypted copy that you can restore
  or discard in the same section: enter your master password once and click "Restore
  previous vault" (swaps the two states, nothing is lost) or "Delete previous vault state"
  (irreversible). One dialog asks for confirmation; Cancel is preselected.

## 5. Updates and recovery

- **Updates:** the public version from addons.mozilla.org updates automatically through
  Firefox like other add-ons (RELEASE.md §4). Your encrypted data, settings and account
  order are kept. After an update, unlock with your usual master password. Make a fresh
  encrypted export before major updates anyway.
- **Forgotten master password:** the accounts cannot be decrypted, and nobody (including
  the developers) can recover them. Remove CTA's data (uninstall the add-on), install it
  again and restore your last encrypted export (§4).
- **Damaged data:** if CTA reports damaged data at unlock, it offers to restore the
  previous saved state after your confirmation and the correct password. It never
  overwrites anything without asking. If CTA says the stored data is damaged and cannot be
  restored safely, entering the password again does not help. Remove CTA (uninstall the
  add-on), install it again and restore your last encrypted export (§4).
- **Lost computer or profile:** install CTA elsewhere and restore your encrypted export.

## 6. Security notes and limitations

- Secrets are stored encrypted (AES-256-GCM). The key is derived from your master
  password (PBKDF2-SHA-256, 600,000 iterations) and kept only while CTA is unlocked. CTA
  needs no internet connection and sends no data anywhere.
- While CTA is unlocked, anyone using your Firefox profile can see and copy codes. Lock it
  (button, shortcut, auto-lock) when you leave the computer. Locking the screen alone is
  not detected; use the idle option if you want that.
- Codes copied to the clipboard stay there until something else is copied.
- CTA protects your keys on disk and against websites. It cannot protect against malware
  on your computer or against someone who knows your master password.
- Download success is shown only in Firefox's downloads panel; CTA does not see it.
- Technical details and known limitations: [SECURITY.md](SECURITY.md).
