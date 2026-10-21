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

## First day — from clone to your first module

**You need:** Git, Docker Desktop (running), and Node 22+. On an Apple-silicon Mac,
`node -p process.arch` must print `arm64`. If it prints `x64`, install an arm64 build first (see
"Known setup pitfalls" in `00-foundation.md`).

```bash
# 1. Get the code. All integration work starts from the main branch.
git clone https://github.com/samad-012/BenchQ.git && cd BenchQ
git checkout codex/json-data-migration

# 2. Frontend dependencies
nvm use                      # reads .nvmrc (Node 22)
corepack enable && pnpm install

# 3. Env files (both git-ignored; the defaults work for local development)
cp .env.example .env.local
cp backend/.env.example backend/.env

# 4. Backend + database. The first build takes several minutes (Playwright).
docker compose up -d --build db backend
curl http://localhost:8000/health        # {"status":"ok","service":"JobNavigator",...}

# 5. Frontend
pnpm dev                                 # http://localhost:3000
```

**Check it works:**

- `http://localhost:3000/health` shows the backend's health JSON. That means the frontend → backend
  proxy works.
- `http://localhost:3000/sign-in` renders, and a seeded account (docs/03 §3.2) signs in. Every screen
  still runs on mock data until a module is switched on (and, until foundation step F6, so does sign-in).
- `pnpm typecheck && pnpm lint && pnpm test` all pass.

**Then pick up a module:**

