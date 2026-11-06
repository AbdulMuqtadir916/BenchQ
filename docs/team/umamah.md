# Mohammed Abdul Ahad Umamah — password recovery and Notifications inbox

Read first: [team README](./README.md), [FLOWS.md](./FLOWS.md), [00-candidate-core.md](./00-candidate-core.md),
`docs/07-ROUTES-AND-RBAC.md`, `docs/02-DATA-CONTRACTS.md`, and `docs/integration/README.md`.

**Assignment:** replace self-service password reset with an approval-based recovery flow and build an extensible
Notifications inbox. One branch and one PR from `main`; keep existing user data and coordinate schema ownership,
contract changes and the migration number with Abdul.

## Status

**Activity logs (from 2026-11-05):** the ledger plan, agreed with Abdul, runs as one branch per PR named `activity/…`.
PR 1 (`activity/pr1-role-access-on-server`): each role reads only its own part of the ledger on the server (07 Q56).
Change document: [pr-changes/activity-pr1-role-access-on-server.md](./pr-changes/activity-pr1-role-access-on-server.md).
Next: PR 2, the ledger rules as tests.

Updated 2026-11-02. Branch `feat/password-reset-notifications` (from `feat/password-reset-approval`), PR #105 to
`main` (open, awaiting Abdul's review; backend suite 3705 passed). Change document: [pr-changes/feat-password-reset-notifications.md](./pr-changes/feat-password-reset-notifications.md).

**Done:**

- §1–§3 built: the `notifications` and `password_reset_requests` models and migration; routing, freeze and session
  revocation (`backend/auth/password_reset.py`); the public request/complete routes and the notification
  list/read/decision/link routes, classified in `backend/auth/access.py` and `backend/tests/isolation_cases.py`;
  `notification.approve` and `platform.notification.approve` in both policy tables; cancellation from
  `backend/scripts/reset_password.py`; `/forgot-password`, `/reset-password`, the firm and Super Admin Notifications
  pages and the sidebar entry; backend tests; Q54 in `docs/07`, the contract in `docs/02` §3.1.
- Merged the latest `main` (2026-11-02). The migration is now `0010` (`0009` went to Applications), claimed in the
  team README §6.
- Kept out of the PR, still on disk: `0010_reconcile_resume_versioning.py` (moved to `backups/local-migrations/`;
  local database only), the reset-demo preview setup (`docker-compose.reset-demo.yml`, `distDir` in
  `next.config.ts`, the `.next-reset-demo` lines in `tsconfig.json` and `.gitignore`) and `.gitattributes`.

**Added to PR #105 (2026-11-02), tasks 1 and 3:**

1. Notifications has its own sidebar of inboxes inside the page, like Settings' sections; only **Requests** for now
   (`/[firm]/notifications/requests`, `/admin/notifications/requests`, registry section `notifications`). The main
   sidebar keeps just Notifications. Nothing opens until an inbox is clicked. The count awaiting approval shows on
   Notifications in the main sidebar and on Requests inside.
2. The reset link: confirmed it expires exactly 30 minutes after it is created (checked in the database) and its token
   is wiped when it is next used, refused with the same message. The approver sees "This link expires 30 minutes after
   it was created: created at …, expires at …"; once that passes, the panel says it has expired. An expired, used,
   unknown or cut-short link says "This link has expired. Contact your manager or firm owner for a new one."
3. A request waiting for the approver shows in their **bell** (firm users and the Super Admin) and opens the Requests
   inbox; opening it marks it read. The inbox refetches once a minute while the tab is visible.
4. The sidebar's notifications query is a hook (`src/lib/hooks/use-notifications.ts`) with firm-scoped keys.

Checked 2026-11-02 on a fresh reset-demo stack (`localhost:3001`, database built 0001→0010 from this branch): Adnan
(BDE) asks for a reset, Fatima (his manager) sees it in the bell, opens Requests, approves, sees the expiry time; the
link, expired, gives the new message. Then Sneha's request: Notifications, then Requests in its own sidebar, and the bell
opening Requests. Light and dark, desktop and phone width.

**Abdul's review of PR #105 (2026-11-02), 10 findings, all fixed on this branch:** the four races (a link spent
twice, concurrent decisions, sign-in during a reset, a reissue on a finished request), sessions ended on completion,
the ledger trail (request, decision, expiry, fresh link), the polled list's locks, the production startup check, the
duplicate adapter, the reset pages on hooks, and one token-based count badge. New concurrency tests
(`backend/tests/test_password_reset_races.py`). Details: the change document, "Third commit".

