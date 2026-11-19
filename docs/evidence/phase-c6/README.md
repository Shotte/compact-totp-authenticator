# Phase C6 evidence – release verification

Synthetic accounts and passwords only. No real TOTP data, no signing, no submission. This
folder holds evidence for the architecture review. It does not declare the extension
production-ready.

| File | Content |
|---|---|
| [`AUDIT.md`](AUDIT.md) | C6.5 release security audit |
| [`OPERATOR-CHECKLIST.md`](OPERATOR-CHECKLIST.md) | C6.3 manual checks that need a person |
| [`browser-results-local.json`](browser-results-local.json) | full browser suite, Windows, Firefox 160.0.1, visible window |
| [`ci-matrix-summary.json`](ci-matrix-summary.json) | CI run 44622947849 (head `ee76efb`), counts and every NOT_TESTED or MANUAL per platform |
| [`update-results-ci-esr153.json`](update-results-ci-esr153.json) | C6.2 update test on Firefox ESR 153.7 (CI) |
| [`native-dialogs-windows.json`](native-dialogs-windows.json) | native Save/Open dialogs N1–N5, Windows, Firefox 160.0.1 |

## C6.1 Security regression

| Area | Evidence | Result |
|---|---|---|
| Vault creation, lock, unlock, rotation | unit (`service`, `vault`, `kdf`, `session-c3`); browser C2-1, C2-2, C2-4, B6-3 | PASS |
| Authentication failures, expiry | unit (`auth-invariant`, `session-c3`, `import-auth`); browser C2-9, B6-5, C3-2, C3-3 | PASS |
| Concurrent writes, conflicts, unknown write outcomes | unit (`write-outcome`, `import`, `import-auth`, `export`); browser B4-1, C4-9, C5-3 | PASS |
| Crash recovery, browser restart | unit (vault fault injection at every commit and rotation step); browser C2-5, C2-6, C2-7-*, C2-8-*, C3-1 | PASS |
| Import-preview invalidation | unit (`import-auth`: every session end); browser C5-2, C5-4 | PASS |
| Encrypted and plaintext exports, restore, legacy migration | unit (`export`, `import`, `legacy`, `portability`); browser C4-1…C4-7, C4-9, C5-1 | PASS |
| No plaintext secrets in persistent storage | unit (`c6-regression`: storage after every lifecycle step); browser B6-2, C6-3 (sweep after all flows) | PASS |
| No sensitive data in logs or responses | static (no `console`); unit (`c6-regression`: every response of a full lifecycle; malformed and unknown messages answer with a code only) | PASS |

Mutation checks from C2–C5 are listed in the respective evidence READMEs. `npm test`:
197/197.

## C6.2 Extension update

Three levels, kept apart:

| Level | What happens | Evidence | Result |
|---|---|---|---|
| Temporary add-on reload | `webExtension.install` again with `keepStorageOnUninstall` (graceful restart, hard kill) | browser C2-6, C3-1, C4-4 | PASS |
| Local unsigned upgrade via the real update path | 0.1.0 installed **permanently** through AddonManager. `findUpdates()` → `update_url` → `updates.json` (local server) → XPI download with hash check → install 0.1.1. Signature checks are off in this test profile (ESR) | `test/browser/update-test.mjs`, CI Firefox ESR 153.7, U-1…U-7 | PASS |
| Signed extension update | AMO-signed 0.1.0 → signed 0.1.1 on release Firefox | – | **NOT_TESTED** (needs signing, Phase D authorization) |

U-1…U-7 in detail (ESR 153.7, CI):

- **U-1:** 0.1.0 is a permanent install (not temporary), active, unsigned.
- **U-2:** the update was found and installed (1 request to `updates.json`, 1 XPI
  download, install state 10, no error).
- **U-3:** the ID `{f587432b-…}` and the moz-extension UUID are unchanged; it is still a
  permanent install.
- **U-4:** `storage.local` is byte-identical: vault, backup and settings; vault revision
  20; nothing reinitialized.
- **U-5:** initialized and locked after the update; a wrong password is refused, the
  master password unlocks; 18 accounts with order and revision unchanged.
