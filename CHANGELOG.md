# Changelog

Version numbers: numeric `major.minor.patch`. Each version can be signed by AMO only once.
0.9.x is reserved for the signed update test builds (docs/SIGNING.md); 1.0.0 is the first
distribution release.

## Unreleased – draft release notes for 1.0.0

Not released. These notes become final with the release decision (RELEASE.md §5).

**Compact TOTP Authenticator 1.0.0**: a compact, offline TOTP authenticator for Firefox.
It is an independent project and not the original "Authenticator" extension.

- Compact toolbar popup: one 25 px row per account, click or keyboard to copy, highlight
  for the current website, light/dark/automatic theme and custom colours.
- TOTP per RFC 6238: SHA-1/256/512, 6–8 digits, custom periods.
- Encrypted vault (AES-256-GCM) under a master password (PBKDF2-SHA-256, 600,000
  iterations). Auto-lock, optional lock when the computer is idle, locked after a browser
  restart.
- Encrypted backup export with its own password; restore into an empty vault.
  Unencrypted exports only after a warning.
- Import from the original extension's `totp.json` and from CTA's unencrypted export, with
  a preview and duplicate detection. Existing accounts are never overwritten.
- German and English user interface.

Known limitations:
- A forgotten master password cannot be recovered without an export.
- Download success is visible only in Firefox's downloads panel.
- Importing an encrypted export into a vault that already has accounts is not supported
  yet (issue #17).

Before 1.0.0 (release blockers):
- the signed update test (docs/SIGNING.md §5);
- the manual acceptance (docs/evidence/phase-d/ABNAHME.md);
- the release decision on `update_url`;
- removing the development notice.

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
