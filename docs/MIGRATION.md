# Migration from the legacy extension

Status: implemented in C5 (security properties: SECURITY.md §14).

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

Pre-1.0.4 format: flat object `{ "<name>": "<key>", ... }`, supported. CTA's own
`cta-plain` v1 export (§3) is accepted through the same preview. Anything else is rejected.

## 2. Import rules

1. Read file in the options page (`<input type=file>`; the popup closes when a file dialog
   opens). Size limit 1 MB.
2. Parse JSON; reject anything that is not one of the two formats.
3. Per entry: normalize key (remove spaces/`=`, uppercase), validate RFC 4648 Base32
   (malformed → invalid; < 16 characters accepted with a warning), `name` and `url` must be
   strings, unknown fields ignored. Every entry is validated like manual entry. An empty
   name is not invalid: the row is shown as **needs name** with an editable replacement
   name that must be filled before applying. `cta-plain` entries must carry algorithm,
   digits and period; missing values make the entry invalid (never defaulted).
4. Duplicate detection against the vault and within the file:
   - same normalized secret → **duplicate** (skipped by default),
   - same name, different secret → **name conflict** (imported, marked).
5. Preview table: name, site, status (new / duplicate / name conflict / needs name /
   invalid with reason, short-key warning). Secrets are not shown in the preview.
6. Nothing is written until the user confirms with the master password (verified fresh);
   cancel writes nothing. Existing accounts are
   never changed; imports are only appended, in one write. The apply must match the
   previewed vault revision and file, otherwise the user previews again. At most 1,000
   accounts in total.
7. After import, CTA reminds the user to delete the plaintext `totp.json`.

Applying uses the shared write path (SECURITY.md §7.6), so a failed import never alters the
existing vault.

## 3. CTA export formats

Implemented in C4 (SECURITY.md §13):

- Encrypted `cta-export` v1 with its own export password (separate by default). In C4 it
  restores into an empty vault; merging runs through the import steps above in C5.
- Unencrypted `cta-plain` v1 with every TOTP parameter, after a warning and confirmation.
- Legacy-compatible `{ "otp_list": [ { name, key, url } ] }`, only when every account uses
  SHA-1, 6 digits and 30 s; otherwise refused with the affected accounts listed.

## 4. Test data

`test/fixtures/legacy-synthetic.json` contains only synthetic secrets and covers: valid
entries, lowercase/padded keys, invalid Base32, empty name, duplicate secrets, name
conflicts, the pre-1.0.4 format and malformed JSON.
