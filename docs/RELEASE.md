# Release and signing

Status: Phase D prepared. Signing procedure and signed update test: [SIGNING.md](SIGNING.md).
No AMO account, API key, submission, signed build, tag, release or published update manifest
exists. Nothing is signed or submitted without explicit operator approval.

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
- Command: `web-ext sign --channel unlisted` on the directory prepared by
  `npm run release:source` (credentials only via `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` in the
  environment; exact steps in SIGNING.md). Unlisted
  submissions pass automated validation and are usually signed quickly; Mozilla may still
  review them later.
- No minified or generated code → no separate source-code submission needed.
- Development installs: `about:debugging` → temporary add-on, or `web-ext run`.

## 4. Distribution and updates (decided, CTA-001)

Two stages (details and guards: [SIGNING.md](SIGNING.md) §1–2):

1. **Signed private acceptance builds 0.9.0 and 0.9.1**, AMO **unlisted**, with the
   test-only `update_url` `https://127.0.0.1:47811/updates.json`. They verify signing,
   installation in release Firefox, signed automatic updates and the manual acceptance. They
   are used only in throwaway profiles with synthetic accounts and are never distributed.
2. **Public release 1.0.0, AMO listed**, without `update_url`: Mozilla manages updates. It
   is published only after the operator's explicit release approval.

| | AMO listed, Mozilla-managed updates | AMO unlisted, self-hosted `updates.json` |
|---|---|---|
| Discovery | AMO page, search, ratings | only via our own link |
| Updates | automatic through AMO, nothing to host | needs an HTTPS `updates.json` and XPI hosting that stay reachable for all installed versions; the URL can never change for them |
| Review | Mozilla review before publication; later versions too | automated signing within minutes; Mozilla may review later |
| Release speed | slower (review queue) | fast |
| Operating risk | low; no infrastructure | hosting outage or expired certificate stops updates |
| Trust for users | AMO listing, Mozilla-reviewed | lower; manual XPI installation warning |
| Fits CTA | yes: small, unminified, no network access, no data collection | only for the private test builds |

Decision: listed for 1.0.0 (operator, CTA-001 "Final Distribution Strategy").
`scripts/check-release.mjs` fails any 1.x package with an `update_url`.
`scripts/release-source.mjs` sets an `update_url` only for the test builds below 1.0.0.

An installed unlisted test build does not move to the listed channel (SIGNING.md §2). That
is why test builds stay in throwaway profiles.

The addons linter accepts only HTTPS `update_url`s for self-hosted builds
(`web-ext lint --self-hosted`). That is why the test builds and the update test's local
server use HTTPS with a certificate trusted only in the throwaway profile.

## 4a. Repository and ownership

The public GitHub repository is authoritative (development, pull requests, issues, CI,
releases); a private Forgejo pull mirror is the backup. Changes reach `main` only via
reviewed pull requests. The operator owns releases and AMO submissions; AMO API
credentials are kept outside both repositories and outside CI until signing automation
is explicitly approved. Conventions: [DEVELOPMENT.md](DEVELOPMENT.md).

## 4a-2. Licensing decision

Final decision (operator, 2026-11-19): **MIT** (`SPDX-License-Identifier: MIT`). The root
`LICENSE` holds the unmodified MIT text with the notices of this project and of the
original project (Copyright (c) 2017 Rayquaza01), whose notice must be preserved.
`src/LICENSE` is an identical copy so the extension package carries the notice (enforced by
a static test). Audit 2026-11-19: no third-party runtime code, fonts, icons or images are
bundled (all icons are original SVGs); `web-ext` (MPL-2.0) is a development tool only and
not shipped.

## 4b. AMO listed release

The project is open source: MIT, with the attribution to Rayquaza01/authenticator kept in
`LICENSE` and in the README. The listed 1.0.0 needs:

- listing texts in German and English and screenshots with synthetic data only
  ([AMO-LISTING.md](AMO-LISTING.md), draft);
- the privacy declaration, matching `data_collection_permissions: none`;
- a source link to the public repository.

The source is published unminified and without a build step, so no separate source upload
is required.

## 5. Release checklist (Phase D)

- [ ] `npm test` green, `web-ext lint` clean, `npm run check:release` OK (package audit, also in CI)
- [ ] Signing source prepared with `npm run release:source` from merged `main` (no uncommitted
      `src/` changes); `SHA256SUMS` recorded
- [ ] Permission review against SECURITY.md §5
- [ ] Secret-leak grep, fixtures synthetic
- [ ] Manual test on Firefox current release (160) and ESR 140, Windows
- [x] Native file dialogs: accepted on the Windows evidence for Firefox 1.0 (CTA-001, issue #5).
  N1–N5 in `test/browser/native-dialogs.mjs` cover Save, cancel, a failing download, Open
  plus restore, and the legacy import.
  **Portability limitation:** the native dialogs on Linux and macOS are not verified, by
  automation or by hand. They stay a manual check whenever such a desktop is available.
  The headless browser suite runs on both platforms in CI.
- [ ] **Release-blocking: real extension update test** (approved C6 decision): the signed
      previous version updates to the new signed version; the encrypted vault survives; the
      extension ID is unchanged; settings and account order are intact; unlock and TOTP
      generation work afterwards (PLAN-C4-C6.md §4)
- [ ] `web-ext build`; XPI contains only `src/`
- [ ] Licensing and attribution: XPI contains `LICENSE` (MIT, identical to the repository
      root, both copyright notices); no new third-party code, fonts, icons or images without
      a compatible license and required attribution; README attribution unchanged
- [ ] Every open issue classified and the issue review accepted
      ([ISSUE-REVIEW.md](evidence/phase-d/ISSUE-REVIEW.md))
- [ ] Manual acceptance by the operator: [ABNAHME.md](evidence/phase-d/ABNAHME.md) (issues #2, #3, #6)
- [ ] Stage 1: operator authorization → sign 0.9.0/0.9.1 unlisted (SIGNING.md §5), verify
      (§6), run the signed update test (§7)
- [ ] 1.0 release decision: remove the development notice (`scripts/check-release.mjs` fails a
      1.x build that still shows it, a 0.x build without it, and a 1.x build with an `update_url`)
- [ ] Stage 2: operator's explicit release approval → listed submission of 1.0.0 (SIGNING.md §8)
- [ ] Tag the release and attach the signed XPI

## Sources

- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
