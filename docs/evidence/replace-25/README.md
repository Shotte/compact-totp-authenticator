# #25: restore or replace from an encrypted backup (1.0 scope)

Operator decision: restoring an encrypted backup must also work when the vault already holds
entries. Design and outcome table: SECURITY.md §13.4a. Synthetic data only. Not merged,
signed or published.

## Architecture review conditions (CTA-D-PR28-PR29)

| Condition | Implementation | Evidence |
|---|---|---|
| A: export password not retained | Discarded after the check. The replacement form asks for it again, and it re-authenticates the backup. The file hash and the entry count must match the preview; master password and revision as before | unit "review A: the export password is not kept …"; R-1: the field is empty after the check |
| B: exactly one previous vault state | One `vault_previous`, labelled "previous vault state", with "Restore previous vault" and "Discard previous vault" (fresh master password and confirmation). Never discarded silently: the replacement preview warns that it would be overwritten. A password change explains the loss and needs a confirmation; the service refuses `changePassword` without it (`previous-exists`) | unit "restore the previous vault …"; R-1: password-change warning shown and confirmation required |
| C: real-browser hard termination | R-2: freeze the extension process right after a target write (`storage.onChanged` busy-wait in the options page, which shares the process with the background page), kill Firefox, restart with the same throwaway profile | table below |

### R-2: hard termination of Firefox 160.0.1 (Windows), synthetic entries, throwaway profile

| Killed after | Outcome after the restart | Opened by | Previous vault kept | Result |
|---|---|---|---|---|
| `vault_previous` written (kept copy) | old entries, exact and in order | destination master password, directly | yes (3) | PASS |
| `vault_backup` written (rollback copy) | old entries, exact and in order | destination master password, directly | yes (3) | PASS |
| `vault` written, before its read-back | backup's entries, exact and in order | destination master password, directly | yes (3) | PASS |
| control, not killed during the replacement | backup's entries | destination master password | yes (3) | PASS |

In no case was a mixed list accepted, and the export password never opened the vault. A
termination inside a single `storage.local.set` (torn write) cannot be produced from
outside; it is covered by Firefox's single-key atomicity (C2-7) and the unit tests.

## Requirements

| Requirement | Implementation | Evidence |
|---|---|---|
| Select a backup, authenticate with the export password | `replacePreview` opens the backup before anything else | unit "wrong master or export password", "damaged or malformed backup" |
| Preview: number of entries and relevant differences | counts; entries in both; names only in the current vault or only in the backup; no secrets | unit "populated vault"; R-1 |
| Fresh master password of the current vault | `authorizeSensitive` in `replaceApply` | unit; R-1 |
| Destructive warning and separate confirmation for a populated vault | `role="alert"` warning listing the local-only entries; required checkbox; `replace-confirmation` in the service | unit; R-1 (form invalid without the checkbox); screenshot |
| Replace only after every check | binding (session, revision, hash), re-read, CAS | unit "cancel, another file, a changed vault or a reused preview" |
| Keep master password and encryption policy | sealed with the destination key and KDF header | unit (the backup's password does not open it); R-1 |
| Recoverable encrypted copy of the previous vault | `vault_previous`, written and verified before the commit; bring back and discard | unit; R-1 brings it back |
| Stage and verify; never delete before success; storage failures | copy verified, then commit with backup, read-back and rollback | unit "storage failure while keeping …", "… while writing the new vault" |
| Browser termination at every write boundary | old or new vault plus copy, always openable | unit "browser terminated at every write boundary" |
| Concurrent modifications | revision binding and CAS: `conflict`, nothing overwritten | unit |
| Truthful outcomes | `replace-failed` only if storage holds the old revision; `unknown` otherwise (`reconcile`) | unit; SECURITY.md §7.6 |
| Session expiry | `locked`, binding wiped, never revived; the preview does not extend the session; clear message | unit "session expired …", "the preview is not an activity" |
| Distinct UX messages | wrong master password, export authentication or invalid backup, session expired, concurrent change, success, failure without data loss (de/en) | F2-2, R-1 |

## Results

| Check | Result |
|---|---|
| `npm test` | PASS 236/236 (new: `replace.test.mjs`, 13 tests) |
| `web-ext lint` | PASS 0/0 |
| `check:release` | PASS 26/26 |
| Local browser run, Firefox 160.0.1, Windows ([`browser-results-local.json`](browser-results-local.json)) | 101/103 PASS, 2 MANUAL, 0 FAIL (new: R-1, R-2; with PR #30: B8-5) |
| Screenshot | [`replace-warning-de.png`](replace-warning-de.png): destructive warning with synthetic names |
| Native Open dialog for the restore (`native-dialogs.mjs` N4, `--os-input`) | NOT_TESTED in this PR (adapted to the two steps) |
| A real browser crash during the replacement | PASS: R-2 at three write boundaries plus a control (see above) |
