# #25: restore or replace from an encrypted backup (1.0 scope)

Operator decision: restoring an encrypted backup must also work when the vault already holds
entries. Design and outcome table: SECURITY.md §13.4a. Synthetic data only. Not merged,
signed or published.

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
| `npm test` | PASS 235/235 (new: `replace.test.mjs`, 12 tests) |
| `web-ext lint` | PASS 0/0 |
| `check:release` | PASS 26/26 |
| Local browser run, Firefox 160.0.1, Windows ([`browser-results-local.json`](browser-results-local.json)) | 99/101 PASS, 2 MANUAL, 0 FAIL (new: R-1) |
| Screenshot | [`replace-warning-de.png`](replace-warning-de.png): destructive warning with synthetic names |
| Native Open dialog for the restore (`native-dialogs.mjs` N4, `--os-input`) | NOT_TESTED in this PR (adapted to the two steps) |
| A real browser crash during the replacement | NOT_TESTED in the browser; simulated at every write boundary in the unit test |
