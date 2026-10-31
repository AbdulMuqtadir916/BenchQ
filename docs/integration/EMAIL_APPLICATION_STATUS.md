# Applications and Inbox integration status

Updated: 2026-10-31
Plan: [EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md](./EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md)
Earlier Saved/Applied implementation: [STATUS.md](./STATUS.md).

## Present state

Modules 1–2 implementation and provider-mocked checks are present. Module 3 has the Decider adapter, worker, persistence and linked-message auto-update/review paths. The Inbox has a “Needs BDE review” filter for pending linked reviews and actionable unmatched classifications. Unmatched messages classified as `OTHER` or with no classification stay visible in All but are excluded from application review. A BDE can link an actionable unmatched email to a candidate application and explicitly confirm a status; no application changes from the unmatched classification alone. The live model adapter was verified with one real message, but that direct call did not persist a classification or change an application. At the last read-only check, Adna had 73 messages in `ERROR`, all unlinked; they require retry and cannot update application status until linked.

Migrations 0008–0010 are applied to the local development DB. The user authorized one combined change set and merge after all three modules. Required code-owner review still applies. This tracker now splits Module 3 into implementation subtasks and separates automated evidence from live end-to-end acceptance.

Current next step: user verification of the Inbox queue, then safely retry one relevant message, link it to an application, and verify persisted classification and status behavior. Obtain Abdul/code-owner review before merge.

Indicators: **Not Started**, **[/] In Progress**, **Completed**, **[!] Blocked**, **[-] Deferred**.

## Planning work

- Completed — Inspect Applications frontend adapters, backend routes, status contract and existing Saved/Applied changes.
- Completed — Inspect candidate Inbox adapter/schema/UI and existing global email monitor.
- Completed — Read ownership, migration, contract and code-owner rules.
- Completed — Read Decider walkthrough and referenced category/adapter/worker/policy code.
- Completed — Read-only local PostgreSQL inspection: head 0007; saved=1, applied=1; application/mailbox/message columns inspected.
- Completed — Re-audit classifier worker, result/review schema, Inbox review route/UI against the user-confirmed no-match → BDE review rule.
- Completed — Verify one direct live Perplexity response after refreshing the backend's OpenRouter environment; no classification or status was persisted.
- Completed — Create module plan, proposed database changes, gates, acceptance criteria and tests.
- Completed — Identify unresolved decisions without presenting recommendations as approved requirements.

## Module 0 — Contract and migration baseline

Status: Completed

- Completed — Inventory status readers/writers and compatibility assumptions for Module 1.
- Completed — Record the 11-status contract, including `move_on` and legacy reads.
- Completed — Resolve Q1: Applications includes a BDE Review column; it displays the last confirmed status and is resolved through the Inbox dropdown. The application side panel shows current status only, with no history/timeline.
- Completed — Preserve legacy statuses and history without guessing mappings.
- Completed — Confirm manual all-status moves and Saved ↔ Applied reversal; classifier mapping is direct per category, with confidence, message freshness, and later human changes controlling automatic writes.
- Completed — Design shared status/review commands, revisions, idempotency and persistence.
- Completed — Verify baseline 0007, claim migration 0008 and apply it to local development DB.
- Completed — Record automated acceptance matrix and access scope.

## Module 1 — Complete Applications tracker

Status: [/] In Progress — implementation/checks and user manual acceptance complete; code-owner review pending.

- Completed — Apply additive migration 0008; preserve original JSON history and legacy states.
- Completed — Shared transactional status service, status events, ledger, revision/idempotency and review resolution API.
- Completed — Scope list/detail/status/review/bulk routes and secure candidate delete paths.
- Completed — Keep favorites/feed behavior and submission date/submitter semantics synchronized across statuses.
- Completed — Connect general Applications list/detail/update to the real API; production adapter has no app mock fallback.
- Completed — Candidate and general boards expose 11 canonical statuses plus retained legacy reads; active cards can move directly between any canonical status columns. The BDE Review queue preserves last confirmed status and blocks drag bypass. Detail side panel shows the current status and full status selector; the timeline uses the app's canonical statuses.
- Completed — Keep a read-only “Resume used” field for mock resume-version data and remove all resume selection/persistence from status moves. Frontend/backend status-move wiring no longer carries resume IDs.
- Completed — Persisted pending-review membership API and synthetic review confirmation test path.
- Completed — Guard legacy email monitor and scheduler from candidate status writes.
- Completed — Remove production Applications fixture/local-storage dependency; keep test fixtures and unrelated follow-ups mock isolated.
- Completed — Run full frontend/backend suites plus focused tracker regression checks (evidence below).
- Completed — User manually verified reverse move, heart/feed synchronization, and reload persistence.
- [/] In Progress — Required code-owner review remains.

## Module 2 — Candidate Gmail Inbox

Status: [/] In Progress — implementation and provider-mocked checks are complete. Live OAuth and account acceptance, deployment secret setup, and code-owner review remain.

- Completed — Confirm candidate-owned Gmail account; BDE initiates OAuth from that candidate's page; candidate or authorized person consents at Google; read-only scope.
- Completed — Confirm initial 3-day import and retain synced messages after disconnect while deleting credentials and stopping future sync.
- Completed — Record five-minute polling default with a PostgreSQL advisory lock; sync worker does not classify or change status.
- Completed — Add migration 0009 after 0008 for candidate mailbox/OAuth/sync fields and OAuth attempt storage.
- Completed — Implement candidate mailbox/OAuth/sync/message persistence.
- Completed — Implement candidate-scoped routes and permission/access/isolation registration.
- Completed — Implement real OAuth, encrypted refresh credentials, identity/reconnect/disconnect safeguards.
- Completed — Allow the verified Google mailbox address to differ from placeholder `candidates.email`; continue storing and displaying the actual Google address. OAuth state, PKCE, Google verification, candidate scope and read-only consent remain enforced.
- Completed — Implement 3-day initial sync, history pagination, deduplication, retry surface and checkpoint recovery.
- Completed — Conservative thread-based application matching; unmatched emails can be linked by the BDE from the Inbox.
- Completed — Connect Inbox adapter/DTO/hooks/UI and overview/activity consumers.
- Completed — Replace simulated consent/sync; production adapter has no mock fallback; mock remains for test fixtures.
- Completed — Legacy global monitor and auto-reject only act on legacy rows without candidate IDs.
- Completed — Run provider-mocked OAuth/sync/security/isolation tests.
- [/] In Progress — Complete separately recorded live OAuth acceptance and owner review.
- [/] In Progress — Retry Gmail OAuth with the non-matching verified Google address and confirm it connects and syncs under the intended candidate. The local backend was restarted to load the updated callback.

## Module 3 — Decider and automatic updates

Status: [/] In Progress — Decider, persistence, automatic-update and BDE review paths are implemented; final rollout and owner acceptance remain.

- Completed — Map each user-approved category to its matching application status; Saved remains separate. Do not assume a mandatory category sequence. Old emails and later BDE changes are protected by message/status timestamps.
- Completed — Integrate backend Perplexity Decider V1.2 adapter and the exact ten-category taxonomy including `move_on`.
- Completed — Redact contact data/credentials, bound input, validate provider responses, apply confidence fallback, and retry transient provider errors.
- Completed — Add classification-result/review migration and persistence; migration 0010 is applied locally and migration consistency checks pass.
- Completed — Add retryable worker state, provider retry limit, failure state/recovery action, restart lease recovery, and no regex fallback.
- Completed — Implement <0.6 review / >=0.6 eligible automatic-update threshold.
- Completed — Require a unique existing message-to-application association, reject stale/out-of-order emails and newer human edits, and write idempotent status/classification audit records.
- Partly completed — Inbox API can link an unmatched email to a candidate application and accept the BDE-selected status once the message is opened. However, `UNMATCHED` results are not currently surfaced as an automatic BDE review queue/filter; a no-match message does not create a pending ApplicationReview until the BDE links it.
- Completed — Provide independent mailbox sync/classifier operation gates through connected mailbox status and OpenRouter key configuration, plus bounded batch/attempt limits and scheduler summaries.
- Completed — Add/run Decider contract, threshold, worker, persistence, route-isolation and frontend adapter tests.
- [/] In Progress — Verify persisted classification and status effects through the real worker. A direct live provider call succeeded, but did not execute worker persistence or update an application. No linked email has yet proven the full automatic path.

### Module 3 — Deep implementation breakdown

Statuses describe current code/evidence as of 2026-10-31. No code was changed during this audit.

- **3.1 Provider configuration and worker readiness — [/] In Progress**
  - Completed — OpenRouter key is present in the backend and the backend was recreated so it loads the current configured key.
  - Completed — One live adapter request to Perplexity Decider V1.2 succeeded on a real inbox message, returning `other`, confidence 0.9941, and ten probabilities.
  - Not Started — Verify the same current key/version through a worker invocation and report safe operational errors without exposing provider secrets.
