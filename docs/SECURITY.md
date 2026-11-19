# Security

Status: design, amended by B0 (CTA-001-B0). Product code is not implemented yet; the lock
policy and the CryptoKey storage behaviour are verified by the B0 spike
([spikes/b0-cryptokey/RESULTS.md](../spikes/b0-cryptokey/RESULTS.md)).

## 1. Upstream weaknesses (commit `fd07df3`)

| # | Weakness | Location | Impact |
|---|---|---|---|
| U1 | "Encryption" is a Vigenère cipher over a 65-character alphabet with the password as repeating key; no IV, no integrity | `crypt.js` | Base32 plaintext uses only 32 of 65 symbols, so each ciphertext character narrows the password character; with several keys the password and all secrets are recoverable in seconds. Effectively obfuscation. |
| U2 | Password verifier is a single SHA-256 of `password + extension UUID`, stored in `storage.local` | `loader.js`, `options.js` | Fast offline brute force; UUID is readable from the profile. |
| U3 | Encryption optional; default is no password | `options.js` | Secrets stored in plaintext in the Firefox profile. |
| U4 | Decrypted secrets logged: `console.log(item, tab)` per row, `console.log(res.otp_list)` | `loader.js:57`, `options.js:279` | Secrets in browser console / logs. |
| U5 | Plaintext export kept permanently in a `data:` URL on the options page | `exportSettings()` | Secrets sit in the DOM whenever options are open. |
| U6 | Import clears storage and writes the raw file | `importSettings()` | Silent data loss; arbitrary storage keys (e.g. `hash`) can be injected. |
| U7 | "Forgot password" resets the hash but leaves encrypted keys | `reset.js` | Silent corruption of all secrets. |
| U8 | Characters outside the alphabet map to index −1 → wrap | `crypt.js` | Some passwords silently weaken or break encryption. |
| U9 | `tabs` permission for a cosmetic feature | `manifest.json` | Unnecessary broad permission. |
| U10 | Secrets stored in the popup DOM (`data-key` attribute per row) | `loader.js` | Secrets readable from the DOM for the popup's lifetime. |

Good parts: no network access, no remote code, DOM built with `innerText`.

## 2. Threat model

Protected assets: TOTP secrets and account names (the account list reveals which services
use 2FA).

| Threat | In scope | Mitigation |
|---|---|---|
| Profile files copied (backup, theft, sync, malware reading disk while locked) | yes | AES-256-GCM vault, PBKDF2 key, no plaintext persistence (§3, §6) |
| Encrypted export leaked | yes | Same crypto as the vault; plaintext export only after explicit confirmation (§8) |
| Tampering with stored vault/export (incl. lowering KDF parameters) | yes | GCM tag; all security-relevant metadata authenticated as AAD (§6) |
| Secrets in console, logs, telemetry, network | yes | No logging of account data, no network, no telemetry; grep gate |
| Unlocked session left alone, missed or delayed alarm | yes | Fail-closed deadline gate on every sensitive operation (§5) |
| System clock moved backwards to extend a session | yes | Gate rejects `now < lastActivity` (§5) |
| Data loss through failed import, password change or write | yes | Commit protocol with verification and rollback (§7) |
| Web pages / content scripts reading extension state | yes | No content scripts; `storage.session` not exposed to content scripts by default |
| Malware running as the user while unlocked, keyloggers, compromised Firefox, memory dumps | **no** | Out of scope for any browser extension; documented |
| Clipboard history after copying a code | partial | Codes expire after the period; no clipboard clearing (needs read permission) |

Keeping TOTP secrets in the same browser as passwords reduces the independence of the
second factor. This is a conscious user choice and is documented in the README.

## 3. Cryptographic parameters

Verified 2026-11-18 against the sources in §10.

| Parameter | Value | Basis |
|---|---|---|
| Cipher | AES-256-GCM (Web Crypto), 128-bit tag | NIST SP 800-38D; the 2026 Rev. 1 draft removes tags < 96 bits, we use 128 |
| Nonce | Fresh 96-bit value from `crypto.getRandomValues` for **every** encryption; never derived, never a counter, never reused | SP 800-38D: random 96-bit IVs allowed up to 2^32 encryptions per key. CTA performs one encryption per save (orders of magnitude below). |
| KDF | PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte random salt | OWASP Password Storage Cheat Sheet: "600,000 iterations (recommended)" |
| Key | `deriveKey(..., extractable=false, ["encrypt","decrypt"])` | B0-1: non-extractable key survives `storage.session` |
| Password check | Successful GCM decryption; no separate verifier stored | Avoids a fast offline oracle |
| Master password | Mandatory, at least 12 code points (C2, §11.1), confirmation, no character-class rules, no recovery | Loss of password = loss of vault; encrypted export is the backup |

Argon2id (OWASP minimum m=19 MiB, t=2, p=1) is stronger against GPUs but not in Web Crypto;
it would need third-party WASM and `wasm-unsafe-eval`. Kept as a future option: `kdf.name`
in the authenticated header allows migration on the next unlock.

No home-made primitives. TOTP itself (RFC 6238) is HMAC via Web Crypto.

## 4. Key handling during an unlocked session

The popup is destroyed whenever it loses focus, so the key must outlive it.

**Decision (B0-1 PASS):** after unlock the non-extractable AES `CryptoKey` is stored inside
the session record in `browser.storage.session`. The B0 spike showed on Firefox 160.0.1
that this key:

- survives popup close/reopen and event page suspension/restart,
- stays non-extractable in every context (`exportKey`/`wrapKey` → `InvalidAccessError`),
- is gone from every context after `storage.session.remove()`.

