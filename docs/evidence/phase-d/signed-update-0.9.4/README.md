# Signed acceptance build 0.9.4: signed update test 0.9.3 → 0.9.4 and shortcut regression

Date: 2026-11-22.

- AMO channel: **unlisted**, signed by the operator.
- Nothing was listed, published or tagged.
- The signed 0.9.0–0.9.3 XPIs are unchanged; all 124 files are byte-identical before and after
  the 0.9.4 preparation.

0.9.4 contains `main` `68407dd`, which is PR #34: F3-1 account rows, F3-2 default shortcut
Ctrl+Shift+2, F3-3 replacement flow.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/0.9.4/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.4 | `68407dd` | `b6d63835a4834f55a37a-0.9.4.xpi` | `acc46d30364e8674ee2be61c7471d0852006a9d57f1574f380494d38b3f69aaf` | 6/6 OK (operator run) |

The SHA-256 was recomputed before the test and matches.

## Environment

- Firefox **160.0.1** (release) on Windows 11, German UI, signature checks on.
- A throwaway profile per run (created and deleted by the script). The operator's `CTA-Test`
  profile and normal profile were not touched.
- Synthetic accounts and passwords only (`exportRoundTripAccounts()`, 18 entries). The result
  files contain no secrets.
- Visible browser, native key events with the German (0x407) and US (0x409) keyboard layouts.

## Runs

Two runs of `test/browser/update-test.mjs`, each going through the real update path:

- `findUpdates()` → HTTPS `update_url` on 127.0.0.1 → `updates.json` → download → hash check →
  install.

| Run | Command | Result file |
|---|---|---|
| Default shortcut | `node test/browser/update-test.mjs --old <0.9.3.xpi> --new <0.9.4.xpi>` | [`update-results.json`](update-results.json) |
| Customized shortcut | same, plus `--custom-shortcut Ctrl+Shift+9` | [`update-results-custom-shortcut.json`](update-results-custom-shortcut.json) |

| Check | Default run | Customized run |
|---|---|---|
| U-1 0.9.3 permanent, `signedState` 2 | PASS | PASS |
| U-2 update through `update_url`, hash checked | PASS | PASS |
| U-3 ID and UUID unchanged, still permanent | PASS | PASS |
| U-4 `storage.local` byte-identical (vault, backup, settings) | PASS | PASS |
| U-5 wrong password refused, master password unlocks; accounts, order and revision unchanged | PASS | PASS |
| U-6 TOTP codes equal RFC 6238 | PASS | PASS |
| U-7 restart: 0.9.4 active, session locked, no key in `storage.session` | PASS | PASS |
| **U-signed** 0.9.3 → 0.9.4 with signature checks on | **PASS** | **PASS** |
| U-8 replace from an encrypted backup, previous vault kept, restored and discarded | PASS | PASS |
| **U-S1** API level: shortcut before, after the update and after the restart | **PASS**: Alt+Shift+A → Ctrl+Shift+2 | **PASS**: Ctrl+Shift+9 → Ctrl+Shift+9 (kept) |
| **U-S2** real key event: the active shortcut opens the toolbar popup and nothing else | **PASS**: Ctrl+Shift+2 (de, us) | **PASS**: Ctrl+Shift+9 (de, us) |
| **U-S3** real key event: replaced shortcuts no longer open the popup | **PASS**: Alt+Shift+A opens only Firefox's "Ansicht" menu | **PASS**: Alt+Shift+A ("Ansicht" menu) and Ctrl+Shift+2 (nothing) |

Each run: 12/12 PASS, 0 not tested, 0 failed.

## What each level shows

The three levels are kept apart:

- **Signed update behaviour** (U-1…U-7, U-signed): both builds are AMO-signed, the old one is
  permanently installed, and the update goes through Firefox's own update mechanism. U-S1 reads
  the shortcut in that same signed, updated installation.
- **API level** (U-S1): `browser.commands.getAll()` reports the active shortcut.
  - The user shortcut in the customized run was set on 0.9.3 with `browser.commands.update`.
    That is the API behind the about:addons shortcut manager, but not a click in about:addons.
- **Real key events** (U-S2, U-S3): `sendNativeKeyEvent` goes through the Windows key path of the
  browser window, so menu access keys are included.
  - The popup counts as open when the toolbar panel (`customizationui-widget-panel`) shows and
    no menu, tab or window opened.
  - The events reach the test browser only. Other applications, OS-wide shortcuts and keyboard
    tools are outside them.

## Not tested here

| Item | Status | Why |
|---|---|---|
| Real key events on macOS and Linux | NOT_TESTED | The native key path is only implemented for Windows. In CI (headless ESR, unsigned simulation) U-S2 and U-S3 report NOT_TESTED, and U-S1 compares an unchanged default. |
| Customizing the shortcut by clicking in about:addons | NOT_TESTED | Operator checklist, point 2.0 |
| Physical keyboard, other add-ons, OS-wide shortcut tools | MANUAL | Operator checklist, part 1 |
| Operator acceptance of #6 and #25 with this build | MANUAL | [`../ABNAHME-0.9.4.md`](../ABNAHME-0.9.4.md) |
