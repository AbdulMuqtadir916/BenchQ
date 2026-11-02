# Password reset by approval, and the Notifications inbox

Branch: `feat/password-reset-notifications` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Base: `origin/main` at `a1c7a92` (merged 2026-11-02, includes Applications 0009 #100, body limit #101, first base
résumé #102, statement timeouts #103).

## Scope and dependencies

07 Q54: a forgotten password is approved by one person instead of reset by email. A BDE's request goes to their active
assigned manager (or the firm's owner when there is none), a manager's and a viewer's to the owner, an owner's to the
Super Admin. The request freezes the old password and signs the account out; approval returns a one-use link that
works for 30 minutes, shown only to the approver, who shares it by hand. Denial, or the request's 24-hour expiry,
restores the old password. The Notifications inbox (firm users under Preferences, the Super Admin in the admin shell)
is new and extensible: password-reset approval is its first type.

Depends on the merged tenancy tables (`users`, `firms`, `platform_users`, `sessions`), the session helpers and the
ledger. No change to any table another person owns. No new dependency.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/.env.example` | Documents `PASSWORD_RESET_BASE_URL`, the origin put in front of a reset link (HTTPS in production). |
| `backend/api/routes_auth.py` | Adds `POST /api/auth/password-reset/request` (always the same generic answer) and `/complete` (sets the new password, consumes the link, revokes sessions, logs to the ledger). Sign-in refuses a frozen account with the usual credential error, holding the user row lock so it serializes with a new request. |
| `backend/api/routes_notifications.py` | New. Lists the signed-in recipient's notifications with the linked request's current status, marks one read, approves or denies a request, and reissues a link for the original approver. Every lookup is filtered by recipient (and firm), so another account's id is a 404. |
| `backend/auth/access.py` | Classifies the two public reset routes and the four signed-in notification routes. |
| `backend/auth/password_reset.py` | New. Approver routing within the requester's own firm, freezing and expiry, the link (random token, stored only as a SHA-256 hash, 30 minutes), decisions under row locks. Expiry is flushed before the caller queries again (sessions don't autoflush): without it, the first sign-in after an approver went stale was refused, and a new request right after an expiry was ignored (`test_stale_approver_after_request_expires_it_without_rerouting` caught it). |
| `backend/auth/policy.py`, `backend/auth/policy_table.json` | New actions `notification.approve` (OWNER, MANAGER) and `platform.notification.approve` (Super Admin, not in a support view). |
| `backend/auth/throttle.py` | Rate limits for reset requests: 10 a minute per IP, 3 an hour per hashed email. |
| `backend/config.py` | Reads `PASSWORD_RESET_BASE_URL` (local default `http://localhost:3000`). |
| `backend/main.py` | Mounts the notifications router. |
| `backend/migrations/versions/0010_password_reset_approvals.py` | New. Creates `password_reset_requests` and `notifications` with their checks and indexes; a real `downgrade()`. Was `0009` before main gave that number to Applications. |
| `backend/models/__init__.py`, `backend/models/notifications.py` | The two models, registered with the metadata. |
| `backend/scripts/reset_password.py` | A staff reset also cancels the account's open approval request and resolves its notifications. |
| `backend/tests/test_access.py` | The public reset routes in the public-route list. |
| `backend/tests/test_migration_0009.py` (Samad's) | The refused-downgrade test now checks the version is unchanged instead of `"0009"` by name, since `0010` is the head now. Listed in [cross-area-changes.md](../cross-area-changes.md). |
| `docs/team/cross-area-changes.md` | Records the change above. |
| `backend/tests/isolation_cases.py` | The six new routes classified for the F7 isolation test (signed-in routes act only on the caller's own notifications). |
| `backend/tests/test_password_reset.py`, `backend/tests/test_password_reset_approval.py` | New. Routing for every requester, freeze and unfreeze, expiry, reissue by the original approver only, concurrency, cross-firm isolation, the support view, password checks. |
| `docs/02-DATA-CONTRACTS.md` | The Notification and PasswordResetRequest contract (§3.1, Q54). |
| `docs/07-ROUTES-AND-RBAC.md` | Q54, Q50 narrowed to candidate assignments, the public routes, `/[firm]/notifications` and `/admin/notifications`. |
| `docs/team/README.md` | The owner row, the two tables, migration `0010` claimed. |
| `docs/team/umamah.md` | The plan and its status. |
| `docs/team/pr-changes/feat-password-reset-notifications.md` | This document. |
| `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx` | New public pages. The link's token arrives in the URL fragment and is removed from the address bar once read. |
| `src/app/[firm]/(app)/notifications/page.tsx`, `src/app/admin/notifications/page.tsx`, `src/components/app/notifications-inbox.tsx` | New Notifications pages and the inbox: approve, deny, copy the link, create a fresh one. |
| `src/app/sign-in/page.tsx` | "Forgot password?" links to `/forgot-password`. |
| `src/components/layout/sidebar.tsx` | A Preferences section in the admin sidebar; a pending-request count on Notifications. |
| `src/components/layout/notifications-menu.tsx` | Formatting only. |
| `src/lib/api/password-recovery.ts` | The adapter for the reset and notification routes. |
| `src/lib/api/password-reset.ts`, `src/lib/hooks/use-password-reset.ts` | An earlier adapter and hook for the same routes; nothing uses them yet. |
| `src/lib/auth/policy.ts`, `src/lib/auth/policy-table.test.ts` | The two actions, mirrored from Python. |
| `src/lib/routes/registry.ts`, `src/lib/routes/registry.test.ts` | Routes `forgot-password`, `reset-password`, `notifications`, `admin.notifications`, and their access table rows. |

## Migration and rollback

- One revision, `0010`, on main's `0009`. Two new tables only; no existing table changes.
- `downgrade()` drops both tables. Open requests are lost on downgrade, which unfreezes those accounts.

## Merge with main

- `docs/team/README.md` §6: kept Samad's `0009`, this PR claims `0010`, next free is `0011`.
- `backend/auth/access.py`, `backend/main.py`, `docs/02-DATA-CONTRACTS.md` merged without conflict.
- `backend/tests/test_migration_0009.py` adjusted for the new head (above).

## Validation (2026-11-02, Windows, Docker Postgres)

- `pnpm typecheck` and `pnpm lint` clean.
- `pnpm test`: 558 of 559 pass. `src/mocks/db.test.ts` (the fixture fingerprint) fails only on this Windows checkout,
  where Git writes the fixture JSON with CRLF; unrelated to this PR and unaffected on CI.
- Backend suite on Postgres: see the PR description.

## Remaining limits

- The Requests inbox, the bell entry for new requests, the link-expiry wording and removing Design system from the
  sidebar are next on this branch ([umamah.md](../umamah.md) Status).
- The sidebar's notifications query moves into a hook with a firm-scoped key in that change.
- Anyone who knows an account's email can freeze it until the approver denies or the request expires (Q54 accepts
  this trade-off; rate limits and the 24-hour expiry bound it).
