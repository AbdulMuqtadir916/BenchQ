# Applications tracker → candidate Inbox → Decider implementation plan

Date: 2026-10-31
Status: Updated 2026-10-31 after a live classifier check and Inbox queue implementation. Linked-message classification and automatic status-update code exist, but the end-to-end flow is not accepted. Every synced email is queued for classification; unmatched classifications are stored without changing an application. `OTHER` messages are hidden from the candidate-facing Inbox. Live provider connectivity succeeded; worker persistence and application updates were not exercised. See [EMAIL_APPLICATION_STATUS.md](./EMAIL_APPLICATION_STATUS.md) for module-level state.
Progress: [EMAIL_APPLICATION_STATUS.md](./EMAIL_APPLICATION_STATUS.md).
Earlier Saved/Applied work and evidence remain in [STATUS.md](./STATUS.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

## 1. Goal and agreed scope

Deliver the Applications tracker, real candidate Inbox, and Perplexity Decider classification as one integrated change set, as authorized by the user. The normal repository sequencing was overridden for this combined branch; migrations remain ordered and owner review is still required. Final acceptance exercises the complete system.

Agreed behavior:

- Preserve existing candidate Jobs → heart → Saved behavior. Saving creates a favorite and a candidate application; preview does not save. Preserve existing unheart/progress rules.
- Saved belongs in Applications. Existing manual Saved ↔ Applied behavior continues while the extension is deferred.
- Support the ten email categories as corresponding application statuses. Saved is additional, giving **11 canonical application statuses**.
- Perplexity Decider V1.2 classifies candidate emails; regex is neither the classifier nor a classification fallback.
- Every newly synced email enters the classification queue, whether or not it is already linked to an application. User-confirmed 2026-10-31: start matching and classification immediately after the import commits, without waiting for the next scheduler tick. Manual sync and OAuth/reconnect imports use background work; scheduled sync processes committed imports per mailbox. Imported IDs are scoped and processed in batches of 50 when classification is enabled and an OpenRouter key is configured. The scheduled sweep remains for missed work, pending retries and expired leases; it does not repeat a new import's transient failure in the same tick. Gmail fetching still uses its configured cadence.
- Emails classified as `OTHER` are retained in storage but hidden from the candidate-facing Inbox because they are not job-related. Emails still pending, processing, or in error are not treated as `OTHER`; errors need retry after the bounded automatic attempts are exhausted.
- Classification confidence below 0.6 enters BDE review. At exactly 0.6 or above, the result is eligible for automatic status update subject to a unique application match and transition policy.
- If a message has no unique application match, its classification is retained but it does not update any application. Only linked, low-confidence or policy-blocked classifications enter BDE application review. Unmatched `OTHER` messages are hidden from Inbox; unmatched job-related messages remain available for manual linking.
- Use the adapter's valid confidence value; when absent/invalid, its existing parser uses the selected category probability. Persist both the confidence and all category probabilities.
- BDE review handles uncertain decisions and human corrections. It is not a compulsory stage between Applied and every subsequent status.
- Authorized BDEs, Managers, and Owners can change statuses within their candidate scope. Record the actual signed-in actor; Pan is an example, not a special account.
- The application side panel shows the current status and a Progress view built from BenchQ's canonical Saved + ten status states, with dates drawn from real application status events. It does not use the 3001 sample's legacy stage names.
- Show a read-only “Resume used” field using the existing mock application/resume-version fixtures. Do not add a resume picker, resume persistence, or a resume prerequisite to status moves in this phase.
- The extension and external submission detection are deferred. No extension implementation is included.

The user authorized one combined change set covering Modules 1–3. Additive migrations 0008–0010 are now applied to the local development database after the user authorized restarting the backend for this test. Required code-owner review remains outstanding before merge. Inbox decisions confirmed 2026-10-31: one candidate-owned Gmail mailbox per candidate; a BDE initiates OAuth from that candidate's page; the candidate or someone authorized to access the candidate's account signs into Google and grants read-only consent; import the most recent 3 days (updated from the original 90-day window); disconnect removes credentials and stops future sync while retaining imported messages. Module 3 is included in the authorized combined scope.

## 2. Status and classifier contract

The approved wire values are recorded in docs/02-DATA-CONTRACTS.md. Backend lowercase ↔ frontend uppercase conversion belongs in DTOs.

| Backend status / email category | Frontend status | Meaning |
|---|---|---|
| saved (not a classifier category) | SAVED | Candidate job saved before applying |
| applied | APPLIED | Application received; manual Applied remains available |
| screening_call | SCREENING_CALL | Company wants to schedule an initial screening call |
| interview_schedule_request | INTERVIEW_SCHEDULE_REQUEST | Interview availability requested |
| interview_scheduled | INTERVIEW_SCHEDULED | Interview booking confirmed |
| offer | OFFER | Candidate selected for the role, using the user's category definition |
| shortlisted | SHORTLISTED | Selected to continue to later hiring rounds |
| move_on | MOVE_ON | Rejected; use a clear rejection label in the UI |
| incomplete_application | INCOMPLETE_APPLICATION | Required application information/steps missing |
| assessment | ASSESSMENT | Hiring test, task, questionnaire or aptitude exercise requested |
| other | OTHER | Email does not fit another category |

The provided external adapter currently uses `move_forward` for rejection. Integrate a versioned `move_on` contract; do not silently accept a changed label with old prompt/category metadata. Do not modify the sibling evaluation project as part of BenchQ implementation without separate scope.

These statuses are not a mandatory linear sequence. Each of the ten classifier categories maps directly to its corresponding status, including `other` → `OTHER`. A high-confidence automatic update requires a unique existing message-to-application link, confidence ≥0.6, and a message newer than the latest effective status and any later human change. If no unique match exists, classify and retain the result but route the message to BDE review; never update an application based on a guessed match. Do not impose an inferred rank/order between category statuses.

BDE review is a separate review lifecycle linked to the application and email. **User confirmed 2026-10-31:** show a BDE review column in Applications, immediately after Applied. A low-confidence email places the card there, displaying its last confirmed application status. Do not apply the model category. The BDE reads the email in Inbox and selects/confirms a status from a dropdown; only that confirmation changes status and returns the card to the selected status column. Review is an overlay, not a twelfth canonical application status. Review cards cannot bypass confirmation by dragging out of the review column. The Saved application side sheet follows the 3001 reference action: a clear “Move to Applied” button.

## 3. Inspected baseline and implementation evidence

The table below records the pre-Module-1 baseline observed 2026-10-31. The active implementation and verification state is tracked in [EMAIL_APPLICATION_STATUS.md](./EMAIL_APPLICATION_STATUS.md). Existing uncommitted Saved/Applied changes were preserved.

| Area | Present state | Consequence |
|---|---|---|
| PostgreSQL | Read-only psql inspection on 2026-10-31: alembic_version=0007; application counts saved=1, applied=1. Later upgraded locally to 0008 for Module 1. | Counts were a snapshot, not seed requirements |
| Applications DB | applications has candidate_id, job_id, firm_id, resume_id, submitted_by_user_id, applied_at, JSON status_transitions | Reuse canonical application IDs; do not introduce a second candidate application registry |
| Candidate status route | Baseline PATCH /api/applications/{id}/candidate-status accepted only saved/applied; it now uses the shared 11-status tracker service and records actor/history/ledger/revisions/favorites transactionally. | See current tests and progress in tracker |
| Generic routes | VALID_STATUSES contains applied/interview/offer/rejected; old update/bulk paths have separate transition behavior | Audit all writers, not just the candidate board |
| Frontend | Baseline enums used old statuses; now canonical statuses, legacy read labels, board/detail/candidate views and live adapter are connected. | No fallback to application fixtures in the production adapter |
| Applications adapter | Baseline general list/byId/updateStatus still used applicationsMock; those paths now use HTTP, including pagination/detail/revision commands. | Unrelated follow-ups remain mocked |
| Inbox frontend | src/lib/api/inbox.ts calls inboxMock for list/connect/disconnect/read; staged consent is simulated | Replace with real backend calls and actual OAuth redirect |
| Inbox action | Baseline applySuggestion displayed an integration-pending toast. The live Inbox UI now provides email viewing and BDE review/link/confirm actions. | See implementation evidence and remaining live acceptance in the tracker |
| Mailbox DB | candidate_mailboxes exists with identity/status/actor timestamps, but no credential or sync cursor fields | Add encrypted credential and durable connection/sync state |
| Email DB | inbox_messages has nullable application_id/body, provider IDs/thread, sender/content/read state; unique(mailbox_id,provider_message_id) | Reuse it; add processing/classification/review metadata with approved migration |
| Monitor | backend/email_monitor/gmail_client.py reads one global refresh token and writes old statuses; scheduler also has auto-reject assumptions | Isolate legacy writers before new states go live |
| Decider | Adapter is in ext/LayaClassificationTest; evaluation endpoint calls it, not JobNavigator Gmail worker | Integrate explicitly into BenchQ backend |
| External candidate worker | ext/JobNavigator candidate_sync.py still imports candidate_rules regex functions | Reference implementation, not a ready Decider integration or a drop-in tenancy implementation |
| Team docs | Samad D8 draft says read-only and human-confirmed changes; earlier docs describe different statuses/order | The user's chosen Applications-first sequence and 11 statuses are recorded in docs/02; code-owner review remains outstanding |

Read-only DB inspection command: docker compose exec -T db psql -U jobnavigator -d jobnavigator with SELECTs against alembic_version, grouped applications.status, and information_schema.columns for applications/candidate_mailboxes/inbox_messages. No mailbox contents, tokens or environment secrets were read. No tests were run for this documentation task.

### Current classification-flow audit (2026-10-31)

- `backend/inbox/classification_worker.py` processes `PENDING` messages, calls the Perplexity adapter, and stores category, probability map, confidence, provider/model metadata, and outcome in `email_classifications`.
- For a linked message, confidence below 0.6 creates an application review without changing the confirmed status. Confidence at or above 0.6 can update the linked application when the email is fresh and no later BDE change takes precedence. Category-to-status mapping is direct.
- For an unlinked message, the worker writes outcome `UNMATCHED` and a nullable `application_id`; it does not call `request_review` or create an application-review row. The Inbox derives a queue item from this existing outcome and missing application link, without a schema change.
- The Inbox review endpoint links a message to one of the candidate's applications and accepts a BDE-selected status. The UI surfaces unlinked `UNMATCHED` classifications and pending linked reviews in a distinct “Needs BDE review” filter. A BDE decision that an email belongs to no application remains open as Q10.
- A live, direct call using the real latest candidate email succeeded after recreating the backend to load the updated OpenRouter key. It returned `other` at confidence 0.9941 with ten probability values. This test did not run the worker, persist the classification, link the message, or update an application.
- At audit time, the candidate had 73 messages in `ERROR`, all unlinked. The retry endpoint can requeue an individual failed message; changing the provider key does not automatically requeue those messages.

No tests were run for this audit or documentation update. No classification or application record was written by the direct live call.

Source references:

- Backend: backend/api/routes_applications.py, backend/api/routes_jobs.py, backend/models/db.py, backend/models/candidates.py, backend/migrations/versions/0007_candidate_core.py, backend/auth/{access,policy,scoping,ledger}.py, backend/scheduler.py, backend/email_monitor/.
- Frontend: src/lib/{schemas/enums.ts,schemas/application.ts,schemas/inbox.ts,api/applications.ts,api/inbox.ts,api/dto/applications.ts,hooks/use-applications.ts,hooks/use-inbox.ts}; src/components/app/applications/; src/components/app/candidate/{applications,inbox}/; candidate workspace/actions/page.
- Rules: CLAUDE.md, CONTRIBUTING.md, docs/team/{README,00-candidate-core,samad,FLOWS}.md, docs/integration/{README,03-applications,06-open-decisions}.md.
- External walkthrough: /Users/abulsamad/Documents/ext/JobNavigator/docs/EMAIL_CONNECTION_COMPLETE_WALKTHROUGH.md.
- Decider reference: /Users/abulsamad/Documents/ext/LayaClassificationTest/backend/app/{categories,openrouter_decider,safe_text,main,evaluation_store}.py.
- Candidate service references: /Users/abulsamad/Documents/ext/JobNavigator/backend/email_monitor/{candidate_sync,candidate_matching,candidate_status_policy,candidate_tracking,candidate_reviews}.py.

## 4. Ownership, approvals and delivery rules

- Samad owns applications, interviews, favorite_jobs, candidate_mailboxes and inbox_messages and their write routes.
- Abdul approves new entities/contracts/permissions and code-owner files, and all candidate-table changes. Changing another owner's table requires that owner. Ledger table changes are out of scope; use its existing writer.
- Coordinate feed changes with Zuhair, and worker/deployment concerns with Uzair. Existing firm_jobs/jobs/candidate_jobs must not be redesigned for this work.
- Record the revised D3/D8 contract in docs/02 and decisions/team docs before code. The user's requested sequencing is Applications → Inbox → Decider; do not use old Inbox-first recommendations to reverse it.
- Module 1's additive tracker entities/fields were implemented in claimed migration 0008 after verifying head 0007; migrations 0009–0010 followed sequentially. Local DB now runs 0010 after the user's restart authorization; code-owner review remains required before merge.
- User authorized one combined change set for Modules 1–3, overriding the usual one-task/one-PR sequencing for this work. Follow branch rules and required Abdul code-owner review before merge.
- Alembic only, real downgrade, one linear head, reviewed data backfill. Do not edit merged migrations or create tables at startup.
- Frontend screens use hooks → adapters → http.ts → FastAPI through the existing proxy. Do not copy the external Next API bridge into BenchQ; its architecture forbids new frontend API handlers.
- Before writing Next code, read installed relevant guides under node_modules/next/dist/docs/. Map backend DTOs; obtain approved contract changes before editing schemas.

## 5. Modules and dependencies

### Module 0 — Contract, migration design and baseline (completed)

Depends on: none. Owner: Samad; product/code-owner review: Abdul.

Tasks:

1. Inventory every status reader/writer: generic/candidate/bulk routes, saves/unfavorites, scheduler/auto-reject, global email monitor, imports/seeds, stats/analytics, board/detail/list/calendar, candidate stats, follow-ups and activity.
2. Recheck migration head, constraints/indexes and existing status distribution read-only. Separate legacy candidate_id=NULL records from candidate applications.
3. Confirm open rules in section 8 and document exact status/category/review contracts and transition matrix.
4. Design shared status command and review command, expected revision/idempotency behavior, DTOs and route permissions.
5. Approve data migration for old statuses without relabeling ambiguous historical events as new facts. Snapshot/backup and rollback procedure must be reviewed.
6. Claim migrations in team README only when their PRs are ready; resolve conflicts against the actual head.

Database changes: Module 1's migration was claimed after verifying the baseline and applied additively to the local development database. Acceptance evidence and still-open later-module decisions are in the status tracker.

### Module 1 — Complete Applications tracker, manual moves and review foundation

Depends on: Module 0 complete. Owner: Samad; coordinate Zuhair for any necessary existing feed filter changes.

Tasks:

1. Create the approved shared status service. Validate firm/candidate scope and role, lock/check expected revision, enforce allowed manual transitions, write status/history/ledger atomically. Repeated command IDs must not duplicate events.
2. Add approved 11-status validation to all relevant write paths. Unsupported/legacy paths must fail explicitly or use reviewed compatibility logic; never default unknown statuses to Applied.
3. Preserve Saved favorite/feed rules. Entering Applied removes favorite and hides the candidate job from feed; returning to Saved restores them. Define all non-Saved visibility consistently; later states must not accidentally reappear merely because the filter checks only Applied.
4. Preserve applied_at/submitter when moving beyond Applied; do not assign the email worker as the human submitter. Keep existing approved Saved ↔ Applied reversal semantics and record all reversal history.
5. Add application status revision, effective time and last-human-change metadata as approved. Prefer normalized immutable status events; retain legacy JSON history without lossy rewriting. Store actor/source, previous/new status, command ID, time, note and optional email/classification/review references.
6. Provide real paginated application list/detail/status APIs used by the general Applications page and candidate workspace. Enforce manager/BDE candidate scopes on every read/write, including legacy endpoints and bulk actions.
7. Replace Applications mock-backed list/detail/update paths, expand DTOs/types, board labels/targets/filtering, detail/history and candidate views. Update stage dots, closed-state logic, date/count derivation and calendar without assuming a single linear rank.
8. Add the BDE review foundation and command contract. Module 1 supports synthetic pending reviews through APIs/tests; the real Inbox dropdown and email-generated reviews arrive in Module 2/3. Resolve with notes and expected revisions; do not create a second application record.
9. Audit stats, follow-ups, auto-rejection and legacy monitor for old status assumptions. Gate conflicting candidate writes; preserve legacy functionality only within explicit reviewed scope.
10. Remove Applications mock paths only after all Applications consumers work live. Keep unrelated followupsMock until its separate work is authorized; do not delete shared fixture files blindly.

Database changes delivered in migration 0008: application revision/effective/manual timestamps, immutable normalized status events, and candidate/application/email-linked review rows. Original JSON histories and legacy statuses remain readable; no candidate table was changed and no ambiguous status was relabeled. The review API requires a pending review plus expected revisions and a human status choice.

Tests: the executed coverage and remaining manual review are recorded in the tracker. Automated coverage includes all canonical statuses, Saved/Applied reversal, revision/idempotency, review confirmation, immutable history, actors/submitter, assignment isolation, legacy-monitor protection, live API DTO/pagination/no-fallback, and board behavior. Concurrency and migration downgrade/backfill review remain follow-up verification gaps.

Acceptance: Applications data and status writes use the backend; pending review is represented and protected by persisted backend state and the Applications review column; Inbox email reading/decision UI arrives in Module 2. The production Applications adapter has no mock fallback. Automated checks pass; local browser acceptance and required code-owner review remain pending. Inbox/model services are not part of Module 1.

### Module 2 — Real candidate Gmail Inbox integration

**2026-10-31 matching decision (implemented locally):** identify the application before status inference using a unique complete company+role pair from subject/body, scoped to the mailbox's firm/candidate and restricted to submitted applications (`applied_at` on a non-Saved application, or submitter evidence). Later-stage submissions stay eligible; never-submitted Saved drafts stay excluded. Preserve a unique existing scoped thread link, leave ambiguous/conflicting links unmatched, and persist a new unique association with the classification result after revalidation. Identity uses deterministic name normalization, not category keywords or fuzzy overlap. Job-related unmatched results use the existing Inbox BDE review flow; unrelated `other` remains excluded. No migration or live mailbox reprocessing is part of this change. See the data contract's “Email identity matching” paragraph and `backend/tests/test_email_application_matching.py`.

Depends on: Module 1 implementation. Owner: Samad; production coordination: Uzair. Implemented in the user-authorized combined change set; owner review and live acceptance remain.

Tasks:

1. Implement backend candidate-scoped connect/status/callback/disconnect/sync/messages/detail/read APIs. A BDE starts OAuth from the candidate page; the selected verified Google account is stored for that candidate even when its address differs from the candidate profile email. The mailbox row remains one-per-candidate. Register every route in access.py and isolation_cases.py, mirror permissions in frontend/backend policy.
2. Use Google OAuth authorization code flow with state, browser binding, PKCE, short expiry and one-use attempts. Validate granted scopes, offline credential and verified Google account identity; do not compare the Google address with `candidates.email`. Same-account reconnect preserves old credentials until successful replacement; replacing identity requires explicit disconnect.
3. Start with approved Gmail read-only scope. Email sending/replies, delete, labels and provider read changes are outside this plan. Frontend read state remains local to BenchQ.
4. Encrypt refresh credentials with authenticated encryption and a deployment-managed key. Never return/log tokens or put key material in the DB. Plan key rotation and reconnect behavior if decryption fails.
5. Persist durable per-mailbox sync state, connection generation, lease/epoch, cursor, bounded windows and retry/backoff. Provider requests run outside long-held DB transactions; revalidate generation/lease before persisting results.
6. Import the user-approved 3-day initial window. On disconnect, stop sync and remove credentials while retaining imported messages. Use Gmail history checkpoints for incremental sync; handle expired history checkpoints with a bounded 3-day rescan. Do not claim ext's scan-watermark implementation is Gmail History API synchronization.
7. Import messages idempotently through existing mailbox/provider-message uniqueness; parse MIME safely, bound body/page sizes, preserve timestamps, exclude approved folders and record unavailable/unparseable messages. Attachments/OCR are deferred.
8. Match only within the firm's candidate applications: exact application references and confirmed thread links first, then conservative company+role evidence. Ambiguous/unmatched messages stay visible without forced links. Use real BenchQ applications directly; no frontend snapshot registry as a second source of truth.
9. Connect inbox adapter/DTO/hooks/screens to APIs. Replace simulated consent/progress with real provider redirect and backend sync state. Add pagination, reconnect/backoff/empty/error/loading states and safe body display. Sync now must schedule work rather than only refetch mock messages.
10. Keep the global legacy monitor separate from candidate mailboxes; it must not read candidate OAuth credentials or write candidate application statuses. Schedule candidate sync in the existing single-process scheduler and avoid duplicate schedulers; coordinate execution topology with Uzair before deployment.
11. Remove the Inbox mock path after all Inbox/overview/activity consumers work live; expose message import and matching without requiring Decider to be available yet.

Proposed database changes: encrypted credential/key version, verified provider identity, connection generation/reconnect metadata, OAuth attempt table, durable sync lease/cursor/checkpoint state and retry/error metadata; message extraction/processing/matching metadata as required. Retain existing firm/candidate/application/mailbox FKs and deduplication. Separate migration PR(s) with real downgrade; never edit 0007.

Tests: OAuth state replay/expiry/wrong browser, PKCE/scopes, verified Google address stored even when it differs from the candidate profile email, encryption/no token leakage, connect/disconnect/reconnect races, tenant/role isolation, duplicate imports, pagination/checkpoint recovery, provider 401/429/5xx/timeouts, sync lease expiry and concurrent workers, reconnect during fetch, malformed MIME/XSS/body bounds, local read state, exact/ambiguous/unmatched matching and cross-candidate safety. Use mocked provider transports; live OAuth acceptance is separate and explicit.

Acceptance: approved user can connect candidate Gmail, sync/retry/reconnect/disconnect, read stored messages after reload, and see trustworthy match/unknown state. No simulated consent or Inbox mocks remain. Email-driven status mutations follow Module 3's classifier policy. Provider-mocked automated checks pass; live OAuth acceptance and owner review remain.

### Module 3 — Decider classification, automatic status updates and BDE resolution

Depends on: Modules 1–2 implementation. Owner: Samad; AI/deployment configuration reviewed with Abdul/Uzair. Implemented in the user-authorized combined change set; owner review and live acceptance remain.

Tasks:

1. Port the small backend Decider interface from LayaClassificationTest into a BenchQ-owned module; do not bring its evaluation DB/server or shared-key authentication. Model: perplexity/pplx-decider-v1.2, OpenRouter Decisions request shape; revalidate provider contract at implementation time.
2. Use the approved ten category definitions and move_on key. Version the categories, prompt, redaction and model adapter. Preserve the user's offer definition; document differences from the reference prompt requiring an explicit offer.
3. Redact sensitive subject/body fields before external inference and bound inputs. Treat email content as untrusted data. Do not send OAuth credentials, candidate profile dumps or unnecessary identifiers. Redaction is best effort; document what still leaves the system and obtain appropriate owner consent/configuration decisions.
4. Validate selected category, every category probability (finite 0..1), confidence/fallback and metadata. Persist raw validated scores, selected result, model/provider/request ID, versions, usage/latency and processing state; never persist API keys.
5. Run provider calls in bounded asynchronous worker execution outside DB locks. Persist pending work, handle timeout/rate limits/retry limits and interrupted workers; no regex fallback. Failed/unusable model responses must never imply a status; define retry exhaustion → review without fabricating a confidence.
6. Apply the user-approved decision rule: confidence <0.6 → BDE review, no automatic status mutation. At confidence >=0.6, automatically update the uniquely linked application only when freshness, revision and status-mapping safeguards pass. If an actionable category has no unique application match, route it to BDE review and leave all applications unchanged. Messages classified as `other` are retained in backend records but hidden from candidate-facing Inbox surfaces and excluded from application review.
7. Map the ten categories to their corresponding application statuses. The mapping includes other→OTHER as requested; confirm automatic OTHER transitions and handling of unrelated mail in section 8 before activation. Applied confirmation after later progress must use the approved stale/regression rule, not reset status blindly.
8. Validate current revision and email time against last status/manual decision, handle initial-import decisions under approved policy, and deduplicate by email/classification/command. Classification, linking, status event, ledger and review disposition must commit consistently.
9. Make one actionable Inbox “Needs BDE review” queue for low-confidence linked messages, actionable unmatched messages at any confidence, stale/conflicting high-confidence messages, and automatic-status-disabled cases. Hide `other`-classified messages from candidate-facing Inbox surfaces while retaining their backend records. Show queued emails' proposed category/status, confidence, match state and current confirmed status when one exists. Low-confidence linked applications also appear in the Applications BDE Review column while retaining their current status. Do not show status history in the application side panel. BDE may link an actionable unmatched message to an application and select/confirm the status in Inbox. Preserve original model output separately from human correction.
10. A human resolution records actual actor/time/reason and expected review/application revision. Stale resolution returns conflict; refresh instead of overwriting another user or classifier. Define superseding pending reviews when newer evidence arrives.
11. Enable import/classification and automatic updates with separate backend flags, default off until acceptance. Scope rollout to approved development firm/candidate; cost/rate/concurrency limits and safe error metrics precede broader activation.
12. Update Inbox/Applications contracts, filters, badges/review counts and activity to display all ten categories and corresponding statuses. Update connection copy that currently promises all changes need confirmation. Preserve manual corrections.

Database approach: reuse `EmailClassification.outcome='UNMATCHED'` and nullable `application_id` to derive the unmatched review queue if that is sufficient; reuse `ApplicationReview` for messages already linked to an application. Do not add a table or field just to duplicate queue membership. If resolving/dismissing an unmatched message needs a new durable disposition, define the smallest additive design first, update the data contract, claim a linear Alembic migration, and obtain Abdul's product/code-owner approval plus Samad's approval as owner of Inbox/application tables before changing schema.

Tests: all ten categories including move_on; malformed probability/category/JSON, optional confidence fallback and boundaries 0.5999/0.6/0.6001; retries/error exhaustion, secret redaction and injection text; no regex path; actionable unmatched messages at low and high confidence enter BDE review and never update a status; unmatched `other`/unclassified mail stays outside the review queue; unique linked high-confidence decisions update exactly one application; linked low-confidence decisions retain status; stale/conflicting decisions go to review; duplicate/replayed emails, older acknowledgments after progress, concurrent manual/model decisions, initial import, OTHER handling, failure atomicity, reviewer authority and audit; UI queue filtering and review conflict recovery. Mock provider in automated tests; live provider checks remain separate. Do not equate provider confidence with measured accuracy.

Acceptance: eligible >=0.6 decisions update exactly one fresh, uniquely linked application and create traceable backend records; <0.6 goes to review without changing status; BDE can resolve/correct and retain original evidence; provider failures do not lose mail or fabricate decisions; replay does not duplicate events. Focused provider-mocked checks pass. Live credentials/consent, owner review and controlled rollout remain.

### Module 4 — Full workflow acceptance and handover

Depends on: Modules 1–3 accepted. Owner: Samad; review with Abdul and Uzair.

Tasks:

1. Run full frontend and backend suites, migration head/model agreement, build, lint and typecheck; record exact commands/results, known expected failures and unresolved warnings.
2. Exercise existing development firm/candidate with authorized BDE plus Owner/Manager: Saved → manual Applied → imported mail → eligible classification/status → low-confidence review → human correction → reload/history.
3. Repeat with a second candidate and firm, Viewer and support view; prove all unauthorized reads/writes fail without data leakage.
4. Simulate worker restart, reconnect, revoked grant, model outage, stale email, duplicate delivery, concurrent user edits and migration rollout/rollback.
5. Verify board/list/detail/candidate/overview/activity consistency, derived counts, paginated data and queue resolution. Check light/dark, keyboard, small-screen and loading/empty/error/reconnect states.
6. Document operational commands, monitoring, alerts, token-key handling, retry/reprocess behavior, costs, disable switches and safe rollout/rollback. Legacy writers remain isolated.
7. Update module/team docs to match shipped behavior and tracker with evidence. Merge only after code-owner review. Do not mark the extension complete or begin it.

Acceptance: end-to-end and regression checks pass with recorded evidence; no unresolved critical isolation/history/data-loss defect; approved rollout and recovery instructions exist; user and owner acceptance are recorded separately from automated results.

## 6. Database design safeguards

- Preserve one application per candidate/job and existing IDs; all new candidate records carry firm_id/candidate_id with validated relationships. Individual FKs do not prove same-firm ownership: validate related rows together, with composite constraints where approved.
- Keep original model classification immutable and human override separate. Review state is not the application's status.
- Use unique command IDs, unique message import IDs and unique application-event cause IDs for retry safety; index pending work/reviews, candidate/date listings and FK lookups.
- Backfill revision/event history without inventing actors, application dates or proof of external submission. Nullable legacy actor remains explicitly unknown.
- Existing statuses RESPONSE, SCREENING, INTERVIEW, PLACED, REJECTED, WITHDRAWN and EXPIRED require reviewed migration/compatibility rules. `interview` alone does not prove scheduled; old SCREENING label currently says Shortlisted. Preserve old values/history until mapping is approved.
- Rollback after new statuses are written must not silently collapse them into old statuses. Define a safe rollback reader/compatibility path or block downgrade with actionable preconditions, while retaining a real reviewed downgrade procedure.
- Deleting/disconnecting a mailbox removes credentials and stops future work. Retention/deletion of imported content, classifications and history follows a separately approved rule; never cascade-delete application history as an incidental disconnect.

## 7. Test execution and progress evidence

Each implementation PR includes tests for its own behavior. Later modules do not postpone earlier test requirements.

- Frontend: pnpm typecheck, pnpm lint, pnpm test, pnpm build (supported Node version per .nvmrc).
- Backend: repository Postgres test setup and suite from docs/integration/README.md; start with focused module tests, then isolation/regressions/full suite before acceptance.
- Migration: one head, upgrade, reviewed downgrade, alembic check and existing model/migration agreement checks.
- Google/OpenRouter network calls are not part of deterministic CI. Provider adapters are mocked; live model/OAuth acceptance is clearly labeled with date, scope and authorization.
- A green check means a recorded actual run; test cases merely written are not evidence they pass.

## 8. Open decisions and implementation gates

Planning can finish with these listed; dependent implementation must wait for explicit decisions.

| ID | Question / proposed decision to review | Blocks |
|---|---|---|
| Q1 | Resolved 2026-10-31: Applications BDE review column; retain last confirmed status; BDE resolves through Inbox dropdown. | Decision recorded; implement foundation in Module 1 |
| Q2 | Resolved for Module 1: preserve legacy statuses/history as-is, display legacy labels where present, and do not guess a mapping into the new taxonomy. | No Module 1 block; revisit only if product requests conversion |
| Q3 | Resolved: an authorized Owner, Manager or currently assigned BDE may manually select any canonical status, including Applied → Saved; each move is auditable. Classifier categories map directly to the matching status; there is no enforced linear sequence. Older emails and later human changes cannot overwrite a newer effective state. | Implemented; see tracker checks |
| Q4 | Resolved by the user: every one of the ten Decider categories maps to its corresponding application status, including `other` → `OTHER`. Confidence <0.6 goes to BDE review; confidence >=0.6 automatically updates a uniquely matched, fresh application when policy checks pass. Actionable unmatched categories go to a visible BDE review queue. Messages classified as `other` are retained in backend records but hidden from candidate-facing Inbox surfaces and excluded from application review. Do not impose a mandatory stage sequence. | Verify the end-to-end decisions in Module 3 |
| Q5 | Updated by the user 2026-10-31: a BDE initiates OAuth on a specific candidate; whoever is authorized to access the selected Google account signs in and grants read-only consent. The verified Google address is stored for the candidate and does not need to match the candidate profile email. | Remove profile-email equality check; retain Google identity verification and firm/user/candidate scoping |
| Q6 | Updated 2026-10-31: import 3 days (replacing the earlier 90-day window); disconnect removes credentials/stops future sync while retaining imported messages; incremental sync uses Gmail history checkpoints. Poll interval and deployment execution topology are implementation settings to document and verify. | Module 2 sync/retention |
| Q7 | Resolved: Owner/Manager/BDE status actions follow their firm role and current candidate scope; general Applications list uses those same scopes. Review resolution is a human command and Inbox UI is Module 2. | No Module 1 block |
| Q8 | Implementation contract resolved: Gmail and Decider use separate credentials, separate feature gates, bounded retries and scheduler worker execution. Local migrations 0009–0010 are applied; the candidate mailbox has synced messages and a direct OpenRouter classifier call succeeded. Still required: worker persistence/status end-to-end acceptance, unmatched review queue, and Abdul/code-owner review before merge/deployment. | Live acceptance / rollout |
| Q9 | Resolved 2026-10-31: show a “Resume used” display field with the existing mock application/resume data for this UI phase. Status moves do not prompt for, select, persist, or otherwise depend on a resume. A real application-to-resume connection is deferred. | UI display only; no status-flow dependency |
| Q10 | Open: if the BDE reviews an unmatched email and confirms that it belongs to no application, what action closes it (for example, mark unrelated/Other or leave it unresolved)? Do not map it to an application status without an application link. Prefer deriving the queue from existing `UNMATCHED` results; request approval before adding a durable review disposition/schema if needed. | Final unmatched-review resolution and schema decision |

User-confirmed: threshold <0.6 review / >=0.6 eligible auto; each category corresponds to its application status; `other` maps to `OTHER`; no unique application match goes to BDE review with no status update; Saved is a separate Applications status; extension deferred; Applications then Inbox then Decider; tests per module. Statuses are not required to follow a fixed linear path. No need to ask these again. Open resolution detail: if the BDE determines an unmatched email is unrelated to every application, define how to close it without inventing an application status.

## 9. Tracker maintenance contract

Use EMAIL_APPLICATION_STATUS.md for this initiative; retain earlier STATUS.md as historical Saved/Applied evidence. Every implementation edit, including a one-line change, must be reflected in the tracker during that work session before reporting completion. Record module/subtask, exact files, purpose, checks actually run, result, blockers and next step. Do not mark a whole module complete because code exists; all acceptance criteria, required approvals and test evidence must be met. Document-only changes must be labeled as such.
