# Samad — Inbox, then Applications, then the Extension

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md) (your tables:
`candidate_mailboxes`, `inbox_messages`, `applications`, `interviews`, `favorite_jobs`), `docs/integration/README.md`
"The workflow for one module", `CONTRIBUTING.md`.

**Starts after** the candidate core PR (0007) is merged. One branch and one PR per numbered step below, from `main`.

## PR raise rules

Agreed with Samad on 2026-11-01 for separating the existing combined Inbox/Applications work:

1. **Check the latest `main` before every PR.** Fetch `origin/main`, start each PR branch from it, and merge or
   rebase any newer `main` changes into the branch before publication. Resolve conflicts and run the required checks
   against that updated branch.
2. **One concern per PR, raised step by step.** Each PR targets `main`. Wait for the preceding dependency to be
   approved and merged, then prepare the next branch from the updated `main`; do not stack PRs on open branches.
3. **Split the existing work in this order:**
   - PR 1: Applications foundation — statuses, status history, BDE review records, and migration `0009` — merged in PR #100.
   - PR 2: Candidate Inbox connection — Gmail OAuth, mailbox connection/sync and minimum retained-account identity protection; migration `0010` follows merged `0009`.
   - PR 3: Email classification — application matching, confidence rules, automatic status updates and BDE review
     routing, and its next available migration.
   - Original PR 4: account provenance and deduplication are moved into PR 2 (user confirmed 2026-11-01). Do not raise a duplicate history PR; later hardening is a separate concern only if needed.
   - PR 5: Remaining UI improvements — recruiter reply cards, exact-email navigation, and display changes.
   Main owns résumé `0008` and Applications `0009` (PR #100). PR 2 claims `0010`. Claim later migration numbers
   individually after checking the latest Alembic head on `main`; do not reserve numbers from the old combined branch.
   Include dependencies needed for each PR to work independently and explain any necessary scope adjustment.
4. **Include a Markdown change document in every PR.** Use `docs/team/pr-changes/<branch-name>.md` (replace `/`
   in the branch name with `-`). List every added, modified, deleted, or renamed file, explain what changed in each
   file and why, and record the PR's scope, dependencies, migration impact, validation results, and remaining limits.
5. **Preserve existing work while splitting.** Keep the combined implementation and local UI changes available;
   move only the relevant changes into each PR. Each PR includes its own relevant tests and documentation, with no
   dependency on changes left only in a later branch.
6. **Follow the repository merge gates.** Fill in the PR template, include at most one migration with a real
   downgrade, pass the required CI checks, and obtain Abdul's code-owner approval where required. Merge using a
   merge commit. Supersede PR #95 with links to the replacement PRs when the replacement sequence is established.

## 1. Inbox — each candidate's own Gmail, linked to their applications (D8)

The candidate page already has an Inbox tab and an "Inbox" preview on its Overview, on mocks
(`src/mocks/inbox.ts`, `src/lib/schemas/inbox.ts`: `InboxMessage`, `MailboxConnection`). The backend today watches
**one** Gmail account for the whole app (`backend/email_monitor/`, `POST /api/email/check-now`).

### 1.0 Connection and retention design — user confirmed, PR 2 (2026-11-02)

- The candidate owns the mailbox. An authorized OWNER/MANAGER/BDE starts Google-hosted consent from that
  candidate’s Inbox, using existing `candidate.edit` plus the shared candidate scope. VIEWER and support views
  may read stored mail but cannot connect, sync, disconnect or mark it read. No new role checks are introduced.
- Request `openid email` and Gmail read-only. Google verifies the selected account address; the UI shows that
  address rather than guessing it from the candidate profile. Complete consent in the browser running the
  initiating BenchQ session; callbacks require that session. BenchQ never accepts a Google password. State is
  random, stored hashed, single-use and bound to the initiating user/firm/candidate; the PKCE verifier and refresh
  token are encrypted with a Fernet key held outside the database. Recheck current authorization around exchange.
- Initial import is **3 days** (the former 90-day proposal is superseded). Retain message text, headers, provider
  IDs and the source address, skip attachments, cap stored bodies at 100,000 characters. Incremental history sync
  defaults to 5 minutes; 0 disables polling. Expired history checkpoints rebuild the deduplicated recent window.
- Disconnect removes credentials/checkpoints and stops sync, retaining imported messages. Replacing an active
  address requires disconnect first. Reconnect generations and row locks prevent stale sync/error callbacks from
  changing a newer connection. A PostgreSQL advisory lock prevents duplicate pollers in the current single-process
  deployment; production worker topology remains Uzair’s track.
- **Minimum account-history protection is included now:** `source_address` records the verified address at import.
  Deduplicate by `(mailbox_id, source_address, provider_message_id)`. Before changing an account, attribute blank
  legacy sources to the existing address. Existing database rows are backfilled from their current mailbox; unknown
  historical replacement must be investigated before rollout rather than inventing original provenance.
- Imports are unclassified and do not match new application links or change application statuses in this PR.
  Matching/classification/BDE routing and the agreed confidence policy belong to PR 3. A null signal renders as
  Unclassified in all existing consumers; retained mail remains readable after disconnect.
- Every human mutation is attributed to its actor/candidate in the ledger. Initial/background imports use SYSTEM
  attribution when records are added; no email body, subject, credential or provider diagnostic is logged.
- Ship behind the existing `inbox` live-module adapter flag. The connect flow navigates to Google; mock mode keeps
  synthetic fixtures without a fake consent screen. Sync/read/disconnect errors are visible and read failures roll
  back optimistic state with explicit retry. Google Cloud client/redirect and encryption key must be configured
  through local/deployment secrets before live connection testing. Verification uses synthetic providers only.
- One new migration, `0010` after `0009`, contains OAuth and minimum provenance. Downgrade refuses to discard
  active OAuth attempts, live credentials or retained provenance that cannot be reconstructed. No merged migration
  or existing development data is rewritten. Required code-owner review remains pending before merge.

Connection implementation: `backend/api/routes_inbox.py`, `backend/inbox/`, the Inbox adapter/DTO/hooks and current
connect/reader components. [Per-file changes and evidence](./pr-changes/codex-candidate-gmail-connection.md).

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