Rules derived from the spike observations:

1. **Only the background event page reads the key.** Popup and options page never receive
   the key, the decrypted vault or any secret (§9). Reason: a copy already deserialized into a
   page realm stays usable after the lock (spike observation 1).
2. **No caching.** The background obtains the key through the gate (§5) for each operation
   and keeps no module-level reference to the key or decrypted data. Event pages restart
   often; state lives only in `storage.session`.
3. **No exportable key material anywhere.** The password is never stored; raw key bytes
   never exist outside Web Crypto.
4. **Locking never relies on `runtime.onSuspend`** (async work there does not complete).
5. **Browser restart:** `storage.session` is memory-only and cleared when the browser stops
   (MDN). Additionally `runtime.onStartup` calls `storage.session.clear()`.

Rejected alternatives: password on every popup open (unusable); MV2 persistent background
(no longer needed); raw key bytes in `storage.session` (exportable material, explicitly
excluded); IndexedDB (persists to disk).

Residual risk: while unlocked, key material is in Firefox process memory (possibly swap or
crash dumps). Accepted and documented.

## 5. Lock deadlines (B0-2)

Implemented and unit-tested in
[spikes/b0-cryptokey/extension/session-policy.js](../spikes/b0-cryptokey/extension/session-policy.js),
browser-verified in the spike (checks B0-2a/b).

Session record in `storage.session`:
`{ key: CryptoKey, timeoutMs, lastActivity, deadline }` with
`deadline = lastActivity + timeoutMs`.

- **Validity:** `lastActivity <= now < deadline`, and `deadline === lastActivity + timeoutMs`.
  Anything else (`none`, `expired`, `clock`, `invalid`) fails closed.
- **Gate:** every sensitive operation (account access, code generation, vault modification,
  export) first calls `requireSession()`. If the check fails, the gate removes the session
  and throws `locked`. The alarm is only a cleanup accelerator; correctness does not depend
  on it firing.
- **Non-extendable deadline:** the deadline moves only via `touch()` on a still-valid
  session, triggered by qualifying user activity. An expired session cannot be revived.
- **Qualifying activity:** successful unlock, user opening the popup, copying a code, user
  edits in the options page. Automatic code refresh and background events do **not**
  qualify.
- **Alarm:** `alarms.create("autolock", { when: deadline })` after every touch; on firing
  the background re-checks and wipes or re-arms.
- **Defaults:** 15 minutes (operator decision), configurable; always lock on browser
  restart (§4 rule 5). A changed setting applies to the running session as described in
  §12.1; the optional system-idle lock is in §12.4.
- **Clock:** wall-clock time (`Date.now()`) is required because the deadline must survive
  event page restarts. A backwards jump locks; a forward jump locks early (safe direction).

### 5.1 Implementation (Phase B, `src/lib/service.js`)

- `requireSession()` at the start of every sensitive command; `recheck()` after async work
  (decryption, code generation, encryption) and before any result is returned or written.
- An in-memory **epoch** is incremented synchronously by lock and unlock. An operation that
  started under an older epoch is rejected even if storage looks valid, and the epoch is
  checked again immediately before `storage.session.set` with no `await` in between.
  Storage calls from one context are assumed to execute in call order.
- The session record carries a random `id`; a re-unlock during an operation is detected.
- Regression tests: [test/service.test.mjs](../test/service.test.mjs) (expiry and lock
  during reads and writes, re-unlock, restart, clock rollback, alarm handler) and browser
  tests B6-1…B6-5 ([evidence](evidence/phase-b/README.md)).

### 5.2 Concurrent writes

- Read-modify-write sequences are serialized in the event page (promise chain).
- Every mutation carries the revision the UI last saw; a different current revision is
  rejected with `conflict` (the options page reloads and asks the user to retry).
- `writeVault` re-reads the stored revision right before writing (compare-and-set), so a
  write that happened in between is never overwritten silently.
- The revision is part of the AES-GCM AAD; a manipulated revision fails decryption.
- Phase C applies the same rules to the persistent vault in `storage.local`.
- Write outcomes (C4 review, decision 1): see §7.6.

## 6. Vault format (version 1)

`storage.local` keys: `vault` (current), `vault_backup` (previous revision, see §7),
`settings` (plaintext, no secrets).

```json
{
  "format": "cta-vault",
  "version": 1,
  "revision": 42,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<b64, 16 bytes>" },
  "cipher": { "name": "AES-GCM", "iv": "<b64, 12 bytes>", "tagLength": 128 },
  "ciphertext": "<b64>"
}
```

Implemented in C1: [`src/lib/vault.js`](../src/lib/vault.js), tests in
[`test/vault.test.mjs`](../test/vault.test.mjs).

- **AAD:** UTF-8 of `JSON.stringify([format, version, revision, kdf.name, kdf.hash,
  kdf.iterations, kdf.salt, cipher.name, cipher.tagLength])`. A fixed array, not object
  serialization, so the encoding is unambiguous. Any change to these fields makes
  decryption fail (tested per field). The IV is not repeated in the AAD: AES-GCM already
  authenticates it, and a changed IV fails the tag check (tested).
- **Reader rules (`validateVault`, before any decryption):** exact key sets at every level
  (unknown or missing keys rejected), `format === "cta-vault"`, `version === 1`, revision a
  safe integer ≥ 1, PBKDF2/SHA-256, iterations in [600,000, 10,000,000], salt exactly 16
  and IV exactly 12 bytes of valid base64, `AES-GCM` with a 128-bit tag, non-empty
  ciphertext. Errors are `VaultError` with a reason (`format`, `version`, `header`,
  `decrypt`, `payload`, `conflict`, `write`, `corrupt`); no error carries data.
