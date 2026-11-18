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

- **AAD:** UTF-8 of `JSON.stringify([format, version, revision, kdf.name, kdf.hash,
  kdf.iterations, kdf.salt, cipher.name, cipher.iv, cipher.tagLength])`. A fixed array, not
  object serialization, so the encoding is unambiguous. Any change to these fields makes
  decryption fail.
- **Reader rules:** unknown `format`/`version`, iterations below 600,000 or above a sanity
  cap, wrong salt/IV length → reject before decrypting.
- **Plaintext payload:** `{ "accounts": [ { id, name, secret, url, algorithm, digits, period } ] }`.
  Names and URLs are encrypted too.
- **Encrypted export** (`format: "cta-export"`) uses the same structure and AAD rule with its
  own salt and IV; password chosen at export time (may equal the master password).

## 7. Writes, backup and rollback

Goal: no failed import, password change or write may destroy the existing vault.

Commit protocol (background only, under the gate):

1. Build the complete new vault in memory (`revision + 1`, fresh IV). Any error up to here
   writes nothing.
2. `storage.local.set({ vault_backup: <current vault> })`.
3. `storage.local.set({ vault: <new vault> })`.
4. Verify: read `vault` back, decrypt with the intended key, compare revision and payload
   digest.
5. On verification failure: `storage.local.set({ vault: <backup> })` and report an error.
6. Password change only: after successful verification, remove `vault_backup` (it is
   encrypted with the old password) and replace the session key.

Two separate single-key writes are used instead of relying on multi-key atomicity, so every
crash point leaves at least one decryptable vault. On unlock: if `vault` fails to decrypt and
`vault_backup` succeeds, CTA restores the backup and tells the user.

- **Import:** parsed, validated and previewed without touching storage; committed only after
  confirmation, append-only, via the protocol above.
- **Password change:** requires the current password (re-derive and decrypt, not just a
  valid session); the new vault is verified with the new key before the old one is dropped.

To verify in Phase C: behaviour of `storage.local` write failures (quota, profile errors)
with fault injection where possible.

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
- **B0-3:** until Phase C is complete, builds use synthetic fixture accounts only; no
  account persistence and no legacy import apply step.

Sources (checked 2026-11-18):

- OWASP Password Storage Cheat Sheet – https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-38D and Rev. 1 drafts – https://csrc.nist.gov/pubs/sp/800/38/d/r1/2prd
- MDN `storage.session` – https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session
- Mozilla bug 1724754 (`setAccessLevel`) – https://bugzilla.mozilla.org/show_bug.cgi?id=1724754