**Task 2, its own branch:** `feat/remove-design-system-nav`, from this branch: **Design system** out of the sidebar
(the `/dev/design-system` page itself stays). The change is ready; branch and PR when the lead decides (no stacked PRs:
`CONTRIBUTING.md`).

**Still to do:** bring the local dev database in line with
`main` (it ran the old local 0009/0010, not Samad's 0009) without losing data.

**Known local issue:** `src/mocks/db.test.ts` (fixture fingerprint) fails on this Windows checkout only, because Git
checks the fixture JSON out with CRLF. CI (Linux) is unaffected; `.gitattributes` would fix it for Windows.

**Activity logs PR 2 (2026-11-05):** `activity/pr2-ledger-rules-as-tests`. CI now fails a route that changes data and
writes no ledger entry (unless listed in `NOT_LOGGED` with a reason), a ledger write without `candidate_id`, and a ledger
read outside the role-limited routes. No behaviour change. Change document:
[pr-changes/activity-pr2-ledger-rules-as-tests.md](./pr-changes/activity-pr2-ledger-rules-as-tests.md).

**Activity log PR 3 (2026-11-06):** `activity-log/pr3-new-table-and-endpoints`, built on PR 1 and PR 2, not pushed yet.
The new `activity_logs` table with the old rows copied in, history that stays with the manager and BDE at the time, and
the reads the screen needs. Change document:
[pr-changes/activity-log-pr3-new-table-and-endpoints.md](./pr-changes/activity-log-pr3-new-table-and-endpoints.md).

## 1. Notifications inbox

The main sidebar's **Preferences** section gets a **Notifications** page for firm users and the Super Admin.
Password-reset approval is the first notification type; the notification record has a type and an entity reference so
later modules can add notification types without changing the password-reset request shape.

1. A notification is addressed to one firm user or one platform user. Firm notifications carry `firm_id`; the
   recipient is always the signed-in account. The UI never trusts client-supplied recipient ids.
2. The API lists the signed-in recipient's notifications, supports read state, and renders the current status of
   linked approval requests. A notification's generic data contains no password-reset token or URL.
3. The frontend route is registered in `src/lib/routes/registry.ts`; the backend routes are classified in
   `backend/auth/access.py`. Role actions stay in the shared TypeScript/Python policy tables.
4. Firm notifications are scoped to one firm and recipient. A Super Admin sees only platform notifications unless
   an explicit future notification type says otherwise; a support view never approves requests.

## 2. Password-reset approval flow

Super Admin is the highest role and does not submit a forgot-password request. The flow is for active firm accounts
(OWNER, MANAGER, BDE; VIEWER follows the owner path until Abdul decides otherwise).

| Requester | One designated approver |
|---|---|
| BDE with an active assigned manager in the same firm | That manager only |
| BDE with no assigned manager | The active OWNER of that same firm |
| BDE whose assigned manager is inactive or no longer a MANAGER in that firm | The active OWNER of that same firm |
| MANAGER | The active OWNER of that same firm |
| OWNER | The active BenchQ Super Admin account(s) |
| VIEWER (proposed default) | The active OWNER of that same firm |
| Super Admin | Does not request a reset; may approve an Owner's request |

1. `/forgot-password` normalizes the submitted email and always displays the same response. Unknown addresses,
   inactive accounts and Super Admin accounts create no request and do not freeze an account.
2. For an eligible active firm account with an available approver, one pending request is created. The old password
   is frozen immediately, and every existing session is revoked. Repeated submissions do not extend the request's
   expiry or create more notifications.
3. A pending request is delivered only to its exact approver in the Notifications inbox. It is never redirected to
   another manager or to an owner in a different firm. An inactive approver causes the request to expire; if an
   assigned BDE manager is already inactive when routing begins, the request goes to that BDE's own firm owner.
4. The designated approver may approve or deny. Approval generates a random one-time link tied to the requester;
   only the approving user sees it in the response/UI and can copy it. BenchQ does not email the reset link and never
   logs it. The approver shares it manually with the requester.
5. The reset link is kept in the URL fragment, expires after 30 minutes, and is stored server-side only as a hash.
   The approval request expires after 24 hours. The approver may generate a replacement link before the request
   expires; each new link invalidates the previous one.
6. Completing the reset replaces the password, consumes the link, expires the request, revokes all sessions and
   invalidates any other reset links. The requester must sign in again.

## 3. Edge cases and security rules

- **Frozen account:** the sign-in path checks pending/approved-unexpired requests while holding the account row
  lock. A sign-in racing the request either completes first and is revoked by the request transaction, or sees the
  request and fails with the same generic credential error.
- **Denial or expiry:** denial immediately unfreezes the unchanged old password. A pending request expires after
  24 hours; sign-in and inbox requests also settle expired state so an account is not left frozen indefinitely.
- **Lost/expired link:** while the approval request is still live, only the designated approver can issue a new link;
  the prior hash is replaced. After the request expires, a new request and approval are required.
- **Approver deactivation or changed relationship:** a manager who becomes inactive after receiving a request does
  not pass it to another manager or owner; the request expires. A manager already inactive at initial BDE routing
  results in the same-firm owner receiving it. A changed manager/owner relationship invalidates the stale request.
- **No eligible approver available:** do not route across firms and do not freeze the account without an approver.
  Return the same generic response; the requester may retry after their firm has an active Owner or BenchQ has an
  active Super Admin.
- **Concurrent actions:** a locked request row permits only one decision. A second approver sees it as resolved and
  cannot obtain a link. Only one live reset request per account and one active token per request.
- **Repeated requests and abuse:** rate-limit by IP and a keyed/hashed normalized email; don't refresh the pending
  request's lifetime. The immediate account freeze can be abused to temporarily lock another account using its email;
  document this trade-off and preserve an audited denial/expiry path.
- **Password checks:** use the existing minimum length and Argon2id hashing, require matching confirmation, reject a
  new password equal to the old one, and keep the stored password unchanged until completion.
- **No account or tenant leaks:** generic public response; every inbox read/action checks recipient identity,
  current role, relationship and firm. Unknown or cross-firm ids are indistinguishable from missing requests.
- **No SMTP dependency:** reset links are transferred manually by the approver. No reset-link SMTP variables or
  development log fallback are used.

## 4. Implementation order

1. Pull `origin/main`, start a fresh task branch from it, inspect the schema history and protect the existing local
   database. The old branch's `0008` is password-reset tokens; current `main` uses `0008` for résumé versioning.
2. Agree the notification/request contract and ownership with Abdul; claim the next migration in the team README.
3. Add the generic notification and password-reset request models/migration; route and lock rules; session revocation;
   scoped notification/decision APIs; cancellation from the existing staff password-recovery command.
4. Add the public forgot/reset pages, the firm Notifications page under Preferences, and the Super Admin inbox.
   Show/copy the reset URL only after the designated approver accepts.
5. Test every routing, freeze/unfreeze, concurrency, expiry, cross-firm and authorization case; run migration checks,
   frontend typecheck/lint/tests and the backend suite. Update route/data/auth docs.

## Rules

- Do not modify `users`, `firms`, `sessions` or `ledger_entries` schema without Abdul's approval; use the module's
  own request/notification tables and existing session/ledger helpers.
- Every new route goes in the route registry or `backend/auth/access.py`; cover public routes and firm isolation in
  tests. No inline role checks where the shared policy table applies.
- Keep the old branch and both stashes until the PR is merged. Do not upgrade the existing local database until its
  conflicting revision `0008` has a verified, data-preserving reconciliation path.