- **3.2 Gmail message queue/recovery — [/] In Progress**
  - Completed — Gmail sync persists candidate messages and the classifier has `PENDING`, `PROCESSING`, `DONE`, and `ERROR` states.
  - Completed — Per-message retry API returns an `ERROR` message to `PENDING`; worker retries provider transient failures within its attempt bound.
  - Not Started — Retry one controlled message after the key refresh and confirm it leaves `ERROR` through the normal worker.
  - Not Started — Decide whether a bounded bulk-retry/requeue operation is needed for the 73 existing failures; do not replay all messages blindly or exceed provider/cost limits.
- **3.3 Decider request and response contract — Completed (code); live adapter smoke check completed**
  - Completed — Send bounded/redacted subject and body to the versioned Perplexity Decider adapter.
  - Completed — Validate category and all ten probabilities; use returned confidence or selected-category probability fallback.
  - Completed — Keep classifier/model errors from fabricating categories or statuses; no regex fallback.
- **3.4 Classification persistence and idempotency — [/] In Progress**
  - Completed — `EmailClassification` stores category, probabilities, confidence, provider/model/version, nullable application link, and outcome.
  - Completed — Provider-mocked worker/persistence tests exist and were recorded in earlier evidence.
  - Not Started — Run one real email through the worker and confirm the classification row and inbox DTO reflect it after reload.
- **3.5 High-confidence, uniquely linked auto-update — [/] In Progress**
  - Completed — Worker maps each category to its canonical status and applies only when confidence is >=0.6, message is fresh, and no later BDE/manual status decision wins.
  - Completed — Code writes classification outcome, application revision/status event, and favorite/feed updates transactionally.
  - Not Started — Prove this with one clearly matched real email and confirm the stored application status/event after reload.
- **3.6 Low-confidence linked-message review — [/] In Progress**
  - Completed — Linked classification below 0.6 creates a pending ApplicationReview and does not change the confirmed status.
  - Completed — Inbox review action and Applications review membership/select-status flow are implemented.
  - Not Started — Verify persisted low-confidence review and a BDE resolution end to end with a real linked message.
- **3.7 No-match review routing — [/] In Progress**
  - Completed — Worker persists no-match classification outcome as `UNMATCHED`; it does not attach a guessed application.
  - Completed — Surface actionable unlinked `UNMATCHED` classifications in the Inbox “Needs BDE review” filter, regardless of confidence; unmatched `OTHER`/unclassified messages stay in All and are not offered as application matches. No unmatched result changes application status automatically.
  - Completed — Show the classifier category/confidence and reuse the candidate-scoped application selector and explicit status confirmation.
  - Completed — Derive pending queue membership from the existing `UNMATCHED` outcome plus missing application link; after BDE links/confirms, the email leaves the unmatched queue without a schema change.
  - Not Started — Define and implement the BDE action when an unmatched message belongs to no application (open decision Q10 in the plan).
- **3.8 Frontend queue and review feedback — [/] In Progress**
  - Completed — Inbox displays classifier result metadata and exposes retry/review controls.
  - Completed — Add a distinct “Needs BDE review” filter/count covering actionable unlinked `UNMATCHED` messages and linked messages with pending review records; unmatched `OTHER`/unclassified messages and provider `ERROR` messages are not misrepresented as review decisions.
  - Completed — Keep the reader selection within the active filter, and show unmatched classification confidence plus the no-status-change instruction.
  - Partly completed — Local browser confirms the Needs BDE review filter shows 0 for the current Inbox after unmatched `OTHER`/unclassified messages were excluded; the emails remain in All. Remaining loading/provider-error/pending/resolved states still need UI review.
- **3.9 Integrated acceptance — Not Started**
  - Not Started — Exercise one real high-confidence linked email through sync → worker → persisted result → automatic status update.
  - Not Started — Exercise one low-confidence linked email through BDE review → human status selection; ensure model prediction alone does not change the status.
  - Not Started — Exercise one unmatched email at high confidence through visible BDE review; ensure status remains unchanged until the BDE links/confirms it.
  - Not Started — Verify retries, idempotency, tenant/role isolation, audit fields, and reload persistence; update this tracker with actual evidence.

Module 3 implementation batch 1 — Added the canonical ten-category contract (including `move_on`), confidence normalization, provider response validation, bounded/redacted model input, and the sequential 0010 migration/model for immutable classifications and retry queue state. Files: `backend/inbox/decider_categories.py`, `backend/inbox/safe_text.py`, `backend/inbox/decider.py`, `backend/models/db.py`, `backend/models/candidates.py`, `backend/migrations/versions/0010_email_classification.py`, `docs/team/README.md`, this tracker. Checks pending; no OpenRouter request and no migration application.

### 2026-10-31 — Surface classification review queue

Added an Inbox “Needs BDE review” filter and message badge for unlinked `UNMATCHED` results at any confidence and for messages with a pending application-review record. The reader explains that unmatched classifier output has not changed an application, displays confidence, and reuses the existing candidate-application selector and explicit BDE status confirmation. Reader selection now stays within the active filter. Queue membership derives from existing classification outcome, application link, and pending-review data; no API, schema, or database change was made. Q10 remains open for a BDE decision that an email belongs to no application. Files: `src/components/app/candidate/inbox/inbox-tab.tsx`, `src/components/app/candidate/inbox/inbox-reader.tsx`, this tracker. No tests or browser verification run in this change.

Module 3 batch 2 — Extended the shared BDE review creation service to retain the source classifier result ID. File: `backend/applications/tracking.py` and this tracker. Checks pending.

Module 3 batch 3 — Added the bounded classification worker. It classifies pending messages only when the OpenRouter key exists, records immutable probabilities and model metadata, creates reviews for linked low-confidence/stale/non-forward cases, and writes audit/status/favorite changes for eligible automatic transitions. Unmatched results are stored with outcome `UNMATCHED`; they are not currently surfaced as a BDE review item. Connected it to the existing five-minute Inbox sync job. Files: `backend/inbox/classification_worker.py`, `backend/scheduler.py`, this tracker. Automated checks are recorded below; a live provider call was subsequently verified without persistence.

Module 3 batch 4 — Added the new firm-owned classification model to the auth-scoping lint inventory. Files: `backend/tests/test_firm_scoping_lint.py`, this tracker. Checks pending; frontend Inbox still needs to display classifications and provide a BDE status dropdown.

Module 3 batch 5 — Updating the Inbox decision contract so model output is displayed as a classification and the BDE chooses a status through a dropdown backed by the existing revision-checked application review command. Checks pending.

Module 3 batch 6 — Added the candidate Inbox review endpoint: authorized Owner/Manager/assigned BDE can link an unlinked message to one of that candidate's applications and confirm a selected status through the transactional tracker service; cross-candidate/firm links are rejected. Inbox responses now include classifier state/result metadata. Checks pending.

Module 3 batch 7 — Registered the review endpoint with firm route authorization. File: `backend/auth/access.py` and this tracker. Checks pending.

Module 3 batch 8 — Added the cross-firm message-review action to the standard F7 isolation matrix and supplied its pending-review fixture IDs. Files: `backend/tests/isolation_cases.py`, `backend/tests/isolation_support.py`, this tracker. Checks pending.

Module 3 batch 9 — Adding the classifier result DTO and the BDE status selector in the Inbox reader; preserving test-only legacy signal rendering. Checks pending.

Module 3 batch 10 — Expanded the shared Inbox message contract with the 10 category tags, classifier processing state, confidence and decision outcome. File: `src/lib/schemas/inbox.ts`, this tracker. Checks pending.

Module 3 batch 11 — Mapped backend classification metadata into frontend Inbox messages and added display labels/icons for the user-approved taxonomy while retaining test-only old signal names. Files: `src/lib/api/dto/inbox.ts`, `src/components/app/inbox/signal-meta.ts`, this tracker. Checks pending.

Module 3 batch 12 — Added the live Inbox message review mutation and shared candidate page action contract; the mutation refreshes inbox, application and jobs state after a backend decision. Files: `src/lib/api/inbox.ts`, `src/lib/hooks/use-inbox.ts`, `src/components/app/candidate/candidate-actions.ts`, this tracker. Checks pending.

Module 3 batch 13 — Normalized selected application status to the backend's lowercase status contract at the mutation boundary. File: `src/lib/hooks/use-inbox.ts`, this tracker. Checks pending.

Module 3 batch 14 — Surfaced persisted low-confidence reviews as Inbox suggestions linked to their review revision; overview actions now open the email for human decision, and the candidate page owns the backend review mutation. Files: `src/components/app/candidate/use-candidate-workspace.ts`, candidate page, this tracker. Checks pending.

Module 3 batch 15 — Added the Inbox reader dropdown to select/link a candidate application and explicitly choose its status; the button submits expected application/review revisions to the backend. Files: `src/components/app/candidate/inbox/inbox-reader.tsx`, `inbox-tab.tsx`, this tracker. Checks pending.

Module 3 batch 16 — Added Decider contract/redaction/confidence/transition tests and an auto-applied receipt persistence test. Files: `backend/tests/test_email_decider.py`, this tracker. Backend tests pending.

