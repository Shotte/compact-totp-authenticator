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
- Verschlüsselter Export und Wiederherstellung; Import aus dem eingestellten Add-on
  „Authenticator“ (totp.json).
- Hell, dunkel oder automatisch, eigene Farben mit Kontrastprüfung, Schriftgröße 12–20 px.
- Bedienung mit Tastatur (Alt+Shift+A öffnet das Popup).

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
- Encrypted export and restore; import from the discontinued "Authenticator" add-on
  (totp.json).
- Light, dark or automatic theme, custom colors with contrast check, font size 12–20 px.
- Keyboard operation (Alt+Shift+A opens the popup).

Important: if you forget the master password, your accounts can only be restored from an
export you made before.

Based on the interface concept of Rayquaza01/authenticator (MIT), discontinued in 2025. The
security and storage architecture is newly written. Independent project, not affiliated
with the original author. Source code: GitHub (link above).

## Screenshots (to create, synthetic data only)

1. Popup with about 10 synthetic accounts, light theme.
2. Popup, dark theme.
3. Options page: account list.
4. Options page: appearance settings.

The Phase B screenshots in `docs/evidence/phase-b/` show the layout. They are recreated at
1.0.0 with `test/fixtures` data.

## Reviewer notes (AMO "Notes to Reviewer")

No build step: the submitted files are the repository's `src/` at the release commit. To
test: install, create a master password (12+ characters), add an account with the
synthetic secret from `test/fixtures/legacy-synthetic.json`, open the popup.
