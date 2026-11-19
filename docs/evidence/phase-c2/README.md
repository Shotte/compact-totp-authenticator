# Phase C2 evidence (master password, persistent vault)

Firefox 160.0.1, Windows 11, real mouse input (`npm run test:browser:os`), 2026-11-19.
Synthetic accounts and synthetic test passwords only (none appear in the results).

Result: **74/74 PASS** ([browser-results.json](browser-results.json)) – the full Phase B
regression (layout matrix 37/37, real toolbar popup, copy, hover, locking) plus:

| Check | Result |
|---|---|
| C2-1 setup via UI: 12+ characters (service-enforced), confirmation, unlock, inputs cleared | PASS |
| C2-2 popup unlock; wrong passwords rejected; `storage.local` byte-identical | PASS |
| C2-3 latency; forged 10M-iteration header fails, UI responsive; oversized rejected before PBKDF2 | PASS |
| C2-4 password change via UI: immediate lock, old key/password dead, no rollback, NFD input unlocks | PASS |
| C2-5 damaged vault: recovery offered without writing, confirmation + password required | PASS |
| C2-6 hard kill + restart: locked, `storage.session` empty, vault persists | PASS |
| C2-7 kill 400 / 1200 ms into write bursts: vault opens, data consistent | PASS |
| C2-8 kill 100 / 350 / 800 ms into password changes: exactly one password works, data intact | PASS |

Unlock timing: cold 126 ms, wrong password 116 ms per guess, cached repeat 3–5 ms,
forged 10M header 1.87 s (see SECURITY.md §11.3). Restart tests use
`extensions.webextensions.keepStorageOnUninstall` so the temporary add-on keeps its
storage across a reinstall; the browser is killed hard (taskkill / SIGKILL).

## C2 review: authentication scenarios and repeated-unlock timing

[`auth-review-results.json`](auth-review-results.json): headless run, Firefox 160.0.1,
Windows 11, after the review checks were added. Result: 67/72 PASS, 0 failed, 5 not tested
(the real toolbar popup is unavailable headless; covered by the 74/74 run above, which
predates C2-9/C2-10).

| Check | Result |
|---|---|
| C2-9 scenarios 2–10 on real storage, plus an identical wrong guess repeated three times: wrong passwords fail with `storage.local` byte-identical, correct ones open | PASS |
| C2-10 instrumented experiment: one PBKDF2 call per derivation; only byte-identical input is fast, also with raw Web Crypto | PASS |

| Attempt | Time |
|---|---|
| New wrong guess (scenarios 2–8) | 119–170 ms each |
| Correct password, already derived in this process | 6–10 ms |
| First attempts after a browser restart (wrong / correct) | 125 / 123 ms |
| Old password after rotation (new salt) | 164 ms |
| Identical wrong guess, 3× | 118 / 6 / 8 ms, all fail |
| C2-10: first, different password, different salt, iterations + 1 | 111–112 ms |
| C2-10: identical input, new string instance, NFD, raw repeat | 0–1 ms |

Root cause and assessment: [SECURITY.md §11.7](../../SECURITY.md); unit-level proof that
every attempt derives: [`test/auth-invariant.test.mjs`](../../../test/auth-invariant.test.mjs).
