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

## Second commit: the Requests inbox, the bell, the link wording

Removing Design system from the sidebar is not in this PR; it is `feat/remove-design-system-nav`.

| File | Changes and reason |
|---|---|
| `src/lib/routes/registry.ts`, `src/lib/routes/registry.test.ts` | A `notifications` nav section and its first inbox, **Requests**: `notifications.requests` (`/[firm]/notifications/requests`, every firm role, not in a support view) and `admin.notifications.requests` (`/admin/notifications/requests`); access, support and palette rows in the table test. |
| `src/app/[firm]/(app)/notifications/requests/page.tsx`, `src/app/admin/notifications/requests/page.tsx` | New. The Requests inbox pages. |
| `src/components/app/notifications/requests-inbox.tsx` | Replaces `src/components/app/notifications-inbox.tsx`. The password-reset requests, with skeleton, empty and error states. |
| `docs/07-ROUTES-AND-RBAC.md` | The two Requests routes in the route map. |
| `src/components/app/notifications/notifications-shell.tsx`, `src/app/[firm]/(app)/notifications/layout.tsx`, `src/app/admin/notifications/layout.tsx` | Notifications' own sidebar of inboxes (the `notifications` section), like Settings' sections; the inbox opens beside it. |
| `src/components/app/notifications/notification-card.tsx` | One notification with approve / deny / fresh link; errors shown on the card. |
| `src/components/app/notifications/reset-link-panel.tsx` | The link with its creation and expiry time; says when it has expired. |
| `src/lib/hooks/use-notifications.ts` | New. The list (refetched every minute while visible), mark read, decide, reissue; no query from a support view. |
| `src/lib/query/keys.ts`, `src/lib/query/keys.test.ts` | `notifications.mine(firmId)` and `platform.notifications()`, replacing the unscoped `["notifications", "inbox"]`. |
| `src/components/layout/notifications-menu.tsx`, `src/components/layout/topbar.tsx` | The bell lists requests awaiting the person's decision and opens the Requests inbox; the admin shell gets the bell too (requests only). |
| `src/components/layout/sidebar.tsx` | The pending count on Notifications, through the hook. |
| `src/app/[firm]/(app)/notifications/page.tsx`, `src/app/admin/notifications/page.tsx` | Empty until an inbox is picked. |
| `src/app/reset-password/page.tsx` | The missing-link message matches the expired one. |
| `backend/auth/password_reset.py`, `backend/api/routes_auth.py` | One message for any bad link: "This link has expired. Contact your manager or firm owner for a new one." The token has no minimum length, so a cut-short link gets that message, not a validation error. |
| `backend/tests/test_password_reset.py` | The link lives 30 minutes, then is refused with that message and its token removed; unknown and cut-short links get the same answer. |

The once-a-minute refetch is one request a minute per open tab, far under the per-user limit (uzair.md §1).

## Third commit: Abdul's review (2026-11-02)

| Finding | Fix | File(s) |
|---|---|---|
| A one-use link could be spent twice | Both locks in `/complete` re-read their rows (`populate_existing()`, as in `backend/applications/tracking.py`); so does the lock in `expire_due_for_user` | `backend/api/routes_auth.py`, `backend/auth/password_reset.py` |
| Two decisions at once both passed the PENDING check; a reissue could hit a finished request | `decide_request` and the reissue route re-read the requester and the request under their locks | `backend/auth/password_reset.py`, `backend/api/routes_notifications.py` |
| Completion didn't end sessions | `/complete` calls `end_all_sessions` (Q54) | `backend/api/routes_auth.py` |
| Sign-in checked the old password before the lock | The lock re-reads the user, and the hash must still be the one just verified | `backend/api/routes_auth.py` |
| Decisions weren't in the ledger | Request (`CREATE`, SYSTEM), approval or denial (`STATE_CHANGE`, the approver), expiry and completion (`STATE_CHANGE`, SYSTEM), fresh link (`UPDATE`, the approver), all `password_reset_request` in the requester's firm, existing actions only (no change to `ledger_entries`); `docs/02` §3.1 lists them | `backend/auth/password_reset.py`, `backend/api/routes_notifications.py`, `docs/02-DATA-CONTRACTS.md` |
| The polled list locked every requester, N+1, unordered | Only requesters with an open request are locked, in one query, in id order; nothing is locked or committed otherwise | `backend/api/routes_notifications.py` |
| A missing reset URL only failed at approval | Startup refuses to run in production without an `https://` `PASSWORD_RESET_BASE_URL` | `backend/auth/password_reset.py`, `backend/main.py` |
| Unused duplicate adapter and hook | Deleted | `src/lib/api/password-reset.ts`, `src/lib/hooks/use-password-reset.ts` |
| The reset pages called the adapter | Mutation hooks | `src/lib/hooks/use-password-recovery.ts` (new), `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx` |
| The badges hardcoded `text-[9px]` and `text-white` | One `CountBadge` on theme tokens (`text-mono-sm`, `--color-primary-fg`) for the sidebar and the bell | `src/components/ui/count-badge.tsx` (new), `src/components/layout/sidebar.tsx`, `src/components/layout/notifications-menu.tsx` |

`backend/tests/test_password_reset_races.py` (new) makes each race deterministic: a wrapper commits the competing
change from a second session between the route's read and its lock. Its 8 tests all fail on the code before this
commit (the second use of a link succeeds; an approval after a denial, and a fresh link after completion, return 200;
sign-in on a replaced password returns 200; a session survives completion) and pass after it.

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

- Removing Design system from the sidebar is a separate branch, `feat/remove-design-system-nav`.
- The local dev database of whoever ran the old branch has the old 0009/0010; it needs a data-safe fix before it
  runs this code (not part of this PR).
- Anyone who knows an account's email can freeze it until the approver denies or the request expires (Q54 accepts
  this trade-off; rate limits and the 24-hour expiry bound it).