Module 3 batch 17 — Added Inbox DTO assertions for the 0.45 Assessment review classification and an adapter test proving the BDE-selected status/revisions are sent to the candidate-scoped review API. Files: `src/lib/api/dto/inbox.test.ts`, `src/lib/api/inbox.test.ts`, this tracker. Checks pending.

Module 3 test adjustment — Worker integration assertions now distinguish message processing state (`DONE`) from classification outcome (`REVIEW` or `AUTO_APPLIED`). File: `backend/tests/test_email_decider.py`, this tracker. Checks pending.

Frontend checks after batches 9–15: direct TypeScript `tsc --noEmit` passed; focused Vitest on Inbox DTO/adapter, membership, isolation and Applications board passed **47 tests in 5 files**; `git diff --check` passed. Backend classification tests and migration checks remain.

Initial Module 3 backend run: **167 passed, 2 failed**. The test run exposed a missing `Application.created_at` assumption in the Saved freshness path and clarified that the supplied order treats Shortlisted as following Offer. Updated the freshness check to use `applied_at` when present and aligned the test with the user's status order. Rerun pending.

Backend focused rerun after the policy fixes: **169 passed**, 1 existing Starlette/httpx deprecation warning. Added worker-level low-confidence and high-confidence integration cases after that run; rerun pending. The route review mutation also passed the firm-isolation matrix.

Frontend final focused rerun after classifier DTO/review action tests: `tsc --noEmit` passed; Vitest **49 passed in 5 files**; cross-firm and membership tests included. Backend worker integration rerun is in progress.

Backend classification/isolation rerun: **158 passed**, 1 existing Starlette/httpx deprecation warning. Includes 0.55 low-confidence review, 0.90 auto Applied, automatic status event/favorite cleanup, new Inbox review route isolation, OAuth/Gmail sync and route lint. No live Google/OpenRouter call.

Final lint caught a React hook setState-in-effect violation in the new Inbox reader and two unused-variable warnings. The full frontend and backend regression suites are running; fixing the lint findings before closeout.

Module 3 lint fix — Replaced effect-driven form resets with message-keyed controlled selection state and removed two unused helper declarations. Files: `src/components/app/candidate/inbox/inbox-reader.tsx`, `src/lib/api/inbox.ts`, `src/lib/hooks/use-inbox.ts`, this tracker. Focused lint/typecheck rerun pending.

Frontend full suite before the lint-only state refactor: **569 passed in 45 files**. Post-fix `tsc --noEmit` and focused ESLint both passed. Rerunning the focused Inbox tests after the refactor; full backend suite remains in progress.

Post-refactor targeted frontend rerun: **10 passed in 3 files** (Inbox DTO/adapter and Applications board); TypeScript and ESLint passed with no diagnostics.

Full backend run: **3,508 passed, 58 skipped, 13 xfailed; 1 migration check failure; 28 setup errors after PostgreSQL test storage ran out of disk**. The migration check identified missing UUID server default on migration 0009's OAuth-attempt ID and a missing firm_id index in migration 0010. The disk-full errors occurred while pytest was truncating unrelated test tables; inspect and correct the migration before a controlled rerun.

Module 3 migration correction — Added the `gen_random_uuid()` server default to the 0009 OAuth attempt primary key and the implicit firm_id index to migration 0010 so Alembic metadata matches the models. Files: `backend/migrations/versions/0009_candidate_gmail_oauth.py`, `0010_email_classification.py`, this tracker. Read-only migration check rerun pending; Docker reports test-volume disk full during the previous full suite.

Docker now reports 10.1 GB available in the test container; rerunning the focused model/migration consistency test against a fresh scratch database.

The full-suite rerun of migration checks also failed at test setup because the disposable `db-test` tmpfs filled. Stopped and restarted only `db-test` (the test-only service stores all data in memory; the persistent `db` development service was not touched) before the next focused attempt.

Focused migration consistency rerun passed: **3 passed** after resetting the disposable test DB. Alembic upgrade-to-head and `alembic check` now agree for migrations 0009 and 0010. Development DB remains unchanged at 0008.

Module 3 retry recovery — Added an authorized candidate-scoped retry route for messages in classifier `ERROR`, plus API/hook state contract. Files: `backend/api/routes_inbox.py`, `backend/auth/access.py`, `backend/tests/isolation_cases.py`, `backend/tests/isolation_support.py`, `src/lib/schemas/inbox.ts`, `src/lib/api/dto/inbox.ts`, `src/lib/api/inbox.ts`, `src/lib/hooks/use-inbox.ts`, `src/components/app/candidate/candidate-actions.ts`, this tracker. UI action and tests pending.

Module 3 retry UI — Added the Inbox error banner and BDE retry button, plus candidate-page feedback and an adapter test. Files: candidate page, `src/components/app/candidate/inbox/inbox-reader.tsx`, `src/lib/api/inbox.test.ts`, this tracker. Checks pending.

Module 3 transition-policy refinement — Removed an inferred fixed stage ordering because the user specified category-to-status mapping and said the stages are not a mandatory sequence. Fresh, uniquely linked messages can map to any of the ten statuses; older email is blocked by `status_effective_at`, and later BDE changes win. Saved email evidence can advance directly to its classified status and sets `applied_at` to the received time. Files: `backend/inbox/classification_worker.py`, `backend/tests/test_email_decider.py`, this tracker. Checks pending.

Module 3 feature gates — Added independent `CANDIDATE_EMAIL_CLASSIFICATION_ENABLED` and `CANDIDATE_EMAIL_AUTO_STATUS_ENABLED` environment flags. Disabling classification leaves raw Inbox usable; disabling automatic status changes sends high-confidence classifications to BDE review. Files: `backend/config.py`, `backend/inbox/classification_worker.py`, `backend/.env.example`, this tracker. Checks pending.

Module 3 contract hardening — Added database enforcement for the exact ten-category taxonomy, and expanded worker integration tests to cover the exact 0.60 boundary and automatic-status flag off. Files: `backend/models/db.py`, `backend/migrations/versions/0010_email_classification.py`, `backend/tests/test_email_decider.py`, this tracker. Checks pending.

Module 3 retained-mail handling — Pending imported messages may still be classified after a mailbox is disconnected, because disconnect stops sync and removes credentials but retains imported content. File: `backend/inbox/classification_worker.py`, this tracker. Checks pending.

Added a disconnected-mailbox worker case so this retention behavior is explicit. File: `backend/tests/test_email_decider.py`, this tracker. Checks pending.

Current implementation gate (supersedes earlier setup notes): local mailbox and OpenRouter configuration are available, migrations 0008–0010 are applied, and one direct real-email classifier call succeeded. Module 3 remains in progress because the worker's real persistence/status path is unverified and unmatched outcomes lack a visible BDE queue. The full backend suite previously reached 3,508 passes before the disposable Postgres tmpfs filled; subsequent focused migration and feature suites are green. Abdul/code-owner review is still required before merge.

Disconnected-mail classification rerun passed: **12 passed**. Combined with final focused backend suite **164 passed** and migration consistency **3 passed**; frontend TypeScript/ESLint and targeted Vitest **50 passed** remain green.

Latest frontend checks after retry recovery: TypeScript, focused ESLint, Python compileall and `git diff --check` passed; Vitest passed **50 tests in 5 files**, including Inbox retry adapter, DTO mapping, membership and isolation. Backend worker/retry/isolation/migration suite is in progress.

Latest backend checks after retry recovery: **162 passed**, 1 existing Starlette/httpx deprecation warning. Includes classifier worker boundaries, Inbox retry/review route F7 isolation, firm-scope lint and all three migration consistency checks. No provider network calls; test-only `db-test` reset, persistent development DB unchanged.

After adding independent feature gates, exact 0.60 coverage, and the DB category constraint: frontend TypeScript/ESLint/Python compileall/`git diff --check` passed and Vitest passed **50 tests in 5 files**. Focused backend rerun is in progress.

Final focused backend rerun: **164 passed**, 1 existing Starlette/httpx deprecation warning. This includes the exact 0.60 threshold, auto-status flag disabled→BDE review, retry/review route isolation, classification taxonomy constraint, and all migration/model consistency checks.

Frontend check rerun after the Inbox reviewer dropdown and mutation wiring: TypeScript passed, focused Vitest **47 passed in 5 files**, and `git diff --check` passed. Backend rerun remains in progress.

## Module 4 — Full workflow acceptance and handover

Status: Not Started. Depends on accepted Modules 1–3.

- Not Started — Run frontend/backend suites, migration checks, typecheck, lint and build.
- Not Started — Verify Saved → manual Applied → email → Decider → automatic update/review → correction → reload/history.
- Not Started — Verify Owner/Manager/BDE scope and Viewer/support/cross-firm denial.
- Not Started — Verify restart/outage/reconnect/duplicate/stale/concurrent-edit recovery.
- Not Started — Verify all application/inbox/overview/activity views and derived counts.
- Not Started — Record accessibility/theme/responsive/loading/error acceptance.
- Not Started — Complete operational, configuration, rollback and rollout documentation.
- Not Started — Record user acceptance, code-owner review and release decision.

