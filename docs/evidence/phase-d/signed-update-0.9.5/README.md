# Signed acceptance build 0.9.5: signed update test 0.9.4 → 0.9.5 and regression

Date: 2026-11-22.

- AMO channel: **unlisted**, signed by the operator.
- Nothing was listed, published or tagged, and no update manifest was published.
- The signed 0.9.4 XPI is unchanged (SHA-256 `acc46d30…3f69aaf`).

0.9.5 contains `main` `9637b12`:
- PR #37: #25 V2 replacement — one check, preview, one dialog, at most 180 s.
- PR #38: previous vault state — master password once, one dialog per action, no checkbox.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/0.9.5/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.5 | `9637b1234c72331e2e33ca4e46e6be7852efd9fb` | `b6d63835a4834f55a37a-0.9.5.xpi` | `794d89fd2dc6e63cd6285e0af0e7c32fbb5c0d63ff8aac3a5776d00b95227946` | 6/6 OK (operator run and independent rerun) |

The SHA-256 was recomputed before the tests and matches.

**Contents check.** `verify:signed` confirms that every prepared file is byte-identical and that
nothing besides the AMO signature was added. The signed XPI contains:
- `replaceApply`, `REPLACE_TTL_MS = 180_000` and the `cta-replace-v2` bindings (PR #37);
- `previousDialog` and `askPrevious` (PR #38);
- the filled `.danger` buttons and the file-input fix from the PR #38 review.

The previous-vault form has no checkbox. The two remaining checkboxes in `options.html` belong
to the recovery of a damaged vault and to the unencrypted export, not to #25.

## Environment

- Firefox **160.0.1** (release) on Windows 11, German UI, signature checks on.
- A throwaway profile per run, created and deleted by the script. The operator's `CTA-Test`
  profile and normal profile were not touched.
- Synthetic accounts and passwords only. The result files contain no secrets.
- Visible browser, native key events with the German (0x407) and US (0x409) layouts.

## Signed update runs

Both runs of `test/browser/update-test.mjs --old <0.9.4.xpi> --new <0.9.5.xpi>` go through
Firefox's own update path:
- `findUpdates()`, then the HTTPS `update_url` on 127.0.0.1 and the local `updates.json`;
- download, hash check, install.

Before the update, the old version gets non-default settings: theme dark, font size 14, row
height 25 and auto-lock 30 min.

| Check | Default shortcut ([`update-results.json`](update-results.json)) | `--custom-shortcut Ctrl+Shift+9` ([`update-results-custom-shortcut.json`](update-results-custom-shortcut.json)) |
|---|---|---|
| U-1 0.9.4 permanent, signed, active | PASS | PASS |
| U-2 update through `update_url`, hash checked | PASS | PASS |
| U-3 extension ID and UUID unchanged, still permanent | PASS | PASS |
| U-4 `storage.local` byte-identical (vault, backup, settings) | PASS | PASS |
| U-5 wrong password refused, master password unlocks; accounts, order and revision unchanged | PASS | PASS |
| U-6 TOTP codes equal RFC 6238 | PASS | PASS |
| U-7 restart: 0.9.5 active, session locked, no key in `storage.session`; data and settings intact | PASS | PASS |
| **U-signed** 0.9.4 → 0.9.5 with signature checks on | **PASS** | **PASS** |
| U-8 V2 replacement on the updated signed install: preview, token apply, previous vault kept, restored and discarded | PASS | PASS |
| U-S1 API level: shortcut before, after the update and after the restart | PASS: Ctrl+Shift+2 → Ctrl+Shift+2 | PASS: Ctrl+Shift+9 kept, new default not applied |
| U-S2 real key event opens the popup and nothing else (de, us) | PASS: Ctrl+Shift+2 | PASS: Ctrl+Shift+9 |
| U-S3 real key event: replaced shortcuts no longer open the popup | NOT_TESTED: old and new default are the same | PASS: Ctrl+Shift+2 does nothing |

Totals: the default run has 11 PASS and 1 NOT_TESTED (by design); the custom run has 12/12 PASS.

**U-8 uses the V2 path.** The script falls back to the 0.9.x call only when the preview returns
no token. In 0.9.5, `replaceApply` accepts nothing but `{token}`, so a 0.9.x-style call would
have been refused as a conflict. A PASS therefore means the token path ran.

## Regression of PR #37 and PR #38 on the signed contents

| Check | Basis | Result |
|---|---|---|
| U-8 (above) | The signed, updated install | PASS (both runs) |
| Visual and keyboard review of the previous-vault dialogs, V-1…F-2, de and en | `test/browser/previous-dialogs-review.mjs`, with the extension loaded from `dist/signing/0.9.5/source` (byte-identical to the signed XPI). A temporary copy of the script changed only that path and the output directory | 8/8 PASS in each language: [`review/review-de.json`](review/review-de.json), [`review/review-en.json`](review/review-en.json). Screenshots not kept: they duplicate [`../../previous-dialogs/`](../../previous-dialogs/README.md) |
| Full browser suite (R-1, R-2, R-3, F2-2, F3-3, P-1, C4-4 …) and unit tests | The same code on `main` `9637b12` | CI run 45047384046, 8/8 jobs green. Local suite on the PR head with identical `src/`: 110/113, 0 FAIL |

## Not tested here (operator acceptance)

| Item | Status |
|---|---|
| Upgrade of the operator's existing `CTA-Test` profile | MANUAL: [`../ABNAHME-0.9.5.md`](../ABNAHME-0.9.5.md), part 0 |
| The replacement and previous-vault flow by hand, with off-screen messages, focus and a single message checked visually | MANUAL: parts 2–3 |
| Screen-reader speech | MANUAL: 4.3 |
| Customizing the shortcut by clicking in about:addons; physical keyboard; OS-wide tools | MANUAL |
| Real key events on macOS and Linux | NOT_TESTED (Windows only) |
