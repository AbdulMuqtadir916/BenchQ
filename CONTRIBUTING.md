# Contributing to BenchQ

How the team works in this repo. The product and code rules are in `CLAUDE.md`, and they apply to people and
agents alike. Read it first, then `product.md` once.

## First day

Follow "First day" in [`docs/integration/README.md`](docs/integration/README.md): clone, env files, Docker,
`pnpm dev`, then sign in with a seeded account. Then ask for a starter task. Module tracks are handed out from
the [module board](docs/integration/README.md#module-board) once the foundation (F1–F7) is done. Put your name
in **Owner** on the row you take.

## Branches and pull requests

- **Base branch:** `main`. Every branch starts from it, and every PR goes into it.
- **One branch per PR, one concern per PR.** Name it `feat/…`, `fix/…`, `docs/…`, `chore/…`, or
  `integrate/<module>` for a module track.
- **No stacked PRs.** If your work needs another open PR, wait for it to merge, then rebase onto the base
  branch.
- **Merge commits only**, never squash or rebase-merge, so each PR stays one unit in the history.
- Fill in the PR template. CI (typecheck, lint, tests, build, and backend tests on Postgres) must be green
  before review. Run the same commands locally first (`docs/integration/README.md`, "Running locally").
- Keep your branch current by merging or rebasing the base branch. Never force-push someone else's branch.

## Reviews

- Every PR needs **one approval** before merge.
- Contracts, permissions, auth, models, migrations, the route registry and `.github/` are listed in
  [`.github/CODEOWNERS`](.github/CODEOWNERS). They need the code owner's approval: **Abdul Muqtadir
  (@AbdulMuqtadir916), the product owner and only code owner.**
- GitHub doesn't let anyone approve their own PR. On a PR Abdul opens, a teammate reviews and approves it, and
  Abdul merges it with the branch-protection bypass that only he has.
- **No new entity, field or contract** without the product owner's sign-off, written into
  `docs/02-DATA-CONTRACTS.md` or `docs/07-ROUTES-AND-RBAC.md` first (CLAUDE.md, "Conventions").
- When a doc and the code disagree, or a module file needs a product decision, stop and ask in the PR. Don't
  pick one yourself.

## Migrations

- Schema changes go through Alembic only, **one revision per PR**, with a real `downgrade()`
  (`docs/integration/README.md`, "Schema changes and the test database").
- Revisions form one line. If another PR merged a revision first, `test_migration_heads` fails on yours: rebase,
  set your revision's `down_revision` to the new head, and renumber the file.
- Never edit a revision that is already merged.

## Secrets

Each person uses their own keys (AI providers, Telegram, Gmail) in `backend/.env`, which is git-ignored.
Nothing secret goes in the repo, a fixture, a test or a PR description. There is no shared staging server
yet.

## Working with an agent (Claude, Codex)

Agents follow `CLAUDE.md`; Codex is pointed there by `AGENTS.md`. Brief a session with the prompt in
[`docs/integration/README.md`](docs/integration/README.md#briefing-a-claude-session), name the one module or
task it may touch, and review its diff the way you'd review a teammate's. You own what you open.

## Never commit

- `.env.local`, `backend/.env`, or any key or token
- `docs/ruflo-setup.md`
- The `AGENTS.md` block that `next dev` regenerates, if it changed only because the dev server rewrote it