## Deferred

- [-] Deferred — Browser extension and external submission detection.
- [-] Deferred — Gmail replies/sending, provider read changes, deletes, attachment extraction/OCR.
- [-] Deferred — Live job scraping (owned separately); reuse existing canonical jobs and candidate links.

## Required approvals / unresolved decisions

The user authorized Modules 1–3 as one combined change set on 2026-10-31 and authorized restarting the backend to test Inbox. Migrations 0009–0010 are applied locally. Required Abdul/code-owner review remains before merge. A live direct Decider call succeeded after backend recreation, but persistence/status update acceptance remains open. Existing 73 `ERROR` messages are all unlinked and must be retried selectively before a full worker test. Candidate OAuth/mailbox acceptance remains separate from this classifier gap.

## Change and evidence log

| Date | Module | Files / operation | Change / finding | Checks and result |
|---|---|---|---|---|
| 2026-10-31 | Module 3 planning audit | `docs/integration/EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md`; `docs/integration/EMAIL_APPLICATION_STATUS.md` | Clarified the user-confirmed rule: confidence <0.6 goes to BDE review; confidence >=0.6 automatically updates only a fresh, uniquely linked application; any unmatched result goes to a visible BDE review queue and never updates status until the BDE links/confirms. Added a deep Module 3 breakdown and identified the unmatched queue as missing. | Read-only source audit of classification worker, review service, Inbox route, model/schema and UI. One direct live Decider call succeeded (`other`, 0.9941, ten probabilities); it did not persist or mutate status. 73 messages were found in `ERROR`, all unlinked. No tests were run and no data was changed. |
| 2026-10-31 | Planning / Module 0 | EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md; EMAIL_APPLICATION_STATUS.md; docs/02-DATA-CONTRACTS.md; docs/team/README.md | Confirmed Module 1 decisions and recorded the 11-status, review overlay, scope and revision contracts; claimed migration 0008 after observing head 0007. | Local DB later upgraded to 0008; no external provider calls. |
| 2026-10-31 | Module 1 | See detailed implementation batches below and repository diff | Implemented backend persistence/API, frontend live adapter/board/detail, Saved/feed integration protections, status history, review foundation and mock separation. | Backend full non-live suite: 3,510 passed, 6 skipped, 54 deselected, 13 xfailed. Focused new tracker/status suite: 18 passed. Frontend full suite: 563 passed. TypeScript and ESLint: exit 0. Migration 0008 applied locally. User browser acceptance/code-owner review pending. |
| 2026-10-31 | Module 2 planning | `docs/team/samad.md`; `docs/integration/06-open-decisions.md`; `docs/integration/EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md`; `docs/02-DATA-CONTRACTS.md`; this tracker | Recorded user-confirmed per-candidate Gmail OAuth: BDE initiates, candidate/account owner consents through Google read-only OAuth; import 90 days; disconnect deletes credentials/stops sync and retains imported mail. Module 2 is authorized; email classification/status writes remain Module 3. | Documentation only. No OAuth, DB, mailbox or code changes. Implementation blocked until Module 1 migration 0008 is merged per `CONTRIBUTING.md` no-stacked-PR and migration rules. |
| 2026-10-31 | Modules 1–3 sequencing | This tracker | User explicitly authorized completing Applications, Inbox and Decider on the current branch and preparing one combined merge, overriding the repo's usual one-task/one-PR sequence for this work. | No code change in this entry. Keep migrations ordered; do not merge until checks and required code-owner review pass. |
| 2026-10-31 | Plan/tracker correction | `docs/integration/EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md`; this tracker | Aligned the current plan with the implemented combined Modules 1–3 scope, direct category-to-status mapping/no mandatory sequence, current-status-only side panel, and actual remaining gates. | Documentation review only; no code or database change. |
| 2026-10-31 | Local Inbox runtime check | Backend service restart; local API OpenAPI; Adna candidate Inbox page; this tracker | User authorized a restart to test. Startup applied migrations 0009 and 0010, and the live API now exposes Inbox/OAuth routes. Candidate Inbox GET returned 200 and the page rendered the Google connect prompt. Clicking Continue to Google returned 503 with the UI message “Candidate Gmail OAuth is not configured”; no Google login/consent occurred. | Backend logs confirm successful migration/startup and Inbox GET 200; OAuth start reached the API but is blocked by missing candidate Google OAuth config. No OAuth secret values were read or displayed. |
| 2026-10-31 | Module 2 batch 1 | `backend/models/candidates.py`; `backend/migrations/versions/0009_candidate_gmail_oauth.py`; `docs/team/README.md`; this tracker | Added candidate-scoped mailbox credential/checkpoint fields, short-lived PKCE OAuth-attempt storage, and claimed 0009/0010 sequentially. | Not run yet. Next: implement scoped OAuth and Gmail synchronization routes; migration downgrade refuses to discard live credentials. |
| 2026-10-31 | Module 2 batch 2 | `backend/config.py`; `backend/.env.example`; `backend/requirements.txt`; this tracker | Added separate candidate Gmail OAuth/encryption settings and the OpenRouter key setting; declared the Fernet dependency. | Not run yet. Secrets are examples only and no credentials were added. |
| 2026-10-31 | Module 2 test-first slice | `backend/tests/test_candidate_google_oauth.py`; this tracker | Specified OAuth start scope, PKCE parameters and local-only return target as provider-boundary behavior. | Expected red: implementation module does not exist yet; test execution pending. |
| 2026-10-31 | Module 2 batch 3 | `backend/inbox/google_oauth.py`; this tracker | Implemented read-only Google OAuth URL with S256 PKCE, state hashing, Fernet secret encryption, safe local return paths, auth-code exchange and verified userinfo identity. | Not run yet. Tests pending; no Google request made. |
| 2026-10-31 | Module 2 batch 4 | `backend/api/routes_inbox.py`; `backend/main.py`; `backend/auth/access.py`; `backend/tests/isolation_cases.py`; `backend/tests/isolation_support.py`; `backend/tests/test_firm_scoping_lint.py`; this tracker | Added candidate-scoped Inbox read, OAuth start/callback, initial sync trigger, disconnect that retains messages, and local read state; registered routes and F7 cases. | Not run yet. Isolation tests stub Google; no provider call. |
| 2026-10-31 | Module 2 test-first slice | `backend/tests/test_candidate_gmail_sync.py`; this tracker | Specified 90-day first import, attachment exclusion, local unread state, and duplicate-safe persistence through the sync boundary. | Test execution pending; fake Gmail client only. |
| 2026-10-31 | Module 2 batch 5 | `backend/inbox/gmail_sync.py`; this tracker | Added token refresh, 90-day message listing, Gmail history sync, bounded MIME extraction, idempotent insertion, local read state, and conservative thread-only application linkage. Added one-time recovery when Gmail expires a history checkpoint. | Not run yet. Tests pending; no Gmail call made. |
| 2026-10-31 | Module 2 security refinement | `backend/inbox/google_oauth.py`; `backend/inbox/gmail_sync.py`; `backend/api/routes_inbox.py`; this tracker | Removed scope accumulation, kept the requested Google grants to read-only, and stopped persisting raw upstream exception text; callback/sync failures now retain only a generic safe message. | Not run yet. |
| 2026-10-31 | Module 2 batch 6 | `backend/scheduler.py`; this tracker | Added configurable five-minute candidate mailbox polling with a PostgreSQL advisory lock so multiple API workers do not poll the same mailboxes concurrently. | Not run yet. Deployment topology still needs acceptance; status changes/classification are not invoked here. |
| 2026-10-31 | Module 2 frontend batch | `src/lib/schemas/inbox.ts`; `src/lib/api/dto/inbox.ts`; `src/lib/api/inbox.ts`; `src/lib/hooks/use-inbox.ts`; candidate Inbox/connect/reader/preview/activity/application components; this tracker | Replaced the Inbox production mock adapter with backend DTO calls, real Google redirect, persisted sync/disconnect/read actions, and explicit unclassified email rendering until Module 3. Disconnected accounts can still read retained messages. | Not run yet. Next: typecheck/lint and frontend adapter/UI tests; backend checks remain pending. |
| 2026-10-31 | Module 2 sync-window update | `backend/inbox/gmail_sync.py`; `backend/tests/test_candidate_gmail_sync.py`; `src/components/app/candidate/inbox/inbox-connect.tsx`; team and integration docs; this tracker | User changed the initial import and expired-checkpoint rescan window from 90 days to 3 days. Updated the Gmail query, Inbox copy, regression expectation and workflow documentation. | Not run yet. No Gmail sync run as part of this change. |
| 2026-10-31 | Module 2 disconnect/sync error display | `src/components/app/candidate/inbox/inbox-tab.tsx`; this tracker | Confirmed disconnect succeeds and keeps imported mail as designed. Hide a stale sync error when disconnected and render disconnect request errors so the UI reflects the actual mailbox state. | Not run yet. DB evidence: DELETE returned 200; mailbox status is disconnected; 70 messages retained. |
| 2026-10-31 | Module 2 hardening | `backend/api/routes_inbox.py`; this tracker | Fixed internal Inbox serialization after disconnect, cleared encrypted PKCE verifier after callback use, and denied read-state mutation to VIEWER/support roles. | Not run yet. |
| 2026-10-31 | Module 2 backend test batch 1 | `docker compose --profile test run --rm backend pytest -q backend/tests/test_candidate_google_oauth.py backend/tests/test_candidate_gmail_sync.py backend/tests/test_isolation.py backend/tests/test_firm_scoping_lint.py` | Initial run: 151 passed, 5 failed. Failures exposed the missing F7 Inbox message fixture id, F7's legacy-delete case targeting a candidate-owned application, and OAuth state lookup needing a documented lint exception/model expectation. | Fixes added in `backend/tests/isolation_support.py`, `backend/tests/isolation_cases.py`, and `backend/tests/test_firm_scoping_lint.py`; rerun pending. |
| 2026-10-31 | Module 2 backend retest | Same focused Docker Compose selection | Updated isolation fixtures/lint expectations and reran after fixes. | 156 passed, 1 existing Starlette/httpx deprecation warning. No Gmail/Google request. |
| 2026-10-31 | Module 3 batch 1 | `backend/inbox/decider_categories.py`, `safe_text.py`, `decider.py`; `backend/models/{db,candidates}.py`; migration `0010`; team migration ledger; tracker | Added user-approved ten categories (`move_on` = rejection), Decider v1.2 request/parser with probability validation and confidence fallback, PII/credential redaction, and persistence/queue schema after 0009. | Pending tests and migration consistency checks; no OpenRouter call or migration application. |