- **Nonce:** `sealVault` draws a fresh 96-bit IV from `crypto.getRandomValues` on every
  call (via `crypto.js`). 10,000 seals of the same payload produce 10,000 distinct IVs and
  ciphertexts (tested). Expected volume is a few thousand saves per key over its lifetime,
  far below the SP 800-38D limit of 2^32 random-IV encryptions; the key changes with every
  password change (C2).
- **Plaintext payload:** `{ "accounts": [ { id, name, secret, url, algorithm, digits, period } ] }`.
  Names and URLs are encrypted too.
- **Encrypted export** (`format: "cta-export"`): same cipher and KDF rules with its own salt
  and IV and its own header and AAD; specified in §13.

## 7. Writes, backup and rollback

Goal: no failed write, password change or import may destroy the vault, lock the user out,
or let a wrong or old password change storage. Implemented in C1 as
`createVaultStore(area)` in [`src/lib/vault.js`](../src/lib/vault.js) (background only; wired
to `storage.local` together with the master password in C2, B0-3).

Storage keys: `vault` (current), `vault_backup` (a verified earlier copy, normally the
previous revision of the same key generation), `vault_next` (staged new-generation vault,
only while a rotation is in progress). Every step is a single-key write; operations are
serialized by an in-memory promise chain.

### 7.1 Key generations

The KDF salt identifies a **key generation**: every password (`create`, `rotate`) gets a new
salt, and the salt is authenticated in the header. The salt is only an identifier; a key
counts as verified solely after it has authenticated a ciphertext of that generation. An
AES-GCM failure alone never distinguishes "wrong key" from "damaged ciphertext", so a
failure alone never changes storage.

### 7.2 Operations

| Operation | Guarantee |
|---|---|
| `create(key, payload, {kdf})` | First vault only (revision 1); refused (`exists`) if any vault copy exists. |
| `commit(key, payload, {expectedRevision})` | Compare-and-set on the revision (`conflict`), then the key must **open the current vault** (`auth`) – an unrelated key or a damaged vault is never overwritten. The new vault reuses the current KDF parameters, so a commit can never change the key. Steps: backup = current → vault = new → read-back verify → rollback on failure. A leftover `vault_next` is removed. |
| `rotate(oldKey, newKey, {expectedRevision, kdf})` | Password change. Old key must open the current vault; the new generation needs a new salt (`generation`). Steps below (7.3). |
| `load(key)` | **Read-only.** `ok` if the current vault opens. `recoverable` (with `source`, `revision`, `damage`, `generationVerified`) if the current vault does not open but a copy of the **same generation** does – the key is thereby verified, so the current copy is damaged. Otherwise `decrypt` (current header intact) or `corrupt` (header unreadable); nothing is written. |
| `restoreBackup(key, {allowUnverifiedGeneration})` | Explicit recovery after user confirmation. All checks are repeated at write time: refused while the current vault opens (`current-valid`, so a valid newer vault is never rolled back), never from a copy of another generation, and the newest verified same-generation copy wins. If the current vault's header is unreadable, its generation is unknown; recovery then additionally requires `allowUnverifiedGeneration: true` (separate, explicitly authorized confirmation). |

### 7.3 Password rotation and interruption

1. `vault_next` = new vault (new key, new salt), read-back verified – *stage*
2. `vault_backup` = current vault (old generation) – *rollback copy*
3. `vault` = new vault, read-back verified – *switch; completion point*
4. `vault_backup` = new vault – *old generation dropped*
5. remove `vault_next`

Which password opens the vault after an interruption (tested, "restart" = fresh store over
the remaining storage):

| Interruption | Old password | New password |
|---|---|---|
| before/while staging (step 1 fails or crashes) | opens | – |
| after staging, before the rollback copy | opens | – |
| after the rollback copy, before the switch | opens | – |
| switch write fails, storage usable (rolled back) | opens | – |
| switch write damaged, then crash (rollback impossible) | – | recoverable from `vault_next` (explicit restore) |
| crash after the switch write, before verification | – | opens |
| crash after verification, before the backup update | – | opens |
| backup update fails or is damaged | – | opens (`backupRefreshed: false`) |
| after successful rotation | – | opens |

In every case at least one password reaches the intact data. Once the switch (step 3) has
written the new vault, the old password can no longer restore anything: the remaining
old-generation backup belongs to another generation than the current vault, so recovery
refuses it even with `allowUnverifiedGeneration`. A leftover old-generation backup
(`backupRefreshed: false`) is replaced by the next regular commit.

### 7.4 Fault-injection and negative tests

[`test/vault.test.mjs`](../test/vault.test.mjs): wrong keys (intact and damaged vault),
different salts, valid primary with stale backup, damaged primary with valid same-generation
backup, damaged backup, both copies unreadable, structurally destroyed primary,
concurrent commit/rotate on one revision (exactly one wins), storage failures at every
step of commit and rotation (`set` throws, value lands damaged, storage dies before or after
a write). Mutation checks: removing the generation check fails 8 tests; removing the
"current vault still valid" check fails 1; ignoring the staged copy fails 1 (lock-out case).

### 7.5 Trade-offs and assumptions

- No automatic recovery: a damaged vault needs an explicit, confirmed restore. This costs a
  dialog but guarantees that no password attempt or decryption failure writes storage.
