# Uzair — The production layer, then production testing

**An outline.** Each step gets a detailed plan, written with Uzair when he starts it (team plan, 2026-10-29).

Read first: [team README](./README.md), `docs/integration/07-auth-and-tenancy.md` (sessions, the one-worker rule
while the scheduler lives in the API process, Q37), `backend/main.py`, `docker-compose.yml`.

You own no candidate tables. Your area is the request path and the runtime around every route: middleware, limits,
config, logging. Changing a route's behaviour for its owner (Samad, Zuhair, Abdul) is agreed with them.

## 1. The production layer (first)

What exists today: a sign-in throttle and an invite-acceptance limit, per IP and per email, and a per-user limit on
every signed-in request, all in memory (`backend/auth/throttle.py`; the table below); a request body size cap
(`backend/body_limit.py`); database statement and connect timeouts (`backend/statement_timeout.py`, step 2b below);
one logging setup with request ids and masking (`backend/logging_setup.py`, `backend/request_log.py`, step 4a below);
per-scraper throttles
(`backend/scraper/sources/*`); one uvicorn worker for the API, and the scheduler in its own worker process
(`backend/worker.py`, step 3 below).

1. **Requests per second:** rate limits per IP for sign-in and invite acceptance (brute force), per user for the API,
   per firm for the AI routes (parse, tailor, score: they cost money). 429 with `Retry-After`; the frontend's
   `http.ts` already maps 429 to `RATE_LIMITED`.
2. **Timeouts and limits:** request body size (the résumé upload is 10 MB), request timeouts, database pool size and
   statement timeouts, AI call timeouts and retries.
3. **The scheduler out of the API process,** so the API can run more than one worker.
4. **Errors and logging:** structured logs with a request id, no secrets or personal data in logs, one error shape.
5. **Health and readiness** endpoints for the deployment (agreed with Abdul).
6. **Security headers and CORS** for production; server secrets come only from the environment, and BenchQ's own
   stored credentials (the AI key, candidate Gmail tokens) are encrypted with a key from the environment (step 6
   below). The JobNavigator leftover settings secrets (`linkedin_password`, `jobright_password`,
   `linkedin_mock_password`, `telegram_webhook_secret`, the legacy `gmail_refresh_token`) are plain `Setting.value`
   and on Abdul's clean-up list.

### Decisions and what's deferred (agreed with Abdul, 2026-10-31)

**Done for step 1 (rate limits):**

