# Architecture

Status: B0 approved; Phase B (functional baseline) implemented on `feature/phase-b`
with synthetic in-memory data. Evidence: [evidence/phase-b](evidence/phase-b/README.md).

## 1. Upstream analysis

Source: `https://github.com/Rayquaza01/authenticator`, commit
`fd07df3da3eccfdc0dda9d21aadacf57290e27f6` (2025-03-21, deprecation notice). Last functional
change 2019, last version `1.3.3pre2`, Manifest V2, ID `authenticator@r01`.

### 1.1 Files

| File | Lines | Role | Reuse |
|---|---|---|---|
| `browserAction.html/.css`, `loader.js` | 33/155/194 | Popup: unlock overlay, account table, ticker, copy | UI concept and CSS measurements only |
| `options.html/.css/.js`, `dragdrop.css` | 73/107/453 | Account CRUD, drag-and-drop order, sort order, colors, import/export, change password | Feature list only |
| `authenticator-bg.js` | 52 | Defaults, pre-1.0.4 storage format conversion | Legacy format knowledge only |
| `crypt.js`, `crypt, decrypt from JSON.js` | 48/13 | Vigenère-style "encryption" | **Discard** |
| `sha256.js` (jsSHA) | minified | Password hash | **Discard** (Web Crypto) |
| `otplib-browser.js` (otplib 10.0.1) | 10,421 | TOTP | **Discard** (≈60 lines of Web Crypto replace it) |
| `reset.js/.html` | 18/19 | "Forgot password" – resets hash, leaves keys garbled | **Discard** |
| `icons/*.svg` | – | Material Design Icons + own icon | Reuse MDI glyphs with attribution; new extension icon |

### 1.2 UI reference (the part we keep)

Measured from `browserAction.css` and `loader.js`:

- Popup width 270 px after unlock, `font-family: monospace; font-size: 16px`.
- Row: `display:flex; height:25px; padding: 0 12px`; name grows with ellipsis, code right,
  16 px copy icon column. Hover `#f0f0f0`, active `#e8e8e8`.
- Whole row is the click target → copies the code, copy icon turns into a check mark for 1 s.
- Row background highlighted when the active tab URL contains the account's `url`.
- Footer: seconds-remaining ticker and a settings gear (opens options page).
- Colors are user-configurable (font + background color, applied to every element). Default is
  black on white; the "dark minimal" look is a user color choice. CTA ships it as a built-in
  **Dark** theme plus **Light**.
- Sort orders: created (manual drag-and-drop), A–Z, Z–A.
- No scroll container: the document grows and Firefox clips/scrolls the popup at its maximum
  size (800×600 px).

### 1.3 Functional defects found (besides security, see SECURITY.md)

- Codes refresh only when `epoch % 30 === 0` is hit exactly; a throttled timer skips the
  refresh and shows stale codes.
- Import calls `storage.local.clear()` and stores the file as-is: silent overwrite, no
  validation, can inject arbitrary storage keys (including `hash`).
- Only SHA-1 / 6 digits / 30 s; no `otpauth://` parameters.
- `tabs` permission requested only for the URL highlight.
- Uses deprecated `document.execCommand("copy")`, `applications` key, `browser_style`.

## 2. Target architecture

### 2.1 Decisions

| Topic | Decision | Reason |
|---|---|---|
| Manifest | **MV3**, `background.scripts` (event page) | Mozilla's maintained path; MV2 still supported but no new investment. Firefox MV3 uses event pages, not service workers. |
| Min. Firefox | `strict_min_version: "140.0"` (ESR 140), primary target 160 | `data_collection_permissions` needs 140+. |
| Language | Plain JavaScript ES modules, no framework, no bundler | Smallest attack surface, no source-code submission to AMO, code runs unchanged in Node tests. |
| Runtime deps | **None** | TOTP (RFC 6238), Base32 (RFC 4648), AES-GCM, PBKDF2 all from Web Crypto + ≈100 lines. |
| Dev deps | `web-ext` (lint/run/build/sign) only | Node 24 has `node:test` and `crypto.subtle` built in. |
| Crypto | AES-256-GCM, PBKDF2-HMAC-SHA-256 (600,000 iterations, configurable, stored in header) | See SECURITY.md §3. |
| Session key | Non-extractable `CryptoKey` in `browser.storage.session`, read only by the background through a fail-closed deadline gate | B0-1 PASS on Firefox 160.0.1; SECURITY.md §4–5. |
| Secrets vs. codes | Background decrypts and generates codes; popup/options never receive secrets or the key | SECURITY.md §9; spike observation: held key copies survive a lock. |
| Permissions | `storage`, `alarms`, `activeTab`; optional `idle` | No install warnings. Clipboard write from a click needs no permission. |
| i18n | `_locales/{en,de}/messages.json`, `browser.i18n` | Built-in, no library. |