- A structurally destroyed current vault (header unreadable) cannot prove its generation.
  Recovery is still possible, but only with the separate `allowUnverifiedGeneration`
  consent. Residual edge: if that happens exactly after a rotation whose backup update
  failed, the confirmed restore could use the old-generation backup; it requires a storage
  failure at step 4, later structural destruction of the vault, and a double confirmation.
- Not provable in Node, to verify in the browser (C2/C6): a single `storage.local.set` of
  one key is atomic; a resolved `set` is visible to the next `get`; one event page instance
  writes at a time (compare-and-set limits a violation to `conflict`).
- Import (C5) and export recovery (C4) build on these operations.

## 8. Import and export

- Legacy `totp.json` import: see MIGRATION.md. Disabled in production builds until the vault
  (Phase C) is operational (B0-3).
- Export (C4): encrypted by default; unencrypted CTA format and legacy `totp.json` only
  after a warning and confirmation, legacy only when lossless. Specified in §13.

## 9. Separation of codes and secrets

- The background is the only context that decrypts the vault or generates codes.
- Popup message `getCodes` returns `[{ id, name, url, code, validUntil }]`, never secrets.
- Options page receives the account list without secrets. Secret fields are write-only
  (enter a new secret to replace it); no "show secret" in the first release.
- The DOM never contains secrets except transiently in an input while the user enters one.

## 10. Permissions, CSP, development rules, sources

- Permissions: `storage`, `alarms`, `activeTab`; optional `idle`. No host permissions, no
  `tabs`, `downloads` or `clipboardWrite`. `data_collection_permissions: { "required": ["none"] }`.
- Default MV3 CSP, no inline scripts, no `eval`, no remote code, no content scripts.
- Synthetic secrets only. Never log accounts, secrets, codes, keys or passwords. Gate before
  each phase: `console.` grep reviewed, fixtures checked.
- **B0-3:** satisfied by C2. Persistence is enabled only together with authenticated
  encryption and the master password; the Phase B `devUnlock` and its fixtures are removed
  from the product (fixtures live in `test/helpers/`; static test and package check). The
  legacy import apply step stays disabled until C5.

Sources (checked 2026-11-18):

- OWASP Password Storage Cheat Sheet – https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-38D and Rev. 1 drafts – https://csrc.nist.gov/pubs/sp/800/38/d/r1/2prd
- MDN `storage.session` – https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session
- Mozilla bug 1724754 (`setAccessLevel`) – https://bugzilla.mozilla.org/show_bug.cgi?id=1724754

## 11. Master password, key derivation and key lifetimes (C2)

Implemented in [`src/lib/kdf.js`](../src/lib/kdf.js) and
[`src/lib/service.js`](../src/lib/service.js); evidence in
[evidence/phase-c2](evidence/phase-c2/README.md).

### 11.1 Password rules

- At least 12 Unicode code points, at most 1024; long passphrases welcome; no
  character-class rules. Setup and change require confirmation.
- NFC normalization is applied identically for setup, unlock and change (tested with
  composed/decomposed input; the password-based portability fixture opens with both forms
  on Windows, Linux and macOS in CI).
- The UI warns that there is no recovery without the password. Encrypted export (C4) is
  the planned backup path; until then a forgotten password means data loss.

### 11.2 Unlock sequence (untrusted header)

1. Strict header validation (`validateVault`): exact fields, base64 lengths checked before
   decoding, salt 16 bytes, iterations in [600,000, 10,000,000], ciphertext ≤ 8 MB.
2. `deriveKey` re-validates the KDF parameters (`isValidKdf`) before PBKDF2.
3. PBKDF2-HMAC-SHA-256 → non-extractable AES-256-GCM key.
4. AES-GCM decryption with the header as AAD. Only a successful decryption makes the vault
   – including its KDF parameters – trusted. A wrong password and a damaged or manipulated
   vault are indistinguishable and never write storage (`storage.local` compared
   byte-for-byte in the browser tests).

If the current header is unreadable, the KDF parameters of a structurally valid backup or
staged copy are used; recovery then follows §7 (explicit confirmation).

### 11.3 Measurements (Firefox 160.0.1, Windows 11, AMD Ryzen 7 3700X)

| Case | Time |
|---|---|
| Cold unlock (fresh browser process), 600,000 iterations | 126 ms |
| Wrong password, new guess (full PBKDF2) | 116 ms |
| Repeated attempt with byte-identical input (password, salt, iterations) in the same process | 3–5 ms; PBKDF2 is still called, Firefox's crypto library returns a cached result (11.7) |
| Forged, structurally valid header with 10,000,000 iterations | 1.87 s, then fails at AES-GCM; UI stayed responsive (max 2 ms ping) |
| Out-of-bounds iterations (1e12) | rejected in 2 ms, no PBKDF2 |
| Node 24 reference (same machine): 600k / 2M / 10M | 105 ms / 348 ms / 1.74 s |

Denial of service: a forged header costs at most about 2 s per unlock attempt on this
machine (perhaps 5–10 s on slow hardware) and then fails without writing. Web Crypto
runs asynchronously and the UI shows progress, so nothing freezes. An attacker able to
write `storage.local` can delete the vault anyway, so the header bound does not create a
new capability. Recommendation: keep the current reader bound; if slow target hardware
shows unacceptable times, lower `MAX_ITERATIONS` (e.g. to 2,000,000) as an explicit,
documented reader-rule change – legitimate vaults use 600,000 and stay compatible.

### 11.4 Session invalidation on password change (C2-A3)

