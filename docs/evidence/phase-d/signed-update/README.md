# Signed test builds 0.9.0 / 0.9.1 and the signed update test (issue #19)

Date: 2026-11-20. AMO channel: **unlisted**. Both builds were signed by the operator with
`web-ext sign` in an interactive PowerShell session; the credentials were entered there,
used only in the environment and removed afterwards. Nothing listed, published or tagged.

| Version | Source commit | Signed XPI (git-ignored, `dist/signing/<v>/signed/`) | SHA-256 | `verify:signed` |
|---|---|---|---|---|
| 0.9.0 | `6e0dbb5` | `b6d63835a4834f55a37a-0.9.0.xpi` | `80e49997c4c59b6ad8d76eacf4f0d08d4c23e1a0e7a6539f9c600d5e48bfe736` | 6/6 OK |
| 0.9.1 | `6e0dbb5` | `b6d63835a4834f55a37a-0.9.1.xpi` | `ddf8e2601fb09fdc07c666c90900a8e5eab9500d11e3a5f82c3f693ede5c40ba` | 6/6 OK |

Both builds keep the permanent ID `{f587432b-b553-483e-b08d-4feac6378113}` and the
test-only `update_url` `https://127.0.0.1:47811/updates.json`.

**Finding during verification:** signing removed the trailing newline of `manifest.json`.
The JSON is identical (every key and value) and every other file is byte-identical. The
first `verify:signed` run therefore reported 5/6. The script now compares `manifest.json`
as parsed JSON against the prepared manifest. That manifest must itself still match
`SHA256SUMS`, and every other file stays byte-compared. Both directions are tested in
`test/release-scripts.test.mjs`: whitespace only is accepted, a changed value fails.

## Signed update test

`node test/browser/update-test.mjs --old <0.9.0.xpi> --new <0.9.1.xpi>`. The run used:

- Firefox **160.0.1** (release), Windows;
- a throwaway profile with synthetic accounts only;
- signature checks on: `xpinstall.signatures.required` was not changed;
- a test CA trusted only in that profile, for the local HTTPS update server only.

Result file: [`update-results.json`](update-results.json).

| Check | Result |
|---|---|
| U-1 0.9.0 installed permanently, `signedState` 2, active | PASS |
| U-2 update found through `update_url`, `updates.json` fetched, XPI downloaded, hash checked, installed | PASS |
| U-3 extension ID and moz-extension UUID unchanged, still permanent | PASS |
| U-4 `storage.local` byte-identical, nothing reinitialized | PASS |
| U-5 wrong password refused, master password unlocks; accounts, order, revision unchanged | PASS |
| U-6 TOTP codes equal RFC 6238 codes computed outside Firefox | PASS |
| U-7 after a browser restart: 0.9.1 active, session locked, no key in `storage.session`, master password unlocks, data and settings intact | PASS |
| **U-signed** signed update 0.9.0 → 0.9.1 with signature checks on | **PASS** |

This satisfies every acceptance criterion of issue #19. U-7 is the automated evidence for
issue #4 with a signed build. The operator's visual check of the locked popup after a
restart is ABNAHME 4.1.
