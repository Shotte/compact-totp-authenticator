# Phase C3 evidence (session security)

Spec: [SECURITY.md §12](../../SECURITY.md). Synthetic accounts and passwords only.

## Unit and regression tests

[`test/session-c3.test.mjs`](../../../test/session-c3.test.mjs), 18 tests, part of `npm test`.

| Area | Covered |
|---|---|
| Expiration (C3.1) | 15-minute default; reads and code refreshes never move the deadline; a shorter setting applies at once or locks if already exceeded; a longer setting never extends without activity and applies from the next activity; no revival by settings writes or activity; expiry across event-page restarts; backwards clock; expiry while an operation runs (deadline passes after the gate admitted it); stale session ID after a re-unlock |
| Fresh password (C3.3) | `authorizeSensitive`: exactly one PBKDF2 against the current vault; wrong, missing or non-string passwords fail without writing or locking; the session's own `CryptoKey` is rejected; not reachable through messages; locked or expired session fails before PBKDF2; lock during PBKDF2 aborts; stale key generation wipes the session; password change still requires the current password |
| Idle lock (C3.4) | Off by default; locks only on `idle`/`locked` and only when enabled |
| Recovery (C3.5) | `restore` never replaces a current vault that still opens, even with the right password and confirmation |

Mutation checks (each must fail at least one test, all did): removing `recheck` in
`getCodes`, letting a longer setting extend the session, removing `recheck` or the
generation check in `authorizeSensitive`, ignoring the setting in `activity`, ignoring the
setting in the idle handler.

## Firefox integration (C3-1 … C3-4)

[`browser-results-local.json`](browser-results-local.json): Firefox 160.0.1, Windows 11,
headless. Result 71/76 PASS, 0 failed, 5 NOT_TESTED (real toolbar popup, unavailable
headless). CI results for Windows, Linux and macOS are in the pull request.

| Check | Local result | Details |
|---|---|---|
| C3-1 graceful quit + restart: locked, `storage.session` empty, `getCodes`/`listAccounts`/`activity`/`importPreview` → `locked`, popup asks for the password, vault byte-identical, opens with the password, no secrets or passwords in responses | PASS | session keys after restart: none |
| C3-2 auto-lock setting changed in the options UI: 15 → 1 min applies at once (same session ID, same last activity, deadline = last activity + 60 s); 1 → 30 min leaves the deadline unchanged | PASS | |
| C3-3 popup refresh across a TOTP period boundary does not move the deadline | PASS | 3/3 codes changed, deadline identical |
| C3-4 idle lock: trusted click on the checkbox grants `idle` without a prompt; with 1 min idle time and no input the session is wiped; unchecking removes the permission | PASS | locked 40 s after the unlock message, about 60 s after the last real input |

Hard-kill restarts remain covered by C2-6/C2-7/C2-8, B6 checks by B6-1 … B6-5 (all PASS
in the same run).

## Manual review

- Idle lock on real desktops with a user away from the keyboard (Windows, macOS, Linux
  X11/Wayland): MANUAL_REVIEW.
- Real toolbar popup with real mouse input (`npm run test:browser:os`): not run for C3;
  C3 changes no popup code.
