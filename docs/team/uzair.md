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
- **Cover letters, persona and autofill have no rate limit.** Cover letters and persona are being dropped, and Samad is reworking autofill.

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
  - **413 before the app reads the body:** over 11 MB on the file uploads (parse-resume, `resumes/import-pdf`, `persona/import`), over 1 MB everywhere else.
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
    modules): AI in `resumes/import-pdf`, `persona/import`, `autofill/answer` (and `/stream`); a headless browser in
    `resumes/{id}/pdf` and `cover-letters/{id}/pdf`; scrapes in `companies/{id}/test-scrape` and
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

### Step 4, errors: one error shape (planned)

The frontend shows the backend's `detail` text word for word (`src/components/app/error-state.tsx`), so backend wording reaches users. Step 4 gives every backend error a machine-readable code, RFC 9457 "Problem Details" style, next to the message. The frontend then shows its own plain-language message per code: busy, rate-limited, offline, unexpected. The wording is a product call (Abdul). Internal details (the database, a query) stay in the server logs (OWASP error handling).

Also in step 4: the frontend retries a failed query after about 1 s and 2 s (TanStack Query's default delay;
`src/lib/query/retry.ts`), while a 503 asks for `Retry-After: 5`. It should wait what the backend asks.

## 2. Production testing (second)

Load (requests per second per route, the nightly 6:30 PM – 12:30 AM IST peak), failure (backend, database, AI
provider down), security (the isolation test, auth, a pen-test pass), and a staging run of everything above.

## Rules for you

- New dependencies are agreed with Abdul (and `docs/01-FRONTEND-ARCHITECTURE.md` §3 for the frontend).
- Don't change tables; ask their owner (team README §3).
