# Development and Git conventions

## Repositories

| Role | Location | Visibility |
|---|---|---|
| **Primary (authoritative)** – development, pull requests, issues, CI, releases | [github.com/Shotte/compact-totp-authenticator](https://github.com/Shotte/compact-totp-authenticator) | public |
| Backup – read-only pull mirror of GitHub | private Forgejo backup (address not published) | private |

Local remotes: `origin` → GitHub, `forgejo` → private Forgejo backup. Changes are only ever
pushed to GitHub. The backup never accepts direct changes; there is no bidirectional sync.

## Pull-request workflow

- `main` holds reviewed state only. Every change arrives through a pull request from a
  `feature/<topic>` or `fix/<topic>` branch.
- Branch protection on GitHub `main`: pull request required (0 approvals while there is a
  single operator), status check `test` required, applies to administrators, no force
  pushes, no deletion.
- History on pushed branches is never rewritten (no `--force`, no rebase of pushed commits).
- Merging into `main` is done by the operator after review; agents never merge.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and
on pushes to `main`:

| Job | Runner | Content |
|---|---|---|
| `test` (required check) | Ubuntu | `npm ci`, `npm test` (unit, regression, static, crypto, portability), `npm run lint` (`scripts/lint.mjs`: web-ext lint, every warning fails except the desktop-only Android note), `npm run build` |
| `unit` | Windows, macOS | `npm test`, lint |
| `browser` (headless) | Ubuntu: Firefox release, current ESR, final ESR 140 (140.17.0esr = `strict_min_version`); Windows and macOS: Firefox release | WebDriver BiDi integration suite; results uploaded as artifacts (`browser-results-*`) |

Headless runs cannot exercise the real toolbar popup; those checks appear as `NOT_TESTED`
in the results, together with checks that need privileged chrome scope (unavailable in
Firefox ESR 140). Firefox versions follow the hosted runner images for "release" (they can
lag one version behind); ESR builds come directly from Mozilla.

### Platform coverage

| Area | Windows | Linux | macOS |
|---|---|---|---|
| Unit, crypto, static, portability tests | CI | CI | CI |
| Vault format portability (committed fixture) | CI | CI | CI |
| Popup document layout, appearance, hover, focus (headless BiDi) | CI | CI (+ ESR 153, ESR 140) | CI |
| Locking, auto-lock alarm, event page restart (headless BiDi) | CI | CI | CI |
| Real toolbar popup: size, scrolling, highlight, hover, click-to-copy | operator desktop (`test:browser:os`) | manual_review | manual_review |
| Native file dialogs, keyboard shortcut, visual review | manual_review | manual_review | manual_review |
| Browser restart, persistent encrypted storage (real kill/restart) | C2 browser tests (operator) | C6 | C6 |
| PBKDF2 unlock latency on representative hardware | C2 (operator machine) | C6 | C6 |

Supported platform: **Firefox for desktop only** (Windows, macOS, Linux; Firefox 140 or newer).

- Android: not tested and not supported. The manifest has no `gecko_android` key, so AMO
  does not list CTA for Firefox for Android. `check:release` and `test/static.test.mjs`
  fail if the key comes back. Android support would need its own tests and decision.
- iOS/iPadOS: out of scope.

- Trigger is `pull_request`, never `pull_request_target`: workflows from forks run with a
  read-only token and without secrets. Default workflow token permission is read-only.
- Actions are pinned to commit SHAs; only GitHub-owned actions are allowed.
- Fork pull requests from outside contributors need approval before workflows run.
- `npm run test:browser:os` (real Windows mouse input in the toolbar popup) needs a
  Windows desktop; it runs on the operator machine
  before review and their evidence is committed under `docs/evidence/`.
- No signing credentials exist in the repository or in CI. Mozilla signing is not
  automated yet (see [RELEASE.md](RELEASE.md)).

## Releases

The operator owns releases: version bump, signed build via AMO (unlisted), GitHub Release
with the signed XPI, and the self-hosted `update_url` before stable distribution. Details
and checklist: [RELEASE.md](RELEASE.md).

## Commits

- Atomic: one logical change per commit; tests and docs travel with the code they cover.
- Subject in English, imperative, ≤ 72 characters; body explains why.
- AI-assisted commits carry a `Co-Authored-By:` trailer.
- Author identity: `Shotte <6080354+Shotte@users.noreply.github.com>` (repository-local
  `git config`), so no private e-mail address enters the public history.
- Line endings are normalized to LF (`.gitattributes`).

## Never commit

Credentials, API tokens (GitHub, AMO JWT), `.env` files, private keys, real TOTP secrets,
real passwords or recovery codes, real `totp.json` / `*.cta.json` exports, private
infrastructure addresses, personal e-mail addresses. Test data is synthetic only (RFC test
keys, generated `CTA-SYNTHETIC-*` fixtures, the public demo key `JBSWY3DPEHPK3PXP`).

Pre-push check (Git Bash), run before every push:

```sh
git grep -nIiE "(api[_-]?key|secret[_-]?key|token|passw(or)?d)\s*[:=]\s*['\"][^'\"]{6,}" -- . ':!*.md' ':!package-lock.json'
git grep -nIoE "\b[A-Z2-7]{16,}\b" -- . ':!package-lock.json' | grep -vE "JBSWY3DPEHPK3PXP|ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
git grep -nIE "BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE"
git log --format='%ae %ce' origin/main..HEAD | sort -u   # must show only the noreply address
```

Every hit must be reviewed and proven synthetic before pushing.

## History rewrite before publication (2026-11-18)

Before the first public push, the history was rewritten once, with operator approval, in a
separate clone: author and committer e-mail → noreply address, and the private Forgejo
host/port in this file → neutral text. Names, dates, messages and all other content are
unchanged (verified commit by commit). Branch heads, old → new:

| Branch | Before (private) | Published |
|---|---|---|
| `main` | `158cf06` | `8cb3576` |
| `feature/b0-security-spike` | `d82b8fd` | `6e9be00` |
| `feature/phase-b` | `02ddd55` | `a773736` |

The original history is archived privately by the operator (verified Git bundle); it is
not published. Old SHAs mentioned in earlier reports refer to that archive.

## Backup: GitHub → private Forgejo pull mirror

The Forgejo backup is a **private pull mirror** of the public GitHub repository, created
2026-11-18 under the same repository name: Forgejo fetches all branches and tags from
`https://github.com/Shotte/compact-totp-authenticator.git` every hour. GitHub needs no
credentials for this (public repository). The mirror is read-only: it accepts no pushes,
and Forgejo never pushes anywhere, so synchronization is strictly one-way.

The pre-publication history (original e-mail, private address) is not part of the mirror;
it is kept by the operator as verified Git bundles outside both repositories.

Verification (Git Bash, both remotes configured):

```sh
git fetch origin && git fetch forgejo
diff <(git ls-remote --heads --tags origin | sort -k2) <(git ls-remote --heads --tags forgejo | sort -k2) && echo "in sync"
```

A difference shortly after a push is expected until the next mirror interval; Forgejo's
"Synchronize now" triggers an immediate update.