`changePassword` re-derives the current key from the password (re-authentication), locks
the session **before** any key work, rotates the vault (§7.3) and leaves the session
locked; the user unlocks with the new password. Every operation reads the key through the
deadline gate and compares the session's key generation (salt) with the vault's; a stale
session record is rejected and wiped. Tested in Node and in Firefox: the old session key
cannot decrypt the new vault; operations during the change are rejected; the old password
neither unlocks nor restores; hard kills at 100/350/800 ms into a change always leave
exactly one working password and intact data.

### 11.5 Lifetimes of the password and keys

| Item | Where | Lifetime |
|---|---|---|
| Password string | page input → message → background | until the request ends; inputs are cleared after every attempt; JavaScript strings cannot be zeroed, they are garbage-collected |
| PBKDF2 base key | Web Crypto, non-extractable | inside one `deriveKey` call |
| Vault key (`CryptoKey`) | `storage.session` (memory), non-extractable | until lock, expiry, password change or browser exit; never in page realms (static test) |
| Decrypted payload | background, per operation | transient JS objects |
| PBKDF2 output cached by NSS | Firefox's crypto library, process memory | measured: byte-identical input returns in 0–1 ms after lock and expiry, so the material outlives the session until the browser process exits (11.7); never persisted; a browser restart clears it |

Nothing password-derived is persisted except the encrypted vault (verified by scanning
`storage.local`/`storage.session` for passwords and synthetic secrets).

### 11.6 Remaining assumptions

- Single-key `storage.local.set` atomicity and read-after-write visibility: consistent with
  the kill/restart tests (no torn vault observed in 5 crash scenarios), not proven (11.8).
- The NSS PBKDF2 cache is measured behaviour, not documented Web Crypto behaviour; its size
  and eviction policy in current Firefox are not verified (11.7).
- Malware with access to the running browser process remains out of scope (§2).

### 11.7 Why a repeated unlock takes 3–5 ms (C2 review)

Question: is the fast repeated unlock caused by application caching, a reused session or
`CryptoKey`, an authentication bypass, or Firefox itself?

**Proven by tests in the repository:**

- **The application derives on every attempt.** A test-only spy on
  `crypto.subtle.deriveKey` counts exactly one PBKDF2 derivation per unlock attempt in
  every scenario of [`test/auth-invariant.test.mjs`](../test/auth-invariant.test.mjs).
  The scenarios cover:
  - after setup and after a successful unlock,
  - after lock, expiry, event-page restart and browser restart,
  - after rotation,
  - distinct string instances, and NFC/NFD input.

  `unlock` never reads the session key. It derives from the supplied password and must
  decrypt the **current** vault with AES-GCM (§11.2).
- **The speedup sits inside Firefox Web Crypto, below the application.** Browser check
  C2-10 runs the same spy in an extension page. These inputs each take about 110–170 ms:
  - the first derivation,
  - a different password,
  - a different salt,
  - 600,001 iterations.

  Byte-identical input takes 0–1 ms, while the spy still counts one PBKDF2 call. This also
  holds for a new string instance and for NFD input that normalizes to the same bytes. Raw
  `importKey` + `deriveBits`, without any application code, shows the same pattern: about
  110 ms the first time, 0 ms on repeat. In an exploratory probe outside the suite, keys
  from repeated derivations interoperated, so the cached output is the correct one.
- **No authentication bypass.** Browser check C2-9 runs scenarios 2–10 on real storage.
  Every wrong password fails and leaves `storage.local` byte-identical, and every correct
  password opens. This holds after lock, expiry, event-page restart, browser restart and
  rotation. A byte-identical wrong guess repeated three times is also served from the
  cache in a few ms and still fails: the cached value is the PBKDF2 output of that wrong
  input, so it cannot decrypt the vault.
- **The cache is per process.** After a browser restart, the first attempts (correct and
  wrong) take the full time again. The old password after a rotation also takes the full
  time, because the new vault has a new salt.

**Strong evidence from source code, not run:** NSS softoken keeps a PBKDF2 result cache,
`PBECache` in `lib/softoken/lowpbe.c`. It was introduced for Firefox's own repeated
password-based derivations and later enlarged:

