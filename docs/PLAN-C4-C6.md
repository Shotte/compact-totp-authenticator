# C4–C6 plan and decisions

Status: C4 merged (PR #15, specification: [SECURITY.md §13](SECURITY.md)). C5 is implemented
on `feature/c5-legacy-import` (SECURITY.md §14), review pending. C6 is planned. Decisions below were
approved in the C3 review decision (CTA-001, 2026-11-19). Material from the preparation
draft (PR #14) that is now implemented or decided lives here or in SECURITY.md, not twice.

## 1. Dependencies on C3

| C3 result | Used by |
|---|---|
| `authorizeSensitive(password)` (SECURITY.md §12.3) | Every export (C4): fresh master-password check per export |
| Gate + `recheck()` after async work | Export and import run PBKDF2; a lock or expiry during that work aborts them |
| Issue #8 (open; `allowUnverifiedGeneration` not implemented) | C4 restore from an encrypted export is the supported recovery path |

## 2. C4 – export, restore (implemented, review pending)

Approved decisions, as implemented:

- Encrypted export (`cta-export` v1) with an export password **separate from the master
  password by default** and confirmed; using the master password is an explicit option.
- Fresh master-password verification before every export.
- Plaintext export (`cta-plain` v1) is complete and versioned; separate warning and
  confirmation.
- Legacy `totp.json` only when nothing is lost; otherwise refused with the affected
  accounts listed (no silent conversion).
- Minimal restore of an encrypted export into an **empty** vault; merging is C5.

Acceptance criteria E1–E12 from the preparation draft map to SECURITY.md §13 and the C4
evidence; the matrix is in the pull request.

Final C4 review decisions (CTA-001, 2026-11-19), as implemented:

1. Finding A fixed before the merge: account changes and restore share one write path with
   three reported outcomes (rejected, committed with `locked`, unknown); SECURITY.md §7.6.
2. No `downloads` permission; the "handed to Firefox" message stays. Native dialogs and
   download failures on Linux and macOS stay manual release checks (RELEASE.md §5).
3. Finding B: read-only commands are repeated (bounded) after an undelivered message;
   mutations are never repeated, an undelivered one is reported as `unknown` and the page
   reloads the real state (SECURITY.md §7.7). Automatic mutation retries with operation
   identifiers are not needed for that and are not planned.

Carried over from the draft, not part of C4 (open proposals):

- A "verify export file" action that decrypts a chosen file without importing it, so a
  broken backup is noticed early. The self-check already verifies every new file.
- A destructive "reset vault" action for starting over after a forgotten master password
  before restoring an export. It needs its own confirmation UX and an operator decision;
  today the user removes the extension's data manually.
- Settings are not exported: they contain no secrets and do not matter for recovery.

## 3. C5 – applying the legacy import (implemented, review pending)

Existing: parser and preview (`legacy.js`), rules in MIGRATION.md §2.

### 3.1 Approved rules

- Never silently discard accounts with empty names; show them in the preview with an
  editable replacement name.
- Preserve distinct entries that share a name.
- Clearly identify existing duplicates (same normalized secret); never overwrite existing
  accounts automatically.
- Reject malformed Base32 secrets.
- Distinguish weak but syntactically valid secrets from invalid ones; warn about short
  secrets instead of rejecting all of them.
- Never invent missing security-sensitive parameters.
- A failed import leaves the existing vault unchanged.

### 3.2 Acceptance criteria (proposed for the C5 review)

| # | Criterion |
|---|---|
| I1 | Apply exactly what the preview showed: the apply request carries the preview's vault revision and a hash of the file text; a changed vault or file returns `conflict` and asks for a new preview |
| I2 | Duplicates are skipped by default; only appends |
| I3 | One `commit` for the whole import; an interrupted import changes nothing |
| I4 | Upper bound on the resulting account count (1,000, matching `MAX_IMPORT_ENTRIES`) |
| I5 | After success, remind the user to delete the plaintext `totp.json` |
| I6 | The file text travels page → background once; it is never stored or echoed back |
| I7 | Empty names: replacement names are entered in the preview and validated like manual entry before apply |
| I8 | Short secrets: imported with a visible warning per row (same policy as manual entry) |
| I9 | `cta-plain` v1 files (C4) are importable through the same preview |

### 3.3 Shared secret validation (prepared in C4, review follow-up)

Decided: one policy for manual entry and import (SECURITY.md §13.6). Malformed Base32 is
rejected; valid secrets shorter than 16 characters are accepted with a warning. The
legacy preview already uses it; C5 applies it to the import write path.

### 3.4 Test plan

Per-row statuses (existing fixture plus empty names, same-name entries, weak secrets);
revision conflict; hash mismatch; kill during commit; 1,000-entry limit; cancel writes
nothing; no secrets in preview rows.

## 4. C6 – final security and regression testing (planned)

- **Release-blocking (approved): real Firefox extension update test.** It must show that
  the signed extension updates successfully, the encrypted vault survives, the extension
  ID stays stable, settings and account order stay intact, and unlock and TOTP generation
  work afterwards. Today the harness only reinstalls a temporary add-on with
  `keepStorageOnUninstall`; a real update path is not tested yet. Also listed in
  RELEASE.md §5.
- Full CI matrix plus the real toolbar popup with real mouse input on Windows
  (`test:browser:os`); real popup on macOS and Linux as a manual checklist.
- Manual: idle lock on real desktops (C3); native save dialog, cancel and download
  failures (C4-8); screen reader pass; HiDPI; keyboard-only use.
- Release gate: remove the development notice at 1.0; review `MAX_ITERATIONS`, signing
  and `update_url` (RELEASE.md).

## 5. Automation opportunities

- `scripts/mutate.mjs`: apply the documented gate mutations (C2–C4 evidence) and require
  each to fail a test, in CI.
- A filter for the browser harness (run selected check IDs); a full run takes about 30
  minutes.
- An update test in the browser harness (install the previous signed build, then update).
