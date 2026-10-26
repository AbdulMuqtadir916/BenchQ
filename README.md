# BenchQ

A multi-tenant B2B SaaS for US-focused IT staffing firms: bench-sales recruiters (BDEs) submit applications for
their candidates, and owners and managers see all of it as it happens. The frontend is Next.js; the backend is
JobNavigator (FastAPI + PostgreSQL) in `backend/`. The session, the team, invites, `/admin` and the ledger run
on the backend; every other module runs on mock data until its track connects it.

## Quick start

**Prerequisites:** Git, Docker Desktop (running), Node 22 or newer (`.nvmrc`). On an Apple-silicon Mac,
`node -p process.arch` prints `arm64`.

1. **Clone.**
   `git clone https://github.com/AbdulMuqtadir916/BenchQ.git && cd BenchQ`
   *Done when* `git branch --show-current` prints `main`.
2. **Install the frontend.**
   `nvm use` (skip without nvm), `corepack enable`, `pnpm install`
   *Done when* `pnpm -v` prints `12.5.1`. On Apple silicon, `ls node_modules/.pnpm | grep lightningcss-darwin` lists
   `lightningcss-darwin-arm64` and no `x64`.
3. **Copy the env files** (both are git-ignored; the defaults work locally).
   `cp .env.example .env.local && cp backend/.env.example backend/.env`
   *Done when* both files exist. AI-provider and Gmail keys are only for the features that call them.
4. **Start the backend and database.** The first build takes several minutes.
   `docker compose up -d --build db backend`
   *Done when* `curl http://localhost:8000/health` returns JSON with `"status":"ok"`.
5. **Load the demo accounts** (local only).
   `docker compose exec backend python -m backend.scripts.seed_demo`
   *Done when* it prints `Seeded: …`.
6. **Start the frontend.**
   `pnpm dev`, then open `http://localhost:3000` (not `127.0.0.1`: the backend checks the origin).
   *Done when* `imran@hyderabad-tech-staffing.benchq.test` with the password `benchq-demo-2026` signs in and lands
   on `/hyderabad-tech-staffing/dashboard`. The other demo accounts are in `docs/03-MOCK-DATA.md` §3.2.
7. **Run the checks.**
   `pnpm typecheck && pnpm lint && pnpm test`
   *Done when* all three exit 0. Backend tests run on Postgres: `docs/integration/README.md`, "Tests run on Postgres".

A step that doesn't end as described: [`docs/troubleshooting.md`](docs/troubleshooting.md). Then read
[`CONTRIBUTING.md`](CONTRIBUTING.md) (branches, reviews) and pick up a task from the
[module board](docs/integration/README.md#module-board).

## Where things live

| File | What it owns | Read it when |
|---|---|---|
| `CLAUDE.md` | The agent contract: scope, rules, conventions, definition of done. `AGENTS.md` points other agents to it | Every session, first |
| `CONTRIBUTING.md` | How the team works: branches, PRs, reviews, code owners, migrations, secrets | Before your first PR |
| `docs/troubleshooting.md` | Setup failures: symptom, cause, fix | A Quick start step fails |
| `product.md` | Why it exists: the user, his night, vocabulary, judgment principles | Once per session; when a spec doesn't cover a case |
| `design.md` | Visual language: colour, type, spacing, motion, component rules (`/dev/design-system` shows it running) | Anything visual |
| `docs/01-FRONTEND-ARCHITECTURE.md` | Stack, folder structure, the adapter rule, routing, env | Adding a dependency, wiring data |
| `docs/02-DATA-CONTRACTS.md` | Every Zod schema; JobNavigator alignment | Defining a type or fixture |
| `docs/03-MOCK-DATA.md` | Fixture volumes, the demo accounts (§3.2), derived counters | Adding fixtures |
| `docs/04-SCREENS.md` | Every route: layout, states, permissions, keyboard map | Building a screen |
| `docs/05-COMPONENTS.md` | Component inventory with props and variants | Building a component |
| `docs/06-IMPLEMENTATION-PLAN.md` | The nine UI build phases (complete) | Checking what a phase promised |
| `docs/07-ROUTES-AND-RBAC.md` | Route registry, access per role, the permission policy | Routes, navigation, permissions |
| `docs/integration/` | Backend integration: the board, the module plans, auth and tenancy (07), open decisions | Connecting a module to the backend |
| `docs/archive/` | Backend endpoint reference and retired notes | Looking up a backend endpoint |

## The three rules everything follows

**One architectural rule.** Components talk to hooks, hooks talk to typed adapters in `src/lib/api/`, and only
adapters decide between mock data and the backend. Backend responses are mapped to the frontend types in
`src/lib/api/dto/`, so screens never change.

**Verified, unverified, contradicted.** `VERIFIED` is evidence-backed and shippable. `UNVERIFIED` is drafted and
needs review. `CONTRADICTED` conflicts with the evidence and never ships. A resume with any unverified claim cannot
be exported. This is the product, not a feature of it.

**Every number is derived.** Counters are computed from event arrays, never stored as a literal.

Two features drive every design decision: **time compression** (every extra click costs at 11pm on application
forty) and **total transparency** (the owner and manager see who is working on what, at what stage, at any moment).

The full-stack spec set (BRD, PRD, TRD, data model, API spec) lives in the BenchQ project under `specs/`. This repo
supersedes it on frontend matters only.