| Limit | Counted per | Allowed | Where |
|---|---|---|---|
| Sign-in failures | email | 5 per 15 min | `backend/auth/throttle.py` (#93) |
| Sign-in failures | client IP | 10 per min | the same (#93) |
| Invite acceptance attempts | client IP | 20 per 15 min | the same (#93) |
| Every request of a signed-in firm user | user | 300 per min | `check_user`, the `limit_per_user` middleware in `backend/main.py` |

All answer 429 with `Retry-After` and `{"detail": "Too many attempts. Try again in a few minutes."}`.

- **The Super Admin is never limited per user,** including inside a support view.
- **The frontend never retries a 429** (`src/lib/query/retry.ts`).
- **The per-user limit is a safety ceiling,** not a pace. A BDE applies job by job, BenchQ has no bulk actions against the backend, and nothing polls it.
- **Cover letters, persona and autofill have no rate limit.** The persona stays for now but its readers move to the candidate ([persona-to-candidates.md](./persona-to-candidates.md)), and Samad is reworking autofill.

**Assumptions the limits rest on:**

- **One backend process.** The counters live in memory, which is right for one process (`backend/scripts/start.sh`). A restart forgives everything.
- **A proxy in front of Next in production** (a load balancer, or a free reverse proxy such as nginx or Caddy on the same server; Abdul's deployment). It must:
  - append the client's address to `X-Forwarded-For`, because Next passes a client-sent one through. The backend reads the entry `TRUSTED_PROXY_HOPS` from the right, default 1, so exactly one proxy appends.
  - be the only way to reach the backend. A caller who reaches it directly can forge the header.
  - rate-limit per IP itself, at least on sign-in and invite acceptance, as the first line of defence. Its numbers should be no tighter than the table above.
  - terminate HTTPS.
- **No Redis now.** It may come later.

**Deferred, with the reason:**

- **A per-firm cap on the AI routes,** after Zuhair finishes tailoring and scoring. It is a safety cap, sized by the firm's BDE seats: a flat number per firm would block a large firm's normal tailoring. It covers parse-resume, `resumes/import-pdf`, tailor, analyze and score-check; the number is agreed with Zuhair. Today only parse-resume is live.
  **From tailoring (2026-11-12, [tailoring.md](./tailoring.md) §7):** one tailoring is 5 model calls, about a minute.
  The tailor has its own gate, `resume_tailor`, 40 per worker (`resume_tailor_max_concurrent`), and at most 5 running
  per BDE; nothing yet stops one firm taking most of the gate. Your cap is that missing per-firm layer.
- **More than one worker, for the tailor (2026-11-12):** done in step 3. Every process stamps every run it holds
  (`job_monitor.start_heartbeat`, generalising the tailor's stamp), and a run is failed only after 2 minutes without a
  stamp, so a restart, a deploy's overlap or a second copy never fails a live copy's runs.
- **AI quotas per plan,** with billing (Abdul). The cap above is not a quota.
- **AI work started in the background** (scoring after a scrape, the score a tailor chains): a request limit doesn't see it. It is covered once AI spend is recorded per firm (07-auth issue 8).
- **The IP-count fix:** done in step 6. A successful sign-in reset the IP's count as well as the email's, so someone with their own account could keep resetting the per-IP lock; `throttle.clear()` now resets only the email's.
- **More than one API process (after step 3).** In-memory counts are per process, so N processes allow about N times each limit. Choose then:
  - stay at one process (likely enough at BenchQ's load; §2 measures it)
  - counters in Postgres, which is already paid for (needs a table: Abdul)
  - sticky sessions at the proxy (per-user only)
  - Redis
- **A limit on résumé parses at once** (from Zuhair's parser PR, `cross-area-changes.md`). Scoring and tailoring
  have one (`scoring_max_concurrent`, `tailoring_max_concurrent`); the parser has none, so many uploads at once would
  hit OpenRouter's rate limits (429). It goes with the per-firm AI cap above.
- **The 500 page while rate-limited.** Reloading a page while the account is over its limit shows the generic "Something went wrong" page with status 500. The server-side session read (`src/lib/server/principal.ts`) throws on anything but a 401. Nobody is signed out, but the page should say what happened. It's a small PR of its own: the server-side read, and the page's message.

### Step 2, timeouts and limits: the plan (agreed 2026-10-31)

Three PRs, in order:

- **2a, request body size (done):** `backend/body_limit.py`.
  - **413 before the app reads the body:** over 11 MB on the file uploads (parse-resume, the candidate's résumé upload; `resumes/import-pdf` and `persona/import` were removed in résumé versioning PR 6), over 1 MB everywhere else.
  - **How it measures:** a declared `Content-Length` is judged from the header; a chunked body is read up to the cap.
  - **The upload routes keep their own 10 MB checks** and messages.
- **2b, database statement timeout (done; approved by Abdul, 2026-11-01):** `backend/statement_timeout.py`, two
  settings in `backend/models/db.py`. The limit is per query, never per task: a 20-minute scrape made of quick queries
  never meets it.
  - **15 s per query inside a web request:** every route's queries, the session check before every request, the
    after-response tasks (page cache, description fetch, H-1B lookup for one company) and the "test this search"
    preview.
  - **1 min per query for background work:** the scheduled jobs, everything started through `launch_background()`
    (also from a click: scoring, tailoring, search runs, admin buttons), startup and the scripts.
  - **None for migrations and `pg_dump`,** which open their own connections.
  - **5 s to open a connection** (`connect_timeout`), so an unreachable database fails fast.
  - **A query past its limit answers 503 + `Retry-After: 5`,** "The service is busy. Try again in a few seconds.";
    the pool-full 503 says the same. The route and the statement (without values) are logged on the server only.
  - **Why 1 minute in the background:** nothing found in the code comes close (cleanup deletes row by row), and a
    stuck background query holding locks makes users' pages wait behind it. Raise it if §2 or the logs show a real
    query nearing it.
- **2c, AI-call timeouts and retries (handed to Zuhair for now: `cross-area-changes.md`, the parser PR):**
  - **Done by Zuhair:** a deadline per attempt in `call_llm` (`LLMDeadlineError`), and the Next proxy waits up to
    6 minutes (`next.config.ts` `proxyTimeout: 360_000`) because a parse may take 4 attempts of 80 s.
  - **The 6 minutes applies to every `/api` route,** not just the parse: Next has one number for all its rewrites,
    with no per-route form. Before it was 30 s for all.
  - **Per-path timeouts belong to the production proxy** (Abdul's deployment): about 6 minutes for
    `POST /api/firms/{firm_id}/candidates/parse-resume`, and 30 s or less for the rest. Of the routes the frontend
    calls today, parse-resume is the only one doing slow work inside the request.
  - **Slow work inside other requests, not called by the frontend today** (JobNavigator routes, the extension, later
    modules): AI in `autofill/answer` (and `/stream`) and the candidate's résumé upload (the parser, like
    parse-resume); a headless browser in `cover-letters/{id}/pdf`; scrapes in `companies/{id}/test-scrape` and
    `searches/{id}/test`; a live H-1B lookup per company in `companies/refresh-h1b`, which grows with the number of
    companies. Each gets a number when BenchQ starts using it.
  - **Still open:** the AI libraries retry on their own (neither the Anthropic nor the OpenAI client sets
    `max_retries`), on top of `call_llm`'s 4 attempts.
  - **Later, a product decision:** parse as a background job (202 + polling, like tailor), so nothing waits minutes
    and the proxy's number can go back down. It changes the route and the onboarding screen.
- **No generic "kill the request" timeout:** Python can't stop a request mid-way, so it would report failures for work that still happens.

**For teammates (2b):**

- **Zuhair, Samad:** a single query inside a request is stopped at 15 s, and one in background work at 1 minute. Work
  started through `launch_background()` or `tracked_run()` (`backend/job_monitor.py`) gets the background limit
  automatically. A task started any other way from a request (`asyncio.create_task`, FastAPI's `BackgroundTasks`)
  keeps the 15 s: use `launch_background()` for anything heavy.
- **Abdul:** the production proxy needs per-path timeouts (2c above), and a migration or backfill that must run one
  long statement should do it through Alembic or its own connection, not the app's pool.

### Step 4a, logging (done; plan agreed 2026-11-03)

Python's `logging` sends every module's records up to one root logger. Each file keeps its
`logger = logging.getLogger("jobnavigator.…")`; what changed is the one place that decides how a line looks.

- **One setup:** `configure_logging()` in `backend/logging_setup.py`, called once by `backend/main.py` and
  `backend/scripts/db_upgrade.py`. It replaces `logging.basicConfig`. Lines go to stdout (Docker keeps them: json-file,
  20 MB × 5): JSON in production, readable text otherwise; `LOG_FORMAT` and `LOG_LEVEL` override
  (`backend/.env.example`). uvicorn's and the other libraries' lines go through the same handler.
- **A request id on every line:** `backend/request_log.py`, the outermost middleware. It keeps a safe incoming
  `X-Request-ID` (up to 64 letters, digits, `_`, `-`) or makes one, sends it back in the response, and writes one line
  per request: method, **route pattern** (never the raw path: invite links carry their token there), status, time
  taken, and the user and firm ids (for a Super Admin in a support view, the firm it reads). `/health` is logged at
  DEBUG. uvicorn's own access log is off (`--no-access-log` in `start.sh`).
- **A run id in background work:** lines from `launch_background()` and `tracked_run()` carry `run=` (the `job_runs`
  id). A run started from a request keeps that request's id too; a scheduled run has none.
- **Masked in every line:** emails (first letter kept), phone numbers (10 to 15 digits; dates, times and addresses are
  left alone), Bearer tokens, JWTs, `sk-` keys, `password=` / `token=` / `secret=` style fields, the value Postgres
  quotes in a bad-value error (`invalid input syntax for type integer: "…"`, which ~120 calls log as `f"...{e}"`) and
  the statement line it quotes with it (`LINE 1: …`, where psycopg2 has already put the values), and long strings of letters and digits (tokens, hashes); UUIDs are kept. Database errors are
  written as their type, SQLSTATE and statement, without the values Postgres repeats (`DETAIL: Key (email)=(…)`);
  `hide_parameters` in `backend/models/db.py` keeps bound values out of their text. Validation errors keep where and
  why, not the input. SQLAlchemy is held at WARNING, so `LOG_LEVEL=DEBUG` never prints rows.
- **An unexpected error** is logged once, with its traceback and request id; the answer stays the plain
  "Internal Server Error", plus `X-Request-ID`.
- **The canary test** (`backend/tests/test_logging_canary.py`) plants a name, email, phone number, résumé text, password
  and token in sign-in, invites, the password reset from request to new password, candidate create and edit, the
  résumé parse (the model stubbed), database errors (uncaught, and caught then logged as `f"...{e}"`) and unexpected
  errors, and fails if any of them reaches the log.
  With the masking switched off, it fails on the database and validation errors; the other flows log no personal data
  in the first place.
- **The rule** is in `CLAUDE.md` ("Things you must not do"): masking is the safety net, not permission.
- **CI keeps it for new code** (2026-11-04), so nobody has to come back to logging for each new route. Every route
  is logged by `RequestLog` with no per-route work (`test_logging.py` fails if that breaks), and two checks fail a PR
  that writes a person's data to the log:
  - **`backend/tests/test_log_lint.py` reads the code.** It follows people's data from where it enters (a route's
    body, URL values and uploads; a row of a people table, `PEOPLE_MODELS`; the AI's reply, any `call_*llm`; a reply
    from Google or an AI provider, `PERSONAL_HOSTS`) through assignments, loops, f-strings, dicts, `model_dump()`,
    helpers in the same file, background tasks and exceptions, to any logger. Ids, counts, statuses and `len()` pass.
    It reads branches no request reaches. It fails on `print()` in the server too.
  - **`backend/tests/test_log_every_route.py` runs every route.** Per route: a fresh database with a row in every
    table (people's text columns planted), a request built from the route's OpenAPI description with planted values
    in every string and a planted PDF for a file, and the AI's and Google's replies planted (`route_sweep.py`; no
    request leaves the test). It fails if a planted value reaches the log, after masking. A new route is checked the
    day it is added; nobody lists it. 135 of 182 routes run their normal path; `NOT_REACHED` lists the 47 the built
    request doesn't get through (an OAuth flow, a valid invite token, the browser), with the route's own refusal.
  - **Measured, not assumed:** `backend/tests/log_leak_cases.py` holds 30 leaks written the ways a teammate plausibly
    would, before either check, and 10 safe routes. The lint catches 28 and the sweep 24; only a reply from a host
    not in `PERSONAL_HOSTS`, logged whole, passes both. Neither flags a safe one. Both self-tests fail if that
    changes. With a leak put into the real candidate-edit route (`who = candidate.full_name`, then logged), both
    failed.
  - **Not covered:** a reply from an outside service not in `PERSONAL_HOSTS`; data a helper in another file fetches,
    logged only in a branch the sweep doesn't run; the normal path of the `NOT_REACHED` routes; scheduler jobs no
    route starts (the lint reads them, the sweep doesn't). These need a reviewer's look.
  - **Today's findings:** the lint's `KNOWN` and the sweep's `KNOWN_LEAKS` hold the calls already reported (below);
    `NOT_PERSONAL` holds 19 matches that aren't personal data, each with why. All three only shrink.
- **Fixed on the way:** the tracer redirect logged its link's token on a failed click write; it logs the link id.
- **Left as they are:** the existing log calls. The masking covers what it recognises (database errors, emails, phone
  numbers, tokens), not free text: the calls that log an AI reply are listed for their owners below. The two backfill
  scripts print a report
  in their own format; `backend/scripts/reset_password.py`, which prints the account's name to whoever runs it.

**For teammates (4a):**

- **Everyone:** keep `logging.getLogger("jobnavigator.<area>")` and never call `logging.basicConfig` or add a handler.
  A new program (the worker in step 3, a new script) calls `configure_logging()` first.
- **Everyone, logging in new code:** the rule is in the team README ([README.md](./README.md) §4, rule 9). The detail
  behind it:
  - **The sweep says a route "answered 4xx to the built request":** make the seed or the request fit
    (`route_sweep.py`: `FIELD_VALUES` for a value your code checks, `SEED_OVERRIDES` for a table rule), or list it in
    `NOT_REACHED` with why.
  - **`NOT_PERSONAL`** is only for a lint match that isn't personal data, with the reason. A new table with a rule
    across its columns needs a `SEED_OVERRIDES` line (`test_every_table_is_seeded` says when).
  - **Reviewers:** look at a new log call in an `except` branch or a scheduler job, and at any line added to
    `NOT_PERSONAL`, `NOT_REACHED`, `KNOWN` or `KNOWN_LEAKS`.
- **Samad:** `backend/email_monitor/gmail_client.py:36` logs Google's whole reply (`resp.text`) when a token refresh
  fails. The masking catches what it recognises, but logging the status code and Google's `error` field is safer.
  Your file, so not changed here.
- **Samad:** `backend/email_monitor/response_parser.py:171` and `:186` log 200–300 characters of the model's reply
  about an email, which can quote the email itself. Log its length and the parse error instead. `gmail_client.py:224`
  logs Google's whole reply when listing messages fails, like `:36` above: log the status code and Google's `error`
  field.
- **Zuhair:** two calls log up to 500 characters of the model's reply, which carries the candidate's name, phone and
  résumé text: `backend/analyzer/cover_letter_generator.py:107` (cover letter) and, until tailoring part 2 deleted
  it (2026-11-12), `backend/analyzer/legacy_tailoring.py:379`. Log the reply's length and the parse error instead, as `backend/candidates/parse.py:220` does. (The PDF import and the persona import, which
  logged a file name, were removed with `routes_resumes.py` and the persona import route, 2026-11-05.) The scrapers
  (`backend/scraper/orchestrator.py`, `sources/jobspy.py`, `freehire.py`, `jobright.py`,
  `levelsfyi.py`, `linkedin_personal.py`, and `backend/api/routes_searches.py:328`) log `search.name`, and JobSpy the
  search term. Searches are per candidate now (0007), and a BDE may name one after the candidate ("Ravi – Java"):
  log `search.id` instead.
- **Found by the new lint (2026-11-04):**
  - **Zuhair:** `backend/analyzer/cv_scorer.py:422` logs the first 200 characters of the scorer's reply when its shape
    is wrong (like the replies above: log its length); `:731` logs `job.best_cv`, a résumé's name, which a BDE may type
    as the candidate's name (log the résumé's id).
  - **Samad:** `backend/api/routes_applications.py:1226` logs a résumé's name (`cv_name`) when it can't be flattened:
    log the résumé's id.
  - **Samad, the email classification (2026-11-05), added in #107 for your review:** `process_pending`, `purge_due`
    and `routes_inbox.py` wrote no log line, and the classifier's AI calls weren't in `llm_call_log`. They now log ids,
    counts and error codes (never the exception's text, as your code intended), and each provider call is in
    `llm_call_log` with its firm. Listed in `cross-area-changes.md`; change or drop them as you see fit.
- **Samad and Zuhair, the calls above:** each is a one-line change (log a length, a status or an id instead of the
  text). Fix them in your own PR, or agree that Uzair fixes them in a small follow-up PR after #107, listed in
  `docs/team/cross-area-changes.md`. Found in Abdul's review of #107 and a search of every log call (2026-11-03).
- **Abdul (deployment):** the collector reads JSON lines from stdout. If the production proxy sets `X-Request-ID`, the
  backend keeps it, so the proxy's lines and ours share one id. Log retention is the deployment's.

### Step 3, the scheduler out of the API (plan agreed 2026-11-14)

**Why.** The scheduler (APScheduler, `backend/scheduler.py`) keeps its job list in memory, so every process that starts
one runs every job: two API workers, or the old and new API side by side during a zero-downtime deploy, would classify
each email twice and run two backups at once. That is why the API had to run as exactly one worker (07 Q37). Moving
the scheduler into its own process lifts that tie: the API may run as many copies as it needs, the scheduler exactly
one. This is the standard web/worker split (Twelve-Factor process types; Celery beat, Sidekiq), in its light form: a
separate scheduler process and Postgres for coordination, no Redis and no new table.

**What was built** (`feat/scheduler-worker`, one PR):
- **The worker:** `python -m backend.worker` (`backend/worker.py`), started by `backend/scripts/start_worker.sh` as
  the `worker` service in `docker-compose.yml`, from the same image. It runs the startup checks the jobs need (schema at
  head, the statement timeout, the Gmail token key), cleans its own stale runs, then the scheduler. Run exactly one.
  The API's `lifespan` no longer starts the scheduler; the tailor's heartbeat stays in the API (its runs live there).
- **Settings reach the worker by polling** (decided): `scheduler.reload_schedule_if_changed` runs every minute and
  reconfigures only when a schedule setting (`SCHEDULE_SETTING_KEYS`) changed. `PATCH /api/settings` no longer calls
  the scheduler. Side fix: `candidate_gmail_sync_interval_minutes` was never in the API's reconfigure list, so a change
  waited for a restart; it is reloaded like the rest now.
- **`GET /api/scheduler/jobs` retired (410)** (decided): it read the in-process scheduler, and no BenchQ screen or the
  extension called it. Run history stays at `/api/monitor/history`.
- **Stale runs: a heartbeat, not "I just started"** (decided 2026-11-14, replacing a first per-process split). The
  old start-up clean-up failed every `running` row, assuming whoever ran them was dead. That is wrong as soon as two
  copies overlap: a zero-downtime deploy starts the new API before the old one stops, and a second copy for capacity
  overlaps for good. A tailoring failed that way read as lost while its old copy went on to save it.
  Now every process (each API copy and the worker) stamps `meta.seen_at` on the runs it holds every 30 s, from its own
  thread (`job_monitor.start_heartbeat`; a run blocking the event loop can't silence it), and each beat fails any
  `running` row not stamped for 2 minutes (`cleanup_stale_runs`; a row never stamped counts from its start). The same
  rule and numbers as the tailor's (tailoring.md Q10b), which it generalises. A crashed process's runs read
  `running` for up to 2 minutes before they fail. The inbox's rows recover on their own and are left alone: an import
  (`recover_imports`), the classifier's pause (a state; failing it cleared the pause) and command rows. A
  classification row is never stamped (it isn't held in `_running`) and is failed only once it is 10 minutes old,
  well past its 2-minute claim lease. Fixes R4-T1-27 (its strict-xfail test now passes).
  Fixed in #147 (CodeRabbit): the tailor's save (`runs.py`, `_Stop(LOST)`) also stops when its row is no longer
  `running`, not only on an error code, so a run failed as silent can never come back as completed (a row for Zuhair
  in cross-area-changes.md).
- **`GET /api/monitor/active` reads `job_runs`**, so the worker's runs show: every `running` row, with this process's
  own runs from memory (their scope and company), minus the classifier's pause row. `_running` stays per process.
- **A manual trigger and a scheduled run never overlap:** the seven job types both processes start
  (`job_monitor.SHARED_JOB_TYPES`: `scrape_all`, `email_check`, `daily_digest`, `h1b_refresh`, `auto_reject`,
  `job_cleanup`, `db_backup`) are claimed in `job_runs`: a transaction-scoped advisory lock, then "is one running?",
  then the insert. Neither process can see the other's `_running` dict. Other job types keep the in-memory check.
- **Unchanged:** the API wakes the classifier from a route (`wake_worker`), in the API process. Emails are claimed
  with `SKIP LOCKED` and a lease, so two processes never take the same one (Samad's design). Same for "sync now".

**Not in step 3: more than one API worker.** Still per process: the rate-limit counters (deferred list above), the
tailor's gate and the scoring/tailoring semaphores (each N per worker), and `_running` for the other job types.
Whether to run several API workers is decided from the §2 load test.

**Open, carried from 2026-11-03:** "Q2/Q3 of #104's grilling still need Abdul." Not found in the docs; ask Abdul
whether they were settled.

### Step 4b, errors: one error shape (plan agreed 2026-11-20)

**The problem.** Backend errors come in four shapes: `{"detail": "text"}`, a 422's `{"detail": [{loc, msg}]}`, one
object `detail` (the duplicate résumé, `backend/candidates/versions.py:466`) and a plain-text 500. The frontend shows
`detail` word for word (`src/components/app/error-state.tsx` and about 20 components) and derives a code from the
status alone (`src/lib/api/http.ts`), so it can't tell a busy database from a daily quota, and an unexpected 500 reads
"Request failed with status 500.". A few messages carry exception text. Queries are retried after about 1 s and 2 s
whatever the error, a 401 or 403 included, while a busy 503 asks for `Retry-After: 5`. The provider's own rate limits
are not part of this: the backend already retries the AI provider (`backend/analyzer/llm_client.py`, 4 attempts,
2/4/8 s), and the frontend never retries a mutation, so an AI job is never started twice.

**The shape** (RFC 9457 "Problem Details", `application/problem+json`):

```json
{ "type": "about:blank", "title": "Conflict", "status": 409,
  "detail": "This résumé is already Base 2.",
  "code": "DUPLICATE_RESUME", "request_id": "…",
  "base_resume_id": "…", "hidden": false }
```

- `detail` is always a string written for the user, never internal. Keeping it a string keeps the extension's reader
  (`extension/src/api.ts:57`) and about 100 backend test assertions working.
- A 422's `detail` is one actionable sentence, along the lines of "BenchQ couldn't take this as it was sent. Refresh
  the page and try again." (confirmed 2026-11-20); the fields go in `errors: [{loc, msg, type}]`, never the
  submitted value (Pydantic's `input` would echo an email or password back).
- Extra fields sit at the top level (the duplicate résumé's `base_resume_id`, `hidden`).
- `Retry-After` stays a header.

**Decisions (Uzair, 2026-11-20):**

1. **A contract first:** `docs/02-DATA-CONTRACTS.md` §12 (the body, the code registry, the rules below),
   signed off by Abdul before the PR merges. It is built meanwhile. `docs/integration/00-foundation.md` points to it.
2. **Codes by meaning, not status.** The default comes from the status (409 → `CONFLICT`). A specific code only where
   the frontend acts differently. One registry table in the contract, keeping the names the frontend already uses
   (`RATE_LIMITED`, `UNAVAILABLE`, `NETWORK`, `SCHEMA_MISMATCH`, `DUPLICATE_JOB`, …). A 429, 503 or 500 is not always
   a system error:
   - `RATE_LIMITED` only from the throttle (`backend/auth/throttle.py`); the business limits get their own codes and
     keep their meaning and specifics (the limit, when it resets), worded by the `docs/02` §12.3 writing rules
     (Uzair, 2026-11-20): the daily job-add quota (`routes_applications.py:411`), the job search quotas
     (`routes_job_search.py:85`), "5 tailorings running" (`resume_tailor/runs.py:281`).
   - The busy code only from `statement_timeout.busy_response()`; "the search couldn't start" and "not configured"
     503s get their own.
   - `INTERNAL` only for a crash; the deliberate 500s keep their own code: the tailor isn't set up
     (`routes_resume_tailoring.py:48`), the résumé reader didn't answer (`candidates/parse.py:215`). The set-up 500s
     say "…isn't set up yet. Ask your admin."; the setting's name goes to the log, not the answer (Uzair, 2026-11-20,
     replacing "keep the setting name"; the writing rules are `docs/02` §12.3).
   - **No specific code on a 404 or 403, ever:** one body for every not-found, so a code can't confirm a record exists
     in another firm (CLAUDE.md, routes and access).
3. **The frontend's own text only for system errors** (busy, rate-limited, offline, unexpected, data mismatch), chosen
   by code, from one map beside `ApiError`. Every other error keeps the backend's text. The wording is Abdul's (the
   proposal is the table in `docs/02` §12.3). Busy has one text everywhere: "BenchQ is handling a lot right now. Try
   again in a few seconds." (a page's card shows only after its retries ran out). The sign-in page keeps its own
   throttle line, "Too many sign-in attempts. Try again in 15 minutes.", with the real wait (Uzair, 2026-11-20).
4. **"Reference: …" (the request id) on an unexpected 500 only.** No id (the Next proxy's own 500 when the backend is
   down, which has no JSON body): no reference line.
5. **Queries never retry a 4xx;** network errors and 5xx are retried, waiting what `Retry-After` asks (with a ceiling).
   Mutations stay unretried.
6. **The duplicate résumé's fields move to the top level;** the frontend reads both shapes during the switch.
7. **The website's text changes only for the system codes, from one function** (decision 3); every other error shows
   the backend's `detail` as today, and `http.ts` reads the body's code. A validation 422 shows the backend's sentence
   ("BenchQ couldn't take this as it was sent. Refresh the page and try again."), not the field list (Uzair,
   2026-11-20). The extension never uploads résumés, so
   the duplicate-résumé 409 doesn't reach it. Its only visible change is a validation 422: today the list `detail` is
   ignored and it shows its own "refresh" advice (`extension/src/api.ts:56`, `failureOf`); with the actionable 422
   sentence it shows the same advice, so the extension needs no change. Samad is informed, not asked to change
   anything.

**One PR (decided by Uzair 2026-11-20), in two parts.** It merges after Abdul signs off both the contract
(`docs/02` §12) and the wording (the frontend's own messages, §12.3's rules).

- **Part 1, the shape (backend).** One `problem_response(...)` helper in the backend; handlers in `main.py` for FastAPI's and
  Starlette's `HTTPException` (unknown paths and wrong methods raise Starlette's), validation errors, the existing
  DataError / pool / timeout handlers and the unexpected 500; `exc.headers` kept. Every hand-built error response
  BenchQ reaches goes through the helper: the sign-in refusal (`auth/access.py`, `_refuse`, its cookie delete kept),
  the 413 (`body_limit.py`), the busy 503, the per-user 429 (`main.py`, `limit_per_user`). The exception text BenchQ
  reaches is fixed: the mailbox-connect errors (`routes_inbox.py:298,300`; check 298 is written for users first).
  `http.ts` reads the new shape (decision 7). Tests: a sweep that every route's error has the shape and a known code,
  a 422 with a planted value that isn't echoed, a 405 and an unknown path, the content type, the extension's reader
  against the new body, and the ~30 backend tests that assert the old shape exactly, updated (rows in
  `cross-area-changes.md` for their owners).
- **Part 2, what users see (frontend, `src/` only).** The frontend's text per system code, the reference line, the retry rule (decision 5,
  `retry.ts` and `ApiError` carrying `Retry-After`), a test for a 500 with no JSON body. Agreed 2026-11-20: a
  `Retry-After` wait is capped at 10 s; the system text comes from one function used by the page error cards and by
  the inline and toast errors after a button press; the reference has a copy button. Wording: drafted, with Uzair to
  take to Abdul.

**Left out, JobNavigator leftovers no BenchQ screen or the extension calls:** the 11 "already running" trigger 409s in
`main.py` (scrape, Telegram, H-1B, backup, auto-reject), the companies test-scrape 500 (`routes_companies.py:670`),
the posting fetch (`routes_jobs.py:1199`), "Unsafe URL" (`routes_applications.py:1013`), the persona 500s
(`routes_persona.py:49,62`), Autofill's old routes (`routes_autofill.py`: `/api/autofill/config`, `/answer`,
`/answer/stream`), cover letters. Their raised
errors get the shape from the central handler for free; the hand-built ones stay as they are, listed as exceptions in
the sweep, for Abdul's clean-up track. The streamed autofill answer's own error event is out of scope too.

**Found on the way, not in 4b:** a crash inside the Gmail connect callback (`/api/oauth/google/callback`) reaches the
outermost 500 handler, so `_oauth_browser_result` (`main.py`) never redirects and the user lands on a raw error. A
small fix of its own.

**Follow-ups from 4b's QA (Uzair, 2026-11-21), each a PR of its own:**

- **Named layers.** What sits on top of what is raw `z-*` numbers across the code (10–40 sticky, menus, banner; 50
  drawer, palette, studio; 60 tailoring panel; 70 the studio's selection toolbar). 4b put toasts at `z-[80]`
  (`src/components/app/toast-layer.ts`, guarded by `toast-layer.test.ts`). Name the layers in `design.md` and the
  theme (e.g. overlay, panel, popover, toast) and move every overlay onto them (CLAUDE.md: no raw values).
- **Errors inside popup windows.** A native modal `<dialog>` (`showModal()`: `ConfirmDialog`, upload résumé, use as base,
  job capture, `admin-dialog`, the wizard's discard dialog…) sits above every layer and blocks the page, so a toast
  raised while one is open can't be seen. Rule: while a popup is open, its failure shows inside it (`ErrorNote` with
  the reference). Check each popup; existing behaviour, not caused by 4b.
- **Pre-existing accessibility found by axe:** the not-found and Forbidden screens have no `h1`; the Forbidden screen's
  description fails contrast on a hard load without the app shell (3.88:1); the sign-in page has no `<main>`.

### Step 6, security headers, CORS and secrets (plan agreed 2026-11-23)

**The problem.** Production's safety rested on settings nobody checked:
- `DATABASE_URL` fell back to `postgresql://jobnavigator:password@db…` (`backend/config.py:11`), so a forgotten
  variable started production on the local default password.
- `ALLOWED_ORIGINS` fell back to the `http://localhost` list in production too (`config.py:20`), and was not
  validated; the same list feeds CORS (`main.py:141`, with `allow_methods` and `allow_headers` `*`) and the CSRF
  Origin check (`backend/auth/access.py:325-330`).
- An empty `SESSION_COOKIE_SECURE=` or `BENCHQ_ENV=` meant "not production" (`config.py:14,17`): insecure cookies,
  the API docs on.
- The AI key's secret was checked only when a key was stored (`main.py:55`), the reset link's base only for https
  (`backend/auth/password_reset.py:25`), and nothing stopped a production database holding the seeded demo accounts,
  whose password is published (docs/03 §3.2).
- No API answer carried security headers (nosniff, framing, referrer, HSTS), and uvicorn named itself in `server`.
- A successful sign-in cleared the IP's failure count (`backend/auth/throttle.py:81-83`).

**Decisions (Uzair, 2026-11-23):**
1. **Two PRs:** the backend's (the IP fix, the production config checks, the API's headers, CORS), then the
   frontend's (the pages' headers and their CSP, `next.config.ts`).
2. **CORS narrowed now, removed later:** methods GET/POST/PUT/PATCH/DELETE, `allow_headers` Content-Type and
   X-Request-ID, `expose_headers` Retry-After and X-Request-ID, `max_age` 600. The site calls through the Next proxy
   (same origin) and the extension has host permissions, so neither should need CORS; it goes in a later PR, once a
   manual extension test confirms that. **One validated origin list** for CORS and the Origin check
   (`config.parse_origins`, lower-case).
3. **No demo account gets in, in production** (revised 2026-11-23; a start-up refusal was dropped: an OWNER or the
   Super Admin could invite a `*.benchq.test` address and stop every firm at the next restart). Instead, in production
   only: no invite (an OWNER's, a new firm's owner, a resend) goes to an address on a testing domain (`.test`,
   `.example`, `.invalid`, `.localhost`): a 400 in the §12 shape, "This is a test address, and BenchQ invites only real
   ones. Use the person's own email address."; and an account with such an address can't sign in, with the same 401
   as a wrong password, so it confirms nothing (`backend/auth/invites.py`, `routes_auth.py`). The demo seed
   (`seed_demo`) runs only when `BENCHQ_ENV` is exactly `development`. Development is unchanged.
4. **`AI_SETTINGS_ENCRYPTION_KEY` required always in production,** API and worker; development unchanged.
5. **No CSP report endpoint:** the frontend switches its CSP between report-only and enforcing with an environment
   variable instead.
6. **Staging runs as `BENCHQ_ENV=production`,** with its own accounts on real (non-test) addresses; there is no third
   mode. Everything above applies to it.
7. **Merge order: the backend PR first;** the frontend PR cites this section.
8. **HSTS is the HTTPS proxy's** (Abdul, 2026-11-23): his Caddy sets it for `app.benchq.io` (`max-age=300`, raised to a
   year after a week; no `preload`), in the Caddyfile on his branch `deploy/aws-ec2`. The backend never sends it, so it
   can't contradict the proxy's. Never `includeSubDomains` on `benchq.io`: it would force HTTPS on every subdomain.
   The marketing site (`benchq.io`, `www`) is on Vercel and sends its own.
9. **The database password:** production uses password authentication only (EC2 now, RDS planned), so no password,
   an empty one or `password` is refused. No test or CI run uses SQLite (conftest forces the Postgres test database;
   CI runs Postgres), so nothing is exempt.

**The backend PR** (`feat/production-hardening-backend`):
- **The IP-count fix:** `throttle.clear()` clears only `email:{email}`. The trade-off (an office behind one NAT shares
  the IP's count and a colleague's success no longer clears it) is written in the test.
- **The production config check** (`backend/startup_checks.py`): `check_production_config(env, role)` is pure (the
  mapping it is given; no database, no module reload) and returns one line per problem naming the variable, never its
  value; `require_config(role)` raises them as one error. Production (`BENCHQ_ENV` unset or `production`) refuses:
  `DATABASE_URL` with the default password `password`; `AI_SETTINGS_ENCRYPTION_KEY` missing or not Fernet; Gmail on
  without a client id, a secret, an https redirect or a Fernet key; and, for the API, `ALLOWED_ORIGINS` unset or any
  entry not exactly `https://host[:port]` (not `:443`, which a browser never sends) or `chrome-extension://<32
  letters a-p>`, `SESSION_COOKIE_SECURE` false, `TRUSTED_PROXY_HOPS` 0, `PASSWORD_RESET_BASE_URL` not https or its
  origin not listed, the Gmail redirect's origin not listed. Every environment refuses what nothing can run with:
  `DATABASE_URL` unset, `TRUSTED_PROXY_HOPS` not a number, an unknown `BENCHQ_ENV`, a bad Gmail key with Gmail on.
  It runs first everywhere: `python -m backend.scripts.check_config --role api|worker` in the start scripts before the
  migration (never opens the database), `db_upgrade` (a direct run), the lifespan (API), `worker.start`, and every
  script that writes to the database (`seed_demo`, `create_platform_admin`, `reset_password`, the backfills,
  `move_local_jobs_to_postings`). The stored AI key's decrypt stays in the lifespan (it needs the database).
  `config.py` reads leniently: no fallback `DATABASE_URL` and no crash on import; the engine builds on a `.invalid`
  host until the check speaks.
- **Testing domains** (decision 3): `invites.normal_email` and `resend_invite` refuse them, sign-in refuses their
  accounts, production only.
- **Secrets lint** (`backend/tests/test_secret_lint.py`, over backend/ with the tests): no `os.getenv` /
  `os.environ.get` / `.setdefault` / `os.environ[…] =` / `os.getenv(…) or "…"` of a secret-ish name with a literal
  default, no literal in a secret-named constant; `NOT_SECRET` by name with the reason, a stale check and a planted self-test.
- **The API's headers** (`backend/security_headers.py`, the outermost middleware, set only when absent):
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'` (not on the API docs in development), `X-Frame-Options: DENY` unless the route set its own
  CSP (the posting reader is framed by the app), `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy:
  same-origin`. No `Strict-Transport-Security` (decision 8; a test checks it is never sent).
  `problem_response` adds the same set, because the crash 500 is sent outside every user middleware. uvicorn runs
  with `--no-server-header`. The route sweep checks the headers on every route: the API's CSP on each, unless the
  route is named with its own (the posting reader) or is the API docs in development.
- Docs: `backend/.env.example` "Production: required"; the root `.env.example` loses the backend-only
  `CANDIDATE_EMAIL_*` lines.

**The frontend PR** (`feat/production-hardening-frontend`), the pages' headers:
- **CSP** per request from `src/proxy.ts` (`src/lib/security/csp.ts`, a pure builder): `default-src 'self'`;
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in development only); `style-src 'self'
  'unsafe-inline'` (computed `style` attributes and next-themes' guard); `img-src 'self' https://www.google.com
  https://*.gstatic.com` (company favicons, the Google mark); `font-src 'self' data:`; `connect-src 'self'` (plus `ws:`
  in development for HMR); `frame-src https://linkedin.com https://*.linkedin.com` (the source preview's LinkedIn
  posting, nothing else); `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`;
  `manifest-src 'self'`. No `upgrade-insecure-requests` (the app is also opened over plain http on a local network) and
  no report endpoint.
- **A fresh nonce per request,** read by Next for its own scripts and passed to next-themes' inline script by the root
  layout. Reading the request headers makes **every page dynamic** (a static page would carry one build-time nonce).
- **`CSP_REPORT_ONLY=true`** in the server's environment sends the policy as `Content-Security-Policy-Report-Only`,
  without a rebuild: the switch if a page breaks during a shift.
- **The other page headers** (`next.config.ts`, every path but `/api` and `/health`, which are the backend's):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(),
  usb=(), browsing-topics=()`; no `X-Powered-By`. As built it also sends `Strict-Transport-Security: max-age=86400`
  in production builds; with decision 8 that header is the proxy's, so the frontend PR drops it too (open below).
- **The CI check** (`scripts/check-csp.mjs`, after `pnpm build`): no page prerendered; on `next start`, enforced and
  report-only, the policy under the right header, a fresh nonce per request on every `<script>`, the page headers
  there, and none of them on `/api` and `/health`.

**What needs Abdul, answered 2026-11-23:**
- The empty database password and HSTS: decisions 9 and 8.
- **Production facts:** `BENCHQ_ENV` is unset in production (AWS EC2 behind Caddy), so it runs as production.
  `ALLOWED_ORIGINS=https://app.benchq.io` today, exactly: `benchq.io` and `www` are other origins, added only if a
  marketing page ever calls the API; never `*`. The session cookie has no `Domain` attribute (`app.benchq.io` only);
  don't widen it. No real users yet, so a redeploy is cheap, but run `python -m backend.scripts.check_config --role
  api` (and `--role worker`) against the production environment first. A secret scanner (gitleaks) is approved; it
  is built separately.
- Still for his review: the changes in his areas (`access.py`'s Origin compare, `config.py`, the start scripts and
  database scripts, the invites' and sign-in's testing-domain refusal; rows in `cross-area-changes.md`).

**Open:**
- **The extension's origin in production (Abdul).** His reply says both that the Web Store id is stored in
  `ALLOWED_ORIGINS` and that `ALLOWED_ORIGINS=https://app.benchq.io` today. If `chrome-extension://<the store id>` is
  not in the production list, the Origin check refuses every save the extension makes (403 "Cross-origin request
  refused"; docs/extension-store.md step 5). Confirm the list is `https://app.benchq.io,chrome-extension://<id>`.
- **The frontend's HSTS:** `next.config.ts` on `feat/production-hardening-frontend` still sends
  `Strict-Transport-Security: max-age=86400` in production builds, and `scripts/check-csp.mjs` expects it; with
  decision 8 it should go there too (that PR's owner).

**Left out, JobNavigator leftovers (for Abdul's clean-up):** the old single-account Gmail monitor's `GMAIL_CLIENT_ID`
/ `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` and `TELEGRAM_BOT_TOKEN` are read but not checked.

## 2. Production testing (second)

Load (requests per second per route, the nightly 6:30 PM – 12:30 AM IST peak), failure (backend, database, AI
provider down), security (the isolation test, auth, a pen-test pass), and a staging run of everything above.

## Rules for you

- New dependencies are agreed with Abdul (and `docs/01-FRONTEND-ARCHITECTURE.md` §3 for the frontend).
- Don't change tables; ask their owner (team README §3).
