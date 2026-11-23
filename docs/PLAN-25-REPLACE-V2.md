# #25 vault replacement, version 2: simpler flow, same guarantees (proposal)

Status: **approved by the operator and implemented** (PR "#25 V2"). Basis: `main` `07e4403`,
signed 0.9.4. Operator decisions: architecture approved; lifetime at most 180 s; initial
focus on Cancel in the dialog; previous-vault actions only after a separate design (§7).

**Changes against the reviewed proposal, made during the implementation:**

- **Sealing key.** The proposal sealed the staged accounts with the session key. The session
  key is derived from the master password, so a lock followed by a new unlock yields the same
  key again. The implementation therefore uses a fresh random non-extractable AES-GCM key per
  check, stored only in the session record (`replaceKey`). Every lock or session end deletes
  it together with the session key, and a new session never holds it. Leftover
  `pendingReplace` data is unusable after a lock even if its cleanup never ran (operator
  condition "locking must make pending data unusable").
- **Expiry.** Checked on every read of the pending replacement (`createdAt ≤ now <
  expiresAt`), not only at the replacement; an expired one is consumed and never valid again.
  The alarm only cleans up.
- **Bindings.** Session id, key generation, revision, token hash, creation and expiry time
  are the AES-GCM additional data of the sealed copy. The proposed separate digest was not
  needed: authenticated encryption under a single-use key binds the contents.
- **A failure that changed nothing** (`replace-failed`) also consumes the token: the user
  checks again. Single use without exceptions is simpler to reason about.

## 1. Why