### 2.2 Components

```
popup (popup.html/js)               options (options.html/js)
  unlock form, rows (name+code),      account CRUD (secrets write-only), ordering,
  copy, ticker                        theme, auto-lock, import preview, export
        │  runtime.sendMessage               │
        │  getCodes / unlock / touch         │  listAccounts / addAccount / import / export
        ▼                                    ▼
background.js (event page) – the only context that touches key, vault and secrets
  every sensitive call → requireSession() gate (deadline, fail closed)
  lib/ (pure ES modules, unit-tested in Node):
    totp.js            RFC 6238/4226 via crypto.subtle HMAC
    base32.js          RFC 4648 decode + normalization
    vault.js           PBKDF2 → AES-GCM, versioned format, AAD, commit/rollback
    session-policy.js  deadline rules (from B0 spike)
    legacy.js          parse/validate totp.json, duplicate detection
    export.js          cta-export / cta-plain / totp.json formats (C4)
  alarms → auto-lock; runtime.onStartup → storage.session.clear();
  storage.onChanged(settings) → shorter auto-lock applies at once (C3)
  optional idle permission → idle.onStateChanged("idle") → lock (C3; Firefox has no "locked")
  authorizeSensitive(password) → fresh PBKDF2 against the current vault (C3; gates every export)
storage.session: { session: { key: CryptoKey, timeoutMs, lastActivity, deadline } }
storage.local:   { vault, vault_backup, vault_next, settings: { theme, colors, autoLockMinutes, idleLock, idleLockMinutes, sort } }
```

The whole account list (names, secrets, URLs) is one AES-GCM ciphertext. Settings are
plaintext and contain no secrets.

Phase B state: instead of `vault`/`vault_backup` in `storage.local`, an encrypted working
copy `{ revision, iv, ct }` lives in `storage.session` (B0-3). Page helpers live in
`lib/ui.js`; pages import only `ui.js`, `settings.js`, `accounts.js` (pure view helpers)
and `legacy.js` (size limit constant).

Background message API (all from own pages only; errors reduced to `locked`, `conflict`,
`invalid`, `malformed`, `unknown` or `internal`; write outcomes: SECURITY.md §7.6):

| Command | Gate | Qualifying activity | Returns |
|---|---|---|---|
| `status` | no | no | `{ initialized, unlocked, startedAt }` |
| `setup {password, confirm}` | – | starts session | `{ unlocked }` (12+ chars, confirmation; refuses if a vault exists) |
| `unlock {password}` | – | starts session | `{ unlocked }` or `{ recoverable, damage, generationVerified }`; never writes |
| `restore {password, confirmed}` | – | starts session | explicit same-generation recovery (SECURITY.md §7) |
| `changePassword {current, next, confirm}` | yes | locks | `{ locked: true }` (SECURITY.md §11.4) |
| `lock` | no | – | `{ unlocked: false }` |
| `activity` | yes | yes | `{}` |
| `getCodes` | yes | no | `{ revision, codes: [{ id, name, url, period, code, validUntil }] }` |
| `listAccounts` | yes | no | `{ revision, accounts: [{ id, name, url, algorithm, digits, period }] }` |
| `addAccount`, `updateAccount`, `deleteAccount`, `moveAccount` (+`revision`) | yes | yes | `{ revision, locked }`; add/update also `warnings` (`short-secret`, SECURITY.md §13.6) |
| `importPreview {text}` | yes | no | `{ format, rows, counts, revision, fileHash }` (no secrets; keeps the text in memory, SECURITY.md §14) |
| `importApply {revision, fileHash, names}` | yes | yes | `{ revision, locked, imported }`; appends the importable rows of that preview in one commit |
| `importCancel` | no | no | `{}`; drops the kept import text |
| `exportVault {kind, password, exportPassword, confirm, useMasterPassword, confirmed}` | yes + fresh master password | no | `{ fileName, text, count }`; encrypted text has no secrets in the clear (SECURITY.md §13) |
| `importExport {text, password, masterPassword}` | yes + fresh master password | yes | `{ revision, locked, imported }`; empty vault only; `password` is the export password (SECURITY.md §13.4) |

