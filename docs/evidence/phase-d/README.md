# Phase D preparation – evidence

Status: **prepared, nothing signed or published.** No AMO account, API credentials,
submission, signed build, tag, GitHub release or published update manifest exists.
Synthetic data only.

| File | Content |
|---|---|
| [`../../SIGNING.md`](../../SIGNING.md) | distribution strategy, account and credentials, build, signing, verification, signed update test, AMO listed 1.0.0 |
| [`ABNAHME.md`](ABNAHME.md) | German acceptance checklist for the operator (5 groups, only checks automation cannot replace) |
| [`ISSUE-REVIEW.md`](ISSUE-REVIEW.md) | classification of every open issue before signing |
| [`../../AMO-LISTING.md`](../../AMO-LISTING.md) | draft AMO listing for 1.0.0, German and English |
| [`browser-results-local.json`](browser-results-local.json) | local browser run, Windows, Firefox 160.0.1: 90/93 PASS, 2 MANUAL, 1 NOT_TESTED, 0 FAIL |
| [`../../USER-GUIDE.md`](../../USER-GUIDE.md), [`../../../CHANGELOG.md`](../../../CHANGELOG.md), [`../../MIGRATION.md`](../../MIGRATION.md) | D5 user documentation and draft release notes |

## Review update (after the Phase D approval)

- **Localhost update URL:** the pre-merge check found a gap. `release:source --version 1.0.0
  --update-url https://127.0.0.1:…` passed both scripts. Fixed together with the
  distribution decision (1.0.0 AMO listed, Mozilla-managed updates):
  - `check:release` fails every 1.x package that has an `update_url`, and every package
    with an embedded certificate;
  - `release:source` only knows `--test-update` (below 1.0.0) and `--no-update-url`.
  - Tests: `release-scripts.test.mjs`, 19 tests.
- **Signed XPI verification:** `npm run verify:signed -- <xpi> dist/signing/<v>` checks the
  returned XPI against `SHA256SUMS`: no extra files, signature files present, ID, version
  and `update_url`. Proven by unit tests (changed, missing and extra file, unsigned) and on
  a real unsigned 0.9.0 build: 5/6, only the signature missing, as expected.
