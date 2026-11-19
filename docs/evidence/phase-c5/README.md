# Phase C5 evidence – applying the import

Synthetic data only (`test/fixtures/legacy-synthetic.json`, `syntheticSecret()`); no real
accounts were imported or touched. Specification: [SECURITY.md §14](../../SECURITY.md),
[MIGRATION.md §2](../../MIGRATION.md).

## Unit and regression tests

`npm test`: 181/181. C5-specific: `test/import.test.mjs` (13 tests) and
`test/legacy.test.mjs`:

- the legacy fixture appends new, name-conflict and named needs-name rows and skips
  duplicates and invalid rows; existing accounts stay unchanged and first;
- preview and apply responses carry no secrets;
- empty names: apply without a valid replacement name writes nothing;
- same-name entries are kept; duplicates of existing secrets are skipped, never
  overwritten;
- changed vault, current revision with an old preview, other file hash, stale revision,
  replaced preview and cancel each answer `conflict` and write nothing;
- a lock between preview and apply refuses the apply, and the old preview is gone after
  unlocking;
- one commit: a failing write leaves the vault unchanged, and a lock during the write
  reports the import with `locked: true`;
- the 1,000-account limit; nothing importable;
- the `cta-plain` round trip keeps every parameter; missing parameters are never
  invented.

Mutation checks: each change below makes at least one test fail.

- preview revision not checked;
- current revision not re-checked;
- file hash not checked;
- no 1,000 limit;
- empty import written;
- duplicates imported;
- missing parameters defaulted;
- cancel keeps the preview;
- unnamed rows not flagged.

"Kept import text survives a lock" is not caught. It is a second layer: after a lock the
session id changes, so the old preview is refused anyway.

## Firefox integration

[`browser-results-local.json`](browser-results-local.json): Firefox 160.0.1, Windows 11,
visible window. Result: 85/88 PASS, 0 failed, 2 MANUAL (C4-8; B3-real-4 needs
`--os-input`) and 1 NOT_TESTED (C3-4, because the workstation was in use).

| Check | Result | Details |
|---|---|---|
| B5-1 preview via a real file input; the preview persists nothing; apply offered; malformed file rejected | PASS | the empty-name row is now `needs-name` |
| C5-1 preview, replacement name typed for the unnamed row, apply through the UI: exactly the 6 importable rows are appended once after the existing account; reminder to delete the file; no secrets in the page; preview cleared | PASS | German UI message |
| C5-2 cancel after the preview: nothing written; the cancelled preview cannot be applied | PASS | `conflict` |
| C5-3 vault changed between preview and apply: conflict shown, nothing imported, new preview required | PASS | |

The first local run failed C5-1: the import was correct, but the page showed no progress
message, so the harness read the message before the apply finished. An "Importing…"
progress message was added; the rerun passed.
