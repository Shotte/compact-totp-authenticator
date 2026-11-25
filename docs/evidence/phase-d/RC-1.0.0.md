# CTA 1.0.0 release candidate

Status: **release candidate, prepared 2026-11-25. Not signed, not submitted, not tagged.**
It needs the owner's review and explicit approval of this candidate (RELEASE.md §5,
SIGNING.md §8). A green CI does not authorize a release.

## 1. Commits

| What | Commit |
|---|---|
| `main` before the candidate | `29c18df` (merge of PR #47; PR #45 merged as `e5a861a`). CI run 45678207682: 8/8 green |
| Candidate source change (version 1.0.0, development notice removed, toolbar glyph tone) | `ea9f976` on branch `rc/1.0.0` |
| Candidate PR | #48, branch `rc/1.0.0` (this report, screenshots, listing); not merged |

The signing source was prepared from `ea9f976`, with no uncommitted `src/` changes. The later
commits on `rc/1.0.0` change only `docs/` (`git diff ea9f976 HEAD -- src` is empty).
RELEASE.md §5 asks for the source from merged `main`. After the owner approves and the PR is
merged, the source is prepared again from `main` and compared to the hashes below. They must
be identical: `src/` does not change in a docs-only merge.

## 2. Signing source

`npm run release:source -- --version 1.0.0 --no-update-url` →
`dist/signing/1.0.0/source` (local, git-ignored):

| Item | Value |
|---|---|
| Version | 1.0.0 |
| `update_url` | none (AMO Listed, Mozilla-managed updates) |
| Files | 29 |
| SHA-256 of `dist/signing/1.0.0/SHA256SUMS` | `720557c2a9be9c013ffbe5a286253334861f850d2770d809d923b27c25001351` |
| `release-source.json` | `sourceCommit` `ea9f976f8a6141facb2477a8b02e17c8da20410f`, `srcHasUncommittedChanges: false` |
| Lint (`web-ext lint --self-hosted`) | 0 errors; 1 warning, the accepted desktop-only Android note |
| `check-release` on the source | 28/28 OK, including "1.x: development notice removed" and "1.x: no update_url" |
| Byte check against git | the 28 files other than the manifest have the same SHA-256 as `git show ea9f976:src/<file>`. The manifest has the same content; only the JSON formatting differs |

Signing command, printed by the script; for the operator and only after release approval:
`npx web-ext sign --channel listed --source-dir dist/signing/1.0.0/source --artifacts-dir dist/signing/1.0.0/signed`.
**A listed signing is a public submission.** After it:
`node scripts/verify-signed.mjs <signed.xpi> dist/signing/1.0.0`.

The previously signed XPIs 0.9.0–0.9.6 are unchanged. Their SHA-256 prefixes are `80e49997`,
`ddf8e260`, `05bc5fbc`, `19e99eb0`, `acc46d30`, `794d89fd` and `c7000043`.

## 3. Changes in the candidate

- `src/manifest.json`: version `1.0.0`.
- The development notice and its de/en strings are removed. The setup page keeps the warning that
  a forgotten master password cannot be recovered.
- `src/icons/shield-dark.svg`: `#5b5b66` → `#7a7a85`. Firefox 161 uses this variant also in the
  dark extensions menu (§5).
- Tests:
  - 1.x has neither the notice nor its strings;
  - the release-script cases start from a 1.0.0 source;
  - `icon-check.mjs --unpinned` covers the extensions menu.
- Docs: final AMO screenshots (de/en 1–4), final listing ([AMO-LISTING.md](../../AMO-LISTING.md)),
  CHANGELOG 1.0.0 notes, icon evidence.

## 4. Test results

| Check | Result | Evidence |
|---|---|---|
| `npm test` (unit, static, release scripts) | 254/254 PASS, locally on `ea9f976` | CI on the candidate PR |
| `npm run lint` | 0 errors, 1 accepted warning (desktop-only Android note) | – |
| `npm run check:release` on `src` and on the signing source | 28/28 OK each | §2 |
| Browser suite on `dist/signing/1.0.0/source`, Firefox 161.0, Windows, **de** | 114 checks: **110 PASS, 0 FAIL**, 2 MANUAL, 2 NOT_TESTED | [rc-1.0.0/suite/browser-results-de.json](rc-1.0.0/suite/browser-results-de.json) |
| Same, **en** | 114 checks: **110 PASS, 0 FAIL**, 2 MANUAL, 2 NOT_TESTED | [rc-1.0.0/suite/browser-results-en.json](rc-1.0.0/suite/browser-results-en.json) |
| Icon checks: Firefox 161.0 and ESR 140.17.0, toolbar light and dark, about:addons, extensions menu, gear focus and Enter | PASS (Firefox 161 dark menu: right shape, wrong variant; legible at 4.3:1, §5) | [icons-1.0.0](icons-1.0.0/README.md) |
| AMO screenshots from the signing source, de/en 1–4 | created, checked by eye: no development notice, gear in the popup footer, synthetic names only | `docs/amo/screenshots/` |
| CI (8 jobs: unit on Windows and macOS; browser on Ubuntu release, ESR 140 and ESR latest, Windows, macOS) | on the candidate PR | PR checks |

- The suite ran the same way as for 0.9.6: a temporary copy of the runner changed only the
  extension path and the UI locale, and it was deleted after the run.
- MANUAL and NOT_TESTED, the same items as in every earlier run:
  - B3-real-4: real popup click-to-copy; covered by the operator acceptances;
  - C4-8: native save dialog; accepted on the Windows evidence, CTA-001;
  - C3-4: idle lock; the system never reports idle within the run time;
  - T-2: options tab focus ring when the window is not active.
- No signed 1.0.0 build exists, so there is no signed update test and no `verify:signed` for it
  (§7).

## 5. Icons

Details: [icons-1.0.0/README.md](icons-1.0.0/README.md).

- The owner accepted the shield and the gear visually (PR #47).
- **Extensions menu, button unpinned:**
  - Firefox 161 shows the light-theme variant also in its dark menu. ESR 140 picks the right one.
  - With the original `#5b5b66` the shield had 2.7:1 there. The candidate's `#7a7a85` has 4.3:1
    there and 4.0:1 on the light toolbar.
  - **Visible change for review:** on light toolbars the shield is a little lighter than
    Firefox's own icons.
- The re-run after the change in Firefox 161.0 and ESR 140.17.0 passed: toolbar light and dark,
  about:addons, the menu, and the gear's focus and Enter.
- **AMO Developer Hub preview of the icon:** needs the owner's AMO login, so it is not done.
  Fallback: [`docs/amo/icon-128.png`](../../amo/icon-128.png).

## 6. Listing material for approval

All of it is in [AMO-LISTING.md](../../AMO-LISTING.md):
- fixed fields (name, ID, MIT, category, homepage, platforms desktop only, icon);
- summary and description in de/en;
- the eight screenshots with captions;
- privacy text in de/en (no data collection, no network access);
- permission justification (`storage`, `alarms`, `activeTab`, optional `idle`);
- reviewer notes;
- release notes in de/en.

## 7. Remaining manual checks and limitations

| Item | Status |
|---|---|
| AMO Developer Hub: icon preview and listing preview | **owner**, before submitting (`manual_review`) |
| Signed 1.0.0: `verify:signed` | after signing, which needs the release approval |
| Real update to 1.0.0 | `not_tested` for 1.0.0 itself. The listed 1.0.0 has no `update_url`; Mozilla delivers it. The update path with the same ID and storage was verified signed for 0.9.5 → 0.9.6. 1.0.0 adds only the version, the removed notice and the icons |
| Debian 13 / Firefox ESR 153 and ESR 140 by hand | Manual acceptance of **0.9.6** on Debian 13 by the operator: Firefox ESR 153.7.0, L-1–L-28 PASS; Firefox ESR 140.17.0, E-1–E-16 PASS. Covered: real keyboard, Ctrl+Shift+2, Tab navigation, clipboard. A temporary focus anomaly under ESR 140 did not reproduce after reopening the popup. Not repeated with the 1.0.0 source; the automated ESR 140 checks for 1.0.0 passed (CI). Procedure: [ABNAHME-LINUX-ESR.md](ABNAHME-LINUX-ESR.md) (operator-reported results; the detailed result lists are not in the repository) |
| Real keys and native dialogs on macOS | not verified (known limitation, in the CHANGELOG). Native file dialogs on Linux: not reported separately |
| Screen-reader speech | not verified; roles and labels are checked in the DOM |
| Third-party themes for the toolbar icon | not tested |
| #46 arrow-key navigation | outside 1.0.0 |

## 8. Owner actions, in order

1. Review this candidate:
   - the PR with the version and notice removal;
   - the toolbar glyph tone `#7a7a85`;
   - screenshots, listing, privacy text, permission reasons, reviewer notes, release notes.
2. Approve the merge of the candidate PR. Then I prepare the source again from `main` and confirm
   that the hashes are identical.
3. Give the explicit release approval. Then sign listed with your own credentials (command in
   §2); signing is the public submission. Fill in the listing in the Developer Hub and check the
   icon and listing preview there.
4. After signing: `verify:signed`, then tag and GitHub release with the signed XPI (RELEASE.md §5),
   each only with your approval.
