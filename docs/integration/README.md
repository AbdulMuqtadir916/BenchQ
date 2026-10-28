# Backend integration — start here

This folder is the plan for connecting the BenchQ frontend to the Python backend, one module at a
time. Each module has its own file with everything needed to do it: the endpoints, the response
shape, a field-by-field mapping, the known gaps, a task checklist, and how to know it's done.

**Read [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md) first.** The backend is becoming
multi-tenant (users, firms, roles, sessions) before any data module goes live; every track below starts
after that foundation and is firm-scoped from its first endpoint.

**If you are a Claude session:** read this file, then `07-auth-and-tenancy.md`, then the module file
you were assigned, then `CLAUDE.md`. Do only the module you were assigned. If the module file and the code disagree, or a
mapping needs a product decision, stop and ask.

---

## First day

Follow the **Quick start** in the root [`README.md`](../../README.md): clone, install, env files, backend, demo accounts,
`pnpm dev`, checks. A step that fails: [`docs/troubleshooting.md`](../troubleshooting.md).

**Then pick up a module:**

1. Find your track on the [module board](#module-board) (owners are assigned; see "Team and order" under it).
   Respect **Depends on**.
2. Read that module's file end to end.
3. Create your branch from `main`: `git checkout -b integrate/<module>`.
4. Follow [the workflow for one module](#the-workflow-for-one-module). If you use Claude, start it
   with the prompt in [Briefing a Claude session](#briefing-a-claude-session).
5. Open your PR **into `main`**.

To look inside the database, see [`database-viewer.md`](./database-viewer.md).

---

## The backend

The backend is **JobNavigator** (FastAPI + SQLAlchemy + PostgreSQL, MIT licence, upstream
`github.com/vesaias/JobNavigator`). It lives in `backend/` (Module 00 Part A). Its endpoint
reference is `docs/archive/BACKEND_API_FEATURES.md`; when the server runs, the live contract is at
`http://localhost:8000/docs`.

**It was built for one job-seeker, not a staffing firm.** It covers jobs, companies, applications,
resumes and AI tailoring well. It has no concept of candidates, BDEs, firms, roles, claim states,
evidence, follow-up tasks, documents or per-candidate inboxes. The plan to add firms, users, roles and
sessions is [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md); the product decisions behind the
rest are in [`06-open-decisions.md`](./06-open-decisions.md) (recommendations for D1–D4 in 07 §2).

---

## How data flows

```
Screen / component
   │  uses
   ▼
src/lib/hooks/use-<x>.ts        TanStack Query. Caching, loading/error state, invalidation.
   │  calls
   ▼
src/lib/api/<module>.ts         The adapter. The ONLY file that decides mock vs. real.
   │                    │
   │ isLive(module)?    │ otherwise
   ▼                    ▼
src/lib/api/http.ts     src/mocks/<module>.ts + src/mocks/data/<module>.json
   │                    (temporary — deleted as each module goes live)
   ▼
next.config.ts rewrite  /api/* → BACKEND_URL/api/*   (same origin, so the session cookie works)
   ▼
FastAPI backend
```

Rules that keep this clean:

- **Screens never change during integration.** They consume frontend types (`src/lib/schemas/`).
  If a screen needs to change, that's a product decision — raise it.
- **The backend's shape never leaks past the adapter.** Backend JSON is parsed by a DTO schema and
  converted by a mapper in `src/lib/api/dto/<module>.ts`. Nothing else imports a DTO type.
- **Never edit `src/lib/schemas/` to match the backend.** Those are the frontend's contract. Map to
  them. If a field truly can't be produced, document it in your module file's "Gaps" section and
  ask.

---

## Files you will touch in every module

| File | What you do |
|---|---|
| `src/lib/api/dto/<module>.ts` | **Create.** `Backend<Thing>Schema` (Zod, snake_case, mirrors the backend serializer exactly) + `to<Thing>()` mapper. |
| `src/lib/api/dto/<module>.test.ts` | **Create.** Mapper tests, fed by a real response saved in `src/lib/api/dto/__samples__/<module>.json`. |
| `src/lib/api/<module>.ts` | **Edit.** Add the live branch (template below), then remove the mock branch when done. |
| `src/mocks/<module>.ts`, `src/mocks/data/<module>.json` | **Delete** in the final step. |
| `docs/integration/README.md` | **Edit** the status board below. |

Shared files you should **not** need to edit: `http.ts`, `config.ts` (every module name is
already listed), `client.ts`, `dto/shared.ts`. If you do, say so in the PR.

### Adapter, DTO and mapper

Copy the ledger: [`01-ledger.md`](./01-ledger.md) walks the whole chain, backend and frontend, with the real
files (`src/lib/api/analytics.ts`, `LedgerEntryDto` / `toLedgerEntry` in `src/lib/api/dto/session.ts`,
`src/lib/api/live-ledger.test.ts`). In short:

```ts
const live = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), { query: params })).map(toLedgerEntry),
};

export const ledgerApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> =>
    isLive("ledger") ? live.list(firmId, params) : (await mock()).list(firmId, params),
};
```

The DTO is a Zod object in snake_case that mirrors the backend serializer exactly; the mapper returns the
frontend type parsed by its own schema. When the module is finished, the `isLive` check, the `mock` import
and the mock files all go.

**Timestamps:** FastAPI sends `2026-10-03T10:00:00+00:00` or a zone-less value, and the frontend
schemas reject both. Declare every backend timestamp as `z.string()` and convert with `toIso` /
`toIsoOrNull` from `src/lib/api/dto/shared.ts`.

---

## The workflow for one module

1. **Branch** `integrate/<module>` from `main`.
2. **Run both apps** (see "Running locally" below) and confirm `GET /health` through the proxy.
3. **Capture real responses** from the backend for each endpoint you need, by browser or
   `curl -b cookies.txt`, and save them to `src/lib/api/dto/__samples__/<module>.json`. Trim to a few
   rows. Write the DTO schema from the backend serializer named in your module file, then check it
   parses the sample.
4. **Write the mapper and its tests** against the sample. Every frontend field must be produced;
   anything the backend can't supply gets the default your module file specifies.
5. **Add the live branch** to the adapter. Set `NEXT_PUBLIC_LIVE_MODULES=<module>` (plus any
   dependencies listed in your module file; the session is always the backend's) and click through every screen listed in your module
   file.
6. **Check the states:** loading skeleton shows, an empty backend shows the empty state, and
   stopping the backend shows the error state (not a crash). There must be no `SCHEMA_MISMATCH` in
   the browser console.
7. **Delete the mock:** remove the `isLive` branch, the `mock` import, `src/mocks/<module>.ts` and
   its JSON file. Fix anything that imported them, such as `src/lib/derive/derive.test.ts`.
8. **Add your isolation cases.** Each new route goes into `backend/tests/isolation_cases.py`, and a new
   firm-owned table gets a row in `isolation_support.build_firm` (with a canary) and in `snapshot_of`.
   `test_isolation.py` then proves your routes never cross firms. Don't write your own isolation test
   ([07-auth F7](./07-auth-and-tenancy.md)).
9. **Update the status board** below and open a PR. The checks must pass.

### Definition of done (per module)

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all clean (Node 22 — see `.nvmrc`)
- [ ] Mapper has tests built from a real backend sample
- [ ] Every screen in the module file works against the real backend, in light and dark mode
- [ ] Skeleton, empty and error states verified with the backend running, empty and stopped
- [ ] No `SCHEMA_MISMATCH` in the console
- [ ] Mock code and JSON for the module deleted; no `isLive("<module>")` left
- [ ] Gaps you hit are written into the module file's "Gaps" section
- [ ] Every new route is in `backend/tests/isolation_cases.py`, and `test_isolation.py` passes

---

## Module board

**First the foundation, in order** (one PR each; [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md)
§3). Then the tracks run in parallel. A track's DTO, mapper and tests can be written before its
dependencies are live; only switching the adapter to live waits.

| # | Foundation step | Depends on | Owner | Status |
|---|---|---|---|---|
| 00 | [Monorepo + proxy](./00-foundation.md) (Part A; the old Parts B/C are in `docs/archive/`, replaced by F3/F6) | — | — | Done |
| F1 | Alembic baseline | 00 | — | Done (#29, #30) |
| F2 | Auth + tenancy tables; `firm_id` on existing tables, backfilled to a default firm | F1 | Abdul | F2a tables done (#33); F2b (`firm_id`, `firm_jobs`, migration 0005) built; F2c settings classified (`backend/settings_scope.py`) |
| F3 | Auth endpoints (sign-in/out, me, firm by slug, invites, support view) returning the frontend's `Session` | F2 | Abdul, Uzair | Done (#34, #36; support views: issue #56) |
| F4 | Python permission table mirroring `src/lib/auth/policy.ts` (comparison test) + the firm-scoping dependency | F2 | Abdul | Policy table + `require` done (#35); `scoped()` / `scoped_jobs()` + their lint test done for every firm route (#53, #54); support-view reads done (issue #56) |
| F5 | Seed script: the mocks' firms, accounts and data | F2 | Abdul | Done for firms, plans, accounts and invites (#38); module data lands with each track |
| F6 | Frontend session goes live (cookie, server-side principal, mock sign-in removed) | F3, F4, F5 | Abdul | Done (#40, #41, issues #62–#66). The session is the backend's cookie; a signed-out redirect in `src/proxy.ts`; the principal read on the server with real 404 / 403; no mock sign-in. Exit check on a production build recorded in 07 (2026-10-26) |
| F7 | Reusable cross-firm isolation test over every route | F4 | Uzair | Done (`backend/tests/test_isolation.py`) |

| Track | Module | Depends on | Owner | Status |
|---|---|---|---|---|
| 01 | [Ledger](./01-ledger.md) — the new `ledger_entries` table, not `activity_log_v2` (07 §6.6). **The worked example: copy it** | F1–F4 | Abdul | Live behind flag (`session,ledger`) |
| 02 | [Jobs (+ companies, capture, job marks)](./02-jobs.md) | F1–F7; shared-pool decision (07 §2) | Zuhair | Not started |
| — | Candidates (D1), with the firm hierarchy and onboarding: [`docs/candidate-onboarding/06-backend.md`](../candidate-onboarding/06-backend.md) | F1–F7; D1 (option 1, Q50) | Abdul (from Zuhair, 2026-10-27) | Built (PRs 1–5, 2026-10-27). Frontend live behind flag (`session,ledger,candidates`, onboarding 07b, 2026-10-28); the mock stays until Tracks 03/04 |
| — | Admin API (firms, plans, users, invites, platform team, audit) | F1–F7 | Uzair (after F7) | In progress: create firm, invites, read lists live behind flag (#36, #39, #40); firm edits, suspend, plans, limits, user deactivate, platform-team invites not started |
| 03 | [Applications](./03-applications.md) (10 statuses, D3) | 02, Candidates, D3 | Samad | Not started |
| 04 | [Resumes + claims + AI tailoring](./04-resumes-and-tailoring.md) (D4), then resume scoring (`cv_score`, `score-check`) | 02, Candidates, D4 | Zuhair | Not started |
| 05 | [Analytics](./05-analytics.md) | 03 | First free owner, after 03 | Not started |
| — | Job extension: capture and autofill, per-user access tokens (07 §2). Not in this repo yet (`backend/UPSTREAM.md`) | 02; a proposal signed off by the product owner | Samad | Proposal first |
| — | Gmail inbox per candidate (D8): OAuth, token storage, status updates on applications | Candidates, 03; a design signed off by the product owner | Samad | Design first |
| — | Production readiness: prod Docker config, the scheduler out of the API process (one worker until then), logging, a security pass; CI and test health | F7 | Uzair | Not started |
| — | [AI presets](./08-ai-presets.md): per-module presets (model + prompts) a Super Admin creates and switches. Every AI track reads its setup through `ai_config()` now | Zuhair's AI tracks | Abdul | Decided, not built (`ai_config` seam only) |
| 06 | [Open decisions](./06-open-decisions.md) | Product decision | Product owner | D1–D4 recommended in 07 §2 |

### Team and order (agreed 2026-10-23)

Abdul Muqtadir is the product owner, the only code owner and the reviewer of every PR (`CONTRIBUTING.md`).

- **Wave 1:** each owner rewrites their own module file for tenancy (`firm_id`, scoping, the ledger, Q37's
  D1–D4) against [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md), as their first PR. Abdul approves it
  before any code. Samad's wave-1 PR is the job-extension proposal and the Gmail (D8) design.
- **Abdul:** F2b (`firm_id` on the existing tables, `firm_jobs`), the firm-scoping helper, Ledger as the worked
  example, then F2c, the support-view endpoints and the rest of F6.
- **Zuhair:** Candidates, then job scraping (live once `firm_jobs` lands), then resume tailoring and claims,
  then resume scoring.
- **Samad:** the extension and Gmail designs, then the extension after Jobs, then Applications with the Gmail
  inbox after Candidates.
- **Uzair:** F7, CI and test health, production readiness, then the rest of the Admin API.

Status values: `Not started` → `In progress` → `Live behind flag` → `Done (mock deleted)`.

**Why this order:** nothing can be firm-scoped until there are firms and principals, so the foundation
comes first and alone. After it, 01 Ledger proves the whole pipeline (session cookie, scoping,
`http.ts`, DTO, mapper, error states) on one read-only screen. Jobs and Candidates come before
Applications and Resumes, which reference both. Mixing a live module with a mocked module it references
breaks joins, unless both use the seeded ids (F5 derives backend UUIDs from the fixture ids).

---

## Running locally

**Requirements:** Node 22+, pnpm 12.5.1 (`corepack enable`), Docker; the Quick start in the root `README.md` sets them up. Python
3.12 only if you run the backend outside Docker.

| Task | Command |
|---|---|
| Env files (once) | `cp .env.example .env.local` and `cp backend/.env.example backend/.env` |
| Start backend + database | `docker compose up -d db backend` (add `--build` after backend code changes) |
| Backend health | `curl http://localhost:8000/health` |
| Backend logs | `docker compose logs -f backend` |
| Demo accounts (local only) | `docker compose exec backend python -m backend.scripts.seed_demo`: the mocks' firms, users and invites; every account in docs/03 §3.2 signs in with `benchq-demo-2026`. `--reset` starts over. Refused when `BENCHQ_ENV` is production |
| First Super Admin (any environment) | `docker compose exec backend python -m backend.scripts.create_platform_admin --email you@example.com --name "Your Name"` (asks for the password twice); everyone else joins by invite |
| Reset someone's password (any environment) | `docker compose exec backend python -m backend.scripts.reset_password --email someone@example.com` (asks for the new password twice). Works for firm users and Super Admins, signs the account out everywhere and logs it. There is no self-service reset until email exists (07 Q39) |
| Stop backend + database | `docker compose stop` (data is kept in the `pgdata` volume) |
| Frontend | `pnpm dev`, then `http://localhost:3000/health` shows the backend's JSON |
| Switch a module to the backend | add it to `NEXT_PUBLIC_LIVE_MODULES` in `.env.local` (not `session` or `ledger`: those are always on), restart `pnpm dev` |
| Sign in, onboarding, `/admin` (F6) | Always the backend's. `docker compose up -d db backend`, seed the demo accounts (above), `pnpm dev`, open `http://localhost:3000` (not `127.0.0.1`: the backend checks the origin). Sign-in, `/invite/[token]`, the team list, the ledger and `/admin` firms, plans, users, invites, team and audit are live; every other module stays on mock data, and a demo account keeps its mock dashboards. Admin actions without an endpoint yet say "Not available on the live backend yet" |
| Backend tests (Postgres) | `docker compose up -d db-test backend`, then `docker compose exec -T backend python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider` (details in "Schema changes and the test database" below) |
| Create a migration | `docker compose exec backend alembic -c backend/alembic.ini revision --autogenerate -m "what changed"`, then review the file (below) |
| Look inside the database | [`database-viewer.md`](./database-viewer.md) (Adminer at `http://localhost:8081`) |

The env variables are documented inside `.env.example` (frontend) and `backend/.env.example`
(backend). Restart `pnpm dev` whenever `.env.local` changes, because `NEXT_PUBLIC_*` values are
baked in at start.

---

## Schema changes and the test database

The database schema changes **only through Alembic** (`backend/migrations/`). Nothing creates or alters
tables at startup any more: `docker compose up` runs `python -m backend.scripts.db_upgrade` before the API
starts (see the `CMD` in `Dockerfile.backend`), and the API refuses to start if the database is not at the
newest revision. Run **exactly one backend worker** until the scheduler leaves the API process
([07-auth-and-tenancy.md](./07-auth-and-tenancy.md), Q37).

### Make a schema change

1. Edit the model in `backend/models/db.py`.
2. Generate a revision against your running dev database:
   ```bash
   docker compose exec backend alembic -c backend/alembic.ini revision --autogenerate -m "add firms table"
   ```
   The file appears in `backend/migrations/versions/` (the folder is mounted, so it is on your disk).
3. **Read it.** Autogenerate misses sequences, check constraints, data fixes and renames (it sees a rename
   as drop + add). Fix those by hand. Write a real `downgrade()`.
4. Apply it: `docker compose exec backend python -m backend.scripts.db_upgrade`.
5. Run `docker compose exec -T backend alembic -c backend/alembic.ini check`. It must say no new operations.
   The test suite runs the same check (`test_models_and_migrations_agree`), so a model change without a
   revision fails the tests.

Never edit a revision that has been merged: add a new one. Never put schema changes in `seed.py`: it seeds
and tidies **data** only. The pre-Alembic startup path (`create_tables`, `seed.run_migrations`,
`migrate_h1b_to_visa_cache` and the bootstrap that called them) was deleted at F6 (issue #62).

### An existing dev database

`db_upgrade` only runs `alembic upgrade head`. A database that has tables but **no `alembic_version`** (one the
old startup path built and nobody started since Alembic landed) is refused with the fix in the message, and
nothing is changed. You are fine if `SELECT version_num FROM alembic_version` returns a row. If it doesn't, either:

1. keep the data: `git checkout 14ba662` (the last commit that still stamps), `docker compose up -d --build backend`
   once, then come back to your branch; or
2. start empty: `docker compose down -v` (this deletes the database volume), then `docker compose up -d db backend`.

The legacy schema path was deleted at F6 ([07-auth-and-tenancy.md](./07-auth-and-tenancy.md)).

### Tests run on Postgres

```bash
docker compose up -d db-test backend      # db-test is a throwaway Postgres on port 5433 (data in memory)
docker compose exec -T backend python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider
```

The schema is built once per run by `alembic upgrade head`, and every table is emptied before each test.
Tests refuse to run against a database whose name does not end in `_test`. To run pytest on your machine
instead of in the container, set `TEST_DATABASE_URL=postgresql://jobnavigator:password@localhost:5433/jobnavigator_test`.
A test that needs a row another table points to (a `Job` for `job_runs.target_job_id`, a `Search` for
`scrape_log.search_id`) must create it first: the foreign keys are real now (`tests/r4_support.make_job`).
CI (`.github/workflows/ci.yml`) runs the same command, plus the frontend's typecheck, lint, test and build,
on every PR into `main`. Run them locally before you open one.

---

## Briefing a Claude session

Paste this, changing the module:

> Read `docs/integration/README.md`, then `docs/integration/02-jobs.md`, then `CLAUDE.md`.
> Integrate the Jobs module following the workflow in the README. The backend is running at
> `BACKEND_URL` from `.env.local`. Work only on files the module doc lists. Stop and ask me before
> changing any file in `src/lib/schemas/`, any screen, or any shared file in `src/lib/api/`.
> When done, report against the module's acceptance criteria.
