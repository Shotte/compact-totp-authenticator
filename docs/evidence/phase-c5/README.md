# Phase C5 evidence – applying the import

Synthetic data only (`test/fixtures/legacy-synthetic.json`, `syntheticSecret()`); no real
accounts were imported or touched. Specification: [SECURITY.md §14](../../SECURITY.md),
[MIGRATION.md §2](../../MIGRATION.md). Updated after the C5 architecture review (fresh
master password for the apply; import cache lifetime; generated names marked).

## Unit and regression tests

`npm test`: 195/195. C5-specific tests:

### `test/import.test.mjs` (12 tests)

- The legacy fixture appends new, name-conflict and named needs-name rows and skips
  duplicates and invalid rows. Existing accounts stay unchanged and first.
- Preview and apply responses carry no secrets.
- Empty names: apply without a valid replacement name writes nothing.
- Same-name entries are kept. Duplicates of existing secrets are skipped, never
  overwritten.
- Each of these answers `conflict` and writes nothing: a changed vault, the current
  revision sent with an old preview, another file hash, a stale revision, a replaced
  preview, and cancel.
- One commit: a failing write leaves the vault unchanged, and a lock during the write
  reports the import with `locked: true`.
- The 1,000-account limit; nothing importable.
- The `cta-plain` round trip keeps every parameter; missing parameters are never
  invented.

### `test/import-auth.test.mjs` (14 tests, C5 review)

- A missing or wrong master password writes nothing and keeps the preview; the right one
  imports.
- A session that expired before the apply, or expires while the password is being
  verified, ends in `locked`. Nothing is written and the cache is dropped.
- A concurrent write by a second instance during the password check ends in `conflict`.
  Nothing is imported and the cache is dropped.
- A changed file or revision ends in `conflict` and drops the stale preview.
- The cache is dropped on every session end: explicit lock, expiry through the auto-lock
  alarm, expiry noticed by the gate, system idle lock, password change, a new session,
  and a key generation changed by another instance. The old preview then cannot be
  applied, and nothing is written.
- A lock during the preview caches nothing.
- The cache hook cannot be reached through messages.

`test/legacy.test.mjs` covers the preview statuses, including `needs-name`.

### Mutation checks

Each of these makes at least one test fail:

| Mutation | Failing tests |
|---|---|
| Cache survives `wipe()` (lock, expiry, rotation, generation); this mutation was not caught before the review | 6 |
| Cache survives a new session | 1 |
| Stale preview kept after a failed apply | 1 |
| No fresh master password in `importApply` | 2 |
| File hash not checked | 2 |
| Verified revision comparison, re-read and the store's compare-and-set all removed | 2 |
| From the first C5 round: preview revision, current revision, 1,000 limit, empty import, duplicates, defaulted parameters, cancel, unnamed rows | each ≥ 1 |

Second layers that are not caught on their own, because another layer catches the same
case:

- The epoch check before caching a preview; `recheck()` already catches a lock.
- The verified-revision comparison and the re-read before the write; the store's
  compare-and-set catches it.

## Firefox integration

[`browser-results-local.json`](browser-results-local.json): Firefox 160.0.1, Windows 11,
visible window, after the C5 review corrections. Result: 87/89 PASS, 0 failed, 2 MANUAL
(C4-8; B3-real-4 needs `--os-input`), 0 NOT_TESTED. C3-4 (idle lock) also passed in this
run.

| Check | Result | Details |
|---|---|---|
| B5-1 preview via a real file input; the preview persists nothing; apply offered; malformed file rejected | PASS | the empty-name row is `needs-name` |
| C5-1 preview; the generated name is shown and marked; the user renames it and enters the master password; exactly the 6 importable rows are appended once after the existing account; reminder to delete the file; no secrets in the page | PASS | German UI message |
| C5-2 cancel after the preview: nothing written; the cancelled preview cannot be applied | PASS | `conflict` |
| C5-3 vault changed between preview and apply: conflict shown, nothing imported, new preview required | PASS | |
| C5-4 wrong master password in the UI: error, nothing written, preview kept, password field cleared; missing password: `current-password`; after lock and unlock the cached preview cannot be applied | PASS | `conflict` |
| C4-1 … C4-7, C4-9 (export and restore, no regression) | PASS | |

The first local run in the first C5 round failed C5-1: the import was correct, but the
page showed no progress message. An "Importing…" progress message was added.
