# C4–C6 preparation (draft for architecture review)

Status: **preparation only**. No production code for C4 or C5 exists or may be written
before the C3 architecture review. Based on `main` at `da1d6ee` (C2 merged) and the C3
pull request #13 (session security, review pending).

Sources reviewed: ARCHITECTURE.md (phase table), SECURITY.md §6–§8 and §11–§12,
MIGRATION.md, `src/lib/legacy.js`, `src/lib/accounts.js`, `src/lib/vault.js`, issue #8.

## 1. Dependencies on C3

| C3 result | Used by |
|---|---|
| `authorizeSensitive(password)` (SECURITY.md §12.3) | Every export (C4); a fresh master-password check per export |
| Gate + `recheck()` after async work | Export encryption and import decryption run PBKDF2; a lock during that work must abort |
| Settings changes on the running session | None directly |
| Issue #8 decision (SECURITY.md §12.5) | C4 recovery design |

C4 starts on a branch from `main` after C3 is merged.

## 2. C4 – encrypted and plaintext export, re-import, recovery

Existing specification: SECURITY.md §6 (`cta-export` shares the vault structure and AAD
rule, own salt and IV, password chosen at export time), §8 (plaintext export only after a
warning and confirmation, Blob download, URL revoked at once, never kept in the DOM),
MIGRATION.md §3.

### 2.1 Proposed acceptance criteria (missing today)

| # | Criterion |
|---|---|
| E1 | Every export needs a valid session **and** the master password via `authorizeSensitive`; one check per export, no caching of the authorization |
| E2 | Exact `cta-export` v1 schema with its own reader (`validateExport`), mirroring `validateVault`: exact key sets, `format === "cta-export"`, bounded KDF, salt 16 / IV 12 bytes, ciphertext ≤ 8 MB, file ≤ 10 MB before parsing |
| E3 | The `format` string is part of the AAD, so a vault can never be read as an export or vice versa (test both directions) |
| E4 | Export password: default is a separate password with confirmation (12+ code points, NFC, same rules as the master password); "use master password" is an explicit choice. Own salt, fresh IV, 600,000 iterations |
| E5 | Payload inside the ciphertext: `{ accounts: [...], exportedAt, appVersion }`. No account count, names or dates in the plaintext header |
| E6 | Self-check before delivery: the background decrypts its own export with the export password and compares the payload; a mismatch aborts the export |
| E7 | Delivery: generated in the background, handed to the options page as one message only after confirmation, downloaded via `<a download>` + Blob URL (no `downloads` permission), URL revoked at once, nothing kept in the DOM or page variables; file name without account names |
| E8 | Plaintext export: separate warning dialog, checkbox + second button, fresh master password; generated in the background; same delivery rules |
| E9 | Re-import of a `cta-export`: decrypt → the existing preview (duplicates by secret) → one append-only `commit`; cancel or failure writes nothing |
| E10 | Round trip: export → import into an empty vault → identical accounts (all fields, order) |
| E11 | Tampered, truncated, wrong-password or downgraded exports (iterations < 600,000) are rejected identically and never write |
| E12 | No secret or password in any message except the single confirmed export payload; leak scans over responses, DOM and storage as in B6-2 |

### 2.2 Security-sensitive design questions (need a decision)

1. **Default export password:** separate (proposed, limits damage if a file leaks and the
   master password is reused elsewhere) or the master password (simpler recovery).
2. **Plaintext format loses data:** the legacy `otp_list` has only `name`, `key`, `url`.
   Accounts with SHA-256/512, 7–8 digits or a non-30 s period cannot be represented.
   Options: (a) add optional `algorithm`/`digits`/`period` fields that CTA reads and the
   old extension ignores; (b) warn and list the affected accounts; (c) both (proposed).
3. **Recovery without the master password:** an export only helps if the user can start
   over. A "reset vault" action deletes the current vault: destructive, needs its own
   confirmation UX and an operator decision. Alternative: import is offered only when no
   vault exists (the user removes extension data first).
4. **Issue #8:** decide the unverified-generation recovery (SECURITY.md §12.5) or replace
   it by "restore from export".
5. **Retry limit** for `authorizeSensitive` (SECURITY.md §12.6).
6. **Settings in exports:** proposed no (no secrets, no value for recovery).

### 2.3 Data-loss risks