- **B8-4 (issue #3):** keyboard-only operation with trusted key input. Local PASS.
- **Issue #8:** characterization test in `service.test.mjs`; SECURITY.md §7.5 and
  USER-GUIDE §5 corrected (see ISSUE-REVIEW.md).
- **Acceptance fixture:** `test/fixtures/acceptance-30-synthetic.json`, 30 synthetic
  accounts (`CTA-SYNTHETIC-000301…330`) for the scrolling check.

## D1 – Release package audit

`npm run check:release` (`scripts/check-release.mjs`) runs locally and in the CI `test`
job. Result on `src/` at the Phase D head: **26/26 OK** (a 1.x package gets 27 checks: also
"no update_url").

| Area | Checks |
|---|---|
| Manifest | MV3; ID `{f587432b-b553-483e-b08d-4feac6378113}` unchanged; numeric version; `strict_min_version` 140.0; `data_collection_permissions: none`; permissions exactly `storage`, `alarms`, `activeTab`, optional `idle`; no host permissions, content scripts, web-accessible resources, external messaging or custom CSP; `update_url` absent or HTTPS; localized name and description |
| Files | only `.js .html .css .json .svg` and `LICENSE`; no test, fixture, source-map or hidden files |
| License | `LICENSE` byte-identical to the repository's MIT license, both copyright notices |
| Content | no `console`/`debugger`, no `eval`/`new Function`, no remote resources or network calls, no synthetic test markers, no Base32 secret-like strings, no keys or credentials, no development unlock |
| Development notice | 0.x must show it; a 1.x build that still shows it fails. Removing it is the explicit 1.0 release decision, never silent |

`test/release-scripts.test.mjs` proves that the audit fails on each kind of violation: 13
mutations, e.g. a changed ID, an extra permission, an http `update_url`, a console call, a
fetch, a Base32 string, a fixture marker, a test file, a changed LICENSE, and the
development-notice gate in both directions.

The development notice was outdated: it said "no export yet", although export has existed
since C4. It now says that accounts can only be restored from an export made before. The
German UI texts consistently use the informal address ("du"); two C5 strings were
corrected.

`npm run build` and the package check (`LICENSE` in the XPI): OK.

## D2 – Signing source

`npm run release:source -- --version 0.9.0 --test-update` and `… 0.9.1 …` at commit
`fe08457` (clean tree):

| Version | `update_url` | `web-ext lint --self-hosted` | Audit | Files |
|---|---|---|---|---|
| 0.9.0 | `https://127.0.0.1:47811/updates.json` | 0 errors, 0 warnings | 26/26 | 27 |
| 0.9.1 | same | 0 errors, 0 warnings | 26/26 | 27 |

Finding: the addons linter rejects a plain-http `update_url`. In normal (AMO-hosted) lint
mode it rejects any `update_url`; with `--self-hosted`, an HTTPS URL passes. That is why
the test builds use HTTPS on 127.0.0.1, and why the update test now serves HTTPS with a
per-run certificate.

The script refuses:
- versions below `src/`;
- non-HTTPS URLs;
- test-update builds ≥ 1.0.0;
- uncommitted `src/` changes (exit code 1).

It never runs `web-ext sign`. The signing command it prints relies on
`WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` in the environment.

## D3 – Signed update test

`test/browser/update-test.mjs` now has two modes:

| Mode | Firefox | Signature checks | U-signed |
|---|---|---|---|
| unsigned (default, CI on ESR) | ESR/Developer/Nightly | off in the test profile | always NOT_TESTED |
| signed (`--old`/`--new` signed XPIs) | release | on; both builds must report a signed state | PASS only if U-1…U-7 all pass |

The update server is HTTPS on 127.0.0.1:47811. Its certificate is made per run with
openssl and trusted only in the throwaway profile. A test CA made per run signs a
server certificate for 127.0.0.1; only the CA is trusted. Firefox refuses a CA certificate
used directly as the server certificate; that was the first CI attempt, with 0 update
requests. A privileged TLS preflight fails the run early.

- **Local, release Firefox 160:** TLS preflight 200; the unsigned install is refused (−5)
  and reported NOT_TESTED, as designed.
- **CI run 44633892548, Firefox ESR 153.7:** TLS preflight 200, U-1…U-7 PASS over HTTPS,
  U-signed NOT_TESTED. Evidence:
  [`update-results-ci-esr153-https.json`](update-results-ci-esr153-https.json).

**Signed update test: NOT_TESTED.** It runs only after the operator has signed 0.9.0 and
0.9.1 (issue #19).

## D4 – Open release blockers

See [ISSUE-REVIEW.md](ISSUE-REVIEW.md) for every open issue. Release blockers:

| Issue | What is missing | Who |
|---|---|---|
| #19 signed update test | sign 0.9.0/0.9.1, verify, run `update-test.mjs --old/--new` on release Firefox | Ralf (authorization, AMO account, signing); script automated |
| #2 popup appearance | ABNAHME 1.1–1.5 | Ralf |
| #3 keyboard-only popup | ABNAHME 2.3 (rest automated: B8-4) | Ralf |
| #4 restart clears the session (signed build) | U-7 in the signed run; ABNAHME 4 | Ralf, after signing |
| #5 native file dialog (import) | Windows automated (N1–N5); macOS/Linux decision | architecture review |
| #6 toolbar and shortcut | ABNAHME 2.1, 2.4 | Ralf |
| #9 real storage, interrupted sessions | evidence complete, proposed for closing | architecture review |

Not release-blocking and open: #8 (defect, low; decision pending), #17, #21, #22
(enhancements).

## Recommendation for the first signed test build

Sign **0.9.0 and 0.9.1** as unlisted test builds, prepared with
`npm run release:source -- --version 0.9.x --test-update` from merged `main`. Their
update address is 127.0.0.1 only, so they cannot update from the internet. Then run the
signed update test (SIGNING.md §7) and the acceptance checklist groups 4–5.

Keep **1.0.0** free for the first distribution build. It needs:
- no `update_url` (AMO listed, decided);
- the removal of the development notice;
- all acceptance items OK;
- issue #19 closed with the signed run's evidence.
