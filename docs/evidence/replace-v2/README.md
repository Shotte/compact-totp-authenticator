# #25 V2: simpler vault replacement – evidence and security review

The operator acceptance of the signed 0.9.4 failed on the replacement's usability (#25, F3-3).
The operator approved the V2 architecture in [../../PLAN-25-REPLACE-V2.md](../../PLAN-25-REPLACE-V2.md):

- decision 1: architecture approved;
- decision 2: lifetime at most 180 s;
- decision 3: focus on Cancel.

This directory holds the evidence of the implementation. All data is synthetic. Nothing was
signed, tagged or published.

## Environment

- Local run: Windows 11, Firefox **160.0.1** (release), German UI, visible browser, throwaway
  profiles. The operator was working in parallel.
- CI run 44970538624 on PR #37: five browser jobs (Windows, macOS, Linux release, ESR latest,
  ESR 140) and two unit jobs, all passing.

## Results

| Check | What it covers | Local | CI (5 platforms) |
|---|---|---|---|
| `npm test` | 245 unit tests, including 22 in `replace.test.mjs` (list below) | 245/245 PASS | PASS |
| Lint | `web-ext lint` | 0 errors, 0 warnings | – |
| R-1 | Replacement through the UI (see below) | PASS | PASS |
| F3-3 | Focus, scrolling and dialog semantics (see below) | PASS | PASS |
| F2-2 | Errors of the check (see below) | PASS | PASS |
| R-3 | Pending replacement in real Firefox (see below) | PASS | PASS |
| R-2 | Hard termination of Firefox during the replacement | PASS | PASS |
| C4-4 | Restore into an empty vault after a browser restart | PASS | PASS |
| N4 | Native Windows Open dialog with the complete V2 flow (dialog focus on Cancel) | PASS (`native-dialogs-windows.json`, N1–N5 5/5) | – (Windows only) |
| U-8 | Replacement after an update (unsigned simulation in CI, V2 API) | – | PASS |
| Whole suite | `browser-results.json` | 109/112 PASS, 0 FAIL, 2 MANUAL, 1 NOT_TESTED (see below) | 101–106 PASS, 0 FAIL per job; NOT_TESTED as on `main` |

**R-1:**
- one check with both passwords;
- the preview shows counts, the entries only in the vault, the entries only in the backup,
  and the kept-copy note;
- one dialog, without checkbox or password;
- Escape changes nothing;
- a forged token is refused;
- the replacement succeeds, and the previous vault is kept and restored;
- the destination master password is unchanged.

**F3-3:**
- After the check, the preview is in view and focused. No other message is shown, there is no
  `role=alert`, both password fields are empty, and the file is kept.
- The dialog is `:modal`, has `role=alertdialog`, is labelled and described, and the focus
  starts on Cancel.
- Escape returns the focus to "Replace vault now".
- On success: exactly one message, in view, with both counts. The preview closes and the focus
  moves to the section heading.

**F2-2:**
- The form sits at the very bottom of the window when the check fails. A wrong master
  password and a wrong export password each produce their own message, which is in view.
- Only the field at fault is cleared, focused and marked `aria-invalid`.
- The other password and the file stay.
- A lock meanwhile shows the locked view.

**R-3:**
- The pending replacement survives a **real event-page suspension** (`startedAt` changed) and
  then replaces.
- A lock removes the pending data **and** its key, and the old token is refused after
  unlocking.
- Cancel, choosing another file, leaving the page and the expiry each remove the pending data
  and its key. The expiry shows the expiry message.
- After a change in another tab, the confirmation is refused with the conflict message, and
  both the local and the other tab's entries are intact.

**R-2:** Firefox is killed after the kept copy, after the rollback copy and after the new
vault, plus a control run. Each time the result is either the old or the new entries, never a
mix, and the previous vault is kept.

Screenshots (synthetic names only):
- [`replace-preview-de.png`](replace-preview-de.png): form and preview;
- [`replace-dialog-de.png`](replace-dialog-de.png): the confirmation dialog.

The other files are the suite's regular output from the same run.

**Not run or not passed locally:**
- B3-real-4 (real popup click): MANUAL.
- C4-8: MANUAL, covered by N1–N3.
- T-2 focus ring: NOT_TESTED, because the test window was not active (operator working in
  parallel).

