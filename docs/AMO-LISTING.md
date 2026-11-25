# AMO listing draft for 1.0.0 (German and English)

Status: **draft, not submitted.** It is used for the listed 1.0.0 submission (SIGNING.md §8)
after the operator's explicit release approval. Screenshots use synthetic accounts only.

## Fixed fields

| Field | Value |
|---|---|
| Name | Compact TOTP Authenticator |
| Add-on ID | `{f587432b-b553-483e-b08d-4feac6378113}` |
| License | MIT (AMO: "The MIT License") |
| Categories | Privacy & Security |
| Homepage / support site | https://github.com/Shotte/compact-totp-authenticator |
| Support e-mail | operator decision; optional, the issue tracker is the support channel |
| Source code | public repository above; unminified, no build step, so no source upload |
| Data collection | none (`data_collection_permissions: none`); no network access |
| Permissions shown to users | storage, alarms, activeTab; optional idle |
| Platforms | Firefox for desktop only (Windows, macOS, Linux), Firefox 140 or newer. No `gecko_android` in the manifest (PR #43), so AMO does not offer it on Android. In the Developer Hub, leave "Firefox for Android" unchecked |

## Summary (max. 250 characters)

- **de:** Kompakte Offline-TOTP-Codes: eine Zeile pro Konto, Klick kopiert. Verschlüsselt mit Master-Passwort, ohne Netzwerkzugriff und ohne Datenerhebung.
- **en:** Compact, offline TOTP codes: one row per account, click to copy. Encrypted under a master password, with no network access and no data collection.

## Description – Deutsch

Compact TOTP Authenticator zeigt deine Einmal-Codes (TOTP) in einem sehr kompakten Popup:
eine Zeile pro Konto, Name links, Code rechts. Ein Klick kopiert den Code.

- Verschlüsselte Ablage (AES-256-GCM) unter deinem Master-Passwort (PBKDF2-SHA-256,
  600.000 Iterationen). Der Schlüssel bleibt im Browser und ist nicht exportierbar.
- Automatische Sperre nach einstellbarer Zeit und beim Neustart des Browsers.
- Kein Netzwerkzugriff, keine Datenerhebung, keine Telemetrie.
- SHA-1, SHA-256 und SHA-512, 6–8 Stellen, eigene Perioden (RFC 6238).
- Verschlüsselter Export. Wiederherstellen ersetzt den Tresor erst nach Prüfung und Vorschau;
  der bisherige Stand bleibt als verschlüsselte Kopie. Import aus dem eingestellten Add-on
  „Authenticator“ (totp.json).
- Hell, dunkel oder automatisch, eigene Farben mit Kontrastprüfung, Schriftgröße 12–20 px.
- Bedienung mit Tastatur (Strg+Umschalt+2 öffnet das Popup).

Für Firefox am Desktop (Windows, macOS, Linux), ab Firefox 140. Firefox für Android wird nicht
unterstützt.

Wichtig: Wenn du das Master-Passwort vergisst, lassen sich deine Konten nur aus einem zuvor
erstellten Export wiederherstellen.

Basiert auf dem Bedienkonzept von Rayquaza01/authenticator (MIT), das 2025 eingestellt
wurde. Sicherheits- und Speicherarchitektur sind neu geschrieben. Unabhängiges Projekt,
nicht mit dem ursprünglichen Autor verbunden. Quellcode: GitHub (Link oben).

## Description – English

Compact TOTP Authenticator shows your one-time codes (TOTP) in a very compact popup: one
row per account, name on the left, code on the right. One click copies the code.

- Encrypted storage (AES-256-GCM) under your master password (PBKDF2-SHA-256, 600,000
  iterations). The key stays in the browser and cannot be exported.
- Automatic lock after a configurable time and on browser restart.
- No network access, no data collection, no telemetry.
- SHA-1, SHA-256 and SHA-512, 6–8 digits, custom periods (RFC 6238).
- Encrypted export. Restoring replaces the vault only after a check and a preview; the
  previous state stays as an encrypted copy. Import from the discontinued "Authenticator"
  add-on (totp.json).
- Light, dark or automatic theme, custom colors with contrast check, font size 12–20 px.
- Keyboard operation (Ctrl+Shift+2 opens the popup).

For Firefox on desktop (Windows, macOS, Linux), Firefox 140 or newer. Firefox for Android is
not supported.

Important: if you forget the master password, your accounts can only be restored from an
export you made before.

Based on the interface concept of Rayquaza01/authenticator (MIT), discontinued in 2025. The
security and storage architecture is newly written. Independent project, not affiliated
with the original author. Source code: GitHub (link above).

## Screenshots (draft, synthetic data only)

Draft images in [`amo/screenshots/`](amo/screenshots/), 1280 × 800, one set per language.
`test/browser/amo-screenshots.mjs` created them in a temporary profile, with fictional names and
the `CTA-SYNTHETIC-*` test secrets.

| File | Caption (en) | Caption (de) |
|---|---|---|
| `<lang>-1-popup-light.png` | One compact row per account; click a code to copy it. | Eine kompakte Zeile pro Konto; ein Klick kopiert den Code. |
| `<lang>-2-popup-dark.png` | Dark theme. | Dunkles Design. |
| `<lang>-3-accounts.png` | Manage, edit and reorder your accounts. | Konten verwalten, bearbeiten und sortieren. |
| `<lang>-4-appearance.png` | Theme, colours with contrast check, font size and row height. | Design, Farben mit Kontrastprüfung, Schriftgröße und Zeilenhöhe. |

- **Before upload, recreate all four from the 1.0.0 release source.** Images 1 and 2 show the old
  settings symbol (the gear is mandatory for 1.0.0). Images 3 and 4 still show the 0.x development
  notice:
  `node test/browser/amo-screenshots.mjs --lang=en --src=dist/signing/1.0.0/source`, the same
  with `--lang=de`.
- Popups 1 and 2 show the popup document at 150 % on a plain backdrop. They are not a capture of
  the browser toolbar.

## Privacy and data handling

AMO form: data collection "none" (it matches `data_collection_permissions: none`). Since
nothing is collected or transmitted, no separate privacy policy is required. If the operator
wants one anyway, use this text:

- **en:** Compact TOTP Authenticator does not collect, transmit or share any data. It has no
  network access and no telemetry. Your accounts are stored only in your Firefox profile,
  encrypted with AES-256-GCM under your master password. Exports are files that you save
  yourself, optionally encrypted with their own password. The clipboard is used only when you
  copy a code.
- **de:** Compact TOTP Authenticator erhebt, überträgt und teilt keine Daten. Die Erweiterung
  hat keinen Netzwerkzugriff und keine Telemetrie. Deine Konten liegen nur in deinem
  Firefox-Profil, verschlüsselt mit AES-256-GCM unter deinem Master-Passwort. Exporte sind
  Dateien, die du selbst speicherst, wahlweise mit eigenem Passwort verschlüsselt. Die
  Zwischenablage wird nur benutzt, wenn du einen Code kopierst.

Permission justification for reviewers:

| Permission | Why |
|---|---|
| `storage` | the encrypted vault and the settings in `storage.local`; the session key in `storage.session` |
| `alarms` | auto-lock after the configured time |
| `activeTab` | highlight the account that matches the current site when the popup opens; no page access otherwise |
| `idle` (optional, asked at runtime) | optional lock when the computer is idle |

## Reviewer notes (AMO "Notes to Reviewer")

```text
No build step, no minification, no third-party runtime code: the submitted files are the
repository's src/ directory at the release commit (public repository, link in the listing).
docs/SECURITY.md describes the threat model and the cryptography.

To test:
1. Install, open the options page, create a master password (12+ characters).
2. Add an account with the synthetic secret JBSWY3DPEHPK3PXP, or import
   test/fixtures/legacy-synthetic.json from the repository (General -> Import).
3. Open the popup (toolbar button or Ctrl+Shift+2) and click a code to copy it.
4. Optional: General -> Export (encrypted backup), then General -> Restore: choose the file,
   enter both passwords, "Check backup" shows a preview; replacing keeps the previous state
   as an encrypted copy that can be restored or deleted.

No network requests are made. Desktop only; Firefox for Android is not supported.
```

## Release notes

The draft 1.0.0 notes are in [CHANGELOG.md](../CHANGELOG.md), section "Unreleased". AMO's
"Release notes" field takes the user-facing part: the list of features and the known
limitations.
