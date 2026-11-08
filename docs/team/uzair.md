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
(`backend/scraper/sources/*`); one uvicorn worker with the scheduler inside it.

1. **Requests per second:** rate limits per IP for sign-in and invite acceptance (brute force), per user for the API,
   per firm for the AI routes (parse, tailor, score: they cost money). 429 with `Retry-After`; the frontend's
   `http.ts` already maps 429 to `RATE_LIMITED`.
2. **Timeouts and limits:** request body size (the résumé upload is 10 MB), request timeouts, database pool size and
   statement timeouts, AI call timeouts and retries.
3. **The scheduler out of the API process,** so the API can run more than one worker.
4. **Errors and logging:** structured logs with a request id, no secrets or personal data in logs, one error shape.
5. **Health and readiness** endpoints for the deployment (agreed with Abdul).
6. **Security headers and CORS** for production; secrets only from the environment.

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
- **AI quotas per plan,** with billing (Abdul). The cap above is not a quota.
- **AI work started in the background** (scoring after a scrape, the score a tailor chains): a request limit doesn't see it. It is covered once AI spend is recorded per firm (07-auth issue 8).
- **The IP-count fix.** A successful sign-in resets the IP's count as well as the email's, so someone with their own account can keep resetting the per-IP lock. The fix is to reset only the email's count (`throttle.clear()`).
- **More than one backend process (step 3).** In-memory counts are per process, so N processes allow about N times each limit. Choose then:
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
    modules): the candidate's résumé upload (the parser, like parse-resume); a headless browser in `cover-letters/{id}/pdf`; scrapes in `companies/{id}/test-scrape` and
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
  résumé text: `backend/analyzer/cover_letter_generator.py:107` (cover letter) and
  `backend/analyzer/legacy_tailoring.py:379` (tailoring, moved there from `routes_resumes.py`). Log the reply's length
  and the parse error instead, as `backend/candidates/parse.py:220` does. (The PDF import and the persona import, which
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

### Step 4b, errors: one error shape (planned)

The frontend shows the backend's `detail` text word for word (`src/components/app/error-state.tsx`), so backend wording reaches users. Step 4 gives every backend error a machine-readable code, RFC 9457 "Problem Details" style, next to the message. The frontend then shows its own plain-language message per code: busy, rate-limited, offline, unexpected. The wording is a product call (Abdul). Internal details (the database, a query) stay in the server logs (OWASP error handling).

Also in 4b: the frontend retries a failed query after about 1 s and 2 s (TanStack Query's default delay;
`src/lib/query/retry.ts`), while a 503 asks for `Retry-After: 5`. It should wait what the backend asks.

## 2. Production testing (second)

Load (requests per second per route, the nightly 6:30 PM – 12:30 AM IST peak), failure (backend, database, AI
provider down), security (the isolation test, auth, a pen-test pass), and a staging run of everything above.

## Rules for you

- New dependencies are agreed with Abdul (and `docs/01-FRONTEND-ARCHITECTURE.md` §3 for the frontend).
- Don't change tables; ask their owner (team README §3).
