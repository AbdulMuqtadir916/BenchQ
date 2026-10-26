# Module 00, Parts B and C: connect the frontend, auth

> **Archived 2026-10-26.** Part B (connect the frontend) and Part C (the shared access key) were replaced by F3
> and F6 in `docs/integration/07-auth-and-tenancy.md`: sign-in is per-user cookie sessions. The "Known setup
> pitfalls" that sat above Part A now live in `docs/troubleshooting.md`. Kept for history.

## Part B — Connect the frontend

> Still valid for the proxy check; sign-in goes live in 07-auth-and-tenancy F6.

1. `cp .env.example .env.local`. The template already has `BACKEND_URL=http://localhost:8000`.
2. `pnpm dev`, open `http://localhost:3000/health` → backend JSON. That proves the proxy.
3. Nothing else needs to change yet: with `NEXT_PUBLIC_LIVE_MODULES` empty, every screen still runs
   on mocks.

---

## Part C — Auth

> **Superseded (2026-10-21)** by [`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md): the shared API
> key is removed, not wired into the frontend: sign-in is per-user cookie sessions, and every endpoint needs one
> (07 Q37, Q38; onboarding PR 2). Kept below as a record of how the backend authenticated before.

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
