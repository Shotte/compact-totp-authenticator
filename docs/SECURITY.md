# Security

Status: Phase A analysis and design. Nothing here is implemented yet.

## 1. Upstream weaknesses (commit `fd07df3`)

| # | Weakness | Location | Impact |
|---|---|---|---|
| U1 | "Encryption" is a Vigenère cipher over a 65-character alphabet with the password as repeating key; no IV, no integrity | `crypt.js` | Base32 plaintext uses only 32 of 65 symbols, so each ciphertext character narrows the password character; with several keys the password and all secrets are recoverable in seconds. Effectively obfuscation. |
| U2 | Password verifier is a single unsalted-per-password SHA-256 of `password + extension UUID`, stored in `storage.local` | `loader.js`, `options.js` | Fast offline brute force (billions/s on GPU); UUID is readable from the profile. |
| U3 | Encryption optional; default is no password | `options.js` | Secrets stored in plaintext in the Firefox profile. |
| U4 | Decrypted secrets logged: `console.log(item, tab)` per row, `console.log(res.otp_list)` | `loader.js:57`, `options.js:279` | Secrets in browser console / logs. |
| U5 | Plaintext export kept permanently in a `data:` URL on the options page | `exportSettings()` | Secrets sit in the DOM whenever options are open. |
| U6 | Import clears storage and writes the raw file | `importSettings()` | Silent data loss; arbitrary storage keys (e.g. `hash`) can be injected. |
| U7 | "Forgot password" resets the hash but leaves encrypted keys | `reset.js` | Silent corruption of all secrets. |
| U8 | Characters outside the alphabet map to index −1 → wrap | `crypt.js` | Some passwords silently weaken or break encryption (upstream notes broken 1.2.0/1.2.1). |
| U9 | `tabs` permission for a cosmetic feature | `manifest.json` | Unnecessary broad permission. |

Good parts: no network access, no remote code, DOM built with `innerText` (no HTML injection).

## 2. Threat model

Protected assets: TOTP secrets and account names.

| Threat | In scope | Mitigation |
|---|---|---|
| Profile files copied (backup, theft, sync, malware reading disk while locked) | yes | AES-256-GCM vault, PBKDF2 key, no plaintext persistence |
| Exported file leaked | yes | Encrypted export by default |
| Tampering with stored vault/export | yes | GCM authentication; header bound as additional data |
| Secrets in console, logs, telemetry, network | yes | No logging of account data, no network, no telemetry; lint/grep gate |
| Unlocked session left alone | yes | Auto-lock, lock on browser restart, optional lock on OS lock |
| Malware running as the user while unlocked, keyloggers, compromised Firefox | **no** | Out of scope for any browser extension; documented |
| Clipboard history after copying a code | partial | Codes expire after 30 s; no clipboard clearing (needs read permission) |

Note for users: keeping TOTP secrets in the same browser as passwords reduces the
independence of the second factor. This is a conscious user choice and is documented.

## 3. Cryptography

- **Cipher:** AES-256-GCM (Web Crypto), 96-bit random IV per encryption, 128-bit tag.
  A fresh IV is generated on every save; the key is never reused with the same IV.
- **KDF:** PBKDF2-HMAC-SHA-256, 600,000 iterations (OWASP 2023 recommendation), 16-byte random
  salt. Iterations and salt are stored in the vault header, so they can be raised later
  (re-encrypt on next unlock).
- **Header as AAD:** `{format, version, kdf params, salt}` is passed as GCM additional
  authenticated data, so header manipulation (e.g. lowering iterations) fails decryption.
- **Why not Argon2id:** stronger against GPU attacks, but not in Web Crypto. It would need a
  WASM dependency, `wasm-unsafe-eval` in the CSP and review of third-party binary code.
  PBKDF2 is the native, auditable choice; Argon2id stays a documented future option
  (header `kdf.name` allows migration).
- **Password policy:** mandatory master password, minimum 8 characters, strength hint; no
  recovery. Losing the password means losing the vault – encrypted export is the backup.
- No home-made primitives. TOTP itself (RFC 6238) is HMAC via Web Crypto.

Vault blob in `storage.local`:

```json
{ "format": "cta-vault", "version": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<b64>" },
  "iv": "<b64>", "ciphertext": "<b64>" }
```

Encrypted export uses the same structure with `"format": "cta-export"`.

## 4. Key handling during an unlocked session (main tradeoff)

The Firefox popup is destroyed every time it loses focus – including right after the user
copies a code and clicks into the page. The key therefore must outlive the popup.

| Option | Security | Usability | Verdict |
|---|---|---|---|
| A. Enter password on every popup open | Best: key only in popup memory | Unusable (PBKDF2 delay + typing for every code) | Rejected |
| B. MV2 persistent background page holds a non-extractable `CryptoKey`; popup asks it for codes | Very good: key never serialized, never leaves background | Good | Possible, but ties us to MV2 |
| C. MV3 event page + `storage.session` holds the derived key | Good: memory only, never on disk, cleared on browser exit, readable only by extension contexts | Good | **Recommended** |
| D. MV3 with keep-alive tricks to emulate B | Fragile | – | Rejected |

Recommendation C. Details:

- After unlock, the derived AES key is stored in `storage.session`. If spike B6 shows that
  Firefox can store a non-extractable `CryptoKey` there (structured clone), we store that;
  otherwise the raw 32-byte key, imported as non-extractable `CryptoKey` in each page.
- The password itself is never stored.
- Auto-lock: `browser.alarms` (wakes the event page) clears `storage.session`; browser exit
  clears it automatically; optional `idle.onStateChanged("locked")`.
- Residual risk: while unlocked, the key is in process memory (possibly swap/crash dumps).
  This is the same class of risk as option B and accepted for usability.

## 5. Permissions and CSP

- `storage`, `alarms`, `activeTab` (current-site highlight, granted only when the user opens
  the popup). Optional: `idle`. No host permissions, no `tabs`, no `downloads`,
  no `clipboardWrite` (copy happens on a user click).
- `data_collection_permissions: { "required": ["none"] }`.
- Default MV3 CSP, no inline scripts, no `eval`, no remote code.

## 6. Development rules

- Synthetic secrets only (e.g. RFC test key `12345678901234567890`, random Base32 values).
- Never log account objects, secrets, codes or passwords. Errors log only generic messages.
- Gate before each phase: `grep -rn "console\." src/` reviewed; no fixture contains a real
  secret.