Message handlers validate their input; the background
answers only messages from its own extension pages (`sender.id`, no external messaging).

### 2.3 Data model (inside the vault)

```json
{ "accounts": [ { "id": "uuid", "name": "Example", "secret": "BASE32",
                  "url": "example.com", "algorithm": "SHA-1", "digits": 6, "period": 30 } ] }
```

`algorithm`, `digits`, `period` default to SHA-1/6/30 and are optional; the UI exposes only
name, secret and URL in the first release. Array order is the manual order.

### 2.4 Popup layout

- Same measurements as upstream (270 px, 25 px rows, monospace 16 px).
- List is a scroll container: `max-height: calc(600px - footer)`, `overflow-y: auto`, so the
  footer stays visible and all rows remain reachable. Plain DOM rows; 100–500 rows need no
  virtualization.
- One 1 s interval: updates the ticker; requests fresh codes from the background only when
  the period counter changes (fixes the stale-code bug). Refreshes do not extend the
  lock deadline; a `locked` answer switches the popup to the unlock form.
- Locked state: compact password field inside the same popup width.
- The whole row is one `<button>`; its children ignore pointer events, so a click anywhere
  (name, code, free space, icon) fires exactly one copy. Clicks during the 1 s confirmation
  are ignored. The list has `tabindex="-1"`, so Tab goes straight to the rows.
- Toolbar placement: `action.default_area = "navbar"` (one-click access like the original;
  Firefox would otherwise put the button into the extensions menu).

### 2.4.1 Appearance (B7, B8)

Settings live in `storage.local.settings`, separate from vault data:
`theme` (`auto` default, `light`, `dark`), `customColors` + `fg`/`bg`, `fontSize` 12–20 px
(default 16), `rowHeight` `auto` (default; 25 px at 16 px) / 22 / 25 / 30.

- `lib/appearance.js` (pure, unit-tested) derives all color tokens from fg/bg and
  enforces WCAG contrast: text ≥ 4.5:1 on every background token, icons ≥ 3:1. An
  unreadable custom text color is replaced by black or white.
- Line height is a whole number of pixels, `ceil(1.25 × fontSize)`; fixed row heights are
  raised to that line height + 2 px so text never clips (fractional line boxes clipped
  descenders on Linux/macOS).
- `lib/ui.js applyAppearance()` sets the tokens as CSS variables; `auto` follows
  `prefers-color-scheme` live. `rows.css` is shared by popup and options preview.
- Hover: background-only change to `--hover` (lighter in dark, light gray in light), the
  current-site row uses `--current-hover`; 80 ms transition, none with
  `prefers-reduced-motion`; keyboard focus is a 2 px inset outline (no layout shift).
- Options page: live preview, segmented color scheme, font slider, row-height radios,
  reset of appearance settings only.

### 2.5 Repository structure

```
src/                     extension root (web-ext --source-dir src)
  manifest.json
  _locales/en/messages.json, _locales/de/messages.json
  background.js
  popup/  popup.html popup.css popup.js
  options/ options.html options.css options.js
  lib/    totp.js base32.js vault.js session-policy.js legacy.js i18n.js
  icons/
test/
  totp.test.js base32.test.js vault.test.js legacy.test.js
  fixtures/legacy-synthetic.json   (synthetic secrets only)
spikes/b0-cryptokey/     B0 test extension, BiDi driver, evidence (not shipped)
docs/
package.json             scripts: test, lint, start, build, spike:b0
```

Repository: the public GitHub repository is authoritative (protected `main`, pull requests,
CI); a private Forgejo pull mirror is the backup. See [DEVELOPMENT.md](DEVELOPMENT.md).

## 3. Implementation plan

Each phase ends with the quality gates of the task (tests, secret-leak grep, permission
check, layout check, round trips, diff review, commit).

### Phase B – Functional baseline

