# Compact TOTP Authenticator (CTA)

Firefox WebExtension that shows TOTP codes in an ultra-compact popup: one 25 px row per
account, name left, code right, click to copy.

Based on [Rayquaza01/authenticator](https://github.com/Rayquaza01/authenticator) (MIT),
which was discontinued in 2025 because its encryption was insecure. CTA keeps the original's
compact interface concept and implements a substantially new security and storage
architecture (new code, encryption, key handling, import/export). It is an independent
project, not affiliated with or endorsed by the original author, and not an official
continuation of the original extension.

## Status

**Development build (0.x) – not ready for production use.** Accounts are stored encrypted
under a master password. If the master password is forgotten, the accounts can only be
restored from an export made before. User guide: [docs/USER-GUIDE.md](docs/USER-GUIDE.md);
release preparation: [docs/SIGNING.md](docs/SIGNING.md), [CHANGELOG.md](CHANGELOG.md).

Implemented (Phase B):

- Compact popup (270 px, one 25 px row per account, click to copy, fixed footer,
  scrollable list), toolbar button, active-site highlight, subtle hover, keyboard focus.
- TOTP per RFC 6238 (SHA-1/256/512, 6–8 digits, custom periods) via Web Crypto, offline.
- Account management (add, edit, delete, reorder, sort), German and English UI.
- Appearance settings: light/dark/automatic theme, custom colors with enforced contrast,
  font size 12–20 px, row height.
- Legacy `totp.json` import preview (validation, duplicates).
- Security foundation: non-extractable session key used only by the background,
  fail-closed lock deadline, auto-lock.

Implemented (Phase C1–C2):

- Persistent AES-256-GCM vault (versioned, authenticated metadata, safe writes with
  backup, verified read-back and explicit recovery).
- Master password (12+ characters, NFC) with PBKDF2-SHA-256 (600,000 iterations); setup,
  unlock, confirmed recovery and password change (locks the session immediately).

Implemented (Phase C3):

- A changed auto-lock time applies to the running session (shorter at once).
- Optional lock when the computer is idle (off by default; uses Firefox's optional
  `idle` permission; a locked screen alone is not detected by Firefox).
- Fresh master-password check for sensitive operations.

Implemented (Phase C4):

- Encrypted backup export with its own export password; restore into an empty vault.
- Unencrypted export (complete CTA format) after a warning and confirmation; legacy
  `totp.json` only when no information is lost.

Implemented (Phase C5):

- Import of a legacy `totp.json` or a CTA unencrypted export after a preview and the
  master password: append-only, duplicates skipped, names for unnamed entries, one write.

Implemented (Phase C6, release verification):

- Security regression, extension update test (unsigned upgrade simulation; the signed
  update test is still open), release audit and operator checklist
  ([docs/evidence/phase-c6](docs/evidence/phase-c6/README.md)).

In review (Phase D preparation, not merged): release package audit (`npm run check:release`),
signing-source preparation (`npm run release:source`), signing procedure, signed update test
plan, user guide, changelog and the operator's acceptance checklist
([docs/evidence/phase-d](docs/evidence/phase-d/README.md)). Nothing is signed or released.

Not implemented:

- Recovery UX for unverifiable vault generations (issue #8, proposal in SECURITY.md §12.5).
- Importing an encrypted export into a non-empty vault (issue #17).

Known limitations are documented in [docs/SECURITY.md](docs/SECURITY.md).

`npm test` (unit/regression/static), `npm run lint` (web-ext), `npm run test:browser`
(Firefox via WebDriver BiDi; `npm run test:browser:os` adds real Windows mouse input for the
toolbar popup), `npm start` (run in Firefox), `npm run spike:b0`.
Evidence: [docs/evidence/phase-b](docs/evidence/phase-b/README.md). See:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – upstream analysis, target architecture, plan
- [docs/PLAN-C4-C6.md](docs/PLAN-C4-C6.md) – C4–C6 decisions, C5 rules, release-blocking update test
- [docs/SECURITY.md](docs/SECURITY.md) – upstream weaknesses, threat model, key handling
- [docs/MIGRATION.md](docs/MIGRATION.md) – legacy `totp.json` import
- [docs/RELEASE.md](docs/RELEASE.md) – Manifest version, extension ID, signing, updates
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) – repositories, pull-request workflow, CI, Git conventions

## Contributing and security reports

Development happens on GitHub via pull requests; CI runs tests, lint and a package build.
Please report security issues privately via GitHub's "Report a vulnerability" (Security
tab), not in public issues. Never include real TOTP secrets in issues or pull requests.

## Principles

- Codes are generated locally, offline, with Web Crypto. No network access, no telemetry.
- Secrets are never stored in plaintext.
- No runtime dependencies, no build step: the submitted source is the shipped source.
- UI in German and English.

## License

SPDX-License-Identifier: MIT

MIT, see [LICENSE](LICENSE), which keeps the copyright notice of the original project
(Copyright (c) 2017 Rayquaza01). The interface concept comes from Rayquaza01/authenticator;
no code or assets of the original are included. The extension package ships the same
LICENSE file. No third-party runtime libraries, fonts or icons are bundled.
