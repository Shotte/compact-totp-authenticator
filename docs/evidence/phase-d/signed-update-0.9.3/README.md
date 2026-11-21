# Signed acceptance build 0.9.3, signed update test 0.9.2 → 0.9.3 and replacement check

Date: 2026-11-21. AMO channel: **unlisted**, signed by the operator in an interactive
PowerShell session; the credentials stayed in that session's environment only. Nothing listed,
published or tagged. The signed 0.9.0, 0.9.1 and 0.9.2 XPIs are unchanged.

0.9.3 contains everything merged up to `main` `4e03128`:
- PR #28: contrast-correction explanation, restore messages, sorting note;
- PR #30: popup keeps the keyboard focus when codes refresh;
- PR #29: restore or replace the vault from an encrypted backup, with the previous vault state;
- PR #32: the three-tab options page.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/0.9.3/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.3 | `4e03128` | `b6d63835a4834f55a37a-0.9.3.xpi` | `19e99eb088f704f0738ea8df5c6b48fa3598751f474be1491e19ae6cb5dcd979` | 6/6 OK (ID, version, signature files, test-only `update_url` `https://127.0.0.1:47811/updates.json`) |

## Signed update test and replacement check

`node test/browser/update-test.mjs --old <0.9.2.xpi> --new <0.9.3.xpi>`. The run used Firefox
**160.0.1** (release) on Windows, with signature checks on, in a throwaway profile with synthetic
accounts. Result file: [`update-results.json`](update-results.json).

| Check | Result |
|---|---|
| U-1 0.9.2 permanent, `signedState` 2 | PASS |
| U-2 update through `update_url`, hash checked | PASS |
| U-3 ID and UUID unchanged | PASS |
| U-4 `storage.local` byte-identical (vault integrity, settings) | PASS |
| U-5 wrong password refused, master password unlocks; accounts, **order** and revision unchanged | PASS |
| U-6 TOTP codes equal RFC 6238 | PASS |
| U-7 restart: 0.9.3 active, **session locked**, no key in `storage.session` | PASS |
| **U-signed** 0.9.2 → 0.9.3 with signature checks on | **PASS** |
| **U-8** on the updated, signed permanent install (see below) | **PASS** |

U-8, step by step:
1. Encrypted export of 18 entries.
2. Add "Neu nach Export".
3. Preview: 18 in the backup, 19 current, "Neu nach Export" only local.
4. Replacement: 18 entries again; previous vault state with 19 entries kept.
5. A password change is refused (`previous-exists`).
6. The export password does not open the vault; the master password does.
7. Restore the previous vault: 19 entries; the kept state now holds 18.
8. Discard: no kept state.

## Not tested here

The operator acceptance of #2, #3, #6, #21 and #25 with this build:
[`../ABNAHME-0.9.3.md`](../ABNAHME-0.9.3.md).
