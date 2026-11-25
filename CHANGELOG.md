# Changelog

Version numbers: numeric `major.minor.patch`. Each version can be signed by AMO only once.
0.9.x is reserved for the signed update test builds (docs/SIGNING.md); 1.0.0 is the first
distribution release.

## 1.0.0 – release candidate (not released)

Release candidate for the operator's approval. Not signed, not submitted. The date is set on
release.

**Compact TOTP Authenticator 1.0.0**: a compact, offline TOTP authenticator for Firefox.
It is an independent project and not the original "Authenticator" extension.

- New icons: a shield with three code dots in the toolbar, with light and dark variants for
  Firefox's light and dark themes, and a gear for the settings button in the popup.
- Compact toolbar popup: one 25 px row per account, click or keyboard to copy, highlight
  for the current website, light/dark/automatic theme and custom colours.
- TOTP per RFC 6238: SHA-1/256/512, 6–8 digits, custom periods.
- Encrypted vault (AES-256-GCM) under a master password (PBKDF2-SHA-256, 600,000
  iterations). Auto-lock, optional lock when the computer is idle, locked after a browser
  restart.
- Encrypted backup export with its own password. Restore replaces the vault only after a
  check and a preview of the differences; the replaced state stays as an encrypted copy that
  can be swapped back or deleted, with a reminder after 30 days. Unencrypted exports only
  after a warning.
- Keyboard: Ctrl+Shift+2 opens the popup (customisable in Firefox's add-on shortcuts).
- Import from the original extension's `totp.json` and from CTA's unencrypted export, with
  a preview and duplicate detection. Existing accounts are never overwritten.
- German and English user interface.
- Firefox for desktop only (Windows, macOS, Linux), Firefox 140 or newer.
- The 0.x development notice is removed from the options page. The setup page keeps the warning
  that a forgotten master password cannot be recovered.

Known limitations:
- A forgotten master password cannot be recovered without an export.
- Download success is visible only in Firefox's downloads panel.
- Importing an encrypted export into a vault that already has accounts is not supported
  yet (issue #17).
- Real keyboard and native file dialogs are verified on Windows; macOS and Linux are covered
  by the automated headless suite only, unless a manual check is recorded. Screen-reader
  output is not verified (roles and labels are checked).
- Firefox 161 shows the light-theme toolbar icon in the dark extensions menu (Firefox
  behaviour; ESR 140 picks the right one). The icon uses a mid-grey there that stays legible.

Release candidate report: docs/evidence/phase-d/RC-1.0.0.md. 1.0.0 is distributed
through AMO listed, with Mozilla-managed updates and no `update_url`, only after the
operator's explicit release approval.

## 0.1.0 – development builds (not released)

Phases A–C6 on `main`. Unsigned, for development and review only.

| Phase | Content |
|---|---|
| B | popup, accounts, appearance, legacy import preview |
| C1–C2 | encrypted vault, master password, recovery |
| C3 | session security |
| C4 | export and restore |
| C5 | import apply |
| C6 | release verification |

Details: README and docs/ARCHITECTURE.md.