## Update rule for every implementation change

For every code change, including a single line: update its module subtask and append an evidence entry during that session. Include paths, purpose, commands actually run, results/failures, unresolved decisions and next action. Written tests remain unverified until executed. A module becomes Completed only after its acceptance criteria, checks and required reviews have evidence. Never replace earlier failures with an unqualified success claim.

### 2026-10-31 — Module 1 implementation started

[/] In Progress — Extended candidate manual-status API, enum/DTO/metadata and board targets for the eleven statuses, retaining legacy reads. Updated candidate status hook to preserve application date beyond Applied and remove favorites for every non-Saved state. Existing feed already excludes all non-Saved applications; no feed edit was required. Files: backend/api/routes_applications.py, src/lib/schemas/enums.ts, src/components/app/applications/status-meta.ts, src/lib/api/dto/applications.ts, src/lib/api/applications.ts, src/lib/hooks/use-applications.ts, candidate page/applications-tab.tsx, docs/02-DATA-CONTRACTS.md. Initial typecheck result was not yet collected; see subsequent evidence below. General Applications adapter cutover, review foundation, revision/migration design and full module acceptance remain incomplete.

Added backend regression cases for every post-Applied category, checking actor/history, preserved submission details, feed exclusion and Saved/favorite restoration. File: backend/tests/test_candidate_application_status.py. Execution pending.

Adjusted optimistic date preservation and prevented Move on cards appearing twice in the board archive. Removed unused suggestion callback parameter/dependency in candidate page. Files additionally touched: application-board.tsx. Focused board tests passed (2/2), initial typecheck passed; backend tests running.

Backend category/manual-status regression tests: 13 passed (one existing Starlette/httpx deprecation warning). Typecheck found the existing scopeApplications generic rejected nullable Saved submitters; widened its input type to string|null without changing access behavior (src/lib/auth/policy.ts). Rechecking typecheck/lint after correcting optimistic-date comparison and unused import.

Added rendered-board coverage for all eleven visible category columns (src/components/app/applications/application-board.test.ts). Full Module 1 remains In Progress; no migration/data changes performed.

Frontend check caught an optional next-status indexing issue and an existing undefined toHref in JobExplorer. Narrowed the status fallback and added the existing route helper hook in JobExplorer; rechecking. This also touches src/components/app/jobs/job-explorer.tsx. Board suite: 3 passed.

User requested grilling on BDE review placement before implementing that branch. Review schema/UI remains undecided. Corrected placement of the JobExplorer route helper after syntax check flagged it inside destructured parameters; typecheck rerun pending. No BDE review implementation has been made.

### 2026-10-31 — BDE review decision confirmed

Completed — User confirmed review column in Applications, last confirmed status retained, manual Inbox dropdown confirmation required. Updated plan Q1 and data contract. Added ApplicationBoard review-membership prop and dedicated non-droppable column; pending cards render only there and remain non-draggable with the confirmed status shown. Backend review membership and Inbox dropdown are not wired yet. Files: application-board.tsx, docs/02-DATA-CONTRACTS.md, this tracker and implementation plan. Final prior typecheck completed with no diagnostics after correcting the route helper. New review rendering checks pending.

Added rendered review test: pending card appears in review only, retains Interview scheduled, and has no drag handle (application-board.test.ts). Running focused frontend checks.

Review UI foundation verification: TypeScript check exited 0 with no diagnostics; focused ESLint exited 0; board tests 4 passed, including retained confirmed status and disabled review-card drag. These checks cover the rendering foundation, not persisted reviews or Inbox resolution.

### Module 1 persistence/service implementation
Added backend/applications/tracking.py shared status and review service and model definitions in backend/models/db.py. Revision checks, command replay guards, review isolation, status history/ledger/favorite transaction; immutable original history retained. Claimed 0008 after read-only DB verification at 0007 (docs/team/README.md). Contract recorded in docs/02-DATA-CONTRACTS.md. No migration applied yet; tests pending.

Implemented shared status/review route wiring, scoped tracker list/detail, serialized revisions/pending reviews, migration generation/backfill/append-only event guard, protected candidate records from legacy email/auto-reject writes. Connected general Applications list/detail/update through http.ts with pagination, revision/command IDs; pending review membership comes from backend and remains visible even for closed statuses. Updated manual dropdown, history displays and counts without fabricating intermediate stages. All files in this batch: backend/applications/, models/db.py, migrations/0008_application_tracking.py, api/routes_applications.py, auth/access.py, tests/isolation_cases.py, email_monitor/gmail_client.py, scheduler.py; src/lib/{schemas/application,api/applications,api/dto/applications,hooks/use-applications,auth/policy}.ts, Applications/candidate pages, application board/card/list/drawer/tab, derive/candidate-stats.ts and dashboard.ts. Tests/checks pending. No Gmail/model call or live DB migration yet.

Module 1 compatibility/test adjustments: test requests now send expected revision; legacy LLM stub declares candidate_id=None explicitly. Added isolated pending-review fixture/case for access tests; protects actual candidate history while preserving deletion of empty legacy compatibility rows. Resume lookup in application list is keyed by candidate+job to prevent cross-candidate attachment. Updated Saved optimistic draft defaults and scoped mock-unit tests to test applicationsMock directly now that the public Applications adapter is live; backend isolation and adapter tests cover the live path. General board cards now open real detail routes. Files additionally: tests/isolation_support.py, test_candidate_application_status.py, test_gmail_client_apply_llm.py; use-candidate-favorite.ts; mocks/{application-authorization,isolation,membership}.test.ts; Applications pages. Checks pending.

Added tracker API/review/idempotency/immutability tests (backend/tests/test_application_tracker.py) and live adapter pagination/no-fallback/category/review metadata tests (src/lib/api/applications.test.ts). Candidate drawer now offers all canonical manual statuses and blocks manual changes during pending review. No mocked provider calls or Inbox implementation were introduced. Tests running.

Migration review: initial untouched Saved-only receipts remain in original JSON rather than protected normalized events, preserving the agreed unfavorite/delete rule. All progressed/other historical transitions are backfilled without relabeling. Adjusted fixture selection to candidate assignment scope. Final migration has not yet been applied to development DB.

Focused frontend tests passed: 5 files / 62 tests. Interrupted initial backend subset run after inadvertently overlapping two commands against the shared test DB; those interrupted results are not accepted as verification. Restarted one complete non-live backend suite. Corrected drawer whitespace.

Separated unrelated follow-up mocks into src/mocks/followups.ts. Production Applications adapter no longer imports/seeds application fixtures or browser storage; historical application mocks remain only as test fixtures. Updated src/mocks/applications.ts re-export for existing fixture tests and src/lib/api/applications.ts followup import. Locked candidate update/unfavorite rows before deletion checks to serialize with pending-review creation.

Added assigned-BDE Saved draft visibility/same-firm candidate isolation and legacy-monitor no-overwrite regression tests in test_application_tracker.py. These were added after the full backend run collected its tests, so they will be run in a subsequent focused pass, never concurrently against the test DB.

### Full-suite audit and correction batch


