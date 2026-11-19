# AMO unlisted signing and the signed update test (Phase D2/D3)

Status: **prepared, not executed.** No AMO account, API credentials, submission, signed
build, tag, release or published update manifest exists. Every step marked **operator**
needs Ralf's explicit authorization at the time it is done.

## 1. What gets signed

Signing happens only through Mozilla's add-on service (AMO). Self-distributed ("unlisted")
add-ons are signed by AMO but not listed there. Each version number can be signed only
once per add-on ID, forever. The extension ID `{f587432b-b553-483e-b08d-4feac6378113}`
never changes (RELEASE.md §2).

| Build | Version | `update_url` | Purpose |
|---|---|---|---|
| Signed update test, old | 0.9.0 | `https://127.0.0.1:47811/updates.json` | installed first in a test profile |
| Signed update test, new | 0.9.1 | same | delivered by the local update server |
| First distribution build | 1.0.0 (later) | operator decision, HTTPS (RELEASE.md §4) | needs the release decision, the manual acceptance and the passed signed update test |

The test builds point to `127.0.0.1`, so they never update from the internet. That is
harmless if one is installed elsewhere by mistake. The numbers 0.9.0 and 0.9.1 are used up
by these builds; 1.0.0 stays free.

## 2. Preparation (no credentials, no network)

```sh
git switch main && git pull --ff-only     # sign only reviewed, merged code
npm ci --ignore-scripts
npm test && npm run lint && npm run build && npm run check:release
npm run release:source -- --version 0.9.0 --test-update
npm run release:source -- --version 0.9.1 --test-update
```

`release:source` writes `dist/signing/<version>/`, which is ignored by git:

- `source/`: a copy of `src/` with only `version` and `update_url` changed;
- `SHA256SUMS`: the hash of every file;
- `release-source.json`: version, URL, purpose and source commit.

It runs `web-ext lint --self-hosted --warnings-as-errors` and `scripts/check-release.mjs`
on the result. It exits with an error if `src/` has uncommitted changes; never sign such a
build. It prints the signing command but does not run it.

## 3. AMO account and API credentials (operator, once)

1. Sign in at <https://addons.mozilla.org/developers/> with the account that will own the
   add-on, and accept the developer agreement.
2. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>
   (JWT issuer = API key, JWT secret = API secret).
3. Keep them outside every repository, outside CI and outside chat. Set them only in the
   shell that signs, and clear them afterwards:

   ```sh
   # PowerShell
   $env:WEB_EXT_API_KEY = Read-Host "AMO JWT issuer"
   $env:WEB_EXT_API_SECRET = Read-Host "AMO JWT secret" -MaskInput
   # ... sign ...
   Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET
   ```

   `.gitignore` already excludes `.env`, `.amo-credentials*`, `*.xpi` and `dist/`.

## 4. Signing (operator, after authorization)

`web-ext` reads `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from the environment, so the
values never appear on the command line or in the shell history:

```sh
npx web-ext sign --channel unlisted --source-dir dist/signing/0.9.0/source --artifacts-dir dist/signing/0.9.0/signed
npx web-ext sign --channel unlisted --source-dir dist/signing/0.9.1/source --artifacts-dir dist/signing/0.9.1/signed
```

- The first submission creates the unlisted add-on with the fixed ID; later versions are
  added to it.
- No source-code upload is needed: the code is not minified or generated (RELEASE.md §3).
- Unlisted submissions pass automated validation and are usually signed within minutes.
  Mozilla may review them later. If `web-ext` stops waiting, rerun with
  `--approval-timeout 0` and download the signed XPI from the AMO developer page later.
- Record for each version: the AMO version page, the XPI's SHA-256 and the date. Keep the
  signed XPIs outside the repository. They are release artifacts and not published until
  the release decision.

## 5. Signed update test (Phase D3)

Run on **release** Firefox (Windows, as the operator's main platform). Signature checks
stay on; the script refuses nothing on purpose and fails if a build is not signed.

```sh
node test/browser/update-test.mjs --old dist/signing/0.9.0/signed/<file>.xpi --new dist/signing/0.9.1/signed/<file>.xpi
```

What happens, automatically and with synthetic data only:

1. A throwaway profile is created. A certificate for `127.0.0.1` is made for this run and
   trusted only in that profile. The HTTPS update server starts on port 47811 and serves
   `updates.json` and the new XPI with its SHA-256.
2. **Installation:** 0.9.0 is installed permanently through AddonManager and must report a
   signed state (U-1).
3. **Encrypted vault creation:** master password, 18 synthetic accounts (all algorithms,
   digits and periods), a non-default order and non-default settings.
4. **Upgrade through the real update mechanism:** `findUpdates()` reads `update_url`,
   fetches `updates.json`, downloads 0.9.1, checks the hash and signature, and installs it
   (U-2). The ID and moz-extension UUID must stay the same (U-3).
5. **Preservation:** `storage.local` byte-identical, vault not reinitialized (U-4).
6. **Master-password authentication:** a wrong password is refused, the right one unlocks;
   accounts, order and revision are unchanged (U-5).
7. **TOTP generation:** all codes equal RFC 6238 codes computed outside Firefox (U-6).
8. **Session locking after restart:** Firefox restarts, 0.9.1 is still active, the session
   is locked, `storage.session` is empty, and the master password unlocks (U-7).
9. U-signed is PASS only if U-1…U-7 all pass with both builds signed. The result file is
   `docs/evidence/phase-c6/update-results.json` (or `$RESULTS_DIR`).

The same script without `--old/--new` runs the unsigned simulation on Firefox ESR in CI.
That one never sets U-signed to PASS.

Additionally, by hand, once: install the signed 0.9.0 in the operator's normal Firefox
profile from the XPI file (about:addons → gear → "Install Add-on From File"). Confirm that
it stays installed after a restart, then remove it. This covers issue #4 with a signed
build.

## 6. Not part of this procedure

- Listed AMO distribution (RELEASE.md §4b).
- Publishing `updates.json` or signed XPIs (GitHub Pages or Releases). That needs the
  release decision and the production `update_url`.
- Signing automation in CI: credentials stay out of CI until explicitly approved
  (RELEASE.md §4a).
