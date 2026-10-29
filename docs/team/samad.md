# Samad — Inbox, then Applications, then the Extension

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md) (your tables:
`candidate_mailboxes`, `inbox_messages`, `applications`, `interviews`, `favorite_jobs`), `docs/integration/README.md`
"The workflow for one module", `CONTRIBUTING.md`.

**Starts after** the candidate core PR (0007) is merged. One branch and one PR per numbered step below, from `main`.

## 1. Inbox — each candidate's own Gmail, linked to their applications (D8)

The candidate page already has an Inbox tab and an "Inbox" preview on its Overview, on mocks
(`src/mocks/inbox.ts`, `src/lib/schemas/inbox.ts`: `InboxMessage`, `MailboxConnection`). The backend today watches
**one** Gmail account for the whole app (`backend/email_monitor/`, `POST /api/email/check-now`).

1. **Design note first (no code), agreed with Abdul:** Google OAuth for a candidate's mailbox (scopes: read-only),
   where the refresh token is stored (encrypted at rest; the key from the environment, never in the database or the
   repo), how a sync runs (scheduler job per connected mailbox, incremental by history id), what a disconnect does,
   and the security of a BDE connecting someone else's account. Write it into this file as §1.0.
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
