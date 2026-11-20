# Issue review before signing (CTA-001)

Date: 2026-11-20. Source: GitHub, retrieved with `gh issue list --state open` and
`gh issue view` (body, labels, comments, linked pull requests).

- **Open issues: 11.**
  - 9 were open at the start of the review: #2, #3, #4, #5, #6, #8, #9, #17, #19.
  - #21 and #22 were created during the review (post-1.0 roadmap).
- None had comments or linked pull requests before this review.
- No issue was closed and no label was changed.

Categories: **A** release blocker, **B** product defect, **C** enhancement (deferrable),
**D** already resolved.

| Issue | Title | Category | Current evidence | Missing work | Proposed action |
|---|---|---|---|---|---|
| #19 | Signed extension update test | A | Unsigned simulation U-1…U-7 PASS (CI ESR 153.7, HTTPS); `verify-signed.mjs` ready | Signing 0.9.0/0.9.1, signed run on release Firefox | Operator: SIGNING.md §3–7, ABNAHME 5; close with the signed result file |
| #2 | Popup appearance on the operator's screen | A | B3 layouts (all CI platforms), B3-real-1…3 (Windows, visible window), B7, B8-1/3 | Subjective check on the operator's screen and DPI | ABNAHME 1.1–1.5 (8 min, unsigned is enough) |
| #3 | Keyboard-only popup | A | **New: B8-4**: list not a tab stop, Tab walks the rows, Enter and Space copy once each, lock and settings reachable; B8-2 focus ring | Only the real toolbar panel path (Alt+Shift+A → Tab → Enter) | ABNAHME 2.3 (1 min); close afterwards |
| #4 | Restart clears the session | A | C2-6 (hard kill), C3-1 (graceful), U-7 (permanent install, unsigned, ESR) | Signed build on release Firefox | Automated in the signed update test (U-7); ABNAHME 4 for the real user path |
| #5 | Native file dialog for the legacy import | A | N5 (real Windows Open dialog, preview, import), N1–N4 (Save, cancel, failure, Open + restore) | macOS and Linux only | Architecture decision: Windows evidence sufficient for 1.0, or a macOS/Linux check. Nothing to do for the operator on Windows |
| #6 | Toolbar placement and Alt+Shift+A | A | C6-1 (`nav-bar`), C6-2 (registered, no built-in conflict) | Placement as seen; conflicts with the operator's own add-ons and OS | ABNAHME 2.1, 2.4 (2 min) |
| #9 | Vault tests on real storage with interrupted sessions | A, proposed D | Every criterion covered by browser checks on real `storage.local`, CI matrix, 5 platforms (see below) | None technical | Architecture: accept and close. Label unchanged until then |
| #8 | Exceptional recovery UX for `allowUnverifiedGeneration` | B, low | Unverified recovery disabled in the service (`service.js` `restore`); never automatic. **New test** `issue #8` in `service.test.mjs`. Docs corrected: SECURITY.md §7.5, USER-GUIDE §5 | Defect: with a destroyed header the UI offers a restore, which then reports "unlock failed" as for a wrong password. The way out (export) is not explained in the UI | Decision: (a) small fix before 1.0 (honest message, no restore button, pointer to the export), or (b) defer and document only. Recommendation: (a), separate PR after this review; full UX after 1.0 |
| #17 | Import an encrypted export into a non-empty vault | C | Approved in principle (C5 review); restore into an empty vault exists (C4) | Spec and implementation | Defer after 1.0; explicit approval needed |
| #21 | Options page: three tabs | C | Approved for planning, target 1.0.1 | Implementation after 1.0 | Deferred (approved, CTA-001 roadmap) |
| #22 | Chromium support: feasibility study | C | Approved for planning, target 1.1.0; feasibility report as an issue comment | Architecture review of the report | Deferred (approved, CTA-001 roadmap) |

## Summary

| Category | Count | Issues |
|---|---|---|
| A release blocker (label `release-blocker`) | 7 | #2, #3, #4, #5, #6, #9, #19 |
| B product defect | 1 | #8 (low) |
| C enhancement, deferred | 3 | #17, #21, #22 |
| D already resolved, closable now | 0 | #9 is proposed for D after architecture acceptance |

## #9 criterion mapping (real Firefox storage)

All of the following checks run on the CI matrix on 5 platforms: Ubuntu release and ESR
153 and ESR 140, Windows, macOS. CI run 44633892548 passed them all, as did the local run
in [`browser-results-local.json`](browser-results-local.json).

| Criterion | Checks |
|---|---|
| Write and read-back | B4-1, C2-1, C5-1 |
| Single-key atomicity, interrupted commit | C2-7-400, C2-7-1200: Firefox process killed during a write burst; the vault opens directly or via a confirmed restore, and the data is consistent |
| Interrupted rotation, no lockout | C2-8-100/350/800: process killed during a password change; exactly one password opens the intact vault |
| Wrong passwords never modify storage | C2-2 (`storage.local` byte-identical), C2-9 |
| Concurrent operations never silently overwrite | B4-1 (stale revision rejected), C5-3 (vault changed between preview and apply); unit tests in `write-outcome.test.mjs` |
| Derived key matches the authenticated KDF header | C2-3 (forged header with 10M iterations fails at AES-GCM), C2-4 (old key and password dead after a change), C2-9 rotation scenario |
| Interrupted browser sessions | C2-6 (hard kill), C3-1 (graceful restart), B6-4 (event page suspension) |

## Pull requests

- **#20** (Phase D, updated): release guards for the localhost and AMO listed decision,
  `verify-signed.mjs`, B8-4, the `issue #8` test, documentation and this review.
- **Proposed, after the review:** a small fix for #8, variant (a).
- No other pull request is needed for 1.0 except the 1.0.0 release PR (development notice,
  version) after the acceptance.

## Release gate

Blocked. It opens only when:

- every issue is classified (done);
- every release blocker is resolved and verified;
- the deferral of #17 is approved explicitly;
- the architecture review accepts this status.
