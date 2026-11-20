# Signing, the signed update test and the AMO release (Phase D)

Status: **prepared, not executed.** No AMO account, API credentials, submission, signed
build, tag, release or published update manifest exists. Every step marked **operator**
needs Ralf's explicit authorization at the time it is done.

## 1. Distribution strategy (decided, CTA-001)

Two stages, one permanent extension ID `{f587432b-b553-483e-b08d-4feac6378113}`
(RELEASE.md §2). AMO signs each version number only once per add-on, forever.

| Stage | Version | AMO channel | `update_url` | Purpose |
|---|---|---|---|---|
| 1 – private acceptance, old | 0.9.0 | unlisted | `https://127.0.0.1:47811/updates.json` | installed first in a throwaway test profile |
| 1 – private acceptance, new | 0.9.1 | unlisted | same | delivered by the local update server of the test |
| 2 – public release | 1.0.0 | **listed** | none: Mozilla manages updates | only after the operator's explicit release approval |

Guards in code:

- `release:source --test-update` refuses versions ≥ 1.0.0.
- `release:source` has no way to set any other `update_url`.
- `check:release` fails every 1.x package that has an `update_url` and every package that
  embeds a certificate or private key.

The update test's CA and server certificate are created per run in the OS temp directory,
trusted only in its throwaway profile, and deleted afterwards. They never exist under
`src/`, and the package allowlist (`.js .html .css .json .svg`, `LICENSE`) would refuse
them anyway.

The 0.9.x test builds are not releases. They are used only in throwaway Firefox profiles
with synthetic accounts and are never handed to users.

## 2. Transition from the test builds to the AMO listed release

An installed unlisted test build does **not** migrate to the listed channel:

- Firefox asks the `update_url` in the installed manifest for updates. For 0.9.x that is
  `127.0.0.1`, so it never learns about 1.0.0 on AMO.
- A listed 1.0.0 has no `update_url`. Firefox then asks AMO's update service by ID.
  Only installations of a listed version get Mozilla-managed updates.
- Uninstalling an add-on deletes its `storage.local`, and with it the vault.

Consequences:

- Test builds stay in throwaway profiles, which are deleted after the acceptance (ABNAHME
  E4). No real accounts are ever entered there, so there is nothing to migrate.
- If a vault ever had to move from a test build to 1.0.0: make an encrypted export (C4),
  remove the test build, install 1.0.0 from AMO, and restore the export into the empty
  vault. The browser tests C4-1, C4-4 and C4-6 cover this.
- A direct 0.9.1 → listed 1.0.0 transition can only be tested once a listed 1.0.0 exists,
  that is after publication. It is not needed because of the rules above. If the
  architecture review asks for it: install the signed 0.9.1 in a throwaway profile,
  install the AMO 1.0.0 over it from the AMO page, and check that the ID stays the same,
  the vault survives and `about:addons` shows AMO updates. Not run, MANUAL_REVIEW.

## 3. AMO developer account and API credentials (operator, once)

1. Open <https://addons.mozilla.org/developers/> and sign in with a Mozilla account, or
   create one. The add-on belongs to this account.
   - If AMO asks for two-step authentication, set it up with an authenticator **other than
     a CTA test build**. Test builds hold synthetic accounts only.
2. Accept the developer agreement, and fill in the developer profile if asked (display
   name).
3. Open <https://addons.mozilla.org/developers/addon/api/key/> and choose "Generate new
   credentials":
   - "JWT issuer" is the API key, "JWT secret" is the API secret;
   - the secret is shown only once.
4. Store both only in your password manager:
   - never in a repository, a file in the project folder, CI, a ticket or a chat;
   - set them only in the shell that signs, and remove them afterwards (§5).
   - If they leak: revoke them on the same page and generate new ones.

`.gitignore` excludes `.env`, `.amo-credentials*`, `*.xpi` and `dist/` as a second line of
defence.

## 4. Build and verify the two test packages (no credentials, no network)

On Windows, in PowerShell, in the repository:

```powershell
git switch main; git pull --ff-only          # sign only reviewed, merged code
git status                                    # must be clean
npm ci --ignore-scripts
npm test; npm run lint; npm run check:release
npm run release:source -- --version 0.9.0 --test-update
npm run release:source -- --version 0.9.1 --test-update
```

Each `release:source` run must end with:
- `0 errors, 0 warnings`;
- `26/26 checks OK`;
- `Prepared dist/signing/0.9.x/source (27 files, commit <main head>)`;
- exit code 0.

It refuses a dirty `src/`; never sign such a build.

Result in `dist/signing/<version>/`, which git ignores:

- `source/`: a copy of `src/` in which only `version` and `update_url` differ;
- `SHA256SUMS`: the hash of every file;
- `release-source.json`: version, URL, purpose and source commit.

Check by hand that the two builds differ only in the version:

```powershell
Compare-Object (Get-Content dist/signing/0.9.0/SHA256SUMS) (Get-Content dist/signing/0.9.1/SHA256SUMS)
```