The complete backend suite completed: **3,510 passed, 6 skipped, 54 deselected, 13 expected failures** (non-live selection). The first full frontend run found 22 failures/541 passes. Root causes: dashboard tests still assumed Applications came from fixtures after production API switched to live backend; local-storage fixture tests used a BDE who no longer owns the candidate; and a permission unit test expected historical submitter scope. Updated dashboard test-only fixture reads to use explicit fixture stubs, switched storage-mechanics writes to the owner, and corrected scope expectation to current candidate assignment. Secured legacy delete routes with `application.move` and candidate scope; candidate rows must use Saved/favorite or status actions to preserve history. The full frontend rerun passed **563/563**. The new tracker/status suite passed **18/18** after correcting its BDE fixture. Existing application delete/bulk contract tests passed **91 passed, 3 xfailed**. TypeScript and ESLint completed with exit 0. Local PostgreSQL upgraded 0007 → 0008; Alembic check reported no new operations. Production build succeeded; warnings were the repository's `::highlight(bq-ai-pending)` CSS pseudo-element and Next workspace-root notice. `git diff --check` passed. Browser acceptance/code-owner review remain pending.

### Final Module 1 closeout update

The final implementation/check batch is complete. This covers `backend/api/routes_applications.py` candidate delete authorization/history protection; `src/mocks/fixture-backend.ts`, `src/mocks/db.test.ts`, and `src/lib/auth/permissions.test.ts` test-only fixture/scope corrections; `docs/team/README.md` migration ledger and this tracker. Results: existing application bulk/delete contract tests **91 passed, 3 expected failures**; focused new tracker/status tests **18 passed**; full frontend suite **563 passed**; full backend suite **3,510 passed, 6 skipped, 54 deselected, 13 expected failures**. TypeScript, ESLint, `git diff --check`, Alembic consistency check, and production build all exited successfully. The build emitted only the existing CSS `::highlight(bq-ai-pending)` parser warning and Next workspace-root notice. Migration 0008 is applied to local development PostgreSQL. No Inbox/Decider/extension integration or external provider call was made. Remaining closeout: user browser acceptance and code-owner review; migration downgrade/backfill review is not separately exercised against a scratch database.

### 2026-10-31 — User-requested Applications UI refinements

User requested BDE Review directly after Applied, a Saved side-sheet interaction matching the 3001 reference, and mock data for inspection. Updated the board order and added the primary “Move to Applied” action in the Saved application side sheet. Started `/Users/abulsamad/Documents/kabeer` on port 3001; its existing fixture data loads 16 candidate applications, and clicking Saved shows the reference side sheet with “Move to Applied.” No fixture or database rows were added by this UI refinement; the live backend currently displays its existing records. Order test and frontend checks pending.

### 2026-10-31 — Application tracking detail panel

[/] In Progress — Restyled the candidate application side panel to a wider right-side drawer modeled on the supplied layout while using BenchQ's own status and application fields. Per the user's correction, it displays only the current status (not a status history/timeline), with existing Saved → Applied / status controls and optional application notes. Email and resume details are future work in their own modules. Updated `docs/04-SCREENS.md`. Files: `src/components/app/candidate/applications/application-drawer.tsx`, candidate page drawer props, `docs/04-SCREENS.md`, this tracker. TypeScript, focused ESLint, and `git diff --check` passed; browser verification remains. No database or Inbox integration changes.

### 2026-10-31 — Full status choices in the application side panel

Changed the Saved application side panel from a single “Move to Applied” button to the same full status selector used by other application states. Authorized users can now select Saved plus all ten agreed email/application statuses from the side panel. The side panel still displays only the current status and no history. Updated this tracker; no database or Inbox changes. Focused code checks and browser verification are pending.

Updated the drawer's Progress display to use BenchQ's canonical application statuses (Saved plus the ten agreed statuses), not the 3001 sample's legacy stage names. Reached statuses show the date from the application's existing status events; the current state is highlighted. This was later corrected by the user: resume selection and backend linkage are out of scope. Keep only a read-only “Resume used” display from mock resume-version data; status moves must not depend on a resume.

### 2026-10-31 — Unrestricted canonical status card movement

Removed the board's optional transition restriction so an active application card can move directly from any canonical status column to any other canonical status column. This applies to the candidate and firm-wide boards and uses the existing optimistic frontend mutation and backend status endpoint. Cards pending BDE review remain in the non-draggable review queue until resolved in Inbox. Updated this tracker; automated and browser verification are pending.

### 2026-10-31 — Resume display and free status movement correction

Per the user's clarification, the resume is display-only mock data during application tracking. Removed the resume picker and resume ID from frontend status-move calls, so application status moves do not require a resume prompt. Kept the “Resume used” panel field reading the existing mock `resumeVersionId` and resume fixtures. A real resume association is deferred. Updated the implementation plan and data contract accordingly. Automated and browser verification pending.

Files: `src/components/app/candidate/applications/application-drawer.tsx`, `src/components/app/applications/application-board.tsx`, `src/components/app/applications/resume-sent.tsx`, `src/lib/api/applications.ts`, `src/lib/api/dto/applications.ts`, `src/lib/hooks/use-applications.ts`, `src/lib/schemas/application.ts`, `src/lib/schemas/inbox.ts`, `backend/applications/tracking.py`, `backend/api/routes_applications.py`, `backend/models/db.py`, `docs/02-DATA-CONTRACTS.md`, implementation plan and this tracker. Validation: `tsc --noEmit`, Python compilation for touched backend files and `git diff --check` all passed. Automated tests and browser verification were not run.

### 2026-10-31 — Live email-classifier and mailbox check

Read-only runtime check: Adna's candidate email matches the connected Google mailbox identity; the backend database contains the mailbox and an encrypted refresh token that decrypts successfully. Seventy-two synced emails are present, all currently `ERROR`, and none are linked to an application. A direct live call using the newest stored message was rejected by OpenRouter with HTTP 403 before returning a category; no classification result was stored and no application status changed. OpenRouter account credits were nonzero, but the configured non-management API key has a $50 limit, $50.14 usage, and $0 remaining. Retest is blocked on the owner updating that key's spend limit; do not remove the cap without a user-selected budget. The database was stopped after inspection; no application or mailbox data was changed.

Follow-up after the user replaced the OpenRouter key: the configured key now validates and reports no per-key spending cap. A live, direct Decider call against the newest real Adna email succeeded with Perplexity Decider V1.2 (`other`, confidence 0.9966). This was a read-only provider check: the classification was not saved and no status changed. The email remains unlinked to an application, so worker persistence and application status update still need a linked message test. Local PostgreSQL was stopped after the check.

### 2026-10-31 — Classifier-flow plan refresh

Re-read the worker, review service, schema, Inbox route/UI and team ownership docs against the user's confirmed rule: confidence below 0.6 goes to BDE review; confidence at or above 0.6 updates only a fresh, uniquely linked application; every unmatched result goes to BDE review with no application status change until BDE action. Found that the worker stores `UNMATCHED` but does not create or surface a review queue item. The Inbox API already supports BDE linking and explicit status selection after a message is opened.

After backend recreation to load the current OpenRouter key, one direct live model call on a real message returned `other` at confidence 0.9941 with ten probabilities. This did not use the classification worker, write a classification row, or update an application. A read-only count showed 73 candidate messages in `ERROR`, all with no application link; the existing API retries messages individually. No code, database rows, classifications or application statuses were changed during this plan refresh.

Updated [EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md](./EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md) with the precise decision rule, unmatched queue, safe schema strategy, owner approval gate, acceptance matrix and open question Q10. Added this module/submodule breakdown and evidence above. No tests were run for this documentation-only update.

### 2026-10-31 — Exclude unmatched Other/unclassified email from application review

Per the user's clarification, unmatched messages classified as `OTHER` or with no classification stay visible in All, but are excluded from “Needs BDE review” and cannot use the application-link/status-confirmation form. Pending reviews for already linked applications remain reviewable, including low-confidence `OTHER`. Updated the plan to record this rule. Files: `src/components/app/candidate/inbox/inbox-tab.tsx`, `src/components/app/candidate/inbox/inbox-reader.tsx`, implementation plan and this tracker. Focused Vitest passed: 26 tests in 4 files; `tsc --noEmit` and `git diff --check` passed. Browser check shows 0 messages in Needs BDE review while the Other/unclassified emails remain under All.

### 2026-10-31 — Classify all synced email; hide irrelevant `OTHER` results

Clarified the end-to-end rule: every synced email is eligible for the Perplexity classification queue, including messages without an application link. The scheduler syncs mailboxes and runs the classifier; the worker selects `PENDING` messages (and expired `PROCESSING` leases) in batches of up to 50 when the feature flag is enabled and an OpenRouter key is configured. Classifications without a linked application are retained but do not change application status. Candidate Inbox now hides `OTHER` results after classification while retaining those records in the backend. Automatic provider retries are bounded to three attempts; terminal `ERROR` messages require an explicit retry action, so “all emails go through classification” means all queued messages are attempted, not that provider failures are silently considered classified. Updated `EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md` and this tracker. No tests or browser verification run for this clarification.

### 2026-10-31 — Connect verified Gmail independent of candidate profile email

