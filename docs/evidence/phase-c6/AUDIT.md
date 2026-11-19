# C6.5 release security audit

Scope: the extension package built from `src/` at the C6 head, version 0.1.0. Method:
reading the source and manifest, the package check, `npm audit`, and the automated checks
named below. Release decisions are not made here; open points are listed at the end.

## 1. Manifest and permissions

| Item | Finding | Assessment |
|---|---|---|
| `manifest_version` | 3; event page (`background.scripts`, module) | as designed (RELEASE.md §1) |
| `permissions` | `storage`, `alarms`, `activeTab` | minimal: vault and settings, the auto-lock deadline, current-tab highlight on click |
| `optional_permissions` | `idle`, requested only from the options checkbox and removed when unchecked (C3-4) | as designed |
| Host permissions | none | no page access, no content scripts |
| `downloads` | not requested (C4 review, decision 2) | the export says "handed to Firefox", never "saved" |
| `web_accessible_resources` | none | pages are not reachable from websites |
| `externally_connectable` / external messaging | none; the background answers only its own pages | `test/static.test.mjs` |
| `data_collection_permissions` | `required: ["none"]` | no data collection |
| `browser_specific_settings.gecko.id` | fixed `{f587432b-…}` | stable ID; kept across the update test (U-3) |
| `strict_min_version` | 140.0 (Android 142.0) | CI runs ESR 140.17 |
| `update_url` | not set in `src/` | to decide in Phase D (self-distribution needs it). The update test adds it only to its test packages |

## 2. CSP and external resources

- No `content_security_policy` key, so the MV3 default applies (`script-src 'self'`, no
  remote code).
- HTML pages load only their own module script. There are no inline scripts and no inline
  event handlers.
- No `eval`, `new Function` or `innerHTML` in `src/`. No `fetch`, `XMLHttpRequest`,
  `WebSocket` or dynamic `import()`. No remote fonts, CDNs or analytics. Checked with grep
  over `src/`; the static test enforces the no-`console` rule.
- TOTP and crypto use Web Crypto only (PBKDF2-SHA-256, AES-256-GCM, HMAC). It works
  offline.

## 3. Dependency and asset inventory

- Runtime dependencies: **none**. The package contains only `src/`: 34 entries, i.e. HTML,
  CSS, JS modules, two locale files, one SVG icon and `LICENSE`.
- Development dependency: `web-ext` 10.8.0 (lint, build). It is not shipped.
  `npm audit --omit=dev`: 0 vulnerabilities.
- Assets: `icons/icon.svg`, drawn for this project. There are no third-party images or
  fonts (system font stack).
- CI actions are GitHub-owned and pinned to commit SHAs. The ESR binaries come from
  Mozilla's official download servers.

## 4. License packaging

`npm run build` runs `scripts/check-package.mjs`. The package must contain `LICENSE`
byte-identical to the repository's MIT license, with both copyright notices: **OK** at the
C6 head. The MIT licensing decision is unchanged.

## 5. Development-only code

- The Phase B `devUnlock` and the test fixtures are not in the product; the static test and
  the package check enforce this. Test helpers live in `test/helpers/`.
- Test hooks on the service object (`authorizeSensitive`, `hasPendingImport`) are not
  reachable by messages. `handle()` dispatches only `api`, tested in
  `test/c6-regression.test.mjs`.
- **Release gate:** the 0.x development notice ("not for production use") is shown on the
  options page in every state. It must be removed at 1.0 (RELEASE.md §5). It is
  intentionally still present.

## 6. Logging and error messages

- No `console` calls in `src/` (static test).
- Messages reduce errors to a code (`locked`, `conflict`, `invalid`, `malformed`,
  `unknown`, `internal`) and an optional reason. They never carry data, stacks or secrets:
  `test/c6-regression.test.mjs` checks every response of a full lifecycle, and unknown or
  malformed messages answer with a code only.
- Wrong passwords and damaged vaults give the same generic answer.

## 7. Import and export file handling

| Path | Limits and checks |
|---|---|
| Legacy / `cta-plain` import | ≤ 1 MB, ≤ 1,000 entries, JSON only, strict structure. Every row validated like manual entry; prototype keys are treated as data. Fresh master password, preview bound to session, file hash and revision. Text kept only in background memory with a bounded lifetime (SECURITY.md §14) |
| Encrypted restore | ≤ 8 MB + 4 KB, header validated before PBKDF2, bounded KDF parameters, AES-GCM with authenticated header, empty vault only, fresh master password (§13.4) |
| Exports | Encrypted by default with a self-check. Plaintext and legacy only after warning and confirmation; legacy only when lossless. Blob URL revoked right after the click |

## 8. Persistent data compatibility

- Vault format v1 (SECURITY.md §6) is unchanged since C2. The stored keys are `vault`,
  `vault_backup`, `vault_next` and `settings`.
- The update test (U-4…U-7, ESR) shows that a permanent install updated through the
  AddonManager path keeps `storage.local` byte-identical. After the update, the master
  password, accounts, order, settings and TOTP codes are intact, also after a browser
  restart. It is an unsigned upgrade simulation, see the evidence README.
- No migration code exists or is needed yet. A future format v2 needs its own migration
  and an update test from v1.

## 9. Recovery limitations (documented, not defects)

- A forgotten master password means the vault cannot be recovered. The only recovery path
  is an encrypted or plaintext export made before. There is no reset action yet (open
  proposal, PLAN-C4-C6.md §2).
- A vault whose generation cannot be verified is not recovered automatically. The
  exceptional recovery UX is issue #8, which stays open and is not implemented.
- JavaScript cannot zeroize strings. Passwords, decrypted secrets and import text are
  dropped by reference and freed by garbage collection (SECURITY.md §11.5, §14).
- Download completion is visible only in Firefox's download panel.

## 10. Documentation accuracy

Checked against the code at the C6 head:

- README phase list, ARCHITECTURE API and phase tables, SECURITY §7.6, §7.7, §13 and §14,
  MIGRATION and PLAN-C4-C6 match the implementation.
- Corrected in C6: the README still listed C5 as "in review" and C6 as planned; the
  ARCHITECTURE phase table still showed C5 as an open PR.

## Open points for the release decision

1. `update_url` and signing for self-distribution (Phase D, operator authorization).
2. Remove the development notice at 1.0.
3. Signed-extension update test: release-blocking, NOT_TESTED until signed builds exist.
4. Manual release blockers #2–#6 and #9 are still open; see the operator checklist.
