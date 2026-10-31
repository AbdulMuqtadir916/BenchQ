# Uzair — The production layer, then production testing

**An outline.** Each step gets a detailed plan, written with Uzair when he starts it (team plan, 2026-10-29).

Read first: [team README](./README.md), `docs/integration/07-auth-and-tenancy.md` (sessions, the one-worker rule
while the scheduler lives in the API process, Q37), `backend/main.py`, `docker-compose.yml`.

You own no candidate tables. Your area is the request path and the runtime around every route: middleware, limits,
config, logging. Changing a route's behaviour for its owner (Samad, Zuhair, Abdul) is agreed with them.

## 1. The production layer (first)

What exists today: a sign-in throttle and an invite-acceptance limit, per IP and per email, and a per-user limit on
every signed-in request, all in memory (`backend/auth/throttle.py`; the table below); per-scraper throttles
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

## 2. Production testing (second)

Load (requests per second per route, the nightly 6:30 PM – 12:30 AM IST peak), failure (backend, database, AI
provider down), security (the isolation test, auth, a pen-test pass), and a staging run of everything above.

## Rules for you

- New dependencies are agreed with Abdul (and `docs/01-FRONTEND-ARCHITECTURE.md` §3 for the frontend).
- Don't change tables; ask their owner (team README §3).
