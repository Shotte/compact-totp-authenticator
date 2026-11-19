# Phase D preparation – evidence

Status: **prepared, nothing signed or published.** No AMO account, API credentials,
submission, signed build, tag, GitHub release or published update manifest exists.
Synthetic data only.

| File | Content |
|---|---|
| [`../../SIGNING.md`](../../SIGNING.md) | D2 signing procedure, D3 signed update test |
| [`ABNAHME.md`](ABNAHME.md) | D4 German acceptance checklist for the operator |
| [`../../USER-GUIDE.md`](../../USER-GUIDE.md), [`../../../CHANGELOG.md`](../../../CHANGELOG.md), [`../../MIGRATION.md`](../../MIGRATION.md) | D5 user documentation and draft release notes |

## D1 – Release package audit

`npm run check:release` (`scripts/check-release.mjs`) runs locally and in the CI `test`
job. Result on `src/` at the Phase D head: **26/26 OK**.

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

| Issue | What is missing | Who |
|---|---|---|
| #19 signed update test | sign 0.9.0/0.9.1, run `update-test.mjs --old/--new` on release Firefox | Ralf (authorization, AMO account, signing); script automated |
| #2 popup appearance | ABNAHME A1–A2, B1–B2 | Ralf |
| #3 keyboard-only popup | ABNAHME A5 | Ralf |
| #4 restart clears the session (signed build) | ABNAHME E2–E3 | Ralf, after signing |
| #5 native file dialog (import) | ABNAHME D1 (Windows automated: N5); D4–D5 macOS/Linux | Ralf; macOS/Linux MANUAL_REVIEW |
| #6 toolbar and shortcut | ABNAHME C1–C2 | Ralf |
| #9 real storage, interrupted sessions | review decision on the existing C2/C4/C5 browser checks | architecture review |

Not release-blocking and open: #8 (recovery UX), #17 (encrypted merge).

## Recommendation for the first signed test build

Sign **0.9.0 and 0.9.1** as unlisted test builds, prepared with
`npm run release:source -- --version 0.9.x --test-update` from merged `main`. Their
update address is 127.0.0.1 only, so they cannot update from the internet. Then run the
signed update test (SIGNING.md §5) and the acceptance checklist part E.

Keep **1.0.0** free for the first distribution build. It needs:
- the production HTTPS `update_url` decision;
- the removal of the development notice;
- all acceptance items OK;
- issue #19 closed with the signed run's evidence.
