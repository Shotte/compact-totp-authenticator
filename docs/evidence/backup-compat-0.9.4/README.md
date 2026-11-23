# Backup compatibility 0.9.4 → 0.9.5 and the unresolved acceptance observation

## Observation (0.9.5 operator acceptance, unresolved)

During the manual acceptance of the signed 0.9.5 build (#25), an encrypted backup was rejected
with "Die Sicherung ließ sich nicht entschlüsseln: Das Export-Passwort ist falsch oder die
Datei ist beschädigt". It was rejected:
- after correcting a wrong master password with the export password kept;
- after re-entering both passwords;
- after selecting the file again.

A backup newly created with 0.9.5 then validated successfully. The operator accepted #25.

## What was tested (synthetic data only)

| Test | Result |
|---|---|
| The reported sequence in real Firefox 160.0.1, keyboard input, against `src/` and the signed 0.9.5 contents: wrong export password, then the correct export password with a wrong master password, then the correct master password | Preview shown; the file stays selected |
| What the page sends (instrumented: length and equality only, never the value) | The retained export password is sent unchanged on the retry |
| A backup written by the **signed 0.9.4 XPI** (30 entries of `acceptance-30-synthetic.json`), read by the **signed 0.9.5 XPI** after an in-place upgrade: through the service and through the UI, with wrong attempts first | Opens (30 entries); the wrong attempts report the right field |
| A new 0.9.5 backup | Opens |
| Backup-reading code 0.9.4 (`68407dd`) vs 0.9.5 (`9637b12`) | `export.js`, `kdf.js`, `crypto.js` and `accounts.js` unchanged; `openBackup` identical |
| Firefox password manager with a saved login for the options page | Fills no field on the extension page |

## Conclusion

The observation could not be reproduced, and the original file/password combination was not
examined. The operator's passwords and backup contents were deliberately not requested.

It is therefore **not classified as a confirmed product defect**, and nothing was changed to
"fix" it. Explanations that remain open:
- a different file with the same default name (`cta-export-<date>.json`);
- an export password that differs from the one entered later;
- a non-AES-GCM failure reported as a wrong password. `openBackup` maps every error except an
  invalid payload to `import-decrypt`, which is unlikely here because exports in the same
  profile derive keys successfully.

## Regression coverage

[`test/fixtures/backup-0.9.4-signed-synthetic.json`](../../../test/fixtures/backup-0.9.4-signed-synthetic.json)
is the backup produced by the signed 0.9.4 XPI, stored byte-unchanged:
- XPI SHA-256 `acc46d30…3f69aaf`;
- file SHA-256 `9bb3c542e7124820176433589a6ca4234fd8bb5a55d91d2b2cc2da9c5ddc3e39`;
- export password `Exportpasswort-2026!`, synthetic secrets only.

The unit test "a backup written by signed 0.9.4 opens after wrong-password attempts" in
`test/replace.test.mjs` checks that:
- the current code opens it after a wrong export password and then a wrong master password;
- it opens again after one more wrong attempt.

The test runs in every CI job without the signed XPIs.
