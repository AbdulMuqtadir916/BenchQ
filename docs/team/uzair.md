# Uzair — The production layer, then production testing

**An outline.** Each step gets a detailed plan, written with Uzair when he starts it (team plan, 2026-10-29).

Read first: [team README](./README.md), `docs/integration/07-auth-and-tenancy.md` (sessions, the one-worker rule
while the scheduler lives in the API process, Q37), `backend/main.py`, `docker-compose.yml`.

You own no candidate tables. Your area is the request path and the runtime around every route: middleware, limits,
config, logging. Changing a route's behaviour for its owner (Samad, Zuhair, Abdul) is agreed with them.

## 1. The production layer (first)

What exists today: a sign-in throttle and an invite-acceptance limit, per IP and per email, in memory
(`backend/auth/throttle.py`); no other API rate limiting; per-scraper throttles (`backend/scraper/sources/*`); one
uvicorn worker with the scheduler inside it.

1. **Requests per second:** rate limits per IP for sign-in and invite acceptance (brute force), per user for the API,
   per firm for the AI routes (parse, tailor, score: they cost money). 429 with `Retry-After`; the frontend's
   `http.ts` already maps 429 to `RATE_LIMITED`.
2. **Timeouts and limits:** request body size (the résumé upload is 10 MB), request timeouts, database pool size and
   statement timeouts, AI call timeouts and retries.
3. **The scheduler out of the API process,** so the API can run more than one worker.
4. **Errors and logging:** structured logs with a request id, no secrets or personal data in logs, one error shape.
5. **Health and readiness** endpoints for the deployment (agreed with Abdul).
6. **Security headers and CORS** for production; secrets only from the environment.

## 2. Production testing (second)

Load (requests per second per route, the nightly 6:30 PM – 12:30 AM IST peak), failure (backend, database, AI
provider down), security (the isolation test, auth, a pen-test pass), and a staging run of everything above.

## Rules for you

- New dependencies are agreed with Abdul (and `docs/01-FRONTEND-ARCHITECTURE.md` §3 for the frontend).
- Don't change tables; ask their owner (team README §3).