Removed the OAuth callback's equality check between the verified Google address and `candidates.email`, which blocked connection when the candidate profile contains placeholder data. The selected Google address is still verified by Google's userinfo endpoint and stored on the candidate-scoped mailbox; OAuth state/PKCE, assigned user/firm/candidate checks and read-only scope remain. Updated Inbox copy, the data contract and implementation plan. Files: `backend/api/routes_inbox.py`, `backend/models/candidates.py`, `backend/inbox/google_oauth.py`, `src/components/app/candidate/inbox/inbox-connect.tsx`, `docs/02-DATA-CONTRACTS.md`, `docs/integration/EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md`, this tracker. Backend restarted. Python compilation, frontend typecheck and `git diff --check` passed. OAuth tests and live OAuth retry not run; the user can now retry with the actual Google account.

### 2026-10-31 — Match submitted applications by company and complete role before classification

Implemented the user's confirmed sequence: first resolve an application by a unique existing scoped thread link or a complete company+job-title pair in the email subject/body; then run the independent status classifier. Automatic identity matching is restricted to the mailbox's firm/candidate and durable submission evidence. Later stages remain matchable. Never-submitted Saved drafts are excluded, including legacy drafts that received the model's default `applied_at` date. Name normalization handles case, Unicode, whitespace, modest punctuation, registered company aliases and the explicit synthetic QA title wrapper; technology names, seniority and level remain significant. Partial names, absent names, multiple applications and conflicting thread links stay unmatched. Job-related unmatched results use the existing BDE review queue and explicit manual linking/confirmation API; unrelated `other` remains excluded. The worker revalidates the name match after inference, preserves a concurrent BDE link, refreshes the locked application, and commits the message association with its immutable classification result and status/review decision. Existing confidence threshold, feature flags, freshness/manual precedence and event/idempotency behavior remain.

Files: `backend/inbox/application_matching.py` (new), `backend/inbox/classification_worker.py`, `backend/inbox/gmail_sync.py`, `backend/tests/test_email_application_matching.py` (new), data contract, implementation plan and this tracker. No migration, API shape or frontend change. Current frontend “at apply” names are derived from the linked Job; no historical snapshots were invented.

Validation: `docker compose exec -T backend python -m pytest backend/tests/test_email_application_matching.py backend/tests/test_candidate_gmail_sync.py backend/tests/test_email_decider.py backend/tests/test_application_tracker.py backend/tests/test_candidate_application_status.py backend/tests/test_firm_scoping_lint.py backend/tests/test_isolation.py -q -o asyncio_mode=auto -p no:cacheprovider` — **216 passed**, one existing Starlette/httpx TestClient deprecation warning. All tests used the disposable `_test` database with mocked providers. Python compilation and `git diff --check` passed. Read-only verification of the saved local development database found exactly ten QA applications, all still Applied, with ten unique in-memory company/title matches. No live mail was read, synced, sent or classified; no existing mailbox messages were reprocessed.

Operational prerequisites: the Adna candidate's saved mailbox is still DISCONNECTED. Reconnect it through the existing candidate Inbox flow before the user's live email test. The backend is not autoreloading and was deliberately not restarted during this work, since startup enables the existing scheduler; restart it to load the matcher before live testing. Classification and automatic-status flags and a provider key are configured. Live provider acceptance remains unrun; code-owner review remains required before merge/deployment.

### 2026-10-31 — Process newly imported mail immediately after commit

User requirement: once an email reaches the backend, start application matching and status classification immediately instead of leaving it for the next five-minute scheduler tick. A provider-mocked regression first reproduced the manual Sync now path leaving a committed message PENDING. The fix collects only IDs actually inserted by Gmail sync (`INSERT … ON CONFLICT DO NOTHING RETURNING id`), then dispatches the normal scoped worker after a successful commit. Manual sync and OAuth/reconnect callbacks use FastAPI background tasks after the response; scheduled imports classify each mailbox's committed new messages directly. Explicit ERROR retry also starts background processing immediately. All paths keep existing feature flags, thread/company/title matching, confidence/review rules, manual/freshness precedence, leases and immutable-result/status-event idempotency. Provider failures leave the import intact and do not become Gmail-sync failures. Batches larger than 50 continue in bounded chunks without waiting for a poll. The periodic sweep remains recovery for existing pending messages and expired leases; a creation-time cutoff prevents a new transient failure being retried twice in the same scheduled tick. Scheduler summaries include immediate and recovery classifications.

No new schema, API response fields, Gmail scopes, push delivery or frontend polling were added. Gmail fetching retains the existing cadence. Immediate means work begins without another timer; model inference still takes time.

Files: `backend/inbox/gmail_sync.py`, `backend/inbox/classification_worker.py`, `backend/api/routes_inbox.py`, `backend/scheduler.py`, `backend/tests/test_immediate_email_classification.py` (new), `backend/tests/test_candidate_gmail_sync.py`, data contract, implementation plan and this tracker. Checks: `docker compose exec -T backend python -m pytest backend/tests/test_immediate_email_classification.py backend/tests/test_candidate_gmail_sync.py backend/tests/test_candidate_google_oauth.py backend/tests/test_email_decider.py backend/tests/test_email_application_matching.py backend/tests/test_application_tracker.py backend/tests/test_candidate_application_status.py backend/tests/test_firm_scoping_lint.py backend/tests/test_isolation.py -q -o asyncio_mode=auto -p no:cacheprovider` — **235 passed**, one existing Starlette/httpx deprecation warning. Tests covered committed manual/OAuth/scheduled imports, rollback, provider failure, retry, gates, tenant/candidate/mailbox scoping, deduplication, over-50 batches, unchanged status policy and periodic recovery. Python compilation and `git diff --check` passed.

Restarted only the local backend to activate the change. Health is OK; Adna's Gmail remains CONNECTED, five-minute polling and both classification/status gates remain enabled. Read-only before/after metadata confirmed all ten QA job/application associations and their current statuses were preserved. All 88 stored candidate messages were DONE at verification. No test email was sent and no mailbox sync or classification was manually triggered for live acceptance; immediate-path acceptance used mocked providers in the disposable test database.

### 2026-10-31 — Direct automatic statuses; reserve controls for BDE review

User clarified that matched/fresh confidence >=0.6 decisions move directly to their respective status, while low-confidence, unmatched job-related and stale messages go directly to BDE review. Backend policy already implements this distinction. The frontend still derived suggestions from old stage ordering and displayed a Confirm status form after automatic or resolved decisions. Provider-free reader regression tests reproduced those cases before the fix.

Removed stage-order inference and the separate Needs update/Update suggested path. Linked proposed decisions now require the message's genuine pending backend review; actionable unmatched results use the existing manual-link flow. AUTO_APPLIED/NO_CHANGE show an automatic-result acknowledgement with no confirmation form or Move to action. Resolved reviews drop their controls. Pending low-confidence/stale/policy-blocked reviews retain current status, show Needs BDE review and explain stale or disabled-policy cases. Unrelated unmatched Other remains excluded, while linked Other with an actual pending review stays accessible. Overview actions now say Review email. The Inbox refetches while known messages are PENDING/PROCESSING and refreshes firm-scoped application/job caches after observing persisted classification decisions, preventing cached application state from producing a second suggested move. No status updates moved into the frontend and no schema/API fields changed.

Files: `src/components/app/inbox/signal-meta.ts`, candidate workspace, Inbox tab/reader, overview attention card, `src/lib/hooks/use-inbox.ts`, new `inbox-reader.test.ts`, `backend/tests/test_email_application_matching.py`, data contract, screens and this tracker. Added backend assertions that all ten categories at the 0.6 boundary produce AUTO_APPLIED/NO_CHANGE without an application review. Full Vitest: **583 passed** in 46 files; focused backend provider/matching/immediate tests: **69 passed** with mocked providers in `_test`; reader tests: **13 passed**. TypeScript, lint for all changed source files and `git diff --check` passed. Full-project lint remains blocked by the existing `react-hooks/set-state-in-effect` error in `inbox-connect.tsx:20` and reports an existing unused-import warning in `src/mocks/membership.test.ts:10`; those files were not changed for this task.

Frontend development server serves the change through hot reload; frontend proxy/backend health is OK. Read-only metadata verified classification and auto-status gates remain enabled and all ten QA applications remain present. No live classification, sync, retry, email send or manual application mutation was triggered for this change.


### 2026-10-31 — Applications BDE review opens the exact email

User requested that BDE review appear in Applications and clicking it go directly to the email. Both boards now render pending application cards as keyboard-accessible links to the exact pending email. Actionable unmatched mail appears in the same column as email cards, including for candidates without applications; no application association is guessed. Linked review rows in the candidate list and firm table show BDE review and open the pending email. The application detail review link also targets that email.

Candidate Inbox selection is URL-backed (`tab=inbox&message=...`). Its existing scoped GET accepts an optional message ID so an older review outside the latest Inbox page still opens correctly. A read-only paginated unmatched-review endpoint reuses the existing DTO, omits bodies and applies firm plus candidate-assignment scope. Both boards load its full queue. Review confirmation refreshes Inbox variants, Applications and the unmatched queue. No schema/status enum change or dependency was added.