Expected: only the `manifest.json` line differs.

## 5. Signing the test packages (operator, after authorization)

`web-ext` reads `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from the environment, so the
values never appear on the command line or in the shell history:

```powershell
$env:WEB_EXT_API_KEY = Read-Host "AMO JWT issuer"
$env:WEB_EXT_API_SECRET = Read-Host "AMO JWT secret" -MaskInput
npx web-ext sign --channel unlisted --source-dir dist/signing/0.9.0/source --artifacts-dir dist/signing/0.9.0/signed
npx web-ext sign --channel unlisted --source-dir dist/signing/0.9.1/source --artifacts-dir dist/signing/0.9.1/signed
Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET
```

- The first submission creates the add-on with the fixed ID on AMO, as unlisted. 0.9.1 is
  added to it.
- No source-code upload is needed: the code is neither minified nor generated (RELEASE.md
  §3).
- Unlisted submissions pass automated validation and are usually signed within minutes.
  If `web-ext` stops waiting, download the signed XPI later from the AMO developer page
  into `dist/signing/<version>/signed/`.
- Signed XPIs are not published and stay outside the repository.

## 6. Verify the returned signed XPIs

```powershell
npm run verify:signed -- (Get-Item dist/signing/0.9.0/signed/*.xpi) dist/signing/0.9.0
npm run verify:signed -- (Get-Item dist/signing/0.9.1/signed/*.xpi) dist/signing/0.9.1
```

Each must report `6/6 checks OK`:

- every prepared file is byte-identical to `SHA256SUMS`;
- there are no files besides AMO's `META-INF/` signature files;
- the signature files are present;
- ID, version and `update_url` are as prepared.

It prints the XPI's SHA-256. Record per version: AMO version page, SHA-256, date.

Whether the signature is valid is decided by Firefox. The signed update test (§7) installs
both XPIs with signature checks on and requires a signed state for both (U-1).

## 7. Signed update test

Run on **release** Firefox (Windows, the operator's platform) with signature checks on:

```powershell
node test/browser/update-test.mjs --old (Get-Item dist/signing/0.9.0/signed/*.xpi) --new (Get-Item dist/signing/0.9.1/signed/*.xpi)
```

The script creates its own throwaway profile and uses only synthetic data. The operator's
normal profile is not touched.

1. A test CA and a server certificate for `127.0.0.1` are created for this run and trusted
   only in that profile. The HTTPS update server starts on port 47811 and serves
   `updates.json` and the new XPI with its SHA-256.
2. **Installation:** 0.9.0 is installed permanently and must report a signed state (U-1).
3. **Encrypted vault:** master password, 18 synthetic accounts (all algorithms, digits and
   periods), a non-default order and non-default settings.
4. **Real update mechanism:** `findUpdates()` reads `update_url`, fetches `updates.json`,
   downloads 0.9.1, checks the hash and signature, and installs it (U-2). ID and
   moz-extension UUID stay the same (U-3).
5. **Preservation:** `storage.local` byte-identical, vault not reinitialized (U-4).
6. **Master password:** a wrong one is refused, the right one unlocks; accounts, order and
   revision are unchanged (U-5).
7. **TOTP:** all codes equal RFC 6238 codes computed outside Firefox (U-6).
8. **Restart:** Firefox restarts, 0.9.1 is still active, the session is locked,
   `storage.session` is empty, and the master password unlocks (U-7). With signed builds
   on release Firefox, this is the automated evidence for issue #4.
9. U-signed is PASS only if U-1…U-7 all pass with both builds signed. The result is
   written to `docs/evidence/phase-c6/update-results.json`, or to `$RESULTS_DIR` if set.
   It closes issue #19 after review.

The same script without `--old`/`--new` runs the unsigned simulation on Firefox ESR in
CI. That one never sets U-signed to PASS.

## 8. Stage 2: AMO listed 1.0.0 (not prepared for execution)

Only after:

- #19 has passed;
- every release blocker is closed with evidence;
- the issue review has been accepted;
- the operator has explicitly approved the release.

Then:

1. Remove the development notice; `check:release` requires this for 1.x.
2. Set the version to 1.0.0 in `src/manifest.json` through a reviewed pull request.
3. `npm run release:source -- --version 1.0.0 --no-update-url`. This yields no
   `update_url` and prints `--channel listed`.
4. Prepare the listing in German and English from [AMO-LISTING.md](AMO-LISTING.md):
   - MIT license;
   - attribution to Rayquaza01/authenticator;
   - screenshots with synthetic data only.
5. **A listed submission is a public submission.** It enters Mozilla's review and is
   published after approval. Submit with `web-ext sign --channel listed` or in the AMO
   Developer Hub, and only with the operator's explicit 1.0 approval.

Not part of this procedure: signing automation in CI. Credentials stay out of CI until that
is explicitly approved (RELEASE.md §4a).
