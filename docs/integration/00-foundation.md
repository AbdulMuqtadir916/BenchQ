# Module 00 — Foundation: monorepo, connection, auth

**Difficulty:** Easy · **Depends on:** nothing · **Unblocks:** every other module

## Goal

One repo containing both apps, a backend you can start with one command, a frontend that reaches
it through the Next.js proxy, and a sign-in that gets the backend's session cookie.

## Already done (don't redo)

- `src/lib/api/http.ts` — fetch wrapper: relative `/api/...` paths, `credentials: "include"`,
  FastAPI `{detail}` errors → `ApiError`, Zod check on every response (`SCHEMA_MISMATCH` on drift).
- `src/lib/api/config.ts` — `isLive(module)`, driven by `NEXT_PUBLIC_LIVE_MODULES`.
- `src/lib/api/dto/shared.ts` — `toIso` / `toIsoOrNull` timestamp normalisation, with tests.
- `next.config.ts` — proxies `/api/*` and `/health` to `BACKEND_URL` when it's set.
- ESLint ignores `backend/**`; `.gitignore` covers Python artifacts.
- **Part A (below) is done** and merged into `codex/json-data-migration` (#1): `backend/` copied from
  JobNavigator `cdc7273`, compose trimmed to `db` + `backend`, `.dockerignore` added, stack built
  and verified (health, proxy, backend tests). Parts B and C remain.

### Known setup pitfalls

- **Apple-silicon Macs:** if `node -p process.arch` prints `x64`, your Node is an Intel build under
  Rosetta. Next.js warns about it, and Vitest fails with `Cannot find module
  '@rollup/rollup-darwin-arm64'` the moment you switch to a native Node. Install an arm64 Node 22,
  then `rm -rf node_modules && pnpm install`.
- **Backend image build** fetches the Antigravity CLI from Google during `docker compose build`.
  That download occasionally fails (exit code 2); rerun the build, since earlier layers are cached.

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
     starts without the file (open first-run mode);
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

# backend tests (in-memory SQLite, no Postgres needed)
docker compose exec -T -e DATABASE_URL=sqlite:///:memory: backend \
  python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider
```

Python alternative, if you'd rather not rebuild the image while editing the backend:

```bash
docker compose up -d db
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
DATABASE_URL=postgresql://jobnavigator:password@localhost:5432/jobnavigator \
  uvicorn backend.main:app --reload --port 8000
```

(The `db` service already publishes Postgres on `127.0.0.1:5432`.)

The backend seeds its tables on startup (`Base.metadata.create_all`). It starts empty, so to get
real data into it use JobNavigator's own flows — add companies and run a scrape, or
`POST /api/jobs/manual` — via `http://localhost:8000/docs`.

---

## Part B — Connect the frontend

> Still valid for the proxy check; sign-in goes live in 07-auth-and-tenancy F6.

1. `cp .env.example .env.local`. The template already has `BACKEND_URL=http://localhost:8000`.
2. `pnpm dev`, open `http://localhost:3000/health` → backend JSON. That proves the proxy.
3. Nothing else needs to change yet: with `NEXT_PUBLIC_LIVE_MODULES` empty, every screen still runs
   on mocks.

---

## Part C — Auth

> **Superseded (2026-10-21)** by [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md): the shared API
> key is removed, not wired into the frontend. Sign-in becomes per-user sessions (07 §3, F3 and F6). Kept
> below as a record of how the backend authenticates today.

### How the backend authenticates

- One shared key, stored in the backend's `dashboard_api_key` setting (seeded from
  `INITIAL_API_KEY`).
- `POST /api/auth/set-session` with `{"api_key": "..."}` sets an HTTP-only `jn_session` cookie
  (`SameSite=Strict`, 30 days). Because the frontend proxies `/api/*`, the cookie is first-party
  and `fetch(..., { credentials: "include" })` sends it automatically.
- `POST /api/auth/verify` checks a key without setting the cookie; it returns
  `{"ok": true, "first_run": true}` when no key is configured.
- `POST /api/auth/logout` clears it.
- **First-run mode:** if no key is set, every endpoint is open. That's the easiest way to develop
  locally; set a key before anything is shared.
- Failures: `401 {"detail":"Invalid or missing API key"}`; 5 failures/minute/IP → `429` with
  `Retry-After`.

### Tasks

1. **Sign-in → session cookie.** `src/app/sign-in/page.tsx` currently fakes email/password and
   routes to `/welcome`. When the backend is in use (`NEXT_PUBLIC_LIVE_MODULES` is non-empty), it
   must call `POST /api/auth/set-session` with the access key, through a new `authApi` in
   `src/lib/api/auth.ts` and a `useSignIn` mutation hook. Keep the existing design; label the
   secret field "Access key" in backend mode. Show the `401` and `429` messages from `ApiError`
   inline.
2. **Sign-out** calls `POST /api/auth/logout`, then routes to `/sign-in`.
3. **Global 401 handling.** In `src/lib/query/provider.tsx`, add `QueryCache` / `MutationCache`
   `onError` handlers: an `ApiError` with code `UNAUTHENTICATED` sends the user to `/sign-in`. Also
   don't retry `UNAUTHENTICATED` or `RATE_LIMITED` (extend the existing `retry` rule).
4. **Connection banner (optional, cheap, very useful in demos).** If any module is live and
   `GET /health` fails, show a non-blocking banner "Can't reach the BenchQ backend".

**Out of scope:** user accounts, roles and firms. The backend has one shared key, so the frontend's
OWNER/MANAGER/BDE roles stay mocked (`src/lib/stores/session-store.ts`). See
`06-open-decisions.md` → "Users, roles and firms".

---

## Acceptance criteria

- [ ] `docker compose up -d db backend` starts a healthy backend from a clean clone
- [ ] `http://localhost:3000/health` returns the backend's health JSON
- [ ] With a key set: signing in with the wrong key shows the error; the right key lands on the
      app, and the `jn_session` cookie exists on `localhost:3000`
- [ ] An expired or cleared cookie on a live module redirects to `/sign-in`
- [ ] With `NEXT_PUBLIC_LIVE_MODULES` empty, the app behaves exactly as before (mocks only)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; backend tests pass
      (`pytest`, run from the repo root)
