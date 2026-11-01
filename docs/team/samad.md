# Samad — Inbox, then Applications, then the Extension

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md) (your tables:
`candidate_mailboxes`, `inbox_messages`, `applications`, `interviews`, `favorite_jobs`), `docs/integration/README.md`
"The workflow for one module", `CONTRIBUTING.md`.

**Starts after** the candidate core PR (0007) is merged. One branch and one PR per numbered step below, from `main`.

## 1. Inbox — each candidate's own Gmail, linked to their applications (D8)

The candidate page already has an Inbox tab and an "Inbox" preview on its Overview, on mocks
(`src/mocks/inbox.ts`, `src/lib/schemas/inbox.ts`: `InboxMessage`, `MailboxConnection`). The backend today watches
**one** Gmail account for the whole app (`backend/email_monitor/`, `POST /api/email/check-now`).

### 1.0 D8 design — user-confirmed decisions (2026-10-31)

**Goal:** replace the simulated Inbox connection and messages with one Gmail mailbox per candidate. The BDE starts
OAuth from that candidate's page; the candidate (or someone authorized to access that account) signs in on Google's
page and grants read-only consent. Store messages against that candidate, match them to applications when evidence is
sufficient, and leave email classification/status changes for Module 3. No email sends, deletes, or provider-side
read changes are in scope.

**Proposed design:**

1. **User confirmed 2026-10-31:** the mailbox belongs to the candidate, not the BDE. A BDE starts connection from
   that candidate's Inbox. Google hosts authentication and read-only consent for the candidate's account; BenchQ
   never asks for or accepts a Google password. The candidate's messages are displayed on that candidate's Inbox.
   Every action is checked against the caller's existing candidate scope; VIEWER and support-view principals cannot
   connect, disconnect, sync, or mark messages read.
2. Store the refresh credential encrypted with authenticated encryption. The encryption key comes from deployment
   configuration/secret storage, never from Postgres, source control, API responses, or logs. Add only the required
   encrypted-token and Gmail incremental-sync checkpoint fields to Samad-owned `candidate_mailboxes` in an additive
   migration. Claim the next migration number in the team README and confirm Alembic head before changing schema.
3. **User updated 2026-10-31:** the initial sync imports the most recent 3 days, replacing the earlier 90-day window. Disconnect stops future sync and
   removes credentials while retaining already-imported messages. Run incremental sync per connected mailbox using
   Gmail history checkpoints.
   Enforce the existing unique (`mailbox_id`, `provider_message_id`) key for retries. Persist message metadata and the
   body required by the reader; `is_read` means read in BenchQ and must not modify Gmail. The initial lookback is 90
   days; disconnect keeps messages but removes credentials and stops future sync.
4. Match an email to an application by exact Gmail thread/application evidence first, then conservative deterministic
   company and job evidence. Keep `application_id` null when uncertain; do not force a match with an LLM in the first
   release. Module 2 stores and displays email only; it does not classify messages or change application statuses.
   Module 3 applies the user's agreed Decider confidence and BDE-review policy.
5. Keep the existing single-account `email_check` monitor separate. It currently reads the global
   `GMAIL_REFRESH_TOKEN` and can update application statuses automatically. Before the per-candidate flow is enabled,
   either scope that legacy monitor to legacy non-candidate rows or disable its status-writing path so it cannot race
   or overwrite candidate application history.

**Current code/schema findings:** `candidate_mailboxes` and `inbox_messages` already exist from migration 0007, but
there are no OAuth token or Gmail history-checkpoint fields and no per-candidate mailbox routes. All four frontend
adapter operations (`byCandidate`, `connect`, `disconnect`, `markRead`) still use `inboxMock`. The UI simulates consent
and sync progress. The database permits a null email body while the frontend expects a string, so the DTO must map
that boundary. The existing global monitor is not a safe replacement for a per-candidate sync: it uses one global
token and mutates application stages without a user confirmation.

**Remaining operational decisions before production use:**

- Select/record the periodic sync interval and deployment execution topology; keep the local single-process scheduler
  from starting duplicate mailbox pollers.
- Configure the Google Cloud OAuth client ID/secret and exact authorized callback URI in local/deployment secrets.

**Approval:** Abdul confirmed this connection flow and retention rule on 2026-10-31. Module 2 is authorized. OAuth/API
credentials must be configured through Google Cloud and local/deployment secrets before live connection testing. No
live Gmail account has been connected by this implementation work.

1. **Design is now in §1.0:** BDE initiates OAuth; candidate/account owner consents in Google's hosted flow; the
   candidate mailbox is read-only; import 3 days; disconnect removes credentials and stops sync but retains stored
   messages. No status classification or application changes happen in Module 2.
2. **Connect / disconnect / status:** routes under `/api/firms/{firm}/candidates/{id}/mailbox`; the token columns on
   `candidate_mailboxes` (your migration, claim its number in the team README §6). Policy: who may connect (a new
   action in `src/lib/auth/policy.ts` and `backend/auth/policy.py`, both, with the shared table regenerated).
3. **Sync into `inbox_messages`:** per mailbox, deduped by (`mailbox_id`, `provider_message_id`). Replace the
   single-account monitor; keep its parsing where it helps.
4. **Matching emails to applications:** set `inbox_messages.application_id` (by company, job title, thread). Unmatched
   stay null and show as such.
5. **Status suggestions:** an email that implies a stage (`InboxMessage.impliedStatus`) suggests it; a person accepts.
   Never change a status silently.
6. **Frontend live:** `src/lib/api/inbox.ts` behind `NEXT_PUBLIC_LIVE_MODULES=inbox`, a DTO mapper with a real sample,
   the module workflow's states (skeleton, empty, error). Every write logs to the ledger with `candidate_id`.

## 2. Applications (Track 03, `docs/integration/03-applications.md`)

1. **The 10 statuses (D3)** and status history: your migration on `applications` (SAVED … EXPIRED), mapping the old
   values; `status_transitions` → a proper history the frontend's `ApplicationEvent` reads.
2. **Routes:** list (by candidate, in scope: a MANAGER's team, a BDE's own), create (candidate + job + **tailored
   résumé** `resume_id`; one per candidate per job), move status, notes. `submitted_by_user_id` is the signed-in user.
3. **Follow-ups** (D5) as that doc says.
4. **Frontend live** behind `applications`: the board, the candidate's Applications tab, the dashboards' numbers
   (they are derived from applications: never store a count).

## 3. The Extension (capture + autofill)

Not in this repo yet (`backend/UPSTREAM.md`: JobNavigator's `extension/` was not copied).

1. **Proposal first**, signed off by the product owner: per-user access tokens (07 §2), what it captures, how it
   autofills from the candidate's info and answers, and applying from the candidate's **favorite jobs**
   (`favorite_jobs`).
2. **Favorite jobs:** routes to mark/unmark a job for a candidate (in the app and for the extension). The frontend's
   `JobMark` is per user today: its contract change (per candidate) goes in `docs/02` with Abdul's sign-off.
3. Then the extension itself.

## Rules for you

- Your tables: `applications`, `interviews`, `candidate_mailboxes`, `inbox_messages`, `favorite_jobs`. Need a column
  elsewhere (e.g. on `candidates`)? Ask the owner; for `candidates`, Abdul.
- Every candidate-owned row carries `candidate_id` and `firm_id`; read through `scoped()`; new routes go in
  `access.py` and `isolation_cases.py`.
