# PR 4 — DEBUG: problems and the selected solution for each

Revised 2026-11-06 (rounds 2–4; see the review record at the end). Companion to [PR_4_IMPLEMENTATION_PLAN.md](./PR_4_IMPLEMENTATION_PLAN.md) and
[PR_4_STATUS.md](./PR_4_STATUS.md). Alternatives considered: [PROBLEMS_AND_SOLUTIONS.md](./PROBLEMS_AND_SOLUTIONS.md).

Every solution below was re-checked against the code. Where the round-1 review (Samad's assistant) and my first
draft differed, the better rule was selected on its merits; the reasoning is in **Why this one**. **No code has been
changed.** Markers: **SIGN-OFF** = Abdul or a table owner must approve first; **CONFIRM** = Samad confirms.

> The plan and status files are synchronised with this revision (2026-11-06): one migration (D-11), spend logging and
> the endpoint decision in Phase 1 (D-15, D-16), a dedicated test mailbox (D-25), the counts endpoint (D-20) and an
> activation task after merge. Rule from the repository: new schema/permission/API details need canonical docs
> (samad.md §1.5); a column on another owner's table is added by that owner (docs/team/README.md §4); models and
> migrations need Abdul's code-owner approval (CONTRIBUTING.md).

| ID | Severity | Area | Plan task |
|---|---|---|---|
| D-01 | Blocker | Confidence check | T1.2 |
| D-02 | Blocker | Classifier configuration | T1.1 |
| D-03 | Blocker | Missing config / rejected key | T1.1 |
| D-04 | High | Text used for matching and AI | T1.3 |
| D-05 | Blocker | Frontend cannot show the ten statuses | T2.1 |
| D-06 | High | Revisions and repeated moves | T2.2 |
| D-07 | High | Matching eligibility after leaving Saved | T2.3 |
| D-08 | High | Dismiss links / fails | T3.2 |
| D-09 | Medium | Review list order and fields | T3.1 |
| D-10 | Medium | Stages a review may set | T3.3 |
| D-11 | Blocker | Email status writer (needs a migration) | T4.1 |
| D-12 | Blocker | Undo | T4.3 |
| D-13 | High | Pending review vs newer email | T4.2 |
| D-14 | Medium | Incomplete → Applied | T4.4 |
| D-15 | High | AI spend counting | T1.x (moved) |
| D-16 | Medium | Alpha endpoint decision | T1.x (moved) |
| D-17 | Low | Inbox badges, "Email: Email" | T5.1 |
| D-18 | Low | `crypto.randomUUID` on plain HTTP | T2.4 |
| D-19 | Low | Optimistic move shows a refused change | T3.5 |
| D-20 | Medium | List truncation and counters | T2.5 |
| D-21 | Low | Company aliases reloaded per email | T5.4 |
| D-22 | Low | Adapter error code | T2.5 |
| D-23 | Medium | Older mail classified, review only (decision updated 2026-11-06) | T7.3 |
| D-24 | Info | Reclassify repeat clicks | Deferred |
| D-25 | High | Live tests must not process personal mail | T1.4 |
| D-26 | Blocker | Gmail's own ARC seals made every sender UNKNOWN | T1.6 follow-up |
| D-27 | High | Setup-only failures stayed failed | T7.1 |
| D-28 | Medium | Inbox states the user can understand | T7.2 |
| D-29 | Medium | Older emails seemed missing (hidden as Other; 3-day first import) | T7.2 follow-up |

---

### D-01 — Confidence check · Blocker · T1.2
**Cause.** `backend/inbox/decider.py:62–65` requires `confidence == probabilities[choice]` (1e-6); the provider computes
them separately (live 0.9650 vs 0.9685) ⇒ every real reply fails `INVALID_CONFIDENCE`.
**Selected.**
1. Reject (failure) only structurally invalid replies — rules that exist today: choice in the ten, probabilities for
   all ten, each finite 0–1, choice is the maximum, sum within 0.02 of 1; confidence (if present) finite 0–1.
2. Store both numbers. Decision value = **`min(confidence, probability)`** (probability alone if confidence missing).
3. **Disagreement routes to review, never fails:** if `|confidence − probability| > 0.10`, reason
   `CONFIDENCE_DISAGREEMENT`, whatever the minimum is.
4. 0.10 is a routing parameter included in `config_identity`, tuned later with labelled data.
**Why this one.** My first draft wrongly said a large gap sends the email to review: `min(0.99, 0.81) = 0.81` still
passes 0.8. The explicit disagreement rule fixes that. A wrong 0.10 only produces extra reviews, never lost mail,
which is why it is acceptable without data (the round-1 objection to an arbitrary *rejection* threshold no longer applies).
**Verify.** Equal; small gap (accept, min used); gap > 0.10 (review); missing confidence; NaN/bool/out-of-range (reject).

### D-02 — Classifier falls back to the primary provider · Blocker · T1.1
**Cause.** `ai_config("email_classification")` reads `candidate_email_llm_*`, else the primary `llm_*` (`claude_api`);
the decider accepts only `openrouter` ⇒ later `CLASSIFIER_NOT_CONFIGURED`.
**Selected.** No fallback for this module: empty module settings ⇒ "not configured". OPERATIONS.md setup checklist
(names, provider `openrouter`, Decider model, key location). Matches OPERATIONS.md (OpenRouter only).
**Verify.** Primary set, module empty ⇒ not configured, no provider call.

### D-03 — Missing config and rejected key · Blocker · T1.1
**Cause.** `process_one` claims and counts an attempt before checking config; `CLASSIFIER_NOT_CONFIGURED` and 401/403
are permanent ⇒ live 85/85 `ERROR`. The scheduler runs `process_pending` every minute (`backend/scheduler.py:95`) and
`wake_worker` runs it on its own thread, so two sweeps can run at the same time even in one process.
**Selected.**
- **Missing config:** checked before any claim; mail stays `PENDING`, attempts unchanged, one log line per sweep.
- **Rejected key (401/403) — configuration-scoped pause:**
  - One `job_runs` row, `job_type='candidate_email_classifier_pause'`, id = UUIDv5 of a SHA-256 over (provider, model,
    key) — never the key. Concurrent inserts of the same id ⇒ one row (conflict = already paused).
  - Meta: `reason`, `paused_at`, `next_probe_at`, `probe_lease_until`, `probe_failures`.
  - **Checked by every dispatch path:** scheduled sweep, `wake_worker`, `process_one` (before claim and again right
    before the provider call), retry/reclassify endpoints (409 "Classifier paused: credentials rejected").
  - **In-flight worker** receiving 401/403: releases its email to `PENDING` without counting the attempt (existing
    `WORK_INVALIDATED` release), then creates or finds the pause.
  - **Atomic probe lease:** `SELECT … FOR UPDATE SKIP LOCKED` on the pause row; only if `next_probe_at <= now` and no
    live lease, set `probe_lease_until = now + 2 min`, commit, then send exactly one email. Others skip.
  - **Probe results:** 2xx valid ⇒ clear pause. 2xx malformed ⇒ key works, clear pause; that email follows the normal
    invalid-response rule. 401/403 ⇒ `next_probe_at = now + 1 h`. 429 / 5xx / timeout ⇒ inconclusive: keep pause,
    `next_probe_at = now + 15 min`; email back to `PENDING`, attempt not counted. A crashed probe's lease expires.
  - **Recovery:** config hash changes (new key/model) ⇒ pause ignored at once; documented admin clear.
  - **Retention:** a cleared pause is marked `completed` with `cleared_at`, kept for audit, pruned with other job runs.
**Verify.** Two concurrent sweeps ⇒ one probe; each probe outcome; key change resumes; endpoints return 409 while paused.
### D-04 — Text used for matching and for the AI · High · T1.3
**Cause.** `application_matching._current_body` cuts at any line starting `From:` or `Regards,`; the same text goes to
matching and the AI. A forward can become empty.
**Selected — separate rules:**
- **Replies** (`On … wrote:`, `-----Original Message-----`, Gmail quote block, `>` lines): *current* = text above the
  first reply header. Quoted history is **never** used for matching or sent to the AI. Replies are identified through
  the existing **thread link** (`matching_application_id(..., allow_thread=...)`).
- **Forwards** (`---------- Forwarded message ---------`, `Begin forwarded message:`, subject `Fwd:`): always **review**,
  reason `FORWARDED_EMAIL`, never automatic, **never hidden as Other**. The forwarded part may be used for *identity*
  (which application) and is sent to the AI labelled as forwarded history, so the review is pre-filled.
- **Sign-off:** remove only a trailing block (sign-off line followed by ≤ 8 short lines). Never cut at a mid-body `From:`.
- **Too little current text** (< 20 characters, non-forward): review, reason `INSUFFICIENT_CONTENT`. No fallback.
- **Precedence over Other hiding (round 3):** the worker today decides confident Other before `review_reason`
  (`classification_worker.py:169–184`). New order: `FORWARDED_EMAIL`, `INSUFFICIENT_CONTENT` and
  `CONFIDENCE_DISAGREEMENT` (D-01) are evaluated **first**; any of them ⇒ review, the email is not hidden. Only an
  Other result with none of them is hidden.
**Verify.** Regression tests: forwarded Other, short Other, disagreeing Other ⇒ review and visible; plain confident
Other ⇒ hidden as today; forwarded mail with `From:` keeps content. **CONFIRM** (Samad decision 5).
### D-05 — Frontend cannot show the ten statuses · Blocker · T2.1 · **SIGN-OFF (Abdul, docs/02 §2.1)**
**Selected.** Frontend `ApplicationStatus` = the ten target values exactly as docs/02 §2.1; a separate read-only legacy
group (labelled, never selectable, never hidden); every list, column, progress, label, icon and tone from
`status-meta.ts`; unknown value ⇒ "Unknown (legacy)" + review, never Applied. (Unchanged from round 1.)

### D-06 — Revisions and repeated moves · High · T2.2 · **SIGN-OFF (schema field)** · **CONFIRM (structure)**
**Selected.**
- **Field:** `statusRevision` on `ApplicationSchema` (docs/02 first); the hidden map in `dto/applications.ts` is removed.
- **One move per application — synchronous lock:** a module-level `Set` of `firmId:applicationId` in
  `src/lib/hooks/use-applications.ts`. The move function checks and adds the key **before** calling `mutate` and
  releases it in a `finally`-style handler that runs on success, error, cancellation and unmount (no exit path keeps
  it). A second move is **refused** with "Saving… wait for the current move". JavaScript runs one task at a time in a
  tab, so check-and-add cannot interleave; all screens share the module. Other tabs are protected by the server's
  revision check (409). No `scope` queue.
- **Optimistic display without writing the cache:** the mutation has key `["move", firmId, applicationId]`; screens
  read the in-flight move through `useMutationState` and show `pending.status ?? application.status`, labelled
  **"Saving…"** until the server confirms. The query cache only ever holds server data, so there is nothing to roll
  back and a refetch cannot be overwritten or overwrite a pending change.
- **Revision sent:** read from the cache when the request is sent (server-confirmed only).
- **Success:** write the server's application into list and detail caches, refetch counts (D-20). **Failure:** the
  overlay disappears (server status shows again) with a message; 409 = "changed elsewhere, reloaded".
- **Structure cost:** board, list, drawer and detail read status through one small helper hook instead of the raw row.
**Verify.** Double move refused then allowed; lock released after error and after leaving the page; "Saving…" shown;
refetch during a move does not flicker the pending status; 409 path.
### D-07 — Matching eligibility after leaving Saved · High · T2.3
**Cause.** Matching requires `status != 'saved' AND applied_at` or a submitter (`application_matching.py:76`), **and the
worker repeats its own guard** (`classification_worker.py:164`: no `applied_at` and no submitter ⇒ no match). Only
Saved → Applied sets them (`tracking.py:93`). Callers of the eligibility rule: the worker, `application_matching.py`
(thread links and name match) and `routes_inbox.py` (review route and dropdown).
**Selected.** One rule in one place:
- `is_match_eligible(app)` and the matching query filter live in `application_matching.py`: eligible if
  `status != 'saved'` (any status, including Incomplete) **or** `submitted_by_user_id` is set.
- All three callers use them; the duplicate guard at `classification_worker.py:164` is **deleted**, not edited.
- Submission evidence unchanged: no move other than the existing Saved → Applied writes `applied_at` or the submitter.
**Why this one.** Keeps `applied_at` meaning and freshness intact; Incomplete can match its completion email; one
definition cannot drift again.
**Verify.** Every status through each caller; back to Saved ⇒ ineligible unless a submitter is recorded.
**CONFIRM** (Samad decision 3, revised).
### D-08 — Dismiss links the email / fails on an unrelated revision · High · T3.2
**Selected.** For `DISMISS_NON_APPLICATION` ignore application fields, never link, check only review and content
revisions (`routes_inbox.py:658–673`). Relinking a wrongly linked email is not added (open question).

### D-09 — Review list order and fields · Medium · T3.1
**Selected.** Order `created_at DESC, id DESC`; cursor on both; return `subject`, `from_name`, `received_at`,
`total_count` (support view keeps count only). docs/02 entry.

### D-10 — Stages a review may set · Medium · T3.3 · **CONFIRM**
**Selected.** Nine non-Saved stages or keep current; Incomplete offered when the email is classified incomplete or the
application is already Incomplete; same list enforced in backend and panel. Saved stays a board action.

### D-11 — Email status writer · Blocker · T4.1 · **needs the PR's one migration (Abdul code-owner approval)**
**Cause of correction.** `email_classifications.outcome` allows only `REVIEW`, `OTHER`, `NO_CHANGE`
(`backend/models/db.py:419`); writing `AUTO_APPLIED` would roll back the transaction.
**Selected.**
- **Migration (the PR's single additive revision):** add `AUTO_APPLIED` to `ck_email_outcome`; update the model's
  `CheckConstraint`. Downgrade refuses while `AUTO_APPLIED` rows exist (rollback means deciding those rows first).
- **Writer** `apply_email_decision(db, app, message, classification)` in `tracking.py`, inside the worker's result
  transaction after the classification row:
  1. Classification and review logic run **exactly as in PR 3** whatever the automation switch; specific reasons are
     kept; `AUTO_STATUS_DISABLED` only when every check passed and automation is off.
  2. The writer acts only when the reason would be `AUTO_STATUS_DISABLED` **and** `automation_ready` passes **and**
     stored application/content revisions are current **and** this email was never applied or undone here.
  3. The status event, the application update and the automatic ledger entry (`record_automated`,
     `backend/auth/ledger.py:41`) are written **together in one savepoint** (`db.begin_nested()`); outcome
     `AUTO_APPLIED`, no review.
  4. Otherwise the review is created as today.
- **Replay cases (round 3–4):**

  | Case | Behaviour |
  |---|---|
  | Same command repeated | Look up the event by `(application_id, command_id)` first (command id = UUIDv5 of application + email; the DB enforces `uq_application_status_event_command`); found ⇒ return the existing outcome, write nothing. Concurrent insert ⇒ the savepoint rolls back only itself (status, event and ledger together), the writer re-reads and returns the existing outcome; unrelated work in the transaction is kept. Same pattern for `uq_email_result_version`. |
  | Reclassified after an automatic change | Never re-applied. New classification row. Same category ⇒ `NO_CHANGE`, no review. Different category ⇒ review `EMAIL_ALREADY_APPLIED`. |
  | Reclassified after Undo | Never re-applied. Category suggests a change ⇒ review `AUTOMATIC_CHANGE_UNDONE`; otherwise `NO_CHANGE`. |
- `application_status_events.source` has no constraint, so `email_classifier`/`email_undo` need no change.
**Verify.** Automation off ⇒ classification + review with the specific reason, no event; each gate failing ⇒ review;
all pass ⇒ one event + ledger + `AUTO_APPLIED`; each replay case; forced concurrent insert keeps other work.
### D-12 — Undo · Blocker · T4.3
**Selected.** `POST /api/applications/{id}/status-events/{event_id}/undo` (`expected_revision`, `command_id`); only the
latest `email_classifier` event can be undone; compensating `email_undo` event to `from_status` with `undo_event_id`,
`email_id`; ledger entry; idempotent; old status outside the ten ⇒ 409. `access.py` + `isolation_cases.py`. Frontend
Undo with conflict/denied/unavailable states. Undone email never re-applied (D-11 step 2).

### D-13 — Pending review must not block a newer eligible email · High · T4.2
**Selected.** The writer does not check pending reviews (docs rule). Older review resolved after a newer automatic
change ⇒ 409 (revision), panel reloads and the BDE decides on current state. Older email never overwrites a newer
decision (freshness). Manual board moves keep "confirm the pending review first".

### D-14 — Incomplete → Applied · Medium · T4.4 · **SIGN-OFF (Abdul)**
**Selected.** Category `applied`, application `incomplete_application`, all other gates pass ⇒ automatic Applied with
Undo. Works with D-07 (Incomplete is match-eligible). Left out if not signed off (those emails go to review).

### D-15 — AI spend counting · High · moved to Phase 1
**Cause.** Classification usage is only in `job_runs.meta`. Spend (`GET /api/stats/llm-costs`, `backend/main.py`) sums
`llm_call_log.cost_usd` by purpose/model. `log_llm_call` reads `input_tokens`/`output_tokens` (the classifier has
`prompt_tokens`/`completion_tokens`/`cost`) and `calc_cost` returns 0.0 for an unpriced model (`llm_cost.py:134–137`).
Each job run starts with a top-level `cost_quality='UNKNOWN'` and gets real usage later under `meta.usage`
(`classification_worker.py:92, 123`); discarded claims also get usage (lines 137, 147). `llm_call_log.job_id` is a
foreign key to `jobs.id` (a job posting), **not** a worker attempt — it is not used here.
**Selected.**
- **Dispatch marker:** `meta.dispatch_started = true` is committed **before** the HTTP call. It means "dispatch started;
  charge unknown" — not proof the provider received it. Claims released before this point are never counted.
- **Token mapping:** `prompt_tokens → input_tokens`, `completion_tokens → output_tokens`.
- **Cost source:** provider `cost` (ACTUAL) → OpenRouter price × tokens (ESTIMATED) → UNKNOWN.
- **Logger:** `log_llm_call` gains optional `cost_usd` and `db` arguments (additive; owner informed). With `db` it only
  adds the row to the caller's session — it **never commits, closes or rolls back** the caller's transaction.
- **Exactly-once:** in the worker's result transaction, under the existing row lock and claim-token check, the job run
  is read and must not already be finalized (`status` still `running`); then the result, the job run's final state and
  (for ACTUAL/ESTIMATED) one `llm_call_log` row are written together; the job run stores that row's id. A crash before
  commit writes nothing; a retry is a new claim with a new real call, correctly a new row.
- **Counting (one place per call, no overlap):**
  - priced call ⇒ its `llm_call_log` row (`purpose='email_classification'`, provider `openrouter`, firm id);
  - unpriced call ⇒ job run with `dispatch_started = true` and `meta.usage.cost_quality = 'UNKNOWN'`, reported as
    `unpriced_calls` by `GET /api/stats/llm-costs`;
  - dispatch started but no result (crash) ⇒ reported as `unconfirmed_calls`;
  - the top-level `cost_quality` marker is ignored.
- First step: one isolated test call to learn whether Decisions returns `usage.cost` and whether the model is priced.
**Why this one.** True totals with no change to another owner's table. A per-row quality column is possible through the
owner (README §4) if Abdul prefers; not required for correctness.
**Verify.** Recorded amount and tokens for ACTUAL and ESTIMATED; UNKNOWN ⇒ no row, in `unpriced_calls`; discarded claim
⇒ not counted; finalize twice ⇒ one row; caller transaction untouched by the logger.
### D-16 — Alpha endpoint decision · Medium · moved to Phase 1
**Selected.** Keep the Decisions endpoint (its per-category probabilities are what the policy needs; the shared chat
client does not return them). Mitigations: strict structural checks (D-01), bounded single attempt + worker retries,
spend logging (D-15), pause on rejected key (D-03). Written as a switch-on condition in OPERATIONS.md **before** any
live call; Abdul accepts or asks for the shared client.

### D-17 — Inbox badges and "Email: Email" · Low · T5.1
One map of ten categories → label + icon + tone, plus Not classified / Processing / Failed; fix the empty-label fallback
in `activity-tab.tsx` and `attention-card.tsx`; `signal` in the inbox DTO from the latest classification; labels for
the new review reasons (D-01, D-04).

### D-18 — `crypto.randomUUID()` on plain HTTP · Low · T2.4
`newCommandId()` in `src/lib/utils.ts`: `crypto.randomUUID` if present, else v4 from `crypto.getRandomValues`.

### D-19 — Optimistic move shows a refused change · Low · T3.5
Block known-invalid moves before any change (disabled control with reason: pending review, support view, no
permission, move in flight — D-06); clear message on rollback.

### D-20 — List truncation and counters · Medium · T2.5
**Selected.**
- **Counts endpoint:** `GET /api/applications/counts?candidate_id=` → counts per status.
- **Paged columns:** the board loads each column with the existing `status` filter, `limit=50`, "Load more".
- **One scope:** counts and lists share one scoping function (firm, role/visible candidates, candidate, status).
- **Stable order:** `updated_at DESC, id DESC`, cursor on both.
- **After a move:** refetch counts and both affected columns.
- Every counter on screen comes from the counts endpoint, never from a partial list. docs/02 entry first.
**Note.** The existing `GET /api/stats` status breakdown is firm-wide and ignores role scope; it is not reused for this.
**As built (2026-11-06) — deviation recorded.** Paged board columns were not built: every dashboard, funnel and counter
derives its numbers from the full application list, so paging only the columns would make those numbers partial. The
adapter instead reads every page (500 per request, de-duplicated by id), and the counts endpoint exists for the headers.
Column paging becomes its own change when list sizes require it.

### D-21 — Company aliases reloaded per email · Low · T5.4
Load aliases only for companies of this candidate's match-eligible applications, once per sweep; identical-results test.

### D-22 — Adapter error code · Low · T2.5
Code `UNSUPPORTED_STATUS`, message "BenchQ can't move an application to <status> yet." (03-applications.md).

### D-23 — Older mail never classified · **Now in PR 4** (decision updated 2026-11-06) · T7.3
**Change.** Samad confirmed with Abdul that older emails are classified too (supersedes the PR 111 "later PR" note).
**Selected.**
- Switch `CANDIDATE_EMAIL_HISTORICAL_ENABLED` (default off). When on, each sweep queues up to 20 retained `NOT_QUEUED`
  emails of **connected** mailboxes (current source address, not deleted or hidden), oldest first.
- Each queued email gets one `job_runs` row with a fixed id (UUIDv5 of the message) of type
  `candidate_email_historical`: it is the audit record, it makes queueing exactly-once, and it marks the email as
  historical. A historical email never triggers an automatic status write; it can only create a BDE review.
- Everything else is the normal pipeline: classification, matching, spend, tenancy, the freshness rule and review
  de-duplication. Confirmed statuses are never changed by historical processing.
- Before the first live run, the eligible count and scope are reported and Samad approves.

### D-27 — Emails that failed only because the classifier was not set up · T7.1
**Cause.** Before T1.1, a missing configuration put mail into `ERROR` (`CLASSIFIER_NOT_CONFIGURED`); a refused key
could do the same (`PROVIDER_AUTH_REJECTED`). After setup they stayed failed (live: 25 + 94).
**Selected.**
- Switch `CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED` (default off). When on and the classifier is configured and not paused,
  each sweep returns up to 20 such emails of **connected** mailboxes to `PENDING` (attempts reset).
- Exactly once per email: a `job_runs` row with a fixed id (type `candidate_email_setup_recovery`) is inserted first; an
  email that already has one is never recovered again (no loop, no duplicate audit). One ledger summary per candidate
  and sweep.
- If it fails again, it stays `ERROR` with the new reason and the manual Retry (existing rules) is offered.
- Disconnected mailboxes are never touched (their 94 personal emails stay unprocessed).
- Before the first live run, the eligible count is reported and Samad approves.

### D-28 — Inbox states the user can understand · T7.2
"Not classified" covered every failure. **Selected:** five states from the email's state and error code —
"Received before classification was on" (`NOT_QUEUED`), "Classifying…" (`PENDING`/`PROCESSING`), "Waiting for classifier
setup" (`ERROR` with a setup code), "Classification failed" (`ERROR`, other code, with a readable reason and a Retry
button for roles with `email.retry`), and the category once classified.

### D-24 — Reclassify repeat clicks · Deferred
Approved Owner/Manager action; visible in spend (D-15). Cooldown only if spend shows a problem.

### D-25 — Live tests must not process personal mail · High · T1.4
**Cause.** With classification enabled the worker processes every newly imported email of every connected mailbox; a
personal Gmail is connected to the test candidate Rajesh.
**Selected.** A **dedicated test Gmail account** connected to a dedicated synthetic test candidate; only Samad-authored
test emails go to it. Before any live call: disconnect the personal mailbox (or keep classification switched off on
that backend). D-15 logging and the D-16 condition are in place first. No retry of the 85 personal emails.
**Why this one.** Isolation without test-only code (a mailbox allowlist would add code used only for testing).
**Operational note (no code):** the local backend still has classification switched on with no configuration; switch
it off until the test mailbox exists.

### D-26 — Gmail's own ARC seals made every sender `UNKNOWN` · Blocker · found in T1.6
**Cause.** `delivery_evidence.sender_authentication` returned `UNKNOWN` whenever any `ARC-*` header existed. Gmail adds
its own ARC set to ordinary incoming mail (`ARC-Authentication-Results: i=1; mx.google.com; arc=none` and `i=2;
mx.google.com; …`). Live: all 8 T1.6 emails had dkim/spf/dmarc=pass in Gmail's Authentication-Results yet were
`UNKNOWN`, so no Gmail-delivered email could ever qualify for automation.
**Selected.** ARC headers are acceptable only when **every** `ARC-Authentication-Results` is Gmail's own
(`i=<n>; mx.google.com;`). An ARC result from any other server (a forwarder) keeps the verdict `UNKNOWN`, as before.
All other rules (single mx.google.com Authentication-Results after a Google Received, exact-domain alignment) unchanged.
**Why this one.** Keeps the documented intent ("no ambiguous ARC") — Gmail's own seal is not ambiguous — while making
the approved sender requirement satisfiable. **Verify.** New provider tests (Gmail ARC ⇒ verdict kept; foreign hop ⇒
UNKNOWN; the old `arc` case still UNKNOWN). Live re-evaluation of the 8 T1.6 emails: 8 × `PASS`.

### D-29 — "Older emails are not showing" · found 2026-11-06
**Cause (checked live).** Manoj has 37 imported emails: 27 are hidden because they were classified Other with 0.96–0.998
(newsletters, LinkedIn notifications and job alerts, a Google security alert, promotions — none about a submitted
application), including every email older than today; 10 job emails remain visible. Separately, the first import only
fetches the last 3 days (`gmail_sync.py`, `newer_than:3d`, PR 2 design), so older mail was never imported.
**Selected.** Keep hiding non-job mail (Samad). Make it visible that it happened: the inbox response adds a count-only
`hidden_count` (no content) and the Inbox says how many emails were hidden, that they are kept encrypted for 30 days and
never deleted from Gmail, and that the first import covered the last 3 days. Widening the first-import window is a PR 2
product decision: **Samad decided 2026-11-06 to keep 3 days.**
**Verify.** Backend test: count matches, hidden content never in the response. Browser: the note shows "27 emails…".

---

## Round-2 review record

| # | Round-1 review said | Selected |
|---|---|---|
| 1 | Migration for `AUTO_APPLIED` | Agree (D-11) |
| 2 | Totals must separate known/estimated/unknown | Same goal, different means: no row for unknown + `unpriced_calls`, no migration on another owner's table (D-15) |
| 3 | Separate reply/forward rules; uncertain forwards ⇒ review | Agree, plus forwarded content allowed for identity so the review is pre-filled; replies rely on thread links (D-04) |
| 4 | Read revision at execution; safe rollback for queued moves | Simpler: one move in flight per application, no queue (D-06) |
| 5 | Dedicated test mailbox or processing restriction | Dedicated mailbox (D-25) |
| 6 | Keep specific review reasons | Agree; already how `policy.review_reason` works (D-11) |
| 7 | Pause lifecycle for all dispatch paths | Agree; fixed probe schedule (D-03) |
| 8 | Don't change `applied_at`; Incomplete must match | Agree; eligibility = status not Saved, or submitter (D-07) |
| 9 | Same scope, stable order, refetch on move | Agree (D-20) |
| 10 | Min does not imply review; decide on disagreement | Agree; disagreement > 0.10 ⇒ review (D-01) |

## Round-3 review record

| Finding | Verdict | Selected |
|---|---|---|
| Worker guard `classification_worker.py:164` | Correct | One `is_match_eligible`; delete the duplicate guard (D-07) |
| Other hiding bypasses new reasons | Correct | Forwarded / insufficient / disagreement evaluated before hiding; forwards never hidden (D-04) |
| Probe not unique across workers | Correct (two sweeps can already overlap) | Locked probe lease + outcome table (D-03) |
| Unknown calls double-counted | Correct | `dispatch_started` marker; one counting place per call (D-15) |
| Disabled button is not a guard | Correct | Central lock (refined in round 4) (D-06) |
| Replay wording ambiguous | Correct | Three replay cases defined (D-11) |
| Plan/tracker outdated | Correct | Synchronised; activation task added |

## Round-4 review record

| Finding | Verdict | Selected |
|---|---|---|
| `isMutating()` is not an atomic lock | Correct | Synchronous per-application `Set` lock before `mutate`; refuse, don't queue (D-06) |
| Status-only rollback insufficient | Correct problem | Better: optimistic overlay from mutation variables; cache holds server data only, no rollback (D-06) |
| Dispatch marker before the call; dedupe priced rows | Correct | Marker = "dispatch started; charge unknown"; cost row in the result transaction (D-15) |
| Same transaction ≠ exactly once | Correct | Check job run not finalized under the row lock before inserting (D-15) |
| Duplicate replay must not roll back unrelated work | Correct | Lookup first, savepoint around status + event + ledger, return existing (D-11) |
| Release lock on every exit; "Saving…" label | Correct | Added (D-06) |
| Logger with a caller session must not commit | Correct | Added (D-15) |
| `llm_call_log.job_id` meaning | Correct: FK to `jobs.id` | Not used for attempts (D-15) |
