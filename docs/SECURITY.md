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
| Master password | Mandatory, minimum 8 characters, strength hint, no recovery | Loss of password = loss of vault; encrypted export is the backup |

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
  restart (§4 rule 5).
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
- **Encrypted export** (`format: "cta-export"`) uses the same structure and AAD rule with its
  own salt and IV; password chosen at export time (may equal the master password).

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
- Encrypted export: default.
- Plaintext export (operator decision): legacy-compatible `{ "otp_list": [...] }`, only after
  an explicit warning dialog and confirmation. Generated in the background, passed to the
  options page only after confirmation, offered as a `Blob` download, URL revoked
  immediately. Never kept in the DOM.

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
| Wrong password (full PBKDF2 per guess) | 116 ms |
| Repeated unlock with the same password in the same process | 3–5 ms (see 11.5) |
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
| Derived key material in NSS | Firefox's crypto library | observed: repeated PBKDF2 with identical input is served from a cache (3–5 ms), so derived material may stay in process memory beyond the session; it is not persisted, and new guesses are not accelerated (116 ms each) |

Nothing password-derived is persisted except the encrypted vault (verified by scanning
`storage.local`/`storage.session` for passwords and synthetic secrets).

### 11.6 Remaining assumptions

- Single-key `storage.local.set` atomicity and read-after-write visibility: consistent with
  the kill/restart tests (no torn vault observed in 5 crash scenarios), not proven.
- The NSS PBKDF2 cache behaviour is an observation, not documented API behaviour.
- Malware with access to the running browser process remains out of scope (§2).