1. Choose the next free track on the [module board](#module-board) — respect **Depends on** — and
   put your name in **Owner**.
2. Read that module's file end to end.
3. Create your branch from `codex/json-data-migration`: `git checkout -b integrate/<module>`.
4. Follow [the workflow for one module](#the-workflow-for-one-module). If you use Claude, start it
   with the prompt in [Briefing a Claude session](#briefing-a-claude-session).
5. Open your PR **into `codex/json-data-migration`**.

Until foundation step F5 lands, the database starts empty apart from a few seeded companies; add data
through the backend's API docs at `http://localhost:8000/docs`. After F5, `backend/scripts/seed_demo.py`
loads the same firms, accounts and data as the mocks.
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

### Adapter template

```ts
// src/lib/api/analytics.ts — the ledger, as an example
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { isLive } from "./config";
import { http } from "./http";
import { BackendLedgerEntrySchema, toLedgerEntry } from "./dto/ledger";

const mock = () => import("@/mocks/ledger").then((m) => m.ledgerMock);

export const ledgerApi = {
  // Firm-scoped: every call names the firm (07-auth-and-tenancy §5, rule 1).
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => {
    if (!isLive("ledger")) return (await mock()).list(firmId, params);
    const rows = await http.get(`/api/firms/${firmId}/ledger`, arrayOf(BackendLedgerEntrySchema), { query: params });
    return rows.map(toLedgerEntry);
  },
};
```

When the module is finished, the `isLive` check, the `mock` import and the mock files all go.

### DTO + mapper template

```ts
// src/lib/api/dto/ledger.ts
import { z } from "zod";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { toIso } from "./shared";

export const BackendLedgerEntrySchema = z.object({
  id: z.string(),
  firm_id: z.string().nullable(),
  actor_user_id: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  summary: z.string(),
  created_at: z.string(),            // timestamps are ALWAYS z.string() here — see below
  // …the rest of LedgerEntry's fields, snake_case
});
export type BackendLedgerEntry = z.infer<typeof BackendLedgerEntrySchema>;

export function toLedgerEntry(row: BackendLedgerEntry): LedgerEntry { /* … */ }
```

**Timestamps:** FastAPI sends `2026-10-03T10:00:00+00:00` or a zone-less value, and the frontend
schemas reject both. Declare every backend timestamp as `z.string()` and convert with `toIso` /
`toIsoOrNull` from `src/lib/api/dto/shared.ts`.

---

## The workflow for one module

1. **Branch** `integrate/<module>` from `codex/json-data-migration`.
2. **Run both apps** (see "Running locally" below) and confirm `GET /health` through the proxy.
3. **Capture real responses** from the backend for each endpoint you need, by browser or
   `curl -b cookies.txt`, and save them to `src/lib/api/dto/__samples__/<module>.json`. Trim to a few
   rows. Write the DTO schema from the backend serializer named in your module file, then check it
   parses the sample.
4. **Write the mapper and its tests** against the sample. Every frontend field must be produced;
   anything the backend can't supply gets the default your module file specifies.
5. **Add the live branch** to the adapter. Set `NEXT_PUBLIC_LIVE_MODULES=<module>` (plus any
   dependencies listed in your module file) and click through every screen listed in your module
   file.
6. **Check the states:** loading skeleton shows, an empty backend shows the empty state, and
   stopping the backend shows the error state (not a crash). There must be no `SCHEMA_MISMATCH` in
   the browser console.
7. **Delete the mock:** remove the `isLive` branch, the `mock` import, `src/mocks/<module>.ts` and
   its JSON file. Fix anything that imported them, such as `src/lib/derive/derive.test.ts`.
8. **Update the status board** below and open a PR. The checks must pass.

### Definition of done (per module)

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all clean (Node 22 — see `.nvmrc`)
- [ ] Mapper has tests built from a real backend sample
- [ ] Every screen in the module file works against the real backend, in light and dark mode
- [ ] Skeleton, empty and error states verified with the backend running, empty and stopped
- [ ] No `SCHEMA_MISMATCH` in the console
- [ ] Mock code and JSON for the module deleted; no `isLive("<module>")` left
- [ ] Gaps you hit are written into the module file's "Gaps" section

---

## Module board

**First the foundation, in order** (one PR each; [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md)
§3). Then the tracks run in parallel. A track's DTO, mapper and tests can be written before its
dependencies are live; only switching the adapter to live waits.

| # | Foundation step | Depends on | Owner | Status |
|---|---|---|---|---|
| 00 | [Monorepo + proxy](./00-foundation.md) (Part A); Parts B/C are replaced by F3/F6 | — | | Part A done |
| F1 | Alembic baseline | 00 | | Not started |
| F2 | Auth + tenancy tables; `firm_id` on existing tables, backfilled to a default firm | F1 | | Not started |
| F3 | Auth endpoints (sign-in/out, me, firm by slug, invites, support view) returning the frontend's `Session` | F2 | | Not started |
| F4 | Python permission table mirroring `src/lib/auth/policy.ts` (comparison test) + the firm-scoping dependency | F2 | | Not started |
| F5 | Seed script: the mocks' firms, accounts and data | F2 | | Not started |
| F6 | Frontend session goes live (cookie, server-side principal, mock sign-in removed) | F3, F4, F5 | | Not started |
| F7 | Reusable cross-firm isolation test over every route | F4 | | Not started |

| Track | Module | Depends on | Owner | Status |
|---|---|---|---|---|
| 01 | [Ledger](./01-ledger.md) — the new `ledger_entries` table, not `activity_log_v2` (07 §6.6) | F1–F7 | | Not started |
| 02 | [Jobs (+ companies, capture, job marks)](./02-jobs.md) | F1–F7; shared-pool decision (07 §2) | | Not started |
| — | Candidates (D1) | F1–F7; D1 | | Not started |
| — | Admin API (firms, plans, users, invites, platform team, audit) | F1–F7 | | Not started |
| 03 | [Applications](./03-applications.md) (10 statuses, D3) | 02, Candidates, D3 | | Not started |
| 04 | [Resumes + claims + AI tailoring](./04-resumes-and-tailoring.md) (D4) | 02, Candidates, D4 | | Not started |
| 05 | [Analytics](./05-analytics.md) | 03 | | Not started |
| 06 | [Open decisions](./06-open-decisions.md) | Product decision | Product owner | D1–D4 recommended in 07 §2 |

Status values: `Not started` → `In progress` → `Live behind flag` → `Done (mock deleted)`.

**Why this order:** nothing can be firm-scoped until there are firms and principals, so the foundation
comes first and alone. After it, 01 Ledger proves the whole pipeline (session cookie, scoping,
`http.ts`, DTO, mapper, error states) on one read-only screen. Jobs and Candidates come before
Applications and Resumes, which reference both. Mixing a live module with a mocked module it references
breaks joins, unless both use the seeded ids (F5 derives backend UUIDs from the fixture ids).

---

## Running locally

**Requirements:** Node 22+ (`nvm use`), pnpm via corepack, Docker. Python 3.12 only if you run
the backend outside Docker.

| Task | Command |
|---|---|
| Env files (once) | `cp .env.example .env.local` and `cp backend/.env.example backend/.env` |
| Start backend + database | `docker compose up -d db backend` (add `--build` after backend code changes) |
| Backend health | `curl http://localhost:8000/health` |
| Backend logs | `docker compose logs -f backend` |
| Demo accounts (local only) | `docker compose exec backend python -m backend.scripts.seed_demo`: the mocks' firms, users and invites; every account in docs/03 §3.2 signs in with `benchq-demo-2026`. `--reset` starts over. Refused when `BENCHQ_ENV` is production |
| First Super Admin (any environment) | `docker compose exec backend python -m backend.scripts.create_platform_admin --email you@example.com --name "Your Name"` (asks for the password twice); everyone else joins by invite |
| Stop backend + database | `docker compose stop` (data is kept in the `pgdata` volume) |
| Frontend | `pnpm dev`, then `http://localhost:3000/health` shows the backend's JSON |
| Switch a module to the backend | add it to `NEXT_PUBLIC_LIVE_MODULES` in `.env.local`, restart `pnpm dev` |
| Onboarding on the real backend (07 Q38) | `NEXT_PUBLIC_LIVE_MODULES=session` and `BACKEND_URL=http://localhost:8000` in `.env.local`, seed the demo accounts (above), restart `pnpm dev`, open `http://localhost:3000` (not `127.0.0.1`: the backend checks the origin). Sign-in, `/invite/[token]`, the team list and `/admin` firms, plans, users, invites, team and audit are live; every other module stays on mock data, and a demo account keeps its mock dashboards. Admin actions without an endpoint yet say "Not available on the live backend yet" |
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
and tidies **data** only. `seed.run_migrations`, `models.db.create_tables` and `migrate_h1b_to_visa_cache`
are frozen: only `backend/migrations/legacy_bootstrap.py` calls them, for databases that predate Alembic.

### An existing dev database

**Your existing database is stamped automatically on first start.** You do nothing: pull, then
`docker compose up -d --build backend`. The first time `db_upgrade` sees tables but no `alembic_version`, it
runs the legacy bootstrap once (a no-op on a database that is already current), then **stamps** it at
revision `0001` and upgrades it to head like any other database. Nothing is re-created and no data changes. Do not drop your database or its volume.
The legacy path is deleted at F6 ([07-auth-and-tenancy.md](./07-auth-and-tenancy.md)), so start the backend
once on this version before then.

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
on every PR into `codex/json-data-migration`. Run them locally before you open one.

---

## Briefing a Claude session

Paste this, changing the module:

> Read `docs/integration/README.md`, then `docs/integration/02-jobs.md`, then `CLAUDE.md`.
> Integrate the Jobs module following the workflow in the README. The backend is running at
> `BACKEND_URL` from `.env.local`. Work only on files the module doc lists. Stop and ask me before
> changing any file in `src/lib/schemas/`, any screen, or any shared file in `src/lib/api/`.
> When done, report against the module's acceptance criteria.
