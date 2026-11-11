# Samad — Inbox, then Applications, then the Extension

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md),
`docs/integration/README.md`, `CLAUDE.md` and `CONTRIBUTING.md`.

**Current authority:** [Abdul’s written decisions on issue #110, 2026-11-04](https://github.com/AbdulMuqtadir916/BenchQ/issues/110#issuecomment-6624344616).
These decisions supersede the earlier five-PR split, blanket human-acceptance rule, 0.6 automatic-update threshold,
immediate Other-content removal and manual sender-approval proposals. This file is the reviewer’s current module
plan. Historical proposals in local working documents are not approval to implement conflicting behavior.

> **Update 2026-11-11 (Zuhair):** the `applications.job_id` → `job_postings` repoint, first given to you on 2026-11-10,
> is now **Arbaz's** (§2 item 5 points to it). `applications` stays your table: Arbaz confirms his change with you.

## PR raise rules

1. **Check the latest main before every PR.** Fetch origin/main, start each branch from updated main and integrate
   subsequent main changes before publication. Preserve the combined local code and running development data.
2. **One branch per PR, targeting main; no stacked PRs.** Wait for each dependency to merge before preparing the
   next PR from refreshed main. Merge only with the required review and Samad’s explicit merge instruction.
3. **Approved split:**
   - PR 1 — Applications foundation: statuses, immutable history and BDE-review records (completed).
   - PR 2 — Candidate Gmail connection and encrypted Inbox/import foundation (merged as #104).
   - **PR 3 — Email matching, classification and review backend; no application-status writes.** See §1.2.
   - **PR 4 — Automatic status updates, compensating Undo and existing UI integration.** See §1.3.
   The old separate mailbox-history/UI PRs are superseded by this split; preserve #104’s merged protections.
   Do not reuse historical migration numbers. Recheck main’s Alembic head before claiming a revision.
4. **Include a per-file Markdown change document in every PR.** Use
   `docs/team/pr-changes/<branch-name>.md`, replacing `/` with `-`. List added/modified/deleted/renamed files,
   explain purpose, scope, dependencies, migration impact, checks and remaining limits.
5. **Reuse and adapt existing code.** Move only relevant changes from the combined local implementation; preserve
   merged main’s encryption, OAuth, background import and permissions. Reuse existing tables/commands instead of
   introducing parallel application, review, history, job or ledger structures. New schema/API changes still need
   review in the canonical data/policy documents. Leases, usage accounting and evaluation work must remain lean.
6. **Complete repository checks and review gates.** Fill in the PR template; include at most one additive migration
   per PR with a real, safe downgrade; pass required checks; obtain code-owner approval. Use merge commits.
   Keep #95 as draft; supersede it with replacement links when the replacement sequence is established.

## 1. Inbox — approved remaining workflow (D8)

### 1.0 Existing foundation to preserve

PR #104 provides per-candidate read-only Gmail OAuth, confirmation, encrypted retained body/snippet, background
import, current-source provenance/deduplication and retained-content deletion controls. Initial import uses the
recent three-day window; subsequent imports use the established incremental-sync mechanism.

- Access follows the existing firm/candidate permission policy. BDE access follows current candidate assignment;
  reassignment preserves the candidate’s retained applications/emails and removes the previous BDE’s access.
- One active candidate connection per Gmail **within a firm**. The same Gmail may be connected in other firms.
  Never disclose another firm’s mailbox use. Disconnect/revocation retries must preserve another live shared grant.
- Keep `is_read` local to BenchQ. Do not send, delete or mark messages read in Gmail. Reads/manual-sync requests
  do not create business-ledger entries; a separate access log is a future proposal.
- Preserve #104’s content encryption/key rotation and source-account isolation on reconnect/replacement. The legacy
  global monitor remains limited to non-candidate applications and must not bypass candidate status commands.
- Existing application résumé associations (`applications.resume_id`) and Notes remain intact. No new résumé
  functionality is included in PR 3 or PR 4.

### 1.1 Approved processing, visibility and retention

- **No prefilter in V1:** every imported email goes to the configured classifier when processing is authorized and
  enabled. There is no manual sender allowlist/approval click in V1. A future prefilter is explicitly tracked in §1.6.
- Decrypt body/snippet transiently in backend memory for matching/classification; redact/minimize before external
  calls. Never persist a decrypted duplicate or log raw email content, prompts, credentials or provider diagnostics.
  Key failure is a processing error, never a reason to send ciphertext or erase mail.
- Keep classifications versioned. Automatically discover eligible retained unclassified mail only for the current
  connected source; leave disconnected/replaced-source history unchanged. Model/prompt changes do not silently
  reclassify old results; explicit authorized reruns append evidence without replaying past status decisions.
- **Pending or failed classification stays readable** under current firm/candidate access, like unclassified mail
  in #104, with a **Not classified** badge. Failure never hides or erases mail. Preserve disabled-mode readability.
- Below-0.8 classification, including uncertain Other, stays readable for review; do not treat it as a confident Other disposition.
- **Other is not a selectable application status.** It never changes application status. Hide matched Other from
  Inbox instead of deleting it on classification; keep it encrypted. Hidden Other mail is retained encrypted for
  **30 days**, then becomes eligible for purge only when the purge gate below is passed and purge is enabled.
  Keep the approved minimal scoped exclusion marker afterward to prevent reimport; Gmail originals are untouched.
- **Purge remains OFF** until evaluation demonstrates zero job-related would-remove decisions. Never interpret
  the superseded 0.6 status threshold as permission for immediate deletion. Respect explicit deletion controls and
  minimal history/dedup requirements; content cleanup must cover derivatives, not just the visible message body.
- Owner/Manager quarantine inspection/release UI is **deferred to V2**. Do not build that workflow as a PR 3 blocker
  or use its absence to hide failed/pending mail contrary to the readable V1 behavior above.

### 1.2 PR 3 — matching, classification and review backend

**PR 3 makes no application-status writes.** Its job is to supply classified evidence and review records while
preserving #104’s import/readability/tenancy behavior.

1. Integrate the existing AI classifier with committed background-import batches. Reuse main’s import/decryption
   helpers; do not bring back the combined local code’s obsolete OAuth/router/import implementation.
2. Match submitted applications by a unique valid existing Gmail thread link first, then a unique complete
   company/title match. Scope by firm, candidate and source mailbox; exclude never-submitted Saved drafts and
   retain ambiguous/unmatched mail for BDE review. Matching does not authorize a status write.
3. Persist versioned category, confidence, model/prompt identity, source email and match/application-revision
   evidence. Reuse/adapt local classification code and existing reviews; unmatched review must not create a fake
   application. Preserve historical results and human decisions.
4. **Sender authentication:** automatic-update eligibility for PR 4 requires trusted Gmail Authentication-Results
   evidence showing **DMARC pass, or SPF and DKIM pass aligned with the From domain**. Anything else goes to
   review. Store the normalized pass/fail result with the classification, **not the raw header**. Unknown evidence
   never qualifies. Validate the trusted Gmail header boundary rather than trusting arbitrary message text.
5. Prepare review reasons, Other visibility/retention and safe retry/failure information. Preserve the existing
   BDE review column’s exact-email navigation contract. Since PR 3 does not automate changes, job-related results
   remain available for explicit human review/confirmation until PR 4 is ready.
6. Keep duplicate handling, disconnect/deletion/content-revision checks and bounded retry work safe. Worker leases
   and attempt cost tracking are acceptable, but avoid making a larger infrastructure redesign/new-table exercise
   a blocker for this lean slice. Record actual implementation limits honestly.
7. Include affected regression tests, labelled evaluation evidence, a safe additive migration if needed and the
   per-file change report. A **smaller labelled set is acceptable to start**; the earlier 1,000-message plan is not
   a hard PR 3 startup gate. Zero job-related would-remove decisions is mandatory before purge can be switched on.

### 1.3 PR 4 — automatic updates, Undo and UI

1. Use one shared status-command path, preserving revisions, source evidence, immutable history, submission facts
   and résumé association. Manual decisions record actor/time and take precedence over older email decisions.
2. The approved initial automatic forward-move targets are **Screening call, Shortlisted, Interview schedule
   request, Interview scheduled and Assessment**, at **confidence >=0.8**. Everything below 0.8 goes to review.
   **Offer and Move On always require BDE review**, regardless of confidence. Do not carry the superseded >=0.6
   proposal or automatic Offer/Move On policy into code. Other never changes status.
3. Unique matching, trustworthy sender authentication and freshness are independent requirements; high model
   confidence does not override them. Backward/stale/ambiguous decisions and repeated interview rounds go to review.
   Display order alone must not invent automatic-transition permission. Special Applied/Incomplete/legacy mapping
   behavior requires the final vocabulary/transition sign-off referenced in §1.4.
4. A pending review does not automatically prevent a newer independently eligible email from advancing the
   application. Preserve human work and recheck revisions when an older review is resolved; no silent overwrite.
5. Automatic changes have an automatic ledger label and exact source-email link. **Undo appends a compensating
   event**, preserves the original history and suppresses reapplication from the same email. Recheck current state
   so Undo cannot overwrite a later decision silently.
6. Connect the existing application board/BDE review column and Inbox review actions to the backend. Keep last
   confirmed application status visible; review cards open the exact email. Add recruiter-email evidence/navigation,
   progress filling and conditional Incomplete display while preserving Notes and avoiding full Inbox resets.
7. Keep automation OFF until PR 4 is **merged and Undo is verified usable**. Run affected backend/frontend, build,
   isolation and UI checks before publication; maintain the per-file change document.

### 1.4 Documentation required before implementation / UI sign-off

Abdul authorized proceeding with PR 3 **once the required documentation is updated**. Updating this file alone does
not complete all prerequisites:

- This file’s PR raise rules and §1 now record the approved split and decisions above.
- Write the final application-status list and explicit frontend/backend/legacy mappings into
  `docs/02-DATA-CONTRACTS.md`. Backend currently accepts `other`, while frontend still uses older D3 vocabulary;
  remove Other from new selectable statuses without destroying legacy reads or historical replay.
- Resolve/close D3 in `docs/integration/06-open-decisions.md` against that final mapping. Do not invent a new Response
  stage or silently convert legacy values based on display order.
- Abdul will sign off the vocabulary/mapping in the canonical documentation before PR 4 UI work. This approval
  comment does not itself settle every legacy mapping or new field/endpoint definition.

### 1.5 Safety gates and review evidence

- **External real-mail AI OFF** until provider/downstream retention and logging are confirmed in writing, consent
  is updated and the agreed Google/delegated-access requirements are satisfied. Every-email classification does not
  bypass this gate, and redaction is not proof of anonymity.
- **Status automation OFF** until PR 4 and usable Undo are merged and verified.
- **Other purge OFF** until evaluation passes the zero job-related would-remove requirement. Keep hidden content
  encrypted for the approved 30-day recovery period rather than immediately erasing it.
- Reuse existing tables/commands rather than adding parallel structures. New schema/permission/API details still
  require review and canonical documentation; no provisional migration number or proposed column is approved merely
  because it appeared in an earlier local draft.
- Use lawful labelled data, preferably synthetic/authored first. A smaller initial corpus is acceptable; record
  provenance, category/matching accuracy, calibration and removal mistakes. Test decryption, privacy/visibility,
  duplicates, retries, source changes, scope, manual/automatic races and Undo. Never claim a disabled purge switch
  alone proves a zero-error removal policy; evaluate shadow would-remove decisions.

### 1.6 Next phase — prefilter and deferred review workflow

Explicit future work, as requested by Abdul: add a relevance prefilter so non-job mail need not reach external AI.
Candidate signals include **known ATS/job-board sender domains, company domains from the candidate’s submitted
applications and job-related keywords**. Design for unfamiliar recruiters, ambiguous wording and false negatives;
no prefilter is implemented/enabled in V1 under this approval.

Also deferred: Owner/Manager private inspection/release workflow, a possible local classifier and a separately
proposed access log. These are future scope, not hidden dependencies for PR 3.

## 2. Applications (Track 03, `docs/integration/03-applications.md`)

1. **The 10 statuses (D3)** and status history: your migration on `applications` (SAVED … EXPIRED), mapping the old
   values; `status_transitions` → a proper history the frontend's `ApplicationEvent` reads.
2. **Routes:** list (by candidate, in scope: a MANAGER's team, a BDE's own), create (candidate + job + **tailored
   résumé** `resume_id`; one per candidate per job), move status, notes. `submitted_by_user_id` is the signed-in user.
3. **Follow-ups** (D5) as that doc says.
4. **Frontend live** behind `applications`: the board, the candidate's Applications tab, the dashboards' numbers
   (they are derived from applications: never store a count).

5. **Moved to Arbaz (decided 2026-11-11 by Zuhair):** repointing `applications.job_id` from the old `jobs` pool onto
   `job_postings` is Arbaz's PR, not yours: [arbaz.md](./arbaz.md), "Repoint `applications.job_id` onto
   `job_postings`". `applications` stays your table; that PR changes it, so Arbaz confirms the change with you first. **Still
   yours:** `favorite_jobs` also points at the old `jobs` pool: repoint it onto `job_postings` or retire it in favour of
   a Saved application, your call.

## 3. The Extension (capture + autofill)

Not in this repo yet (`backend/UPSTREAM.md`: JobNavigator's `extension/` was not copied).

1. **Proposal first**, signed off by the product owner: per-user access tokens (07 §2), what it captures, how it
   autofills from the candidate's info and answers, and applying from the candidate's **favorite jobs**
   (`favorite_jobs`).
2. **Favorite jobs:** routes to mark/unmark a job for a candidate (in the app and for the extension). The frontend's
   `JobMark` is per user today: its contract change (per candidate) goes in `docs/02` with Abdul's sign-off.
3. Then the extension itself.
4. **Autofill reads the candidate, not the shared persona** (decided 2026-11-05, Abdul): fixed answers from
   `candidates` and the candidate's résumé, drafted answers from the résumé version's `autofill` (migration 0019,
   `GET …/resumes/{id}?autofill=true`; `candidates.qa_bank` is gone); the extension names the candidate.
   Field-by-field mapping and the two open points (an H1B transfer and sponsorship; self-ID defaults):
   [persona-to-candidates.md](./persona-to-candidates.md) §4–§5 (a suggestion; the facts are §1–§2).

## Rules for you

- Your tables: `applications`, `interviews`, `candidate_mailboxes`, `inbox_messages`, `favorite_jobs`. Need a column
  elsewhere (e.g. on `candidates`)? Ask the owner; for `candidates`, Abdul.
- Every candidate-owned row carries `candidate_id` and `firm_id`; read through `scoped()`; new routes go in
  `access.py` and `isolation_cases.py`.


### PR 104 review follow-up (2026-11-02)

See docs/02-DATA-CONTRACTS.md, PR 104 review corrections, and the per-file PR change report. Working plans/checklists are kept locally, outside the PR.
The final written decision is firm-local one-active-candidate mailbox ownership, ERROR reservation until disconnect, current-BDE
candidate access with retained data on reassignment, both deletion choices, restricted support metadata and the
background import audit policy. The latest correction below supersedes earlier read/manual-sync choices.
No new database columns/tables are added by this follow-up. Durable consent lives in the existing ledger.

Abdul's later replies, supplied in chat, approve automatic updates in principle with the agreed transition
allowlist; enablement stays OFF until PR 4 merges and Undo is usable. External classification for real mail stays
OFF until provider retention/logging are verified in writing and consent is updated. These replace the earlier
unresolved automatic-versus-human acceptance wording; PR 104 itself performs neither classification nor updates.
After #104 merges, submit the revised contracts/plan, then PR 3 classification, then PR 4 remaining UI. No stacks.
The global legacy monitor remains for non-candidate applications only; preserve its candidate-status guards.
Candidate Google access defaults OFF until PR 3 readiness, named Google verification ownership, privacy and approval.

### PR 104 latest review corrections (2026-11-03)

Restore Q52 unchanged: current assignment does not expose every Owner/Manager/SYSTEM ledger event. Store batch
progress atomically in existing JobRun metadata and append one terminal/recovery result; never update the ledger.
Use per-account lifecycle locks and concurrent unknown-account exchange coordination with bounded waiting.
Refresh newest mail while retaining cached older pages; cap automatic reload restoration at three pages and
keep selected body loading independent. Expired confirmation action is Return to Inbox, then a separate Connect.
Support health/counts-only visibility was approved in Abdul’s GitHub review. Abdul’s written 2026-11-03 decision, accepted by Samad, permits the same Gmail across firms and blocks duplicate active candidates only within a firm. The latest correction below removes read/manual-sync request auditing; cursor pagination and exact remaining contracts still require code-owner sign-off before merge.

### Latest Samad clarification and accepted audit/retry decisions (2026-11-03)

Adopt Abdul’s written decision dated 2026-11-03: one active candidate per Gmail within each firm; the same
Gmail is allowed across firms simultaneously. Return only an in-firm candidate conflict; never announce another
firm’s use. Disconnect/retry protects any remaining shared grant. This supersedes earlier global-rule proposals.
Accept Abdul’s 2026-11-03 removal of read/manual-sync request business-ledger entries; keep is_read and propose
separate access logging later. Retain encrypted failed/busy revocations in expired existing OAuth cleanup attempts
for scheduled retry, protecting any still-live shared grant. No new table or migration. Existing business events
(import result, connection, confirmation, deletion) remain audited.

Main integration: merged main ff923c3 (#106 résumé versions); preserved both fixture families and moved only unmerged Gmail migration/tests to 0012 after 0011. New integration checks pending.