Unrelated to #25.

### Unit tests (`test/replace.test.mjs`)

- Empty and populated vault.
- Wrong, missing and both-wrong passwords; the master password is checked first.
- Damaged, malformed and oversized backups (2 MB, with a real 1.7 MB secret).
- Expiry:
  - valid at 179.999 s, refused at 180 s;
  - never valid again, also with the clock set back;
  - a pending replacement from the future is refused;
  - checked again right before the write (expiring during the replacement writes nothing).
- The expiry alarm only cleans up.
- Lock, auto-lock, idle lock, password change and a new unlock each invalidate it.
- Leftover pending data stays unusable after a lock even without cleanup, also with a forged
  session id.
- Wrong, missing and replayed tokens. The first attempt consumes the operation.
- Cancel and a new check.
- A concurrent change in another tab.
- Two parallel replace requests: exactly one succeeds.
- An event-page restart in between.
- Tampered contents, count or expiry.
- The check is not an activity.
- A storage failure before or during the write: nothing replaced, previous copy intact.
- Termination at every write boundary: old or new contents, never mixed.
- Restore, discard, and a password change only with consent.
- No password, token, secret or entry name in plain text in `storage.session`,
  `storage.local` or any response.

## Security review

**Secrets in memory.**

| Material | Where | How long |
|---|---|---|
| Export password, master password (plaintext) | The form field, then one message, then the background request | Until the check answers. The fields are cleared on the answer; nothing stores them |
| Keys derived from both passwords | Local variables of the check request | That request |
| Backup accounts in plaintext | Background memory | The check request only |
| Sealed backup accounts | `storage.session.pendingReplace` (AES-GCM, ≤ 2 MB) | Until replace, cancel, ≤ 180 s, lock or session end |
| Sealing key (random, non-extractable, one per check) | `storage.session` session record only (`replaceKey`) | Deleted with every lock or session end; a new session never has it |
| Token (128 bit) | Options page script variable; the background keeps only SHA-256 | Until replace, cancel, page close; worthless after ≤ 180 s |

Nothing reaches `storage.local`, logs, URLs or the history. `storage.session` is memory-only in
Firefox and is cleared on browser start (`onStartup`).

**Bindings checked at the replacement.**
- Session id and key generation.
- Token hash.
- `createdAt ≤ now < expiresAt`, at the start and again right before the write.
- The sealed copy authenticates under its key with all bindings as additional data.
- The entry count.
- The vault revision, read with the session key right before the write.

The operation is consumed before any of these checks, so it is single use.

**Write path unchanged:**
- `keepPrevious` writes the verified encrypted copy;
- then `commitAccounts` runs: atomic, read-back verify, rollback, `reconcile`, and an honest
  `unknown` outcome;
- the recovery of a damaged vault is unchanged.

**New risks:**
1. The master password is verified at the check, up to 180 s before the write. A person at the
   unlocked computer with that tab open could confirm in that window.
   - Mitigations: the short lifetime, single use, the token lives only in that tab, any lock
     ends it, and the previous vault stays recoverable.
   - Entries in that tab can already be changed without a password.
2. The decrypted backup exists for up to 180 s as AES-GCM ciphertext in `storage.session`.
   - Its key sits in the same memory-only area, like the session key.
   - Only the background reads it; pages never receive it.
3. A dialog bypass gives nothing: the service decides on the token, not on the dialog.
4. `pagehide` cleanup is best effort. If it does not run, the token is gone with the page, and
   the data is removed by the next check, a lock or the expiry alarm.

**Deviations from the reviewed proposal** (documented in the plan):
- A per-check random sealing key instead of the session key, which is password-derived and
  returns after a new unlock.
- No separate digest; the AAD bindings make it unnecessary.
- A failed write also consumes the token.
- The check form stays visible after the check; the proposed collapse to one line was not
  built. The password fields are empty, the file stays selected, and the preview below is
  focused.

## Still manual (operator, next signed test build)

- Screen-reader announcements of the dialog, the preview and the messages. The roles and
  labels are checked automatically; the spoken output is not.
- The look and the readability of the flow, and real Ctrl+Plus zoom.
- The whole flow in the disposable profile, following an updated checklist that is written
  with the next test build.
- Not part of this PR: the previous-vault actions (decision 4), proposed in §7 of the plan.
