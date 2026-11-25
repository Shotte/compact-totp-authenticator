# Signed acceptance build 0.9.6: signed update test 0.9.5 → 0.9.6 and regression

Date: 2026-11-23.

- AMO channel: **unlisted**, signed by the operator after explicit approval.
- Nothing was listed, published or tagged. No update manifest was published.
- The signed XPIs 0.9.0–0.9.5 are unchanged (SHA-256 recomputed, equal to the recorded values;
  0.9.5 `794d89fd…95227946`).

0.9.6 contains `main` `d297a47`:
- PR #41: UX polish, three changes.
  - UX-1: a green "backup verified" message.
  - UX-2: a neutral delete button for the previous vault state; the dialog's confirm button
    stays red.
  - UX-3: a reminder when the previous vault state is 30 days or older.
- PR #43: desktop only, `gecko_android` removed.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/0.9.6/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.6 | `d297a47de03d7b78e16bbcb8596366b66edd0408` | `b6d63835a4834f55a37a-0.9.6.xpi` | `c7000043e886da55e43f347f0a4af3bd724ae8908fb80cba1d223b6d6e8cd48f` | 6/6 OK (independent run) |

**Contents check.** `verify:signed` confirms:
- every prepared file is byte-identical;
- nothing was added besides AMO's signature files (`META-INF/cose.*`, `manifest.mf`,
  `mozilla.sf`, `mozilla.rsa`);
- the ID, the version and the `update_url` are as prepared.

The signed manifest contains:
- `gecko.id` `{f587432b-b553-483e-b08d-4feac6378113}`;
- `version` 0.9.6;
- `strict_min_version` 140.0;
- `data_collection_permissions: none`;
- `update_url` `https://127.0.0.1:47811/updates.json`, the localhost test address;
- **no `gecko_android`**;
- permissions unchanged: `storage`, `alarms`, `activeTab`, optional `idle`;
- the default shortcut Ctrl+Shift+2.

## Environment

- Firefox **160.0.1** (release) on Windows 11, German UI, signature checks on.
- A throwaway profile per run, created and deleted by the script. The operator's profiles were
  not touched.
- Synthetic accounts and passwords only. The result files contain no secrets.
- Visible browser, native key events with the German (0x407) and US (0x409) layouts.

## Signed update runs

Two runs of `test/browser/update-test.mjs --old <0.9.5.xpi> --new <0.9.6.xpi>`, one with the
default shortcut and one with `--custom-shortcut Ctrl+Shift+9`. Both use Firefox's own update
path: `findUpdates()`, the HTTPS `update_url` on 127.0.0.1, download, hash check, install.
Before the update, the old version gets non-default settings.

| Check | Default ([`update-results.json`](update-results.json)) | Custom shortcut ([`update-results-custom-shortcut.json`](update-results-custom-shortcut.json)) |
|---|---|---|
| U-1 0.9.5 permanent, signed, active | PASS | PASS |
| U-2 update found and installed through `update_url` | PASS | PASS |
| U-3 extension ID and UUID unchanged | PASS | PASS |
| U-4 `storage.local` byte-identical: vault, backup, settings | PASS | PASS |
| U-5 wrong password refused, master password unlocks; accounts, order, revision | PASS | PASS |
| U-6 TOTP codes equal RFC 6238 reference codes | PASS | PASS |
| U-7 restart: still installed, locked, unlocks, data and settings intact | PASS | PASS |
| U-S1 shortcut before, after the update and after the restart (API) | PASS: Ctrl+Shift+2 → Ctrl+Shift+2 | PASS: Ctrl+Shift+9 kept, new default not applied |
| U-S2 real key event opens the popup and nothing else (de, us) | PASS: Ctrl+Shift+2 | PASS: Ctrl+Shift+9 |
| U-S3 replaced shortcut no longer opens the popup | NOT_TESTED by design (old and new default are the same) | PASS: Ctrl+Shift+2 does nothing |
| U-8 V2 replacement on the updated install, previous state restorable and deletable | PASS | PASS |
| U-signed both builds signed, signature checks on | PASS | PASS |

Totals: default run 11 PASS + 1 NOT_TESTED (by design); custom run 12/12 PASS.

## Regression and UX on the signed contents

`test/browser/run-browser-tests.mjs` ran with the extension loaded from
`dist/signing/0.9.6/source`, which is byte-identical to the signed XPI (`verify:signed`). A
temporary copy of the script changed only that path and the UI locale (`de`, `en-US`). It was
deleted after the run.

| Language | Result | File |
|---|---|---|
| de | 110 PASS, 0 FAIL, 2 MANUAL, 2 NOT_TESTED (114) | [`suite/browser-results-de.json`](suite/browser-results-de.json) |
| en | 110 PASS, 0 FAIL, 2 MANUAL, 2 NOT_TESTED (114) | [`suite/browser-results-en.json`](suite/browser-results-en.json) |

Not passed, the same in both languages and the same as on earlier runs:
- B3-real-4 MANUAL: real popup click-to-copy, only with `--os-input`.
- C4-8 MANUAL: native save dialog, covered by N1–N5.
- C3-4 NOT_TESTED: the system did not report idle within 150 s.
- T-2 NOT_TESTED: focus ring when the window is not active. Selection and focus movement pass.

**UX check (PASS in both languages):**

| Item | de | en |
|---|---|---|
| UX-1 message after the check: green (`kind` ok), the only message, above the preview; cleared when the form changes | „Sicherung erfolgreich geprüft. Dein Tresor wurde noch nicht verändert.“ | "Backup verified successfully. Your vault has not been changed." |
| UX-2 delete button in the box looks like the restore button (no `danger`); the dialog's confirm button is `danger` | PASS | PASS |
| UX-3 reminder: hidden at 29 d and at 30 d − 1 min, shown at 30 d and 45 d | „Hinweis: Dein vorheriger Tresorstand ist älter als 30 Tage. Du kannst ihn weiterhin wiederherstellen oder löschen, wenn du ihn nicht mehr benötigst.“ | "Note: Your previous vault state is more than 30 days old. You can still restore or delete it if you no longer need it." |
| Contrast, reminder | light #a35200 5.58:1, dark #e8953a 7.15:1 | the same |
| Contrast, verified message | light 5.08:1, dark 6.73:1 | the same |

F3-3, the replacement flow with the verified message, also passes in both languages.

## Not tested here (operator acceptance)

| Item | Status |
|---|---|
| Upgrade of the operator's existing `CTA-Test` profile 0.9.5 → 0.9.6 | MANUAL: [`../ABNAHME-0.9.6.md`](../ABNAHME-0.9.6.md), part 0 |
| Look of the three changes on the operator's screen, light and dark, 200 % zoom, narrow window | MANUAL: parts 2–4 |
| Screen-reader speech | MANUAL, not part of this acceptance |
| Linux and Firefox ESR 140 by hand | MANUAL: [`../ABNAHME-LINUX-ESR.md`](../ABNAHME-LINUX-ESR.md) |
| macOS, Firefox for Android | NOT_TESTED (Android is not supported) |
