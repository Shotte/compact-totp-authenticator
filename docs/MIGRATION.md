# Migration from the legacy extension

Status: Phase A specification. Not implemented yet.

Direct migration from the old extension's Firefox storage is out of scope. Users export
`totp.json` from the old extension (options page → Export) and import it into CTA.

## 1. Legacy formats

Current format (versions ≥ 1.0.4). The old export is **plaintext** even when a password was
set, because the old extension decrypts before exporting.

```json
{
  "otp_list": [ { "name": "Example", "key": "JBSWY3DPEHPK3PXP", "url": "example.com" } ],
  "fontColor": "#000000",
  "backgroundColor": "#FFFFFF"
}
```

- `name`: string, may be empty.
- `key`: Base32 secret, whitespace already stripped; may be lowercase or padded with `=`.
- `url`: optional string (substring matched against the tab URL).
- `fontColor`, `backgroundColor`: optional, ignored by CTA (could map to a custom theme).

Pre-1.0.4 format: flat object `{ "<name>": "<key>", ... }`. Support is cheap and will be
included; anything else is rejected.

## 2. Import rules

1. Read file in the options page (`<input type=file>`; the popup closes when a file dialog
   opens). Size limit 1 MB.
2. Parse JSON; reject anything that is not one of the two formats.
3. Per entry: normalize key (remove spaces/`=`, uppercase), validate RFC 4648 Base32 and
   minimum length (≥ 16 characters / 80 bits recommended, < 16 accepted with warning),
   `name` and `url` must be strings, unknown fields ignored.
4. Duplicate detection against the vault and within the file:
   - same normalized secret → **duplicate** (skipped by default),
   - same name, different secret → **name conflict** (imported, marked).
5. Preview table: name, status (new / duplicate / name conflict / invalid). Secrets are not
   shown in the preview.
6. Nothing is written until the user confirms. Existing accounts are never changed;
   imports are only appended.
7. After import, CTA reminds the user to delete the plaintext `totp.json`.

## 3. CTA export format

Encrypted (`cta-export`, see SECURITY.md §3), with its own export password or the master
password. Import of a `cta-export` file decrypts, then runs steps 3–6.

## 4. Test data

`test/fixtures/legacy-synthetic.json` contains only synthetic secrets and covers: valid
entries, lowercase/padded keys, invalid Base32, empty name, duplicate secrets, name
conflicts, the pre-1.0.4 format and malformed JSON.