Verification: 588 frontend tests passed; TypeScript and lint for changed files passed; diff whitespace clean. Backend review queue, full F7 isolation and scoping checks: 157 passed, followed by all 7 final queue tests including human confirmation removing an unmatched email (158 distinct backend cases across those runs). One existing Starlette/httpx deprecation warning remains. Checks used disposable synthetic data and mocked providers. Full-repository lint still has the previously recorded unrelated inbox-connect effect error; browser theme/viewport acceptance was not rerun for this change.

Local activation: restarted the backend after all tests completed. Backend and frontend-proxy health both return 200/ok; the new endpoint is in the running OpenAPI contract and refuses anonymous reads with 401. No live mailbox sync, classification or review was manually triggered.


### 2026-10-31 — Final pre-PR checks and regression coverage

User requested a final check, new cases for missing coverage, and test execution without committing, pushing or opening a PR. Added ten regression cases: four migration upgrade/rollback and data-preservation cases, one same-firm cross-candidate review-link case, three review-queue empty/paging/failure cases, and two candidate/legacy tailored-resume isolation cases. The first migration/review batch passed all 12 cases. New migration checks use scratch databases ending in `_test`; no development database schema or mailbox content was used.

Validated the current workspace and the isolated feature checkout based on latest fetched main (55ebc4f), with the unrelated theme patch excluded from that checkout. Frozen-lockfile installation succeeded there. Both frontend runs passed 591 tests (46 files). TypeScript and full-project ESLint passed. The isolated Next.js production build passed, with one existing CSS optimizer warning about `::highlight`. The previously recorded Inbox connection effect/import lint issues were already corrected before this verification.

Full backend run: **1 failed, 3586 passed, 6 skipped, 54 deselected, 13 xfailed, 34 errors** in 544.30 seconds. The actual assertion failure was the existing legacy latest-tailored-resume test: candidate scoping excluded NULL-candidate resumes from legacy applications. User explicitly authorized fixing it and rerunning affected tests. The small Applications list fix includes NULL-candidate resumes only when legacy applications are present, while continuing to key candidate results by candidate and job. Added two regression cases covering candidate-only and mixed legacy/candidate lists with a newer resume belonging to another candidate.

The 34 errors were test fixture setup failures (`psycopg2.errors.DiskFull: No space left on device`) in the disposable PostgreSQL test volume at the end of the full run. A first affected rerun inherited failed session setup and was stopped. A CHECKPOINT on db-test recovered the test environment; no app database or Docker data volume was removed or restarted. The final affected rerun passed **435 tests, 3 xfailed** in 83.33 seconds, including all previously storage-blocked work-arrangement cases, the original legacy assertion, new candidate-isolation tests, application CRUD/status/review tests, full F7 isolation and scoping lint. The entire 3640-case suite was not rerun after the targeted fix; retain the initial full-run result and the successful affected-run evidence separately.

Commands: `vitest run --reporter=dot`, `tsc --noEmit`, `eslint`, `next build --webpack`; Docker pytest full run used `backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider`. Final affected run selected `test_application_tracker.py`, `test_candidate_application_status.py`, `test_routes_applications.py`, `test_routes_applications_bulk.py`, `test_r4_contract_applications.py`, `test_r4_cov_routes_applications.py`, `test_isolation.py`, `test_firm_scoping_lint.py`, and `test_work_arrangement.py`, with `-x -q -o asyncio_mode=auto -p no:cacheprovider`. One existing Starlette/httpx warning remains in the final affected run.

No commit, push, PR creation, live mailbox sync, provider classification, email send or manual review was triggered by this verification. Example environment files contain no populated credential assignments. Browser theme/viewport/live-provider acceptance was not rerun; required code-owner approval remains before merge.


### 2026-10-31 — Comprehensive PR safety review

Requested: assess whether the proposed combined feature can be raised safely without breaking main. Freshly fetched main remains 55ebc4f9fa58ea4fa543249755e1092881db273b. Ran independent Standards/Spec review agents using the code-review skill, inspected the working-tree and untracked changes, checked secret patterns, reran the complete existing backend suite with provider/mailbox credentials removed, and repeated frontend tests/typecheck/lint/production build in the isolated latest-main checkout. Application behavior was not edited in this review.

The complete existing backend suite now passes: **3623 passed, 6 skipped, 54 deselected, 13 xfailed**, 6 warnings, 640.20 seconds. Test-database checkpoints avoided the prior temporary-storage failure. The production build (without BACKEND_URL), full lint and TypeScript pass. However, targeted review reproductions found real gaps, now retained as **8 failing backend regression cases** in `backend/tests/test_pr_safety_regressions.py` and **2 failing UI cases** in `src/components/app/candidate/inbox/inbox-tab.test.ts`. The final frontend run is **591 passed, 2 failed**; an earlier concurrent-run import timeout passed on the complete two-worker rerun without relaxing tests. The eight new backend cases were added after full-suite collection and executed separately in a dedicated disposable test database, which was removed afterward.

Decision: **not ready to merge**. Standards findings: OAuth callback write-authorization/suspension bypass, missing mailbox mutation ledger records, duplicated inline role policy, and legacy-delete incompatibility with backfilled immutable history. Spec findings: incomplete legacy interview/prep candidate authorization, missing same-status freshness watermark, mismatched live category filters, and mailbox identity replacement without required disconnect. See [PR_SAFETY_REVIEW.md](./PR_SAFETY_REVIEW.md) for severity, exact code/spec references, reproduction evidence and correction requirements. No findings were suppressed or marked xfail. No commit, push, PR creation/merge, service restart, development-data mutation, live sync or provider request was performed. Manual browser/live-provider acceptance and required code-owner review remain outstanding.


### 2026-10-31 — User-approved correction plan and checkbox tracker

Created [error-correction/IMPLEMENTATION_PLAN.md](./error-correction/IMPLEMENTATION_PLAN.md) and [error-correction/STATUS.md](./error-correction/STATUS.md) after the user approved the module/submodule structure. They map all eight review findings plus Inbox loading, requested stage order, filled progress and conditional Incomplete behavior into eight modules and 50 matching task IDs. The six planning/audit tasks are complete; all 44 product-correction/final-acceptance tasks remain unchecked. Previous workflow plans retain their history.

The actual development database was inspected in an explicit read-only transaction: migration 0010, nullable varchar application status, no application CHECK constraints, existing revision/freshness fields, and 14 rows currently using seven statuses. The backend command vocabulary already supports Saved plus all ten classification categories. No enum addition, fake records or status rewrite is needed to make those values representable; optional database integrity hardening requires a separate legacy-compatible decision/migration. The documents distinguish storage support from observed usage. Validation checked module/task parity, all S/R findings, local links, whitespace, requested order, backend vocabulary and aggregate totals. No application code, schema or records were changed; no tests were rerun for this documentation-only delivery, and no commit, push or PR was created.


### 2026-11-01 — Correction implementation complete; local gates green

Executed the approved error-correction plan after the user said “start”. Fixed all eight original review issues and the Inbox/stage requirements. Independent final review found five additional gaps (legacy edit authorization/detail reads, notes audit, exact selection outside filters and initial-sync locking); added red regressions and fixed them, including connection-generation protection for failed OAuth/manual/scheduled sync diagnostics. Both reviewers confirmed no remaining actionable issue in the corrected scope.

Final proposal is isolated on current main `1c6925f1edeab7de463046c0a949597ca5fe1bac`, preserving main's new auth/rate-limit/session changes and excluding the unrelated root dependency patch. Final complete backend: **3684 passed, 6 skipped, 54 deselected live cases, 13 existing xfails, 6 existing warnings**, 595.56s. Final frontend: **608 passed** plus typecheck/full lint/production build; the existing CSS optimizer warning remains. Browser component acceptance and actual production Next native-history smoke pass; both themes, three viewports, zero axe violations, no cached-selection Inbox/RSC requests, correct exact-email and Back/Forward behavior. Reusable scripts are in `scripts/qa/inbox-corrections/`.

Restarted backend/frontend and applied tested additive revision **0011** after a mode-0600 local Inbox backup. Before/after read-only metadata preserves **14 applications with identical statuses** and **107 emails**, with zero blank source-account namespaces. No status enum or fake status records were needed: storage already represents Saved plus the ten categories. No manual live sync/provider classification/email send was used for testing; configured normal polling is restored. Actual interval 5 minutes; classification/auto-status enabled; model-key presence checked without exposing it.

The correction tracker is **49/50**: implementation and local verification complete, with M7.8 reserved for external code-owner/merge approval. The combined migration chain 0008–0011 needs explicit packaging review under the normal one-revision-per-PR policy, and production must respect the historical-account attribution precondition. No applied revisions were rewritten. No commit, push, PR creation or merge. Full current evidence: [error-correction/FINAL_REVIEW.md](./error-correction/FINAL_REVIEW.md).
