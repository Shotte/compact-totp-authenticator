# Signed acceptance build 0.9.2 and the signed update test 0.9.1 → 0.9.2

Date: 2026-11-20. AMO channel: **unlisted**. The operator signed 0.9.2 in an interactive
PowerShell session; the credentials were used only in that session's environment and
removed afterwards. Nothing listed, published or tagged. 0.9.0/0.9.1 and their signed
XPIs are unchanged.

0.9.2 contains PR #23 (#8 damaged-vault message, closeout) and PR #26 (operator feedback
01). Source: `main` `5e91473`.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/0.9.2/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.2 | `5e91473` | `b6d63835a4834f55a37a-0.9.2.xpi` | `05bc5fbc8b4bd480dbf388dc3cc10d30c037582e0751bf682f9c7567d4314de0` | 6/6 OK |

It keeps the permanent ID `{f587432b-b553-483e-b08d-4feac6378113}` and the test-only
`update_url` `https://127.0.0.1:47811/updates.json`.

## Signed update test

`node test/browser/update-test.mjs --old <0.9.1.xpi> --new <0.9.2.xpi>`. The run used:

- Firefox **160.0.1** (release), Windows;
- signature checks on;
- a throwaway profile with synthetic accounts only.

Result file: [`update-results.json`](update-results.json).

| Check | Result |
|---|---|
| U-1 0.9.1 installed permanently, `signedState` 2, active | PASS |
| U-2 update through `update_url`, hash checked, installed | PASS |
| U-3 ID and moz-extension UUID unchanged | PASS |
| U-4 `storage.local` byte-identical, nothing reinitialized | PASS |
| U-5 wrong password refused, master password unlocks; accounts, order, revision unchanged | PASS |
| U-6 TOTP codes equal RFC 6238 | PASS |
| U-7 after a restart: 0.9.2 active, session locked, no key in `storage.session` | PASS |
| **U-signed** 0.9.1 → 0.9.2 with signature checks on | **PASS** |

The vault written by 0.9.1 is read unchanged by 0.9.2. The pending-import binding is new
in 0.9.2 and lives in `storage.session` only, so the update needs no migration.

**Manual upgrade:** upgrading the operator's `CTA-Test` profile from 0.9.0 to 0.9.2 through
about:addons → "Install Add-on From File" was confirmed by the operator in the second
acceptance session (operator feedback 02): **PASS (operator)**. The automatic lock after 1
minute and A–Z / Z–A sorting in the real popup were confirmed in the same session.
