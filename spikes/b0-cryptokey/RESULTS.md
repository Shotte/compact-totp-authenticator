# B0-1 Spike: non-extractable CryptoKey in `storage.session`

**Result: PASS (10/10 checks) on Firefox 160.0.1, Windows 11, 2026-11-18.**
Run twice with identical verdicts; evidence of the last run:
[results/firefox-160.0.1.json](results/firefox-160.0.1.json).

## Setup

- Test extension: [extension/](extension/) (MV3, event page as ES module, permissions
  `storage`, `alarms`; separate spike ID, never the product ID).
- Driver: [run-spike.mjs](run-spike.mjs). Starts Firefox with a throwaway profile and talks to
  the built-in WebDriver BiDi endpoint (`--remote-debugging-port`) using Node's built-in
  `WebSocket`. No geckodriver, no npm dependencies.
- Test-profile prefs: fixed moz-extension UUID, `extensions.background.idle.timeout = 3000`
  (forces event page suspension within the test), `extensions.openPopupWithoutUserGesture.enabled`
  (lets the test open the real toolbar popup).
- Data: a fresh random AES-256-GCM key per run and the synthetic probe string
  `synthetic-probe-not-a-secret`. No real secrets anywhere.

Reproduce: `npm run spike:b0` (Firefox path as optional argument).

## Results

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | `generateKey(AES-GCM 256, extractable=false)` | PASS | `extractable:false`, `exportKey raw/jwk` and `wrapKey` → `InvalidAccessError` |
| 2 | Store in `storage.session`, nested in an object and as a top-level value | PASS | `set()` resolves; `get()` returns `[object CryptoKey]`, decrypts the probe |
| 3a | Retrieve after the page is destroyed and a new page loads | PASS | same checks in the new page |
| 3b | Retrieve in the real toolbar popup, opened and closed twice | PASS | two popup instances, both decrypt |
| 4 | Use after event page suspension and restart | PASS | new background `instanceId` without reload; key retrieved and decrypts there |
| 5 | Non-extractable in every context (page, popup, restarted background) | PASS | all export/wrap attempts fail, `extractable:false` |
| 6 | Removed on lock (`storage.session.remove`) | PASS | `undefined` in the page, in the background and in a new page; gate rejects |
| B0-2a | Deadline enforced without any alarm (simulated missed alarm) | PASS | after deadline: `locked:expired`, session wiped; `touch` cannot revive |
| B0-2b | Alarm (`when = deadline`) wipes the key while the extension is idle | PASS | alarm woke a fresh event page, `alarm-lock` logged, session `null` |
| 7 | `runtime.reload()` clears `storage.session` | PASS | marker and session gone after reload |

## Observations and limitations

1. **Copies held in memory survive a lock.** A page that read the key before the lock can
   still decrypt with its copy (`heldCopyStillUsable: "OK"`). `storage.session.remove()`
   only removes the stored value; it does not revoke `CryptoKey` objects already
   deserialized into a realm. → Architecture rule: only the background touches the key, it
   re-reads it through the gate for every operation and never caches it.
2. **`runtime.onSuspend` is not reliable for cleanup.** An async storage write in the
   `onSuspend` handler never completed in any run. Locking must never depend on it.
3. **Event page restarts are frequent** (5 starts in a ~30 s run with a 3 s idle timeout).
   Default timeout is 30 s; state must live in `storage.session`, never in module globals.
4. **Browser restart not tested.** A temporary add-on is removed on restart in release
   Firefox, and unsigned permanent installs are blocked. MDN states session storage "is
   cleared" when the browser stops and is "not persisted to disk". Status: `not_tested`
   here; covered by the documented API contract, by test 7 as a proxy, and by an explicit
   `storage.session.clear()` in `runtime.onStartup` (design rule). Re-test with the signed
   build in Phase D.
5. **`setAccessLevel` is not implemented in Firefox** (open bug 1724754); session storage is
   not exposed to content scripts by default. CTA has no content scripts.
6. **Not tested:** behaviour under memory pressure or crash dumps, other Firefox versions
   (ESR 140), Firefox for Android.
7. Driver needs `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` for BiDi script evaluation in
   `moz-extension://` pages, and BiDi refuses `browsingContext.navigate` to
   `moz-extension://` URLs. Both affect only the test harness.