- **U-6:** all 18 TOTP codes equal RFC 6238 codes computed in Node (SHA-1/256/512, 6–8
  digits, periods 10–300 s); the plaintext comparison is identical.
- **U-7:** after a browser restart 0.1.1 is still installed and active; the session is
  locked and `storage.session` is empty; the master password unlocks; data and settings
  are intact.

Release Firefox refuses an unsigned permanent install (error −5, signature required); the
script then reports NOT_TESTED. The release-blocking signed-update requirement
(PLAN-C4-C6.md §4, RELEASE.md §5) is **not** fulfilled.

## C6.3 Release blockers

| Issue | Automated supporting evidence | Status |
|---|---|---|
| #2 popup appearance on the operator's screen | B3-real-1…3 (visible window), B7, B8 | open, manual (checklist 1) |
| #3 keyboard-only popup | B8-2 (focus ring), B3-copy | open, manual (checklist 2) |
| #4 restart clears the session (signed build) | C3-1, C2-6; U-7 (permanent unsigned install, ESR) | open, needs signed build (checklist 5) |
| #5 native file dialog for the legacy import | N5 (Windows, real Open dialog) | open, manual on macOS/Linux and by the operator (checklist 4, 7) |
| #6 toolbar placement and Alt+Shift+A | C6-1 (`nav-bar`), C6-2 (registered, no built-in conflict) | open, manual (checklist 3) |
| #9 vault tests on real storage with interrupted sessions | C2-2, C2-5…C2-9, C4-9, C5-3 on the CI matrix | open, review decision (checklist 6) |
| Signed update test (PLAN §4) | U-1…U-7 unsigned simulation | open, Phase D |

No issue was closed. Issue #8 (recovery UX, not release-blocking) and #17 (encrypted
merge, enhancement) stay open.

## C6.4 Cross-platform

CI run 44622947849 (head `ee76efb`): all 8 jobs green, 0 FAIL.

| Platform | Firefox | PASS | NOT_TESTED | MANUAL | FAIL |
|---|---|---|---|---|---|
| Ubuntu | 160.0 | 86 | 5 | 1 | 0 |
| Ubuntu | ESR 153.7 | 86 | 5 | 1 | 0 |
| Ubuntu | ESR 140.17 | 82 | 10 | 1 | 0 |
| Windows | 160.0 | 86 | 5 | 1 | 0 |
| macOS | 160.0 | 86 | 5 | 1 | 0 |
| Windows local, visible window | 160.0.1 | 90 | 0 | 2 | 0 |

- **NOT_TESTED in CI:** the 5 toolbar-popup checks, because headless runs have no popup
  panel (B3-real-1…4, B8-real). On ESR 140 also 5 checks that need the privileged chrome
  scope (B7-auto, B8-1-auto, B8-3, C6-1, C6-2).
- **MANUAL:** C4-8, native dialogs in the headless suite. Locally also B3-real-4,
  click-to-copy with real OS input, which needs a scheduled `--os-input` run.

| Topic | Evidence | Result |
|---|---|---|
| Popup dimensions, scrolling | B3 layouts (1/25/50/100 accounts) on all platforms; B3-real-1, B3-real-3 locally | PASS (headless + Windows visible); operator check #2 |
| Accessibility, keyboard | B8-2 focus ring, labels; real keyboard pass | PASS (automated parts); MANUAL_REVIEW (#3, screen reader) |
| Clipboard | B3-copy (script-driven, with user activation); B3-real-4a refusal without activation | PASS; real mouse copy MANUAL_REVIEW (`--os-input`) |
| Native file dialogs | N1–N5 Windows | PASS Windows; MANUAL_REVIEW macOS/Linux |
| Optional idle lock | C3-4 on all 5 CI platforms and locally | PASS |
| ESR 140 (`strict_min_version`) | full suite | PASS where executable (82); 10 NOT_TESTED as listed |

## C6.5 Audit

See [`AUDIT.md`](AUDIT.md). Summary: minimal permissions, no host permissions, no remote
code or network access, no runtime dependencies, MIT `LICENSE` packaged, no development
code in the product except the intentional 0.x notice, generic errors, bounded file
handling, vault format v1 unchanged.
