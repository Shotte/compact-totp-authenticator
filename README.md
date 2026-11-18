# Compact TOTP Authenticator (CTA)

Firefox WebExtension that shows TOTP codes in an ultra-compact popup: one 25 px row per
account, name left, code right, click to copy.

Independent fork of [Rayquaza01/authenticator](https://github.com/Rayquaza01/authenticator)
(MIT, discontinued 2025 because its encryption was insecure). CTA keeps the compact UI and
replaces storage, encryption and import/export.

## Status

Phase B (functional baseline) on `feature/phase-b`: compact popup, account management,
TOTP, legacy import preview, background-only key boundary. Development build with
synthetic in-memory demo data only; nothing is persisted until Phase C.

`npm test` (unit/regression/static), `npm run lint` (web-ext), `npm run test:browser`
(Firefox via WebDriver BiDi), `npm start` (run in Firefox), `npm run spike:b0`.
Evidence: [docs/evidence/phase-b](docs/evidence/phase-b/README.md). See:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – upstream analysis, target architecture, plan
- [docs/SECURITY.md](docs/SECURITY.md) – upstream weaknesses, threat model, key handling
- [docs/MIGRATION.md](docs/MIGRATION.md) – legacy `totp.json` import
- [docs/RELEASE.md](docs/RELEASE.md) – Manifest version, extension ID, signing, updates
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) – repository (private Forgejo), Git conventions

## Principles

- Codes are generated locally, offline, with Web Crypto. No network access, no telemetry.
- Secrets are never stored in plaintext.
- No runtime dependencies, no build step: the submitted source is the shipped source.
- UI in German and English.

## License

MIT, see [LICENSE](LICENSE). Contains design concepts from Rayquaza01/authenticator (MIT).