The operator acceptance of 0.9.4 (#25, F3-3) failed on usability. The replacement itself works.

| # | Finding | Cause in 0.9.4 |
|---|---|---|
| 1 | Errors can appear below the visible area | The status sits under the form; it is not scrolled into view on an error |
| 2 | A wrong export password forces choosing the file again | `previewReplace()` clears the file field before the check runs |
| 3 | After the check, several messages and controls in a confusing order | Step 1 status, preview, warning, explanation and step 2 form are all shown at once |
| 4 | An extra checkbox although the action is called "replace" | `replaceApply` requires `confirmed` for a populated vault |
| 5 | The export password is entered twice | It is discarded after the check by design (review A) and re-authenticates the file at apply |
| 6 | The master password only at the end | `authorizeSensitive` runs at apply |
| 7 | Feels paternalistic and repetitive | Findings 2–6 together |

The guarantees behind findings 5 and 6 come from the event page. Firefox suspends it after
about 30 s idle, so nothing survives in background memory between two user actions. 0.9.4
therefore kept only a binding (session id, revision, file hash) in `storage.session` and
re-derived everything at apply.

## 2. Recommended design

**One authentication step. The check stages the decrypted backup, sealed under the existing
session key. A single-use token held only by the open page authorizes the final action. The
pending operation has a short lifetime.**

### Check (step 1: one request)

The page sends:

- the file text (ciphertext);
- the export password;
- the master password.

The background, inside `exclusive()`:

1. `requireSession()`.
2. `authorizeSensitive(masterPassword)`: fresh proof of the master password against the current
   vault. It returns the vault key, the revision and the current accounts.
3. `openBackup(text, exportPassword)`: bounded parsing, PBKDF2, AES-GCM authentication,
   `accountsFromPortable`, `MAX_IMPORT_ENTRIES`.
4. `recheck(ctx)`: a lock, expiry or re-unlock during the PBKDF2 runs aborts.
5. Computes the summary, as today: counts, names only in the current vault, names only in the
   backup, whether an older kept copy would be overwritten.
6. Creates `token` (128 random bits). Stores in `storage.session`:
   ```
   pendingReplace = { sessionId, generation, revision, tokenHash: SHA-256(token),
                      expiresAt: now + 180 s, backupCount, digest: SHA-256(canonical accounts),
                      staged: encryptJson(sessionKey, accounts,
                              aad = "cta-replace|" + sessionId + "|" + revision + "|" + tokenHash) }
   ```
   It also creates the alarm `replace-expiry` for `expiresAt`.
7. Returns `{ token, summary, expiresAt }`.

Neither password is stored anywhere. The derived export key and the second copy of the vault key
are local variables of this request and are dropped when it returns. The page clears both
password fields as soon as the response arrives.

### Replace (step 3: one request, no password, no file)

The page sends `{ token }`. The background, inside `exclusive()`:

1. `requireSession()`. Then:
   - `pendingReplace` exists;
   - session id and key generation match;
   - `SHA-256(token) === tokenHash`;
   - `now < expiresAt`.
   Otherwise: `ConflictError` or `expired`.
2. **Single use.** `pendingReplace` is removed before anything else, so a second request with
   the same token always fails.
3. `readVault(ctx)` with the session key: `revision === pending.revision`, otherwise
   `ConflictError`. This covers another tab, the popup and an import.
4. `decryptJson(sessionKey, staged, aad)`. The digest and the count must match. Otherwise
   `ConflictError`. A tampered or foreign blob cannot pass AES-GCM with this AAD.
5. `replaceContents()` as today:
   - `keepPrevious` (verified encrypted copy, overwrites an older one);
   - `commitAccounts` (the one write path, staged/backup recovery, truthful outcome:
     committed, rejected or unknown).

The vault keeps its master password and key generation.

### Lifecycle of the pending operation

| Event | Effect |
|---|---|
| Cancel, choose another file, edit any step 1 field | Page drops the token and calls `replaceCancel` → `pendingReplace` removed |
| Page closed, reloaded or crashed | Token is gone with the page, so the blob is unusable. Removed at `expiresAt` by the alarm, or earlier by the next check or session end |
| Lock (manual, auto-lock, idle lock), password change, new unlock, damaged vault | Existing `wipe()` / `startSession()` remove `pendingReplace` together with the session key |
| 180 s elapsed | Apply refuses (`expired`); the alarm removes the blob; the page disables the button and asks for a new check |
| Event page suspended between check and replace | No effect: state is in `storage.session`, as is the session key |
| Browser restart | `storage.session` is empty: nothing pending, session locked |

### Which secrets exist where, and for how long

| Material | Where | How long |
|---|---|---|
| Export password (plaintext) | Page field → one `runtime.sendMessage` → background request scope | Until the check request returns (≈1 s of PBKDF2). Never stored; the field is cleared on the response |
| Master password (plaintext) | Same | Same |
| Key derived from the export password | Background local variable (non-extractable `CryptoKey`) | Duration of the check request |
| Key derived from the master password | Background local variable | Duration of the check request |
| Session key (existing, unchanged) | `storage.session`, non-extractable | Session lifetime, as today |
| Decrypted backup accounts | Background memory during the check, then only as AES-GCM ciphertext under the session key in `storage.session` | Plaintext: the check request. Ciphertext: until replace, cancel, 180 s, lock or session end |
| Token | Page JavaScript variable only (not DOM, URL, storage or log); the background keeps only its SHA-256 | Until replace, cancel or page close; useless after 180 s |

Nothing reaches `storage.local`, logs, URLs or the history.

JavaScript strings cannot be zeroed: the plaintext passwords are garbage collected after the
request. This is no different from today, except that today it happens twice.

### Alternatives considered

| Option | Verdict |
|---|---|
| A. Keep both passwords in page memory and send them again at replace | Rejected: plaintext passwords retained for the whole preview, sent twice |
| B. Keep the derived export key (non-extractable) in `storage.session` and send the file again at replace | Works, but keeps a second key, needs the file again, and still leaves the master password question open |
| C. One request "check and replace", confirmed before the preview | Rejected: the user would confirm without seeing what changes |
| D. Ask for the passwords only at replace (preview without authentication) | Rejected: the preview of the backup's contents needs the export password; the operator asked for one authentication up front |
| **E. Staged ciphertext under the session key, page-held single-use token, 180 s** | **Recommended**: no password or extra key survives the check request; the file is not needed again; the staged data is protected like the vault itself |

Point 6 of the task asks whether one interaction with an immediate confirmation could avoid
keeping authentication material across UI operations. It cannot without dropping the preview,
which is option C. Option E keeps no authentication material across operations. What crosses
them is a capability (the token) and ciphertext under a key that already lives there.

## 3. User-visible sequence (German / English)

Section title unchanged: "Wiederherstellen: Tresor durch eine verschlüsselte Sicherung
ersetzen" / "Restore: replace the vault with an encrypted backup".

**Step 1: one form**

- Fields: Sicherungsdatei / Backup file, Export-Passwort / Export password,
  Master-Passwort / Master password.
- Button: „Sicherung prüfen“ / "Check backup".
- Note: „Prüfen ändert noch nichts.“ / "Checking changes nothing yet."
- Errors appear in one status line directly under the button. The line is scrolled into view
  (`block: "nearest"`), and the focus moves to the field at fault:
  - wrong export password or damaged file → export password field (`aria-invalid`);
  - wrong master password → master password field.
- Only the field at fault is cleared. **The file stays selected.**

**Step 2: preview** (replaces the step 1 status; the form collapses to one line „Datei
`name.json` · geprüft“ with „Andere Datei wählen“ / "Choose another file")

- Heading „Vorschau“ / "Preview", focused and scrolled into view.
- Counts: „Aktuell 30 Einträge · Sicherung 28 Einträge · in beiden 26“.
- „Nur in deinem aktuellen Tresor (4): …“ and „Nur in der Sicherung (2): …“, at most 20 names
  each.
- „Dein jetziger Stand wird als verschlüsselte Kopie aufbewahrt und lässt sich unter
  „Vorheriger Tresorstand“ zurückholen.“ If a kept copy exists already: „Die ältere Kopie vom
  … wird dabei ersetzt.“
- Buttons: **„Tresor jetzt ersetzen“ / "Replace vault now"** and „Abbrechen“ / "Cancel".
- For an empty vault the button reads „Einträge wiederherstellen“ / "Restore entries", and step
  3 is skipped: nothing is lost.

**Step 3: one confirmation** (native `<dialog>`, modal, `role=alertdialog` semantics)

- „Tresor jetzt ersetzen? Deine 30 aktuellen Einträge werden durch die 28 Einträge der Sicherung
  ersetzt. Der jetzige Stand bleibt als verschlüsselte Kopie erhalten.“
- Buttons: „Ersetzen“ / "Replace" and „Abbrechen“ / "Cancel". The initial focus is on
  „Abbrechen“ (WAI-ARIA alert dialog pattern for destructive actions). Escape cancels; the
  preview stays.
- No checkbox and no password.

**Result:**

- Exactly one message in the section's status line, scrolled into view and focused: „Tresor
  ersetzt: 28 Einträge aus der Sicherung. Der vorherige Stand (30 Einträge) lässt sich unter
  „Vorheriger Tresorstand“ zurückholen.“
- The preview closes.
- A conflict, expiry or lock shows one message in the same place, and the preview closes, for
  example „Der Tresor wurde inzwischen geändert. Bitte erneut prüfen.“

Only one live region holds text at a time (`say()`, unchanged).

## 4. Guarantees: before and after

| Guarantee | 0.9.4 | Version 2 |
|---|---|---|
| Fresh master password proof | At apply | At check, ≤180 s before the write, bound to session, generation and revision |
| Backup authenticity | AES-GCM with the export password, at check and again at apply | AES-GCM with the export password at check; at replace, AES-GCM of the staged copy under the session key with the binding AAD, plus digest and count |
| Previewed file = written content | File hash + count | Stronger: the exact previewed accounts are written; the file is not read again |
| Revision / concurrent modification | Checked at apply | Unchanged (step 3 of replace) |
| Session expiry, lock, password change | Pending dropped by `wipe()` | Unchanged, plus 180 s lifetime and single use |
| Atomic replacement, rollback, unknown outcome | `keepPrevious` + `commitAccounts` | Unchanged |
| Previous vault recoverable | Yes | Yes, unchanged |
| Explicit destructive confirmation | Checkbox + button | Modal dialog + button. The service enforces the token, not the dialog |
| No secret outside memory | Yes | Yes. `storage.session` is memory-only in Firefox and already holds the session key |

### New risks and their mitigation

1. **The authorization is not at the moment of writing.** Within 180 s after a successful
   check, a person at the unlocked computer with that options tab open could press „Ersetzen“.
   - Mitigations:
     - short lifetime;
     - the token lives only in that tab;
     - single use;
     - any lock ends it;
     - the previous vault stays recoverable.
   - Today the same person could change entries in that tab without any password.
2. **Decrypted backup content exists for up to 180 s** as ciphertext under the session key.
   - It has the same protection class as the vault and session key already in
     `storage.session`.
   - Only the background reads it; no page ever receives it. B0 observation 1 (copies held by
     pages survive a lock) therefore does not apply.
3. **Size in `storage.session`.** The blob is bounded by `MAX_IMPORT_ENTRIES` (1000 validated
   entries, far below the Firefox `storage.session` quota). Version 2 refuses staging above a
   fixed limit (proposed 2 MB).
4. **The confirmation dialog is UI only.** Security does not depend on it: without the token and
   a valid pending operation, nothing is written.
5. **Out of scope:** "Vorherigen Tresor wiederherstellen/verwerfen" still ask for the master
   password and a checkbox. They could follow the same pattern later; that is a separate
   decision.

## 5. Test plan

Unit tests run on the service in Node, with an injected storage, clock and alarms. Every check
also asserts that nothing was written, unless the case is the success path.

| Case | Expected |
|---|---|
| Happy path (populated vault) | Replaced; previous kept with the old count; `pendingReplace` removed |
| Happy path (empty vault) | Restored; no previous copy |
| Wrong export password | `import-decrypt`; nothing staged; the file remains usable for a retry |
| Wrong master password | `current-password`; nothing staged |
| Both wrong | `current-password` (checked first) |
| Damaged or too large file, too many entries | Specific error; nothing staged |
| Missing, wrong or reused token | `conflict`; nothing written; pending removed |
| Replace after 180 s (fake clock) | `expired`; nothing written; pending removed; the alarm also removes it |
| Lock, auto-lock deadline or idle lock between check and replace | `locked`; `pendingReplace` gone from `storage.session` |
| Password change or new unlock (other session id or generation) between check and replace | `locked`/`conflict`; nothing written |
| Another write (account added in the popup) between check and replace | `conflict` (revision); nothing written |
| Two replace requests racing | Exactly one succeeds; the other gets `conflict` |
| Event page restart between check and replace (new service, same storage) | Replace succeeds |
| Tampered `staged` blob or changed AAD fields | `conflict`; nothing written |
| `storage.session` after the check | Contains no password, no export key, no plaintext secret, no plaintext account name (scan for the synthetic values) |
| Interruption: failure injected in `keepPrevious`, in the commit, and a kill during the commit (existing fault harness) | Nothing written / previous intact / outcome `unknown` handled as today; recovery on next unlock |
| Staging size limit | Refused above the limit |

Browser tests run in the local suite and in CI on 5 platforms, in German and English.

| Case | Expected |
|---|---|
| Restore section at the bottom of the viewport, wrong export password | Error in view; focus on the export password field; file still selected; master password field kept |
| Wrong master password | Focus on the master password field; file still selected |
| Successful check | Preview in view, focus on its heading; exactly one filled status; step 1 messages gone; no `role=alert` |
| „Tresor jetzt ersetzen“ → dialog → Escape | Nothing changed; preview and token still valid |
| Dialog → „Ersetzen“ | One success message in view and focused; preview closed; previous vault box shown; entries equal the backup |
| Choose another file after the check | Preview closed; `pendingReplace` removed |
| Cancel | `pendingReplace` removed |
| Reload the page after the check | No preview; a direct `replaceApply` without the token is refused; blob removed at expiry (short TTL in the test build) |
| Lock during the preview | Preview closed; one message |
| Expiry while the preview is shown | Button disabled; one message „Prüfung abgelaufen …“ |
| 200 % zoom, 360 px | No horizontal overflow; dialog fits |
| Existing tests | F2-2, R-1, F3-3, N4 updated to the new flow; U-8 in the signed update test updated |

Manual (operator, next signed test build): the whole flow in the disposable profile, and
screen-reader announcements of the dialog and the messages.

## 6. Scope of the implementation (after approval)

| Area | Change |
|---|---|
| `src/lib/service.js` | `replacePreview` takes `masterPassword`; returns `token`; stages the sealed accounts. `replaceApply` takes only `{ token }`. Alarm `replace-expiry` |
| `src/background.js` | Alarm handler for `replace-expiry`; message validation for the new fields |
| `src/options/*` | Step 1 with three fields, preview, `<dialog>`, focus and scroll handling, file kept on error; new strings de/en |
| Tests | Unit and browser tests per §5; update test U-8 |
| Docs | ARCHITECTURE (#25 section), USER-GUIDE, evidence |

Vault format, export format, KDF parameters, `keepPrevious` and `commitAccounts` are unchanged.
No new permission is needed.

## 7. Follow-up proposal: "Restore previous vault" and "Discard previous vault" (operator decision 4)

**Approved and implemented in PR #38.** Evidence: [evidence/previous-dialogs/](evidence/previous-dialogs/README.md).
Deviations: the dialog texts give the date and both counts; after a successful restore the
focus returns to the restore button (the message is in view). After the 0.9.5 acceptance
(UX polish): the discard button in the box is neutral, only the dialog's "Endgültig löschen"
is red; a successful check shows "Sicherung erfolgreich geprüft …" above the preview; from
30 days on, the box shows an orange "Hinweis" about the age of the previous state (it is
never deleted automatically).

Today both actions share one form: a checkbox ("I understand: restoring replaces …;
discarding deletes … for good"), the master password, and two submit buttons. That repeats
the patterns the operator rejected for the replacement.

**Proposal:**

| | Restore previous vault | Discard previous vault |
|---|---|---|
| Effect | Swap: the previous state becomes current, the current one becomes the kept copy. Nothing is lost | Deletes the kept copy for good. Irreversible |
| Authorization | Master password once, in the box | Master password once, in the box |
| Confirmation | Modal dialog „Vorherigen Tresorstand zurückholen? Deine 28 aktuellen Einträge werden zum vorherigen Tresorstand.“ (focus on Cancel) | Modal dialog „Vorherigen Tresorstand endgültig löschen? Das kann nicht rückgängig gemacht werden.“ (focus on Cancel); the confirm button is styled as destructive |
| Checkbox | None | None: the dialog is the explicit confirmation |
| Result | One message in the box, in view | One message in the box, in view; the box closes |

**Service.** Unchanged in substance: both keep `authorizeSensitive(masterPassword)` and
`confirmed: true` at the moment of the action. Both actions authenticate and write in the
same request, so no pending state or token is needed. The dialog only sets `confirmed`. The
password is typed before the dialog opens and sent with the confirmed request. It is held
in the field, not in a script variable, until the answer arrives.

**Tests.** Wrong password (field cleared and focused, in view), Escape in each dialog changes
nothing, restore swaps and reports both counts, discard deletes and closes the box, a lock
while the dialog is open refuses, keyboard-only operation, German and English.