- [Bug 1606927 commit](https://source-hub.etos-pro.ru/mozilla/gecko-dev/commit/c70fa24ea8d55927f8b5fef9c8ba607b7053bf0b)
- [nss-3.79 "increase pbe cache" patch (RHEL)](https://git.almalinux.org/rpms/nss/src/branch/c8-beta/SOURCES/nss-3.79-increase-pbe-cache.patch)
- [Bug 1726022](https://bugzilla.mozilla.org/show_bug.cgi?id=1726022)
- [lowpbe.h](https://searchfox.org/firefox-main/source/security/nss/lib/softoken/lowpbe.h)

Firefox implements Web Crypto PBKDF2 on NSS softoken, which matches the measurements.

**Not verified (hypotheses):**

- the exact cache size and eviction policy in Firefox 160;
- whether other builds or future NSS versions keep the cache.

**Security assessment:**

- **Brute force is not accelerated.** Each new guess is a new input and costs the full
  PBKDF2 time. Re-trying an identical guess gains no information.
- **The invariant holds.** A locked vault never opens because derived material exists in
  memory: every attempt re-derives and must authenticate the current vault generation.
- **Residual exposure.** PBKDF2 output for recently used passwords stays in Firefox process
  memory after lock and expiry, until the browser exits. Reading it requires access to the
  running browser process, which is out of scope (§2).
- **No correction possible or needed in CTA.** Web Crypto offers no way to clear the NSS
  cache.

### 11.8 Storage atomicity (C2 review)

The implementation does not depend on atomic multi-key writes:

- Every step of `commit` and `rotate` writes exactly one key and is followed by a read-back
  check (§7.2, §7.3).
- The interruption table in §7.3 covers a stop between any two steps.

The remaining assumptions are per key (§7.5): one `storage.local.set` of one key is
all-or-nothing, and a resolved `set` is visible to the next `get`.

Evidence:

- **Node fault injection** at every write step of commit and rotation: `set` throws, the
  value lands damaged, or storage dies before or after a write (§7.4,
  [`test/vault.test.mjs`](../test/vault.test.mjs)).
- **Firefox hard kills** (C2-7, C2-8, [evidence](evidence/phase-c2/README.md)): five crash
  scenarios in total, during a write burst and at 100/350/800 ms into a password change,
  run on Windows, Linux and macOS in CI. After each restart exactly one password opened
  intact data, and no torn value was observed.
- **Not proven:** single-key atomicity is Firefox behaviour that a kill can only sample.

## 12. Session security (C3)

C3 completes the session lifecycle on the persistent vault. It keeps the B0/B6 rules
(§4, §5) and adds the parts below. Evidence: [evidence/phase-c3](evidence/phase-c3/README.md),
[`test/session-c3.test.mjs`](../test/session-c3.test.mjs).

### 12.1 Session expiration

| Requirement | Implementation |
|---|---|
| Default 15 minutes, configurable | `autoLockMinutes` (1–240) on the options page; default 15 |
| Checked before every sensitive operation | `requireSession()` at the start, `recheck()` after async work and before any result or write (§5.1) |
| No revival by delayed activity | `touch()` only accepts a valid session; validity is checked with the session's own values before a new timeout is applied |
| Changed setting | A **shorter** time applies at once, measured from the last activity, and locks immediately if already exceeded. A **longer** time applies from the next qualifying activity, so a settings write never extends a session by itself |
| TOTP refresh is not activity | `getCodes` and `listAccounts` never touch the session (unit test and browser check C3-3) |
| Alarms are cleanup only | The gate decides; the `autolock` alarm only wipes earlier (B6-5) |
| Clock changes | Backwards → `clock`, locked; forwards → early lock (safe direction) |
| Event-page restarts | All state is in `storage.session`; a new instance applies the same deadline (unit test, B6-4) |

Settings changes reach the background through `storage.onChanged`
(`onSettingsChanged`), serialized with all other session updates.

### 12.2 Browser restart

`storage.session` is memory-only, and `runtime.onStartup` clears it (§4 rule 5). Pages
never hold the key or secrets, so no page state can stand in for a session. Tested:

- C3-1, graceful quit and restart: no session record, every sensitive command returns
  `locked`, the popup asks for the password, the vault is byte-identical and opens with
  the password.
- C2-6/C2-7/C2-8, hard kill, including during writes and password changes (§11.8).

### 12.3 Fresh password verification for sensitive operations

| Operation | Verification |
|---|---|
| Change master password | Valid session **and** the current password, re-derived; the session is locked before any key work (§11.4) |
| Restore from a backup copy | Password + explicit confirmation; same key generation only; never replaces a current vault that still opens (§7.2) |
| Future export (C4) | `authorizeSensitive(password)`, below |

`authorizeSensitive(password)` is the reusable gate for C4 and later sensitive features:

1. `requireSession()`: a locked or expired session fails before PBKDF2.
2. Reads the **current** vault header; its key generation must equal the session's,
   else the session is wiped (`generation`).
3. Derives a new key from the supplied password and must open the current vault.
4. `recheck()`: a lock, expiry or re-unlock during PBKDF2 aborts the operation.
5. Returns the freshly verified key, revision and payload to the calling background code.

The session key is never consulted, so possessing an unlocked session is not enough
(unit test: the session's own `CryptoKey`, offered as a password, is rejected before any
crypto). A wrong password does not write and does not lock. The function is not
reachable through messages; C4 calls it inside its own `exclusive()` section.

Not implemented: a retry limit for wrong passwords during an unlocked session. Each
attempt costs a full PBKDF2, and an attacker with an unlocked session already sees the
codes. A limit is a C4 design question (§12.6).

### 12.4 Optional system-idle lock

Firefox facts, read from the Firefox 160 implementation (`ext-idle.js`, `idle.json` in
`omni.ja`):

- States are only `active` and `idle`. **Firefox has no `locked` state**, so a locked
  screen alone is not detected.
- Idle time comes from `nsIUserIdleService`, the platform idle time.
- The minimum detection interval is 15 s.
- `onStateChanged` is a persistent event: it wakes the event page. The interval is
  stored in the extension's startup data.

Implementation:

- Off by default. The options checkbox requests the optional `idle` permission inside
  the click handler; Firefox grants it without a prompt. Unchecking removes the
  permission. A revoked permission switches the setting off on the next options load.
- Idle time 1–60 minutes (`idleLockMinutes`, default 5), applied with
  `setDetectionInterval`.
- On `idle`, the background wipes the session if the setting is on. It only ever
  shortens a session; the deadline gate stays the security boundary.
- No host permissions; the manifest gains only `optional_permissions: ["idle"]`.

Limitations:

- No screen-lock detection in Firefox.
- What counts as input depends on the platform idle service: system-wide on Windows and
  macOS (expected, not verified here), and display-server dependent on Linux.
- Browser check C3-4 verifies the real permission flow and a real idle transition in the
  test environment (no input for 60 s), where the platform reports idle. Real desktop
  behaviour with a user away from the keyboard is MANUAL_REVIEW.

### 12.5 Recovery with an unverifiable vault generation (issue #8): proposal only

Current state: `restoreBackup(key, { allowUnverifiedGeneration: true })` exists in the
store (§7.2) but the service never passes it. If the current header is unreadable,
recovery is refused. No unsafe fallback exists, and a current vault that still opens is
never replaced (unit test C3.5, §7.2 `current-valid`).

Proposed design (needs an architecture decision before implementation):

1. Offered only when the current vault header is unreadable **and** a backup or staged
   copy opens with the entered password.
2. A separate dialog explains that the current vault's generation cannot be verified,
   that an older generation may be restored, and that newer changes may be lost. It
   names the revision of the copy that would be restored.
3. Two confirmations: the existing checkbox plus typing a fixed word (or a second,
   separate button). The password is entered again in the dialog.
4. Before the write, the unreadable current value is preserved under a separate
   `vault_damaged` key, so the step can be undone by hand. This is a new storage key and
   a format decision.
5. Never automatic, never from a copy of another generation than the password opens.

Open decisions: points 3 and 4 (confirmation form, keeping the damaged copy), and
whether this lands in C3 or together with export in C4, which gives a safer recovery
path (restore from an export file).

### 12.6 Open questions for review

- Retry limit or delay for `authorizeSensitive` and unlock (currently PBKDF2 cost only).
- Whether the idle lock should become the default once desktop behaviour is reviewed.
- Issue #8 decisions (§12.5).

## 13. Export and restore (C4)

Implemented in [`src/lib/export.js`](../src/lib/export.js) (formats) and
[`src/lib/service.js`](../src/lib/service.js) (`exportVault`, `importExport`); evidence in
[evidence/phase-c4](evidence/phase-c4/README.md), tests in
[`test/export.test.mjs`](../test/export.test.mjs).

### 13.1 Encrypted export `cta-export` v1

```json
{
  "format": "cta-export",
  "version": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<b64, 16 bytes>" },
  "cipher": { "name": "AES-GCM", "iv": "<b64, 12 bytes>", "tagLength": 128 },
  "ciphertext": "<b64>"
}
```

- **Key:** PBKDF2-HMAC-SHA-256 over the NFC-normalized export password, a fresh 16-byte
  salt per export, 600,000 iterations → AES-256-GCM, fresh 96-bit IV per export.
- **AAD:** `JSON.stringify([format, version, kdf.name, kdf.hash, kdf.iterations, kdf.salt,
  cipher.name, cipher.tagLength])`. The format string is authenticated, so a vault can
  never be read as an export or the reverse (tested both ways).
- **Reader (`parseExport`):** text length ≤ 8 MB + 4 KB before `JSON.parse`; exact key
  sets; bounded KDF (same rules as the vault, §6); salt 16 and IV 12 bytes; ciphertext ≤ 8 MB.
  Checked before any key derivation.
- **Payload** (inside the ciphertext only):
  `{ type: "cta-accounts", version: 1, exportedAt, accounts: [ { name, secret, url,
  algorithm, digits, period } ] }`. Array order is the account order. The vault-internal
  `id` is not exported; restore assigns new ids. No account count, names or dates appear in
  the clear.
- **Payload validation:** exact shape, and every account must pass the same validation as
  manual entry. A file with one invalid account is rejected as a whole.
- **Independent decryption:** the file plus its password are enough. Nothing from the
  Firefox profile is needed (tested: the browser's downloaded file is decrypted in Node
  with the format code alone, and a committed fixture opens on Windows, Linux and macOS).

### 13.2 Export flow

1. The options page sends `exportVault` with the kind and passwords. Input checks run
   first: a short or unconfirmed export password, an export password equal to the master
   password (after NFC), or a missing confirmation for unencrypted kinds fail **before**
   any PBKDF2.
2. `authorizeSensitive(password)` (§12.3): a valid session and a fresh master-password
   derivation against the current vault.
3. Encrypted: a new KDF and key from the export password; seal; **self-check**: the text
   is parsed and decrypted again with a fresh derivation and compared with the vault
   accounts. A mismatch returns `export-verify` and no file.
4. `recheck()`: a lock or expiry during any of this returns nothing.
5. The page receives `{ fileName, text, count }` once, downloads it through a Blob URL
   and an `<a download>` element (no `downloads` permission), removes the element and
   revokes the URL right after the click. Password fields are cleared after every
   attempt. Nothing is written to storage.

Export password: separate from the master password by default (approved decision). The
option "use my master password" is explicit and not recommended in the UI.

### 13.3 Unencrypted exports

- **`cta-plain` v1:** `{ format: "cta-plain", version: 1, exportedAt, notice, accounts }`
  with the same account fields as the encrypted payload. Complete, so no parameter is
  converted or dropped.
- **Legacy `totp.json`:** `{ otp_list: [ { name, key, url } ] }`. The original extension
  supports only SHA-1, 6 digits and 30 s (ARCHITECTURE.md §1.3). The options page lists every
  incompatible account with the parameter that cannot be expressed and disables the
  button; the background refuses again (`legacy-incompatible`). A lossy legacy file is
  never produced.
- Both need the fresh master password, a separate warning and the explicit confirmation
  checkbox. The text exists only in the message response and the Blob; no copy is kept.

### 7.6 Write outcomes (C4 review, decision 1)

Adding, editing, deleting and moving accounts and the restore (§13.4) share one write path
(`commitAccounts` in [`service.js`](../src/lib/service.js)). Every answer matches the
stored state:

| Outcome | When | Answer |
|---|---|---|
| Rejected, nothing written | gate, revision, `recheck()` or the epoch check right before the write fails; the store refuses before writing (`conflict`, wrong key); a write fails and storage still shows the old revision | `locked`, `conflict`, `invalid` or `internal` |
| Committed | the commit returned, or a failed write whose new revision with exactly the intended accounts is in storage | `{ revision, locked }`; `locked: true` when the session was locked or expired during or right after the write. The session then stays locked |
| Unknown | a write failed and storage cannot show either state (for example, storage became unreadable) | `unknown`; never a success |

The epoch check sits immediately before the commit with no `await` in between, so no write
starts after a lock or re-unlock. A lock that arrives while the write is already running
cannot stop it; it is reported as `locked: true` next to the result. Committed changes are
never rolled back or repeated by this path, and the revision compare-and-set stays the
store's own second line (§5.2). Tests: `test/write-outcome.test.mjs` (each mutation with a
lock before, during and right after the write; failed writes in all three outcomes) and
`test/export.test.mjs` (restore).

### 7.7 Undelivered messages (C4 review, decision 3)

A message sent while the event page restarts can fail with "Receiving end does not exist".
`call()` in [`ui.js`](../src/lib/ui.js) sends it again only for commands that change
nothing (`status`, `getCodes`, `listAccounts`, `importPreview`, `lock`), at most twice,
with a short delay. Every other command (account changes, restore, export, unlock, setup,
recovery, password change, activity) is sent exactly once. If it fails to arrive, the page
reports `unknown` ("unknown whether the change was saved") and reloads the account list
from the background, which shows the real state and current revision; the user decides
whether to try again. A second attempt carries the reloaded revision, so it can never apply
a change twice. Automatic retries of mutations with operation identifiers are not
implemented; the reload makes them unnecessary for C4.

### 13.4 Restore (C4.4, revised after the C4 review)

`importExport({ text, password, masterPassword })` restores a `cta-export` into an **empty**
vault. Restoring is a persistent, security-sensitive write, so the order is:

1. Export password shape and file header are checked (bounded, before any PBKDF2).
2. `authorizeSensitive(masterPassword)` (§12.3): a valid session and a fresh derivation of
   the **destination's** master password that must open the current vault.
3. The destination must be empty (`vault-not-empty`).
4. The **export password** derives the file key; the file must authenticate and every
   account must pass the shared validation. Wrong export password and modified file both
   report `import-decrypt`.
5. `recheck()`: a lock, expiry or re-unlock during the PBKDF2 work aborts.
6. The vault is read again right before writing: it must still be empty and at the
   revision that was verified in step 2 (`conflict` otherwise), and the single `commit`
   uses that revision for compare-and-set (§7).
7. Immediately before the commit, with no `await` in between, the session epoch is
   checked: a lock or re-unlock that arrived during the reads of step 6 aborts without
   writing. A lock that arrives while the commit is already writing cannot stop it; the
   restore is then reported as completed with `locked: true` and the session stays locked
   (found by CI on macOS, fixed and tested). Restore uses the shared write path and
   outcome rules of §7.6.

The two passwords stay separate: the master password never opens an export, and the
export password is never accepted as the master password (tested both ways). Nothing is
written on any failure. Merging into existing accounts and the legacy import are C5.

### 13.5 Download status with the current permissions

Measured on Windows with Firefox 160.0.1 (`test/browser/native-dialogs.mjs`, evidence
N1–N4): with "Always ask where to save files", Firefox shows its native Save dialog for the
extension's Blob download; saving completes; cancelling writes nothing; a target folder
without write permission makes Firefox report the download as failed in its download
panel; the native Open dialog selects the saved file for restore.

The extension page cannot observe any of this without the `downloads` permission: an
`<a download>` click gives no completion, cancellation or failure signal. The UI therefore
never claims that a file was saved. After an export it says that the file was created and
handed to Firefox for saving, and asks the user to check Firefox's downloads; a cancelled
dialog means no file. Adding the optional `downloads` permission would allow a real
status; the C4 review decided against it (decision 2): the permission model stays
minimal. Native dialogs and download failures on Linux and macOS remain manual release
checks (RELEASE.md).

### 13.6 Shared secret policy (prepared for C5)

`checkSecret` in [`accounts.js`](../src/lib/accounts.js) is used by manual entry, the legacy
preview and restore:

- **Malformed, rejected** (`secret-format`): not RFC 4648 Base32 (invalid characters or an
  impossible length) or no key bytes.
- **Weak but usable, accepted with a warning** (`short-secret`): valid Base32 with fewer
  than 16 characters (80 bits). HMAC accepts any non-empty key, so codes are generated.
- Manual entry shows the warning while typing and after saving; `addAccount` and
  `updateAccount` return `warnings`; the legacy preview marks the row.

Before C4 review, manual entry rejected short secrets; it now follows the same policy as
the import (approved C5 rule). TOTP test vectors are unchanged.

### 13.7 Limitations

- Download completion, cancellation and failure are visible only in Firefox's download
  UI (§13.5).
- The plaintext of an unencrypted export exists in the extension page's memory until
  garbage collection. JavaScript cannot zero strings.
- A downloaded file is outside CTA's control: an unencrypted file stays readable on disk
  until the user deletes it (the UI says so).
- The export password has the same rules as the master password (12+ code points), no
  strength meter.
