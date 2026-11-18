# Development and Git conventions

## Repository

| Role | Location |
|---|---|
| Authority (private) | Forgejo `shotte/compact-totp-authenticator` – private Forgejo backup (address not published) |
| Remote `origin` | `private Forgejo backup (SSH address not published)` |
| Public mirror | optional, GitHub, not configured yet |

Forgejo is the single source of truth. A GitHub mirror, if added, receives only `main` and
release tags from Forgejo and never accepts direct changes.

## Branches

- `main`: reviewed state only. No direct commits, no automatic merges, no force pushes.
  Changes arrive through a reviewed pull request on Forgejo.
- `feature/<phase-or-topic>` (e.g. `feature/phase-b`), `fix/<topic>`: development branches,
  pushed to `origin` with upstream tracking.
- History is never rewritten on pushed branches (no `--force`, no rebase of pushed commits).

## Commits

- Atomic: one logical change per commit; tests and docs travel with the code they cover.
- Subject in English, imperative, ≤ 72 characters; body explains why.
- AI-assisted commits carry a `Co-Authored-By:` trailer.
- Line endings are normalized to LF (`.gitattributes`).

## Never commit

Credentials, API tokens (Forgejo, AMO JWT), `.env` files, private keys, real TOTP secrets,
real passwords or recovery codes, real `totp.json` / `*.cta.json` exports. Test data is
synthetic only (RFC test keys, generated fixtures, the public demo key `JBSWY3DPEHPK3PXP`).
`.gitignore` blocks the common file names; it is not a substitute for checking.

Pre-push check (Git Bash), run before every push:

```sh
git grep -nIiE "(api[_-]?key|secret[_-]?key|token|passw(or)?d)\s*[:=]\s*['\"][^'\"]{6,}" -- . ':!*.md'
git grep -nIoE "\b[A-Z2-7]{16,}\b" | grep -v JBSWY3DPEHPK3PXP
git grep -nIE "BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE"
```

Every hit must be reviewed and proven synthetic before pushing.

## Mirror note

Commit metadata contains the author e-mail from the local Git configuration. Review this
before enabling a public mirror.
