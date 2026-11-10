# Troubleshooting setup

Symptom, cause, fix. Each fix ends on a check you can run. Start from the Quick start in the root
[`README.md`](../README.md).

## `pnpm: command not found`

**Cause:** pnpm was installed under a different Node version, or never enabled.
**Fix:** `corepack enable`, then `pnpm -v`. *Done when* it prints `12.5.1` (the version in `package.json`).

## `Cannot find module '../lightningcss.darwin-arm64.node'` (or `@rollup/rollup-darwin-arm64`)

**Cause (Apple silicon):** `node_modules` holds Intel (`x64`) binaries while Node runs as `arm64`. Either an Intel
Node under Rosetta ran the install, or pnpm itself is a cached Intel build (pnpm picks its binary by the
architecture of the Node that first downloaded it).
**Fix:**
1. `node -p process.arch` must print `arm64`. If it prints `x64`, install an arm64 Node 22+ and make it the default.
2. `rm -rf ~/.cache/node/corepack/v1/pnpm/12.5.1` (a cache; pnpm re-downloads it).
3. `rm -rf node_modules .next && pnpm install`.

*Done when* `ls node_modules/.pnpm | grep lightningcss-darwin` lists `lightningcss-darwin-arm64` only.

## `/sign-in` says "Can't reach the BenchQ backend"

**Cause:** the backend isn't running, or `BACKEND_URL` in `.env.local` points elsewhere (it defaults to
`http://localhost:8000` in development).
**Fix:** `docker compose up -d db backend`; `docker compose logs -f backend` shows why it stopped. Restart `pnpm dev`
after editing `.env.local`.
*Done when* `curl http://localhost:8000/health` returns `"status":"ok"` and `http://localhost:3000/health` shows the
same JSON.

## Sign-in answers 403 "Cross-origin request refused"

**Cause:** the backend accepts only the origins in `ALLOWED_ORIGINS` (the defaults include `http://localhost:3000`).
`127.0.0.1`, another port or your network address is refused.
**Fix:** open `http://localhost:3000`. Another port needs its origin added to `ALLOWED_ORIGINS` in `backend/.env`.

## Sign-in answers "Email or password is incorrect" for a demo account

**Cause:** the demo accounts aren't loaded, or the database was reset.
**Fix:** `docker compose exec backend python -m backend.scripts.seed_demo` (add `--reset` to start over).
*Done when* it prints `Seeded: …`.

## `pnpm dev` says another server is running, or port 3000 is taken

**Cause:** a `next dev` or `next start` is already using this folder or port.
**Fix:** `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then stop that process.

## A `.env.local` change has no effect

**Cause:** `NEXT_PUBLIC_*` values are baked in when `pnpm dev` starts.
**Fix:** restart `pnpm dev`. `NEXT_PUBLIC_LIVE_MODULES` takes comma-separated module names only
(`companies,jobs`); anything else, such as a pasted command, names a module that doesn't exist.

## The backend stops at start: an `alembic_version` error

**Cause:** the database has tables but was never stamped by Alembic (an old pre-Alembic dev database).
**Fix:** the error message names two ways out. `docker compose down -v` starts over with an empty database (dev data is
lost), or check out commit `14ba662` and start the backend once to stamp it.

## Autofill entries left by the first migration 0019

**Cause:** your database ran PR 118's first migration 0019 (on its branch before 2026-11-08). That version filled
every résumé version's `resumes.autofill` with its built answers, as `{question: answer}`. The app reads none of that
now (it reads only the `edited` and `custom` entries, docs/02 §8.1), but the rows keep it.
**Fix:** with your database at 0019, `docker compose exec backend python -m alembic -c backend/alembic.ini downgrade
0018`, then `docker compose restart backend`: the backend upgrades on start, and 0019 adds the column back empty. The
downgrade puts `candidates.qa_bank` back empty on the way, and the upgrade drops it again. A database that never ran
the first 0019 needs nothing.

## `docker compose build` fails with exit code 2

**Cause:** the image build downloads a CLI from Google, and that download occasionally fails.
**Fix:** run the same build again; earlier layers are cached.
