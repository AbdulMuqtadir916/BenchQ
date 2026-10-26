# 07 — Auth and tenancy in the backend

**Status:** approved (Q37), reordered by Q38 (2026-10-21). F1 is built (#29, then 0002 in #30); CI runs on every PR (#31).
**2026-10-22:** onboarding PRs 1–7 are merged (#33–#41): F2a, F3 (without the support-view endpoints), F4 (the policy
table and `require`; the firm-scoping dependency and its lint test wait for F2b), F5, the Admin API's firms, invites
and read lists, Phase M's backend, and F6 for the session, invites, team and admin adapters **as an opt-in**
(`NEXT_PUBLIC_LIVE_MODULES=session`). Since then: invite guards (#42, Q39), `reset_password` (#43). **2026-10-23:** F2b built (migration 0005, see
F2 below). **2026-10-24:** the support-view endpoints built (issue #56): F3 is done, and so are F4's support-view
reads. **2026-10-24:** F2c done (#57–#59); F7 built: the isolation test runs over every route (#61, see F7 below);
the legacy schema path deleted (issue #62); the signed-out redirect in `src/proxy.ts` (issue #63); the principal read on the server (issue #64). **Still to do:** the rest of F6
(live by default, mock sign-in removed; issues #65–#66).
**Goal:** make the backend multi-tenant, with real users, firms, roles and sessions, so that teammates
can then integrate the data modules in parallel, each one firm-scoped from its first endpoint.

The plan follows the approved contracts (docs/02 §3.1, 07 §0 Q16–Q36), 07 **Phase D** (real
enforcement) and the backend as it is today (§1). Decisions that are yours come first (§2); the
foundation is seven PRs in order (§3); after it, the module tracks run in parallel (§4) under shared
rules (§5). §6 lists what in the backend makes this harder than it looks.

---

## 1. The backend today

| Area | What's there | Where |
|---|---|---|
| Auth | **One shared API key** in the `settings` table (`dashboard_api_key`, seeded from `INITIAL_API_KEY`). A middleware accepts it from the `X-API-Key` header or the `jn_session` cookie. **The cookie's value is the key itself.** With no key set ("first-run mode") every endpoint is open | `backend/main.py` 137–315 |
| Who sends the key | The browser (JobNavigator's own UI, via the cookie); **JobNavigator's Chrome extension** via `X-API-Key` (application logging, `routes_autofill`, `routes_linkedin`; the extension itself was not copied, `backend/UPSTREAM.md`). The **scheduler** runs in-process and needs no key. The **Telegram webhook** is public and checks its own secret header. `/cv/{token}` tracer links are public | `main.py`, `api/routes_applications.py:300`, `api/routes_autofill.py`, `scheduler.py` |
| Users, firms, roles | None | — |
| Schema changes | **No migrations.** `Base.metadata.create_all()` plus raw `ALTER … IF NOT EXISTS` in `create_tables()`, **and** about 57 more ALTER/UPDATE statements in `seed.run_migrations()`, all run at every startup | `models/db.py:639`, `seed.py:594` |
| IDs | UUIDs (Postgres `UUID`), plus `jobs.short_id` from a sequence | `models/db.py` |
| Global uniqueness | `jobs.external_id` (SHA-256 dedup key) and `jobs.short_id` unique across the table; `companies.name` unique; `tracer_links.token` unique; `personas.id` always 1 (a singleton); `settings` one global key-value store | `models/db.py` |
| Background work | APScheduler inside the API process: `scrape_all`, `email_check` (one Gmail account), `auto_reject`, `daily_digest` (one Telegram chat), `db_backup`, `h1b_refresh`, `job_cleanup`; plus `job_monitor.launch_background` for on-demand runs | `scheduler.py`, `job_monitor.py` |
| Activity log | `activity_log_v2`: system events (`scrape`, `h1b`, `cv_score`, `email`, `telegram`) with a message. No actor, entity, action or firm | `models/db.py:444` |
| LLM spend | `llm_call_log` per call, no firm | `analyzer/llm_logger.py` |
| Size | 120 endpoints (main.py + 11 routers); about 1,900 tests, run on **in-memory SQLite** with `create_all` | `backend/tests/conftest.py` |

---

## 2. Decisions needed from you

> **Decided 2026-10-21 (07-ROUTES-AND-RBAC Q37).** Approved: D2 in FastAPI; opaque cookie sessions
> (HttpOnly, Secure, SameSite=Lax, status re-checked per request, 7 days sliding / 30-day cap, same-origin
> unsafe requests); Argon2id; D1 `candidates` table; D3 the 10 statuses; D4 `evidence` + `claims` tables
> with the database refusing `VERIFIED` without evidence.
> **Scraped jobs:** shared pool + a firm link table. A firm sees only jobs matching its own searches, plus
> jobs it captured by hand. Searches become firm-owned (this replaces §6.4's "platform-owned").
> **The shared API key** is removed at F6, no overlap; the extension gets per-user tokens later.
> **Folded into the foundation:** the ledger's own table in F2 (auth, invites and support views write to
> it; the Module 01 track then only connects the screen). Background jobs (scheduler, email monitor) pass
> `firm_id` explicitly. Until the scheduler moves out of process, deploy **exactly one backend worker**.
> Backend tests run on Postgres from F1. In F2, classify every setting as platform-wide or firm-owned.
> "Mark applied" moves to the 03 Applications track.
>
> The text below is the original proposal, kept for the reasoning.

Each has my recommendation. Your stated leaning is noted; where I agree I say so, and I say why where
I'd add a condition.

### D2 — Where users, firms and roles live

- **Options:** (1) users, firms, roles, invites, platform admins and support views as tables in FastAPI;
  (2) an identity provider (Auth0, Clerk, Cognito…) in front, passing the user to the backend.
- **Recommendation: 1 (agrees with your leaning).** Everything that matters is product-specific: the
  four firm roles plus `PLATFORM_ADMIN` (not a firm role), one firm per user, invite-only with seat limits
  (A1, A4), invites lasting 7 days, the read-only support view logged in the firm's ledger (Q10, Q20), and
  suspension taking effect at once. An IdP would still need all of those tables, and would add a second
  source of truth for "is this user active". Revisit if a client firm asks for SSO; then the IdP only
  replaces the password step, and the tables stay.

### Sessions

- **Recommendation: an opaque session token (agrees with your leaning), with these details:**
  - 256-bit random token; the cookie carries the token, the **`sessions` table stores only its SHA-256**
    (a database leak yields no usable sessions).
  - Cookie `bq_session`: `HttpOnly`, `Secure` (off only for `localhost`), `SameSite=Lax`, `Path=/`. Lax
    keeps the cookie on top-level navigations from links (an invite email, a bookmark) and off
    cross-site POSTs. Because the frontend proxies `/api/*`, the cookie is first-party.
  - Every request looks the session up and **re-reads the user's and firm's status**: deactivation,
    suspension, role change and support-view expiry apply on the next request, not at token expiry. That
    is the reason not to use JWT.
  - Lifetime: **7 days sliding, 30 days absolute.** A BDE shouldn't sign in every night at 6:30 PM, and a
    stolen cookie shouldn't live forever. Sign-out, password change and deactivation delete the user's
    sessions.
  - CSRF: `SameSite=Lax`, plus an `Origin` check on every unsafe method (POST/PUT/PATCH/DELETE must come
    from the app's own origin).
  - **The support view lives on the session row** (`support_view_id`), so the principal is always rebuilt
    on the server, and a view ends with its session.
  - Throttle sign-in per IP **and** per email (the current throttle is per IP, in memory, per process).
    Shared state in Postgres or Redis comes when there's more than one worker.

### Password hashing

- **Recommendation: Argon2id with `argon2-cffi`** (the OWASP first choice; maintained), using the library's
  defaults and `check_needs_rehash` on sign-in so the cost can rise later. Not `passlib` (unmaintained).
  The minimum length is 8, as the invite flow already enforces. One message for every failure ("Email or
  password is incorrect."), as the mock does.

### D1 — Candidates

- **Recommendation: a `candidates` table (agrees with your leaning)**, shaped like the approved
  `Candidate` contract, with `firm_id` and a `candidate_assignments` (candidate ↔ BDE) table.
  JobNavigator's singleton `Persona` (contact, work auth, compensation, preferences, `qa_bank`) becomes
  per-candidate data. `applications`, `resumes`, `cover_letters` and `tracer_links` gain `candidate_id`.
  Interim D1 option 3 (one configured candidate) is dropped once this lands.

### D3 — Application statuses

- **Recommendation: extend the backend to the frontend's 10 (agrees with your leaning)**: `SAVED`,
  `APPLIED`, `RESPONSE`, `SCREENING`, `INTERVIEW`, `OFFER`, `PLACED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`,
  stored uppercase as the contract has them. One migration maps the current lowercase four
  (`applied`/`interview`/`offer`/`rejected`). Audit the writers first: the email monitor, auto-reject,
  `/api/stats` and the Sankey endpoint all assume the four.

### D4 — Claims and evidence

- **Recommendation: `evidence` and `claims` tables (agrees with your leaning)**: a claim belongs to a
  resume version, with `state`, `evidence_id` (required for `VERIFIED`, enforced by a check constraint, so
  the database itself refuses a `VERIFIED` claim without evidence), actor, reason and timestamps. Every
  change is written to the ledger. The export endpoint refuses while any claim is `UNVERIFIED`; the
  frontend's gate is UX.

### New — Scraped jobs: a shared pool, or per firm?

- **The tension:** the approved `Job` contract carries `firmId` (07 §7), but scraping is expensive and the
  same public posting is relevant to every firm. The backend already dedups globally (`jobs.external_id`
  is unique across the table).
- **Options:** (1) every firm has its own copy of each job (scrape per firm, or copy on ingest);
  (2) **a shared pool of postings plus a firm link**: `jobs` stays global, like `Company`, and a
  `firm_jobs` table (firm_id, job_id, origin `SCRAPED` | `CAPTURED`, captured_by, created_at) says which
  jobs a firm sees. The API returns the contract's `Job` with `firmId` set from the link.
- **Recommendation: 2.** One scrape serves every firm; dedup stays global; the contract is unchanged,
  because `firmId` means "this firm's view of the job". A job a BDE captures by hand (legal basis
  `USER_SESSION`) is linked **only** to that firm and never shown to others. This matches the approved
  `ScraperRun` (`firmId` null for shared runs, Q33).
- **Needs your answer:** which scraped jobs a firm sees — every one, or only those matching its searches.
  I'd start with every one, filtered by the existing search configs, which become platform-owned (§6.4).

### What replaces the shared API key

| Today's user | Replacement |
|---|---|
| The browser | The session cookie above. `jn_session`, the key setting, first-run mode, `/api/auth/set-session` and `/api/auth/verify` are **removed**, not kept alongside |
| The Chrome extension (not in this repo) | **Personal access tokens later**: per user, scoped to their firm, shown once, stored hashed, revocable from Preferences. Until the extension is brought in, nothing; its endpoints are reached by the signed-in app only |
| The scheduler | Nothing: it is in-process. Each job is given its firm explicitly (§6.5) |
| The Telegram webhook | Its own secret, as today. It is a platform integration, not a user |
| `/cv/{token}` tracer links | Stay public (that's their purpose); the click is attributed to the link's firm |

**Recommendation:** remove the key at the foundation's cut-over (§3, F6), with no compatibility period.
It is a single secret that opens every firm's data. The one thing that loses access is the extension,
which isn't part of BenchQ yet.

---

## 3. The foundation, in order (one PR each)

> **Reordered 2026-10-21 (07-ROUTES-AND-RBAC Q38).** The onboarding flow goes first, end to end: **1** F2a, the
> new tables (firms, plans, users, platform users, invites, sessions, support views, ledger entries; a "Default"
> plan and "Default firm") · **2** F3's sign-in, sign-out, me and invite endpoints, auth on **every** endpoint,
> the shared API key and first-run mode removed · **3** F4's policy table · **4** Super Admin firms + invites
> (from the Admin API track) · **5** OWNER member invites (the backend of Phase M) · **6** a
> `create_platform_admin` command and F5's seed, outside production only · **7** F6 for the session, admin
> and invites adapters. Then F2b (`firm_id` on existing tables, `firm_jobs`), F2c (settings), the support-view
> endpoints and F7. The sections below keep their F-numbers for reference.

Each PR is small enough to review in one sitting and leaves the backend's tests green. **F1–F5 are
backend only; the frontend keeps running on mocks until F6.**

### F1 — Alembic baseline

- Add Alembic. The **baseline revision is the fully migrated end state**: `create_tables()`, then all of
  `seed.run_migrations()`, then `migrate_h1b_to_visa_cache`, built on an empty Postgres and reviewed by
  hand (the `jobs_short_id_seq` sequence, the JSONB defaults, the columns those functions add or drop).
- The old DDL moves, unchanged, into a frozen `backend/migrations/legacy_bootstrap.py`. Two things use
  it: the one-time path for an existing database, and the equivalence test. Delete it once every dev
  database is stamped.
- Migrations run **before uvicorn**, not in `lifespan`: `backend/scripts/db_upgrade.py`, under a Postgres
  advisory lock, called by the Dockerfile `CMD`. No `alembic_version` table but `jobs` exists → run the
  legacy bootstrap, then **stamp** the baseline. Otherwise `alembic upgrade head`. `lifespan` only checks
  the database is at head and fails fast if not.
- Startup stops running `create_all`, the ALTERs in `create_tables()` and `seed.run_migrations()`. Data
  seeding and data backfills (`run_seeds`) stay.
- **Tests run on Postgres** (a `db-test` compose service on port 5433, data in tmpfs): the schema is built
  once per session by `alembic upgrade head`, tables are truncated between tests, and the SQLite scaffolding
  is deleted. A test builds two scratch databases, one the old way and one by Alembic, and compares tables,
  columns (type, nullability, default), constraints, indexes and sequences, so the two can't drift. The repo
  has no CI workflow; the command is in `docs/integration/README.md`.
- **Remove the legacy path by F6 at the latest** (**done, issue #62**; a database that was never stamped is now refused
  with the fix, see README "An existing dev database"). Once every dev database is stamped, delete
  `models.db.create_tables`, `seed.run_migrations` (with `run_migration_statements` and the helpers only it
  calls), `seed.migrate_h1b_to_visa_cache`, `backend/migrations/legacy_bootstrap.py`, the stamp branch in
  `db_schema.py`, and the tests that exist only for them. The equivalence test
  (`test_schema_matches_legacy.py`) goes with them; `alembic check` stays.
- **Done when:** a clean `docker compose up` builds the schema from migrations only; an existing dev
  database is stamped with no change; all backend tests pass on Postgres.

### F2 — Auth and tenancy tables; `firm_id` on existing tables

- New tables, from the approved contracts (docs/02 §3.1): `firms` (status, `plan_id`, copied
  `seat_limit` / `candidate_limit`, `contact_phone`, slug rules), `plans`, `users` (`firm_id`, role, name,
  email unique, `password_hash`, `is_active`, `last_active_at`), `platform_users`, `invites` (+
  `invitee_name`; the token stored **hashed**, never on the invite row, as in the mock), `sessions`,
  `support_views`, and the business ledger `ledger_entries` (the contract's `LedgerEntry`, `firm_id`
  nullable only for platform events; §6.6).
- `firm_id` (non-null, indexed, FK) on every firm-owned table that exists today: `applications`,
  `resumes`, `cover_letters`, `tracer_links`, `interviews` (through its application), `searches` if they
  stay per firm (§6.4), plus `firm_jobs` (decision above). **Backfilled to a default firm** created by the
  migration ("Default firm", slug `default`, ACTIVE). Then the column becomes `NOT NULL`.
- Global, no `firm_id`: `companies`, `visa_cache`, `jobs` (if the pool is shared), `scrape_log`,
  `job_runs` (gains a nullable `firm_id` for firm-triggered runs), `settings` (platform), `llm_call_log`
  (gains `firm_id`, required for new rows, Q33).
- `jobs.short_id` (a global sequence used in URLs) is not exposed to firms; firm URLs use the UUID (§6.7).
- **Done when:** upgrade and downgrade both run on a copy of a dev database; nothing reads the new
  columns yet.

**F2b as built (migration 0005, agreed 2026-10-23):**

- `firm_id` NOT NULL (FK `firms` RESTRICT, indexed) on `searches`, `applications`, `interviews`, `resumes`,
  `cover_letters`, `tracer_links`, `tracer_click_events`; each child carries its own column, so one scoping rule
  covers every table. Nullable on `job_runs` and `llm_call_log`; nothing writes it there yet. `personas` is
  untouched. Existing rows go to the Default firm, which migration 0003 already creates on every database.
- `firm_jobs` (`firm_id`, `job_id`, `origin` SCRAPED | CAPTURED, `search_id`, `captured_by_user_id`), unique per
  firm and job. Existing jobs are linked to the Default firm: CAPTURED when `source` is `manual` or `extension`,
  else SCRAPED. `job_id` is ON DELETE CASCADE (not RESTRICT), so the job cleanup keeps working.
- Writes: every firm route that creates a firm-owned row takes `firm_id` from the signed-in user
  (`backend/auth/scoping.py` `writer_firm_id`; a Super Admin gets 403). A hand-added, extension-saved or
  logged job is linked CAPTURED by that user. A new job a search finds is linked SCRAPED to the search's firm
  (a `before_flush` listener in `models/tenancy.py`). Searches (Super Admin routes), Telegram and the startup
  seeds write to the Default firm. Tracer links and clicks take their document's firm.
- **Left for the Jobs track:** a job already in the pool that another firm's search finds again, and jobs from
  company pages, are not linked yet. Who owns a search (a firm, or the platform for every firm) is decided there.
- Reads are not filtered yet: the firm-scoping dependency and its lint test (F4) are the next PR.

**F2c as built (agreed 2026-10-23):** `settings` stays one platform table, Super Admin only (`/api/settings` is
PLATFORM). Firms never configure models, prompts, scraper logins or Telegram (product owner, 2026-10-23). There is
no `firm_settings` table: a firm's own choice moves to a firm table when its track needs one (a new entity, so it
needs a contract first). Every key is classified in `backend/settings_scope.py`, and
`backend/tests/test_settings_scope.py` fails on a key that isn't:

| Scope | Keys | Who moves them |
|---|---|---|
| Platform (stays) | schedules and crons, intervals, concurrency limits, job archive / auto-reject days, scraping filters (company, title, body exclusions), proxy, dedup params, tracer-link URL format | — (auto-reject per firm: 03 Applications, D3) |
| AI presets | every `*_llm_*` provider, model, effort and key, the fallback model, the models list, prompt caching, the scoring rubric and output schemas, the tailoring, persona, cover-letter, email and autofill prompts, the cover-letter voices | The AI presets module (Super Admin: one active preset per module), after the AI tracks |
| A firm's choice, platform-wide for now | `default_resume_id`, on-save scoring, auto quick-score, default cover-letter voice, tracer links on/off, prep sections, autofill dictionaries, the Gmail query and tokens | The track named next to each key (04, 02, 03, the extension, D8) |
| Unused, to delete | LinkedIn and Jobright logins and sessions, Telegram (chat, webhook secret, digest, fit alert), the JobNavigator feed zoom | 02 Jobs (scraper logins) and production readiness (Telegram), with the code that reads them |

**Leak found by F2c, fixed (#58):** scoring a job for a firm used the company's `selected_resume_ids`, else
`default_resume_id`, else **every firm's base résumés**. Now every résumé lookup in `cv_scorer` takes the firm the
run scores for and skips another firm's résumés; `score_single_job` and `resolve_score_resume_names` require
`firm_id`. The scheduler's pass (no signed-in firm) scores only the Default firm's jobs with its résumés
(`PIPELINE_FIRM_ID`). Still shared: the Persona (D1) and the scores on the job row (Q36).

### F3 — Auth endpoints, returning the frontend's `Session`

The wire shape is snake_case and the frontend maps it in `src/lib/api/dto/session.ts` (the CLAUDE.md rule:
backend shapes never pass the DTO layer). The fields are exactly the frontend's `SessionSchema`: a firm
session (`principal` + `user` + `firm`) or a platform session (`principal` with `support`).

| Endpoint | Does | Mirrors |
|---|---|---|
| `POST /api/auth/sign-in` `{email, password}` | Session cookie + the session; one 401 message for every failure; throttled | `sessionApi.signIn` |
| `POST /api/auth/sign-out` | Deletes the session (and ends an open support view, logged) | `sessionApi.signOut` |
| `GET /api/auth/me` | The current session, or 401 | `sessionApi.current` |
| `GET /api/firms/by-slug/{slug}` | The firm, or 404 for a firm you can't open (same answer as unknown) | `sessionApi.firmBySlug` |
| `POST /api/auth/first-run-done` | Marks the user active (landing becomes the dashboard) | `sessionApi.finishFirstRun` |
| `GET /api/invites/{token}` / `POST /api/invites/{token}/accept` | Every link state; accept creates the user, signs them in, logs `INVITE_ACCEPTED`, activates an ONBOARDING firm | `invitesApi`, `src/mocks/invites.ts` |
| `POST /api/support-views` `{firm_id, reason}` / `DELETE /api/support-views/current` | Super Admin only; 60 minutes, one at a time; `ADMIN_ACCESS` / `ADMIN_ACCESS_END` in the firm's ledger | `sessionApi.startSupportView` / `exitSupportView` |

The mock's behaviour is the spec: `src/mocks/session.ts`, `auth.ts`, `invites.ts`, `invite-flow.ts`,
`support.ts` and their tests (`support.test.ts`, `invite-flow.test.ts`, `session-persistence.test.ts`)
are ported as backend tests, case for case.

**Support views as built (2026-10-24, issue #56):** `backend/auth/support.py` holds the rules (start, end, expiry),
`backend/api/routes_support.py` the two endpoints, `backend/tests/test_support_views.py` every case of
`src/mocks/support.test.ts` plus the read / write / other-firm matrix.
- A view lives on the session that started it (`sessions.support_view_id`); the admin's other browser is a plain
  Super Admin. One open view per admin: starting another, of any firm or the same one, ends the first ("another
  support view started"). Start and exit lock the admin's `platform_users` row, so two at once never fail.
- It ends by exit ("Support view ended"), expiry ("Support view ended after 60 minutes", dated at `expires_at`) or
  **any** end of its session ("Support view ended: signed out"): sign-out, signing in as someone else in that
  browser, accepting an invite there, `reset_password`. The session row's `support_view_id` is then null.
- Expiry is settled lazily, every expired view (anyone's), once, on `/api/auth/me`, start, exit, every session end,
  the firm's ledger read and `/api/admin/audit`, so the firm's ledger and the admin overview's "open now" are true
  even if the admin never comes back. `ledger.record(..., at=)` dates the entry.
- Ledger entries: the admin's name, never their email; `entity_label` is the firm's name.
- A malformed or unknown `firm_id` is 404; any firm status can be viewed (Q29).

### F4 — The permission table in Python, and one firm-scoping dependency

- `backend/auth/policy.py`: the same table as `src/lib/auth/policy.ts`: firm actions, team actions (Q15),
  `team.view`, platform actions; `can(principal, action)`. **One shared fixture file**
  (`backend/auth/policy_table.json`, under `backend/` because the backend container has only that folder;
  generated from the TypeScript table by `UPDATE_POLICY_TABLE=1 pnpm test src/lib/auth/policy-shared.test.ts`)
  and **a test on each side** that compares its table with the file. A change on one side fails the other
  side's test until both agree. Built in onboarding PR 3, with `require(action)`.
- Dependencies, used by every router:
  - `current_principal` (401 when signed out);
  - `firm_scope(firm_id)`: the principal must belong to the firm, or be a Super Admin inside an active
    support view of it; **any other firm is 404**, the same answer as a missing record (principle 4);
  - `require(action)`: 403 when `can()` says no. A support view gets 403 on every write.
  - Record-scope helpers matching the frontend's `scope*`: a BDE sees assigned candidates, their own
    applications and follow-ups, and their own ledger entries.
- Every query on a firm-owned table goes through a helper that adds `firm_id = :firm`. A lint test fails
  if a router queries a firm-owned model without it (a grep over `db.query(<Model>)`, as the frontend's
  `no-path-literals` test does).
- **Done when:** the policy-comparison tests pass on both sides, and every **existing** endpoint is either
  scoped, platform-only, or explicitly public (a table in the PR).

**As built (2026-10-23):** `backend/auth/scoping.py` has `reader_firm_id` and `scoped(db, Model, firm_id)`;
`backend/tests/test_firm_scoping_lint.py` fails when a route in `backend/api/` or `main.py` queries a model with a
NOT NULL `firm_id` any other way, unless the function is on its `ALLOWED` list with a reason (platform routes,
the public tracer link, background workers whose route checked the ids). Applications, interviews, résumés, cover
letters, tracer stats, `/api/stats` and the Sankey are scoped; another firm's id answers 404 (#53). The jobs feed,
its menus, facets and counts, a job's detail and pages, bulk update, analyze, and the job lookups of the résumé and
cover-letter routes read through `scoped_jobs()`, the firm's links in `firm_jobs`; the lint test also fails on raw
SQL over `jobs` without a `firm_jobs` filter. Capture routes still dedup over the whole pool, then link the job.
**Support views (2026-10-24, issue #56):** `Principal.support_firm_id` is the viewed firm. A FIRM route lets a view
through for **GET only** (`backend/auth/access.py`): every other method is 403 "A support view is read-only.", and so
are the GETs in `SUPPORT_VIEW_REFUSED` (the résumé and cover-letter PDF exports: a view never exports, 07 §4).
`reader_firm_id` gives a view its firm on GET only and refuses any other method itself, because many write routes
take it rather than `writer_firm_id`: a write needs two mistakes to get through. `writer_firm_id` refuses every
platform principal. `own_scope` gives a view the whole firm, as the OWNER. The team routes accept the viewed firm
(reads only); `/api/companies` counts the viewed firm's rows. **Follow-up:** move the write routes that take
`reader_firm_id` to `writer_firm_id`.
**Known gaps:** the Persona is one shared row until the Candidates track (D1); a job's
status and scores are shared across firms until the Jobs track's `JobMark` (Q36).

### F5 — Seed script: the mocks' world, in the database

- `backend/scripts/seed_demo.py` loads **the same JSON the mocks use** (`src/mocks/data/*.json`, read from
  the repo, never copied), so the two can't drift: the four firms, plans, users and the Super Admin from
  docs/03 §3.2 with the one demo password (hashed), the invites, and then each module's data as its track
  lands.
- IDs: the backend uses UUIDs, the fixtures `cand_01`-style ids. The seed derives **UUIDv5 from each
  fixture id** (one fixed namespace), so a seeded record has the same id on every machine, and a sample
  saved by one teammate matches another's database.
- Relative dates are shifted the same way the mocks shift them (`seededAt`), so "3 days ago" stays true.
- Idempotent: running it twice changes nothing. A `--reset` flag drops and reseeds the demo data.
- **Done when:** signing in as each seeded account in docs/03 §3.2 works against the backend.

### F6 — The frontend's session goes live

- `sessionApi` and `invitesApi` call F3's endpoints through `http.ts`, with a DTO mapper. The mock
  sign-in, `benchq.session` in `localStorage`, `src/mocks/auth.ts`'s passwords and credentials table go.
- The session is read **on the server** (07 Phase D items 2–4): the firm and admin layouts read the
  principal server-side, `src/proxy.ts` makes the signed-out redirect, and not-found / forbidden answer
  with real 404 / 403 statuses.
- Cross-tab sync becomes "the cookie changed": a `BroadcastChannel` ping after sign-in or sign-out, then
  `current()`.
- **The other modules stay on mocks**, but now under a real signed-in principal. Until its track lands, a
  mocked module reads the principal from the session the way it does today.
- **The signed-out redirect (issue #63, built):** `src/proxy.ts` sends a request without the `bq_session` cookie to
  `/sign-in?returnTo=…` unless the registry says the route is public (`/dev/*` only where it is served). A path the
  registry doesn't know redirects too, so existence is never confirmed. It looks for the cookie, not for a valid
  session (UX; the backend's 401 is the enforcement), and runs only while `session` is a live module, so mock mode
  keeps working until live is the default (issue #65 drops that condition). The rule is `signedOutRedirect()` in
  `src/lib/routes/proxy-access.ts`.
- **The principal on the server (issue #64, built):** the firm and admin layouts read `bq_session` off the request and ask
  `GET /api/auth/me` (and `/api/firms/by-slug/…`) through `createHttp()` in `http.ts`, the one place that calls `fetch`.
  `src/lib/server/gate.ts` decides (pure, table-tested): redirect to sign-in, real 404, real 403, or render. `src/proxy.ts`
  passes the path in `x-pathname`. `forbidden()` needs `experimental.authInterrupts`. Live mode only, like the redirect;
  #65 drops that condition. The browser gates stay for client-side navigation: UX, with the backend as enforcement.
- **Delete the legacy schema path** (F1's list): `create_tables`, `run_migrations`,
  `migrate_h1b_to_visa_cache`, `backend/migrations/legacy_bootstrap.py` and the stamp branch in
  `db_schema.py`. **Done (issue #62)**, after every teammate started the backend once. `db_upgrade` now stops on a
  database with tables but no `alembic_version`, and the `alembic_only` model markers are gone.
- **Done when:** every seeded account signs in on a production build and lands where docs/03 §3.2 says;
  the support view starts and ends with its ledger entries; signing out in one tab signs out the others;
  the legacy schema path is gone.

### F7 — The cross-firm isolation test, reusable

- `backend/tests/test_isolation.py`: a parametrised test over **every route in the OpenAPI schema**. For
  each firm-scoped route, a firm-A OWNER calling it with firm B's ids gets 404; firm B's own member gets
  through; a support view of firm B gets reads and is refused writes (403); signed out gets 401. Routes
  must be listed as scoped, platform or public, or the test fails, so a new endpoint is covered by default.
- It ports the frontend's `src/mocks/membership.test.ts` and `write-authorization.test.ts` to the real
  backend. Every track (§4) adds its fixtures, not a new test.

**As built (2026-10-24):** three files in `backend/tests/`.
- `test_isolation.py` enumerates the app's own routes (what the middleware sees). A FIRM route without a case or a
  known gap fails, and so does any entry naming a route that's gone. For every FIRM case:
  - **firm A's OWNER with B's ids:** 404, the same status and body as ids that exist nowhere. None of B's canaries
    or ids appear in the answer, and B's rows are unchanged.
  - **every GET:** A's answer is byte-identical before and after B's rows exist, which catches count leaks.
  - **a support view of A:** B's ids are as missing, and every write is 403.
  - **a support view of B:** GETs answer; writes and PDF exports are 403; B's rows are unchanged.
  - **firm B's OWNER:** gets through for real, with LLM workers, page fetches and the PDF browser stubbed.
  - **signed out:** 401.

  Also: PLATFORM routes refuse a firm user, another firm's slug gets the unknown-slug 404, `/api/companies` counts
  only the caller's firm, and `live-page` in a view writes nothing. The attacker is the OWNER, the widest firm
  role; a BDE's `own` scope stays in each module's tests.
- `isolation_cases.py` is the case table, in sections by track: which rows a route's path names, its body, and
  whether the body names rows (`body_ids`) or answers `not_found` lists (`bulk`). It also holds `KNOWN_GAPS` and
  the reasons for the other classes.
- `isolation_support.py` builds firms A and B with a row of every firm-owned kind; B's rows carry canaries.

**A track adds its routes to `isolation_cases.py` and its table's rows to `isolation_support.build_firm` and
`snapshot_of`, not a new test** (§5 rule 1).

**Known gaps, from F4:** the Persona and autofill routes skip the matrix until the Candidates track (D1). A shared
job's status is checked to still leak, until the Jobs track's `JobMark` (Q36), so the entry fails once that is fixed.

**Fixed on the way:**
- `POST/PATCH /api/resumes` and `/api/cover-letters` check that body ids (`parent_id`, `job_id`, `resume_id`) are
  the firm's own (`scoping.firm_ref`): another firm's id was accepted and a random one wasn't, an existence oracle.
- Both `tracer-stats` routes 404 another firm's id; they answered `200 []`.
- `live-page` no longer warms a job's cached page inside a support view.

`test_firm_scoped_reads.py` was folded in and deleted.

---

## 4. The parallel tracks, after the foundation

| Track | What | Depends on | Notes |
|---|---|---|---|
| **01 Ledger** | `ledger_entries` read API (`GET /api/firms/{firm}/ledger`, BDE `own` scope); every write in every later track logs here | F1–F4 | Live behind flag: the worked example every track copies (`01-ledger.md`). The ledger is the new table, not `activity_log_v2` (system events, §6.6) |
| **02 Jobs** | The shared pool + `firm_jobs`; capture (dedup on the canonical URL, as fix PR 1); `JobMark` (Q36) | F1–F7; the jobs decision (§2) | Scraping stays platform-side |
| **Candidates (D1)** | `candidates`, assignments, the Persona → candidate move; create with the over-limit block (A4) | F1–F7, D1 | Unblocks 03, 04 |
| **Admin API** | Firms, plans, users, invites, platform team, audit: the `/admin` screens' `platformApi` | F1–F7 | Can run beside 01 / 02 / Candidates |
| **03 Applications** | `candidate_id`, the 10 statuses (D3), status history, follow-ups | 02, Candidates, D3 | The email monitor and auto-reject change with it |
| **04 Resumes + claims** | `candidate_id` on resumes; `evidence` + `claims` (D4); the export gate on the server | 02, Candidates, D4 | Tailoring runs are firm-scoped (Q21) |
| **05 Analytics** | Firm-scoped stats, derived from events, never stored | 03 | `/api/stats` and the Sankey endpoint rewritten for firms |

01, 02, Candidates and the Admin API can start together once F7 is merged. A track's DTO, mapper and
tests can be written before its dependencies are live; only "switch the adapter to live" waits.

---

## 5. Rules every track follows

1. **Firm-scoped by default.** Every firm-owned table has `firm_id NOT NULL`; every query goes through the
   scoping helper; every endpoint is in F7's table, and the isolation test passes with your fixtures.
2. **The policy is the one table.** Use `require(action)` and the scope helpers; no `role ==` in routers.
   A new action is added to both tables in the same PR (F4's comparison test enforces it).
3. **Migrations only through Alembic**, one per PR, with a downgrade. Never `create_all` or raw `ALTER` in
   app code.
4. **The contract is the frontend's.** Responses map to `src/lib/schemas/` through a DTO in
   `src/lib/api/dto/`; never edit a schema to fit the backend. A field the backend can't produce goes in
   your module file's Gaps and is asked about.
5. **Every write that a person makes logs to the ledger** (actor, entity, action, firm), except where a
   decision says otherwise (personal `JobMark`s, Q36).
6. **Numbers are derived** from events in queries, never stored as counters (CLAUDE.md).
7. **Seed from the mocks' JSON** (F5), so a screen looks the same live as on mocks.
8. **Background work names its firm.** A job or task that touches firm data takes `firm_id` as an argument
   and writes it on every row; the scoping helper is not there to catch it.
9. **Delete the mock** when the track is live (the README's workflow, step 7).

---

## 6. What in the backend makes this harder than it looks

1. **The cookie holds the raw API key**, and an empty key opens every endpoint ("first-run mode",
   `main.py:176`). Neither can survive into a multi-tenant app: F6 removes both, and until then the backend
   must not be reachable from anywhere but a developer's machine. (The cookie is also `SameSite=Strict`
   with `secure=False`.)
2. **Migrations live in two places and run at every startup**: the ALTERs in `create_tables()` and about
   57 statements in `seed.run_migrations()`, some of which drop columns. The Alembic baseline (F1) must
   absorb both in the right order, or an old dev database and a fresh one will differ. This is the
   riskiest step and why it goes first, alone.
3. **The tests run on SQLite**, and the new schema leans on Postgres (UUID, JSONB, sequences, partial
   indexes, possibly row-level security later). F1 moves the backend tests to Postgres (Q37), so
   the isolation test (F7) runs there too.
4. **Global configuration mixed with firm data.** `settings` is one global key-value store (LLM keys,
   Gmail, Telegram, cron schedules); `companies` holds both reference data and one user's choices
   (`selected_resume_ids`, scrape URLs, tiers); `searches` are one user's scrape configs. Proposed: settings
   and searches become **platform-owned** (Super Admin), companies stay global reference data, and a
   per-firm choice (which resumes to score against) moves to a firm table when a track needs it.
5. **Background jobs have no principal.** The scheduler and `launch_background` run outside any request,
   so the scoping dependency never sees them. `auto_reject` and the email monitor write application
   statuses; `daily_digest` posts to one Telegram chat; `email_check` reads one Gmail account (per-candidate
   inboxes are D8). Each must loop over firms, or be platform-only, explicitly (rule 8). The scheduler
   also runs inside the API process, so a second API worker would run every job twice. That needs a
   separate worker process or a lock before scaling out.
6. **`activity_log_v2` is an operations log, not the ledger.** It has no actor, entity, action or firm, and
   its `type` values are system events. The first 01-ledger.md mapped it to `LedgerEntry`; that mapping got
   the "who did what" part of the product wrong (rewritten with track 01). The ledger becomes its own table (F2), and the activity log
   stays as the platform's system log (it feeds `/admin/system` in Phase S).
7. **Singletons and global uniques**: `personas.id = 1` (D1 replaces it); `jobs.external_id` unique
   globally (fine for the shared pool; a per-firm copy would need `(firm_id, external_id)`);
   `companies.name` unique (right for global reference data). `jobs.short_id` comes from one global
   sequence and appears in URLs: shown to firms, it would reveal how many jobs exist platform-wide and
   invite guessing, so firm-facing URLs use the UUID.
8. **LLM spend has no firm.** `llm_call_log` rows are written from inside analyzers and background tasks
   that don't know the firm; the approved `AiUsage` requires `firmId` (Q33). Every LLM entry point must
   carry the firm down.
9. **120 endpoints, all unscoped.** F4 classifies every one (scoped / platform / public), and many of
   JobNavigator's will become platform-only or be removed (Telegram, backups, DB cleanup, scraper
   triggers). That list is a product call; F4's PR proposes it for your review.
10. **Upstream sync ends here.** `backend/UPSTREAM.md` says to diff and apply upstream fixes. After F2 the
    backend is a fork in practice; record that in `UPSTREAM.md` so nobody tries.
11. **The auth throttle is in memory, per process** (`main.py:205`). Fine for one worker; the new sign-in
    throttle should use the database (or Redis) from the start.
