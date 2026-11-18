# Compact TOTP Authenticator (CTA)

Firefox WebExtension that shows TOTP codes in an ultra-compact popup: one 25 px row per
account, name left, code right, click to copy.

Independent fork of [Rayquaza01/authenticator](https://github.com/Rayquaza01/authenticator)
(MIT, discontinued 2025 because its encryption was insecure). CTA keeps the compact UI and
replaces storage, encryption and import/export.

## Status

**Development build (0.x) – not for everyday use yet.** It runs on synthetic demo accounts
only; nothing is saved, and there is no master password yet.

Implemented (Phase B):

- Compact popup (270 px, one 25 px row per account, click to copy, fixed footer,
  scrollable list), toolbar button, active-site highlight, subtle hover, keyboard focus.
- TOTP per RFC 6238 (SHA-1/256/512, 6–8 digits, custom periods) via Web Crypto, offline.
- Account management (add, edit, delete, reorder, sort), German and English UI.
- Appearance settings: light/dark/automatic theme, custom colors with enforced contrast,
  font size 12–20 px, row height.
- Legacy `totp.json` import **preview** (validation, duplicates; no import yet).
- Security foundation: non-extractable session key used only by the background,
  fail-closed lock deadline, auto-lock, encrypted in-memory working copy.

Planned (Phase C) – not implemented yet:

- Persistent AES-256-GCM vault and master password (PBKDF2); the "Unlock with demo data"
  button is a development stand-in, not a security mechanism, and is removed then
  (enforced by a release-gate test before 1.0.0).
- Encrypted export, confirmed plaintext export, applying the legacy import.

Known limitations are documented in [docs/SECURITY.md](docs/SECURITY.md).

`npm test` (unit/regression/static), `npm run lint` (web-ext), `npm run test:browser`
(Firefox via WebDriver BiDi; `npm run test:browser:os` adds real Windows mouse input for the
toolbar popup), `npm start` (run in Firefox), `npm run spike:b0`.
Evidence: [docs/evidence/phase-b](docs/evidence/phase-b/README.md). See:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – upstream analysis, target architecture, plan
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

MIT, see [LICENSE](LICENSE). Contains design concepts from Rayquaza01/authenticator (MIT).
