# Module 00 — Foundation: the monorepo

**Difficulty:** Easy · **Depends on:** nothing · **Unblocks:** every other module

## Goal

One repo containing both apps and a backend you can start with one command. **Done.** The frontend
connection and sign-in came later, in F3 and F6.

## Already done (don't redo)

- `src/lib/api/http.ts` — fetch wrapper: relative `/api/...` paths, `credentials: "include"`,
  FastAPI `{detail}` errors → `ApiError`, Zod check on every response (`SCHEMA_MISMATCH` on drift).
- `src/lib/api/config.ts` — `isLive(module)`, driven by `NEXT_PUBLIC_LIVE_MODULES`.
- `src/lib/api/dto/shared.ts` — `toIso` / `toIsoOrNull` timestamp normalisation, with tests.
- `next.config.ts` — proxies `/api/*` and `/health` to `BACKEND_URL` when it's set.
- ESLint ignores `backend/**`; `.gitignore` covers Python artifacts.
- **Part A (below) is done** and merged into `codex/json-data-migration` (#1): `backend/` copied from
  JobNavigator `cdc7273`, compose trimmed to `db` + `backend`, `.dockerignore` added, stack built
  and verified (health, proxy, backend tests).

---

## Part A — Bring the backend into this repo

Layout after this step (Next.js stays at the root; nothing in `src/` moves):

```
BenchQ/
├── backend/              ← JobNavigator's backend/ package, copied unchanged
│   ├── LICENSE           ← JobNavigator's MIT licence (required by the licence)
│   └── UPSTREAM.md       ← which upstream commit this copy came from
├── docker-compose.yml    ← Postgres + backend only
├── Dockerfile.backend
├── pytest.ini
├── src/ …                ← the frontend, unchanged
└── package.json …
```

The folder must be named `backend/`: the code imports itself as `backend.*`
(`uvicorn backend.main:app`) and `pytest.ini` points at `backend/tests`.

### Steps

1. From the JobNavigator checkout, copy into the repo root:
   - `backend/` → `backend/`
   - `Dockerfile.backend`, `pytest.ini`, `docker-compose.yml` → repo root
   - `LICENSE` → `backend/LICENSE`
   - `.env.example` → `backend/.env.example`

   **Don't copy** `frontend/`, `extension/`, `Caddyfile`, root `tests/` (end-to-end tests for
   JobNavigator's own UI) or `docs/`.
2. Write `backend/UPSTREAM.md` with the source repo URL and commit
   (`git -C <jobnavigator> rev-parse HEAD`), so upstream fixes can be pulled in later.
3. Edit `docker-compose.yml`:
   - delete the `frontend` and `caddy` services and the `caddy_data` / `caddy_config` volumes;
   - on `backend`, change `env_file: .env` → `backend/.env` with `required: false`. This keeps
     backend secrets out of the root `.env*` files that Next.js auto-loads, and the stack still
     starts without the file;
   - rename the backend `image:` to a local tag (`benchq-backend:local`), so Compose never pulls
     upstream's prebuilt image in place of this copy;
   - keep `db`, `backend`, `pgdata`, and the auth volumes the backend service mounts.
4. `cp backend/.env.example backend/.env` and make sure `backend/.env` is git-ignored (the root
   `.gitignore` rule `.env*` already covers it).
5. Check nothing in the frontend picked the backend up: `pnpm typecheck && pnpm lint && pnpm build`.

### Run it

```bash
docker compose up -d --build db backend      # first build takes a few minutes (Playwright)
curl http://localhost:8000/health             # {"status":"ok","service":"JobNavigator",...}

# backend tests (Postgres; since F1 -- see "Schema changes and the test database" in README.md)
docker compose up -d db-test
docker compose exec -T backend \
  python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider
```

Python alternative, if you'd rather not rebuild the image while editing the backend:

```bash
docker compose up -d db
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
export DATABASE_URL=postgresql://jobnavigator:password@localhost:5432/jobnavigator
python -m backend.scripts.db_upgrade          # builds / upgrades the schema (Alembic); the API will not start without it
uvicorn backend.main:app --reload --port 8000
```

(The `db` service already publishes Postgres on `127.0.0.1:5432`.)

The backend seeds its tables on startup (`Base.metadata.create_all`). It starts empty, so to get
real data into it use JobNavigator's own flows — add companies and run a scrape, or
`POST /api/jobs/manual` — via `http://localhost:8000/docs`.

---

---

## Acceptance criteria

- [x] `docker compose up -d db backend` starts a healthy backend from a clean clone
- [x] `http://localhost:3000/health` returns the backend's health JSON
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; backend tests pass
      (`pytest`, run from the repo root)

Connecting the frontend and sign-in: [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md) (F3, F6). Setup and
failures: `README.md` Quick start, [`docs/troubleshooting.md`](../troubleshooting.md).
