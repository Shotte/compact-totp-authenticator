# CTA 1.0.0 release-readiness assessment

Status: read-only assessment, 2026-11-23. **Not a release authorization.** A green CI does not
authorize a release. Signing and the listed AMO submission each need the operator's explicit
approval (RELEASE.md §4, SIGNING.md §8).

**Verdict (updated 2026-11-23, after the operator's approvals): not ready for signing 1.0.0
yet.** No release blocker issue is open any more. The remaining gates are listed in §0.
Sections 1–9 are the original assessment from earlier the same day.

## 0. Status update after the approvals

| Gate | State | Evidence |
|---|---|---|
| PRs #39–#42 | **merged** | `main` = `be1a5cb`, CI run 45220906518 8/8 green |
| #6 toolbar placement and shortcut | **closed (completed)** | operator acceptance on Windows (Ctrl+Shift+2, text field, no conflict, Alt+Shift+A inactive, survives the signed update, custom Ctrl+Shift+9 kept) plus U-S1–U-S3; comment on #6. macOS and Linux keyboards are not tested |
| Milestone 1.0.0 | 5 closed, 0 open | #2, #3, #6, #21, #25 |
| Android | **decided: desktop only.** PR #43 removes `gecko_android`, **waiting for approval** | PR #43 |
| Signed 0.9.6 test build | signing source **prepared, not signed** (`be1a5cb`, without #43) | `dist/signing/0.9.6/` (local); checklist [ABNAHME-0.9.6.md](ABNAHME-0.9.6.md) |
| Linux and ESR 140, by hand | procedure ready, **not done** | [ABNAHME-LINUX-ESR.md](ABNAHME-LINUX-ESR.md) |
| AMO material | **drafts for review**: screenshots (to recreate from the 1.0.0 source), privacy text, permission reasons, reviewer notes, platforms, release notes | [AMO-LISTING.md](../../AMO-LISTING.md), CHANGELOG |

Remaining before signing 1.0.0, in order:
1. Approve and merge #43. Then re-prepare 0.9.6 from the new `main` if it should include the
   change; the source is not signed yet, so re-preparing is safe.
2. Operator: sign 0.9.6 unlisted. Then the signed update test 0.9.5 → 0.9.6 and ABNAHME-0.9.6.
3. Operator: the Linux and ESR 140 procedure, or a recorded decision that the CI evidence on
   ESR 140 is enough.
4. Review the AMO material.
5. The 1.0.0 PR: version, removal of the development notice, final screenshots from the
   release source. Then `release:source --no-update-url`.
6. The operator's explicit release approval and the listed submission by the operator.

## 1. Release blockers and open issues

| Issue | Milestone | Status | Assessment |
|---|---|---|---|
| #2 popup appearance | 1.0.0 | closed (operator acceptance 0.9.3) | done |
| #3 keyboard-only popup | 1.0.0 | closed (operator acceptance 0.9.3) | done |
| #19 signed update test | – | closed | done; repeated for 0.9.3 → 0.9.4 and 0.9.4 → 0.9.5 |
| #21 options tabs | 1.0.0 | closed | done |
| #25 replace/restore from an encrypted backup | 1.0.0 | **closed 2026-11-23** (operator acceptance of signed 0.9.5) | done; one unreproduced observation documented (PR #40), not a confirmed defect |
| **#6 toolbar placement and shortcut** | 1.0.0 | **open, `release-blocker`** | see below |
| #31 C4-6 intermittent seeding conflict on Windows CI | – | open, not a blocker | test-harness flake, not reproduced since the harness change; classified in the issue |
| #17, #22, #24 | post-1.0 | open | out of scope for 1.0.0 |

**#6 in detail.**
- Placement in the navbar: satisfied (operator screenshots, C6-1).
- The issue title still names Alt+Shift+A. Since 0.9.4 the default is **Ctrl+Shift+2** (F3-2,
  PR #34). The signed update tests verify it on Windows with real key events, and the custom
  shortcut survives the update.
- Missing: the operator's explicit confirmation, on the target setup, that Ctrl+Shift+2 opens
  the popup and that no other add-on or OS tool takes it (ABNAHME-0.9.4 part 1, or 0.9.5
  point 0.2).
- Closing it needs that statement plus an acceptance comment. The title or a comment should
  record the changed default.

Milestone 1.0.0: 4 closed, 1 open (#6).

## 2. Open pull requests (before any release build)

| PR | Content | State |
|---|---|---|
| #39 | 0.9.5 acceptance checklist and signed-update evidence (docs only) | ready, waiting for approval |
| #40 | 0.9.4 backup compatibility regression test, documentation of the unresolved observation | waiting for approval |
| #41 | UX polish after the 0.9.5 acceptance (verified message, neutral delete button, 30-day reminder) | waiting for approval; **changes the UI**, see §8 |

## 3. Outstanding MANUAL and NOT_TESTED checks

| Item | Status | Release relevance |
|---|---|---|
| Ctrl+Shift+2 on the operator's setup, conflicts with other add-ons and OS tools | MANUAL | **blocker (#6)** |
| Manual test on **Firefox ESR 140** (RELEASE.md §5) | not done by hand; CI runs ESR 140 and ESR latest headless on Linux | checklist item open: decide whether CI evidence suffices or do a short manual pass |
| Screen-reader speech (NVDA etc.) | MANUAL, never verified; roles, labels and names are checked in the DOM | known limitation, document in the listing or README |
| B3-real-4 real popup click-to-copy | MANUAL in the default suite; available with `--os-input` on Windows | low; operator acceptance 0.9.3 covered the popup |
| C4-8 native save dialog | MANUAL in the suite; covered by N1–N5 on Windows | accepted (#5, CTA-001) |
| T-2 focus ring of the options tabs | NOT_TESTED when the window is not active (local runs); selection and focus movement PASS | low |
| Real key events on macOS and Linux | NOT_TESTED (Windows only) | known limitation |
| Native file dialogs on macOS and Linux | not verified (RELEASE.md §5) | known limitation |
| Clicking a custom shortcut in about:addons | NOT_TESTED (API-level `commands.update` is tested) | low |
| 0.9.x unlisted → listed 1.0.0 transition | MANUAL_REVIEW, not needed (SIGNING.md §2: test builds stay in throwaway profiles) | none |
| Android | not tested, no support claimed (DEVELOPMENT.md) | **see §5: manifest inconsistency** |

## 4. Signed test-build evidence

| Build | Source | Evidence |
|---|---|---|
| 0.9.0 – 0.9.3 | see `docs/evidence/phase-d/signed-update*/` | signed update tests, operator acceptance 0.9.3 (#2, #3, #21) |
| 0.9.4 | `68407dd` | `signed-update-0.9.4/`: 12/12 + 12/12; acceptance of #25 F3-3 failed and led to V2 |
| 0.9.5 | `9637b12` (PRs #37, #38) | `signed-update-0.9.5/` (PR #39): `verify:signed` 6/6, 11 PASS + 1 NOT_TESTED by design, 12/12 with custom shortcut; operator acceptance of #25 on 2026-11-23 |

All signed XPIs stay unchanged; version numbers 0.9.0–0.9.5 are used and must not be reused.

## 5. Firefox compatibility

- `strict_min_version` 140.0 on desktop.
- CI on every PR: Firefox release on Windows, macOS and Linux, ESR latest and ESR 140 on
  Linux, all headless. Local runs use Firefox 160.0.1 on Windows with a visible window.
- Checks needing chrome-scope access (theme override, real zoom) report NOT_TESTED on ESR 140,
  never PASS.
- **Android inconsistency:** the manifest declares `gecko_android` with `strict_min_version`
  142.0, but Android is untested and DEVELOPMENT.md claims no support. AMO derives platform
  compatibility from the manifest, so a listed 1.0.0 would probably be offered on Android.
  **Decision needed:** remove `gecko_android` before 1.0.0, or test Android and state support.

## 6. Known limitations to state publicly

- macOS and Linux: native file dialogs and real key events are not verified; the headless
  suite passes there.
- Screen readers: semantics checked, speech not verified.
- Custom colours: error and success colours are guaranteed 3:1 against a custom background;
  4.5:1 applies to the built-in themes.
- A forgotten master password cannot be recovered; only a previous encrypted export helps
  (USER-GUIDE §5).
- No sync, no Chromium (post-1.0: #22, #24); no import of an encrypted export into a
  non-empty vault without replacing it (#17).

## 7. Security, privacy and source

- **Documentation.** SECURITY.md covers the threat model, crypto and KDF, session, storage,
  recovery, and replacement V2 (§13.4a, with an explicit security review). Permissions:
  `storage`, `alarms`, `activeTab`; optional `idle`. `data_collection_permissions: none`.
  No network access and no third-party runtime code.
- **Privacy declaration for AMO:** it must match "no data collection" (RELEASE.md §4b). The
  text still needs writing in the listing.
- **License:** MIT, `LICENSE` in the package, attribution to Rayquaza01 kept.
  `check:release` 26/26 on `main`.
- **Reproducibility:**
  - No build step: the package is `src/` at the release commit.
  - `release:source` copies it and records `SHA256SUMS`.
  - `verify:signed` proves byte identity of the signed XPI against that source.
  - The only dev dependency is `web-ext` 10.8.0, pinned with `package-lock.json`.
  - Reviewers can rebuild by checkout; no separate source upload is needed (unminified).

## 8. AMO submission requirements (listed)

- Listing texts de/en: draft in AMO-LISTING.md; needs a final review against the 1.0
  behaviour (V2 replacement, previous vault, Ctrl+Shift+2).
- Screenshots: **still to create** with synthetic data (AMO-LISTING.md lists four).
- Privacy policy / data declaration: see §7.
- Reviewer notes: present, need an update for the V2 replacement.
- Source link to the public repository. Category, support contact and homepage are AMO form
  fields for the operator.
- Package: 1.x without `update_url` and without the development notice; `check:release`
  enforces both.

## 9. Remaining steps before signing and publication (proposal)

1. Operator: confirm Ctrl+Shift+2 and the absence of conflicts on the target setup, then close
   #6 with an acceptance comment.
2. Decide on Android (`gecko_android`): remove it or test it (§5).
3. Review and merge #39, #40, #41.
4. Because #41 changes the UI after the last signed acceptance, **a signed 0.9.6 test build is
   recommended**:
   - signed update 0.9.5 → 0.9.6;
   - a short operator check of the three UX changes;
   - optionally the manual ESR 140 pass.
   A 1.0.0 cannot serve as a test build: listed versions are public, and version numbers
   cannot be reused.
5. 1.0.0 pull request:
   - version 1.0.0;
   - remove the development notice;
   - final listing texts, screenshots, privacy text and reviewer notes;
   - CI green, `check:release` OK.
6. `npm run release:source -- --version 1.0.0 --no-update-url`, verify `SHA256SUMS`.
7. Operator's **explicit release approval**, then the listed submission (`web-ext sign --channel
   listed` or the Developer Hub), done by the operator with private credentials.
8. After Mozilla's approval: tag `v1.0.0`, GitHub release with the signed XPI and checksums,
   and a check that the AMO listing and the update path work.
