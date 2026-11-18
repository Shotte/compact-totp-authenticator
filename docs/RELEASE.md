# Release and signing

Status: Phase A research. No AMO account, API key or submission exists. Nothing is submitted
without explicit operator approval.

## 1. Manifest version

- Firefox supports MV2 and MV3; Mozilla has stated it will keep MV2 support and has not
  announced an end date. MV3 in Firefox uses event pages (`background.scripts`), not
  service workers.
- CTA uses **MV3**: maintained path, no host permissions needed, our design (event page +
  `storage.session`) fits it.
- Required keys: `browser_specific_settings.gecko.id`,
  `browser_specific_settings.gecko.data_collection_permissions` (mandatory for new
  extensions since 2025-11-03; CTA declares `{"required": ["none"]}`, which needs
  Firefox 140+, so `strict_min_version: "140.0"`).
- Version strings: numeric `major.minor.patch` only.

## 2. Extension ID

**Decided: `{f587432b-b553-483e-b08d-4feac6378113}`** (GUID, generated 2026-11-18 with
`crypto.randomUUID()`). It must never change after the first signing (updates are matched
by ID). The old ID `authenticator@r01` is not reused. The B0 spike uses its own ID
`{5821226e-579a-404a-9336-5ad61995f89c}` and is never signed.

## 3. Distribution: signed, unlisted

- Release Firefox only installs signed add-ons; signing is done by AMO for both listed and
  unlisted add-ons. Unlisted = signed XPI distributed by us, not shown on AMO.
- Requires an AMO developer account and API credentials (JWT issuer/secret), stored outside
  the repository (environment variables).
- Command: `web-ext sign --channel=unlisted --source-dir src` (with API key/secret). Unlisted
  submissions pass automated validation and are usually signed quickly; Mozilla may still
  review them later.
- No minified or generated code → no separate source-code submission needed.
- Development installs: `about:debugging` → temporary add-on, or `web-ext run`.

## 4. Updates

Unlisted add-ons do not update automatically unless the manifest contains
`browser_specific_settings.gecko.update_url` pointing to an HTTPS `updates.json`
(for example on GitHub Pages or Releases). Each new version must be signed via AMO first.
Without `update_url`, users install each new XPI manually.

Decided: manual installation during development; a self-hosted HTTPS `update_url` is added
before stable distribution (host to be chosen; the manifest key cannot be added
retroactively to already installed versions, so it must be present in the first stable
release).

## 4a. Repository

Private Forgejo is the development authority; changes reach `main` only via reviewed feature
branches. A public GitHub mirror is optional. Signing credentials never enter either
repository. Address and Git conventions: [DEVELOPMENT.md](DEVELOPMENT.md).

## 5. Release checklist (Phase D)

- [ ] `npm test` green, `web-ext lint` clean
- [ ] Permission review against SECURITY.md §5
- [ ] Secret-leak grep, fixtures synthetic
- [ ] Manual test on Firefox current release (160) and ESR 140, Windows
- [ ] `web-ext build`; XPI contains only `src/`
- [ ] Operator approval → `web-ext sign --channel=unlisted`
- [ ] Tag release, attach signed XPI, update `updates.json` if used

## Sources

- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