| # | Milestone | Acceptance criteria |
|---|---|---|
| B1 | Skeleton: manifest, `package.json`, `web-ext lint` clean | `web-ext lint` 0 errors/warnings; loads via `about:debugging` in Firefox 160 |
| B2 | `base32.js`, `totp.js` | All RFC 6238 Appendix B vectors (SHA-1/256/512, 8 digits) and RFC 4226 Appendix D vectors pass in `node --test` |
| B3 | Popup with compact rows, copy, ticker, Dark/Light theme | Row height 25 px measured in DevTools; 100 synthetic accounts scroll fully, footer visible, no freeze; click copies code |
| B4 | Options: add/edit/delete, drag order, sort | CRUD persists; order survives restart |
| B5 | Legacy import parser and preview (no apply step) | Synthetic fixture with valid, invalid and duplicate entries shows correct preview; unit tests for parser and duplicate detection |
| ~~B6~~ | CryptoKey spike | Done as B0-1: PASS ([RESULTS.md](../spikes/b0-cryptokey/RESULTS.md)) |

**B0-3:** Phase B runs on synthetic fixture accounts held in memory only. No account
persistence and no import apply step exist until authenticated encryption (C1–C2) works.
B ends without a release.

### Phase C – Security modernization

Approved sequence (CTA-001-C-PLAN): one reviewed pull request per milestone; encrypted
export and recovery come before production legacy import.

| # | Milestone | Acceptance criteria |
|---|---|---|
| C1 ✔ | `vault.js`: format v1, authenticated metadata, fresh nonce; `create`/`commit`/`rotate` authenticate the key before writing, read-only `load`, explicit same-generation `restoreBackup`, staged rotation (SECURITY.md §6–7); not yet wired to storage | Tampering, wrong keys, different salts, stale/damaged copies, concurrency; fault injection at every step of commit and rotation; at least one password always opens the data |
| C2 ✔ | Master-password setup and unlock (PBKDF2-SHA-256, NFC, 12+ chars), confirmed recovery, password change with immediate lock, persistence on `storage.local`, development unlock removed | Wrong passwords never write; old key/password dead after change; kill/restart during writes and rotation recover; latency measured (SECURITY.md §11) |
| C3 ✔ | Session lifecycle on the persistent vault: deadline gate, alarms, `onStartup` clear, auto-lock setting on the running session, optional system-idle lock, fresh password gate `authorizeSensitive` for sensitive actions (SECURITY.md §12) | B0-2/B6 checks against the real vault; every sensitive message rejected after expiry or lock |
| C4 ✔ | Encrypted backup export (`cta-export` v1, separate export password, self-check), restore into an empty vault, complete plaintext export (`cta-plain` v1) and lossless-only legacy `totp.json` after warning and confirmation (SECURITY.md §13) | Export → import identical; tampered file rejected; recovery from backup tested; no plaintext export without confirmation |
| C5 (PR open, review pending) | Legacy `totp.json` and `cta-plain` v1 import: preview, validation, duplicates, names for unnamed entries, append-only single commit (SECURITY.md §14) | Duplicates skipped; failed or interrupted import changes nothing |
| C6 | Comprehensive security, regression and browser testing incl. the real toolbar popup | All suites green; evidence refreshed; release gate passes without demo code |

### Phase D – Release preparation

| # | Milestone | Acceptance criteria |
|---|---|---|
| D1 | Full German/English localization | No hard-coded UI strings; both locales complete |
| D2 | Manual test protocol on Firefox 160 (Windows) and ESR 140 | Signed-off checklist in RELEASE.md |
| D3 | Package validation | `web-ext build` + `web-ext lint` clean, XPI contains only `src/` |
| D4 | Signing preparation | RELEASE.md runbook complete; submission only after operator approval |

## 4. Operator decisions (CTA-001-B0)

1. Extension ID: project-owned GUID `{f587432b-b553-483e-b08d-4feac6378113}`.
2. Export: encrypted and plaintext; plaintext requires explicit warning and confirmation.
3. Appearance: Light and Dark themes plus optional custom colors.
4. Auto-lock: 15 minutes default; always lock on browser restart.
5. Updates: manual installation during development; self-hosted `update_url` before stable
   distribution.
6. Repository: private Forgejo as authority; optional public GitHub mirror.