- A broken export noticed only when needed: mitigated by the self-check (E6) and a
  "verify export file" action that decrypts a chosen file without importing it.
- Plaintext parameter loss (question 2).
- Import racing with edits: existing revision compare-and-set returns `conflict`.
- A destructive reset (question 3).

### 2.4 Test plan

- Unit: reader tests mirroring `vault.test.mjs` (every header field tampered, unknown
  keys, bounds, base64 lengths); AAD cross-format test; NFC/NFD export passwords; round
  trip; self-check failure injection; gating (no session, expired, wrong master password,
  lock during PBKDF2); plaintext export without confirmation refused.
- Browser: export download in the options page (Blob URL revoked, DOM leak scan), import
  round trip, hard kill during import (vault unchanged or fully committed).
- Fixtures: a committed synthetic `cta-export` v1 file generated by a test helper
  (like `vault-v1-portable.json`), opened on Windows, Linux and macOS in CI.

## 3. C5 – applying the legacy import

Existing: parser and preview (`legacy.js`), rules in MIGRATION.md §2.

### 3.1 Proposed acceptance criteria

| # | Criterion |
|---|---|
| I1 | Apply exactly what the preview showed: the apply request carries the preview's vault revision and a hash of the file text; a changed vault or file returns `conflict` and asks for a new preview |
| I2 | Duplicates (same normalized secret) are skipped; nothing existing is changed; only appends |
| I3 | One `commit` for the whole import; an interrupted import changes nothing |
| I4 | Upper bound on the resulting account count (proposal: 1,000, matching `MAX_IMPORT_ENTRIES`) so the vault stays far below the 8 MB ciphertext bound |
| I5 | After success, the UI reminds the user to delete the plaintext `totp.json` |
| I6 | The file text travels page → background once; it is never stored and never echoed back |

### 3.2 Questions

1. **Empty names:** the old extension allowed them; CTA rejects them, so such entries are
   dropped today. Proposal: import them as "Imported 1", "Imported 2" … with a marker in
   the preview, instead of silently losing a secret.
2. **Name conflicts:** MIGRATION.md says "imported, marked" but not how. Proposal: keep
   the name and show the conflict in the preview only (no rename).
3. **Short secrets** (< 16 characters): imported with a warning (current preview) or
   rejected like manual entry (`secret-short`). Today manual entry rejects them, so an
   import would bypass that rule. Decision needed.

### 3.3 Test plan

Per-row statuses (existing fixture plus the cases above); revision conflict; hash
mismatch; kill during commit; 1,000-entry limit; cancel writes nothing; no secrets in
preview rows (existing).

## 4. C6 – final security and regression testing

- Full CI matrix plus the real toolbar popup with real mouse input on Windows
  (`test:browser:os`); real popup on macOS and Linux is a manual checklist.
- **Upgrade test (data-loss risk):** install a 0.x build with a vault, update to the new
  build (not a reinstall) and open the vault. Today the harness reinstalls a temporary
  add-on with `keepStorageOnUninstall`; a real update path is not tested yet.
- Manual: idle lock on real desktops (C3), screen reader pass over popup and options,
  HiDPI/scaling, keyboard-only use.
- Release gate: remove the development notice at 1.0 (static test enforces its presence
  in 0.x), review `MAX_ITERATIONS`, signing and `update_url` (RELEASE.md).

## 5. Automation opportunities

- `scripts/mutate.mjs`: apply the documented gate mutations (C2/C3 evidence) and require
  each to fail a test; run in CI so a weakened test is noticed.
- A filter for the browser harness (run selected check IDs) to shorten iteration from
  about 25 minutes.
- Export fixture portability across platforms, like the vault fixture.
- An upgrade test in the browser harness (install the previous build, then update).

## 6. Decisions requiring operator or architecture approval

1. C4 default export password (§2.2 question 1).
2. Plaintext export format extension for non-default TOTP parameters (§2.2 question 2).
3. Destructive "reset vault" path for recovery from an export (§2.2 question 3).
4. Issue #8: unverified-generation recovery or "restore from export" (§2.2 question 4).
5. Retry limit for password checks during an unlocked session (§2.2 question 5).
6. C5: empty names, name-conflict marking, short secrets (§3.2).
7. C6: whether a real update-path test is a release requirement (§4).
