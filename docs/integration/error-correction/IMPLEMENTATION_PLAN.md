# Error correction implementation plan

Updated: 2026-10-31. Execution tracker: [STATUS.md](./STATUS.md).

## 1. Purpose and current position

Correct the eight findings in [PR_SAFETY_REVIEW.md](../PR_SAFETY_REVIEW.md), fix the reported Inbox reload when selecting an email, and implement the requested application-stage order, filled progress and conditional Incomplete application stage. Inspect and align frontend, backend and database behavior together.

The user approved creating this plan and its matching module/submodule checklist. This document records proposed implementation; creating it does not mean the corrections have been implemented. This planning pass changes documentation only. No application rows, schema, runtime behavior, branch history or PR state are changed.

The earlier [email/application implementation plan](../EMAIL_APPLICATION_IMPLEMENTATION_PLAN.md) and [status history](../EMAIL_APPLICATION_STATUS.md) retain their evidence. This correction plan is the next work breakdown for the unresolved findings and newly requested UI changes. Do not replace the older Jobs/Saved plan or its history.

### Confirmed baseline

- Latest verified main during the safety review: `55ebc4f9fa58ea4fa543249755e1092881db273b`. Review and full-suite checks used an isolated feature checkout based on that commit; the development working tree remains uncommitted. Fetch and recheck the base when implementation/PR preparation resumes.
- The complete pre-existing backend suite passed **3623 tests**, with **6 skipped**, **54 deselected live cases**, **13 existing xfails** and 6 warnings. That collection began before the new safety tests were added.
- The new backend safety file reproduces **8 failures**; the final frontend run reports **591 passed and 2 failed**, with both failures in the new live-category filter cases. These failures are open work, not completed fixes.
- TypeScript, full-project lint and the production build passed in the recorded safety check. The build has an existing CSS `::highlight` optimizer warning. These results must be rerun after corrections.
- The Inbox flash is reported by the user. Code inspection identifies a message-dependent Inbox query key and whole-Inbox loading skeleton as a likely cause; a focused browser/network reproduction is still required.
- The current drawer matches the supplied screenshot: progress uses recorded stage events and all connector lines remain grey. Its shared status array has the old display order.

## 2. Scope, invariants and ownership

Read `CLAUDE.md`, `CONTRIBUTING.md`, `docs/team/README.md`, `docs/team/samad.md` and the relevant integration contract before implementation. Samad owns Applications, interviews, favorites and candidate Inbox tables/routes. Coordinate shared ledger/auth changes with Abdul and runtime concerns with Uzair. Do not change `candidates` or another owner's tables without the required owner involvement.

- Keep firm and candidate access enforced in FastAPI through the existing policy and scope helpers. Viewer/support reads must remain read-only. A caller outside candidate scope receives the established not-found behavior.
- Keep status commands, history, revisions, favorites and ledger changes transactional. Never remove append-only history to make a deletion succeed.
- Preserve all supported legacy records and readable statuses. Do not relabel history to make it resemble the new UI order.
- Match a submitted application within the same firm/candidate before classifying. Fresh, unique, eligible classifications at confidence **>=0.6** update the corresponding status. Low-confidence, actionable unmatched and stale/policy-blocked cases enter BDE review. Unmatched Other remains excluded from application review.
- BDE review is a separate queue, not an extra application-status enum value. Clicking review must open the exact email, including an older email outside the latest page.
- Keep Google access read-only, initial import at three days, and disconnect retention of imported mail. Do not compare the verified Google address with a placeholder candidate profile email.
- Keep UI display order separate from status-transition permission. Reordering the display must not force every application through every stage.
- Use hooks → adapters → DTOs → existing FastAPI proxy. Use the route registry for navigation and firm-prefixed query keys. Read the installed Next.js guide before writing relevant Next.js code.
- Test with synthetic records, mocked providers and guarded `_test` databases. Do not use live mail or development application mutations as a shortcut to automated verification.
- New schema changes, if evidence shows they are needed, use a newly claimed additive Alembic revision with a real downgrade. Do not edit merged migrations or assume the next number is free. Required code-owner review remains before merge.

## 3. Database and status audit

### Verified development database, read-only on 2026-10-31

The actual database was inspected in a `BEGIN TRANSACTION READ ONLY` transaction. Only migration/schema metadata, check constraints and aggregate status counts were selected.

| Item | Observed result |
|---|---|
| Alembic version | `0010` |
| `applications.status` | Nullable `character varying` / `varchar`; not a PostgreSQL enum |
| CHECK constraints on `applications` | None returned by the catalog query |
| Revision support | `status_revision` integer, non-null |
| Freshness support | `status_effective_at` and `last_manual_change_at`, timezone-aware timestamps |
| Backend command vocabulary | Eleven canonical statuses: Saved plus the ten classification categories |
| Classification mapping | Ten categories, each mapped to the matching lowercase stored status |
| Current rows | 14 applications using seven distinct status values; counts below |

**Conclusion:** no new database status values need to be added merely to represent the ten categories. The text column can already store them, and the backend command service already lists them. A category with zero current rows is supported but unused. Do not create dummy applications or rewrite real application statuses to make every value appear.

The database does **not** itself enforce the canonical list through an enum/CHECK, and the status column is nullable. Any proposal to tighten those integrity rules must separately audit legacy/null values and all writers, document the contract, preserve valid old records and use an approved new migration if necessary. It is not required simply to change display order.

### Canonical vocabulary and requested display order

| Order | UI label | Frontend value | Backend/database value | Decider category | Observed rows |
|---|---|---|---|---|---:|
| 1 | Saved | `SAVED` | `saved` | None: saving is not a classification | 0 |
| 2 | Applied | `APPLIED` | `applied` | `applied` | 8 |
| 3 | Incomplete application — conditional | `INCOMPLETE_APPLICATION` | `incomplete_application` | `incomplete_application` | 1 |
| 4 | Screening call | `SCREENING_CALL` | `screening_call` | `screening_call` | 0 |
| 5 | Shortlisted | `SHORTLISTED` | `shortlisted` | `shortlisted` | 1 |
| 6 | Interview schedule request | `INTERVIEW_SCHEDULE_REQUEST` | `interview_schedule_request` | `interview_schedule_request` | 0 |
| 7 | Interview scheduled | `INTERVIEW_SCHEDULED` | `interview_scheduled` | `interview_scheduled` | 1 |
| 8 | Assessment | `ASSESSMENT` | `assessment` | `assessment` | 1 |
| 9 | Offer | `OFFER` | `offer` | `offer` | 1 |
| 10 | Move on | `MOVE_ON` | `move_on` | `move_on` | 0 |
| 11 | Other | `OTHER` | `other` | `other` | 1 |

Counts are an inspection snapshot, not expected totals or values to seed. Keep legacy aliases/readable statuses distinct from this new canonical list. Never infer a historical mapping from a label that happens to look similar.

## 4. Module map and finding traceability

Execute correctness/security work before UI presentation, then run the complete acceptance gate.

| Module | Area | Findings or request | Depends on |
|---|---|---|---|
| M0 | Baseline, contracts and database status audit | Database/status request and this plan/tracker | Inspection and agreed scope |
| M1 | Authorization and shared candidate scope | S1 OAuth bypass; S3 inline roles; R1 legacy-route access | M0 |
| M2 | Mailbox identity and audit | R4 identity replacement; S2 missing ledger events | M1 |
| M3 | Historical data and deletion protection | S4 backfilled-history deletion failure | M0; scope policy from M1 |
| M4 | Classification freshness and category filters | R2 delayed-email overwrite; R3 live filter mismatch | M0; preserve M1 scope |
| M5 | Stable email selection | Reported Inbox reload/flash | M1 and M4 contracts |
| M6 | Status order and progress | Requested order, filled stages and email-triggered Incomplete | M0, M4; stable Inbox from M5 |
| M7 | Verification and PR readiness | All corrections, database compatibility and remaining acceptance | M1–M6 |

### M0 — Baseline, contracts and database status audit

**Goal:** establish exactly what exists and which changes are necessary before implementing fixes.

1. **M0.1 — Record scope and review findings.** Retain all eight S/R findings, ten failing reproductions and the user's later UI requirements, distinguishing confirmed failures from the unmeasured Inbox-flash hypothesis.
2. **M0.2 — Inspect the actual database read-only.** Record migration, status-column type/nullability, relevant constraints and aggregate counts without exporting email content or changing rows.
3. **M0.3 — Align the status vocabulary on paper.** Compare backend accepted values, Decider mapping, frontend enums/DTOs and display order. Record ten classification categories plus Saved and retain legacy reads.
4. **M0.4 — Record the database-change decision.** State that all ten categories are representable already; no status-enum addition or row backfill is required for the requested ordering. Treat optional integrity hardening as a separate evidence-driven migration decision.
5. **M0.5 — Record invariants, ownership and acceptance boundaries.** Preserve confidence/review rules, immutable history, permissions, mailbox retention, main isolation and code-owner review.
6. **M0.6 — Create and validate the paired documents.** Ensure every implementation task has a matching status checkbox, evidence links resolve, and only verified investigation/documentation work is marked complete.

**Evidence:** read-only database result above; `tracking.STATUSES`, `decider_categories.CATEGORY_TO_STATUS`, frontend enum/DTO/status metadata; safety report and saved regression files.

**Done when:** the baseline and task mapping are verified and both documents agree. This completes planning/audit, not the product corrections.

### M1 — Authorization and shared candidate scope

**Problems:** OAuth completion bypasses current write restrictions; Inbox duplicates role policy; legacy interview/prep routes omit required action/candidate checks.

**Solution:** centralize candidate lookup and enforce current authorization at every write/read boundary, including the write-producing OAuth GET callback.

1. **M1.1 — Reuse central candidate scope.** Replace Inbox's explicit BDE/Manager branches with the established candidate lookup/scope helpers. Verify helper argument order, not-found behavior and locking needs; do not duplicate role rules elsewhere.
2. **M1.2 — Reauthorize OAuth completion.** Enforce current write permission, firm state, initiating identity and candidate visibility before provider exchange/credential storage. Recheck scope at the write boundary if assignment can change during the exchange. Denied requests must not store credentials, import mail or perform a forbidden mutation.
3. **M1.3 — Protect interview mutations.** Apply the proper action permission and owning application's candidate scope to create, update and delete. Keep Viewer/support unable to write, including direct HTTP calls.
4. **M1.4 — Protect prep and associated resume reads.** Check application/candidate visibility before assembling prep or choosing resume data; do not select another candidate's resume merely because the job matches. Preserve intentional legacy access through the shared policy.
5. **M1.5 — Update access and isolation coverage.** Keep route classification and F7 cases aligned; add same-firm assignment, reassignment, suspended-firm, Viewer, support-view and cross-firm cases where absent.
6. **M1.6 — Verify the authorization gate.** Make the saved OAuth, Viewer interview and unassigned-BDE prep regressions pass, and prove authorized users still succeed.

**Primary files:** `backend/api/routes_inbox.py`, `backend/api/routes_applications.py`, established auth/scoping helpers, `backend/tests/isolation_cases.py`, `backend/tests/test_pr_safety_regressions.py` and relevant application tests.

**Done when:** current permissions apply consistently, no new inline role branches remain, denied operations write nothing, and role/assignment/isolation checks pass.

### M2 — Mailbox identity and audit

**Problems:** a connected identity is silently overwritten, and successful human mailbox mutations are missing from the business ledger.

**Solution:** separate reconnect from account replacement and record auditable human actions atomically.

1. **M2.1 — Define reconnect/replace behavior.** Permit a successful same-account reconnect while preserving the old credential until replacement succeeds. Require an explicit disconnect before replacing a connected verified identity. Keep the placeholder candidate profile email out of identity validation.
2. **M2.2 — Enforce identity replacement protection.** Reject an unauthorized identity swap without changing the old address, credential, history checkpoint or imported messages. Preserve one-use OAuth state behavior and safe user-facing errors.
3. **M2.3 — Check retained account namespaces.** Audit provider-message deduplication and thread matching when a disconnected candidate later connects another account. Keep retained mail attributable to its original connection; do not assume identifiers from different accounts can safely share a namespace. If additional identity metadata is needed, document its contract and migration before implementing it.
4. **M2.4 — Add human mutation ledger events.** Record successful connect/reconnect, disconnect, manual sync, read-state changes and explicit retry with actual actor, firm, candidate and time through the existing ledger seam. Exclude credentials, subjects and bodies from audit summaries.
5. **M2.5 — Keep mutations and audit transactional.** Commit the change and ledger event together. Avoid duplicate events for replayed OAuth or unchanged read state. Audit failed/denied operations only through an established policy, never as successful writes.
6. **M2.6 — Verify mailbox safety and audit.** Make the identity-replacement and disconnect-ledger regressions pass; add same-account failure/success, retained-message, repeated-request and denied-action checks.

**Primary files:** Inbox routes, `backend/inbox/google_oauth.py`, `backend/inbox/gmail_sync.py`, existing ledger writer and candidate mailbox/message models only if justified, OAuth/sync/security tests.

**Done when:** reconnect is safe, replacing an active identity is refused, disconnect preserves imported mail, cross-account identifiers cannot silently mislink mail, and successful human operations have correct ledger evidence.

### M3 — Historical data and deletion protection

**Problem:** migration 0008 backfills immutable status events for legacy applications, but legacy delete endpoints attempt a child-FK update and raise a database error.

**Proposed safe behavior:** preserve protected history and return a deliberate conflict for historical records. Keep permitted deletion of unprotected legacy records. Apply the same rule to single and bulk deletion; do not cascade away audit history.

1. **M3.1 — Confirm the deletion contract.** Document the protected-record rule and compatibility response, including bulk atomicity, before changing endpoints. Coordinate any contract decision with the code owner; do not solve the failure by disabling the immutable trigger.
2. **M3.2 — Guard single deletion.** Check protected history/references before modifying the job or deleting the application. Return an intentional conflict instead of exposing a database exception. Keep existing candidate-application deletion protections.
3. **M3.3 — Guard bulk deletion.** Validate scope and protected records before mutation. For the proposed atomic-conflict behavior, a mixed protected/unprotected request must not leave partial deletions or a released job when the transaction is refused. Preserve the agreed response contract.
4. **M3.4 — Exercise real backfill data.** Test legacy rows upgraded from the pre-tracker schema, including original JSON, status events, interviews and relevant references. Do not rely only on rows created after the migration.
5. **M3.5 — Verify preservation and rollback.** Make the saved historical-delete regression pass; prove history remains unchanged after refusals, valid unprotected deletion still works, and no trigger/foreign-key protection was relaxed.

**Primary files:** Applications delete/bulk routes, tracking helpers and relationships only if necessary, `test_pr_safety_regressions.py`, application bulk tests and `test_inbox_application_migrations.py`.

**Done when:** single/bulk deletion has defined behavior, protected history survives, and no expected operation ends in an unhandled integrity error.

### M4 — Classification freshness and category filters

**Problems:** a newer same-status email does not advance freshness protection; Inbox Calls/Not selected filters compare obsolete names with new live category values.

1. **M4.1 — Advance freshness for accepted no-change decisions.** Under the existing application lock, preserve the newest accepted effective email timestamp even if the category confirms the current status. Do not claim a new manual decision or fabricate a status transition.
2. **M4.2 — Preserve stale/manual precedence.** An older conflicting email must leave the current status unchanged and enter the required BDE review path. Keep later human decisions, exact threshold behavior, mapping and concurrency/idempotency safeguards.
3. **M4.3 — Align live filter vocabulary.** Map Calls to `SCREENING_CALL` and Not selected to `MOVE_ON`, retaining only intentional legacy aliases. Check remaining category/filter combinations against the canonical mapping, including Assessment/Shortlisted behavior.
4. **M4.4 — Keep counts and rows consistent.** Derive each filter's count and membership from the same predicate. Keep unrelated unmatched Other excluded from application review while linked genuine reviews remain available.
5. **M4.5 — Verify status and filter regressions.** Make the delayed-email freshness case and both UI filter cases pass. Cover same-status/newer/older ordering, manual overrides, all ten categories at 0.6, low-confidence review, unknown responses and unchanged automatic-result controls.
6. **M4.6 — Verify atomic downstream effects.** Recheck classification/link/status-event/review/favorite persistence and the agreed ledger contract. Automatic actions must not impersonate a human submitter; coordinate any required SYSTEM/AGENT ledger seam with its owner.

**Primary files:** `classification_worker.py`, category metadata, Inbox filter/signal metadata, DTOs if needed, saved safety/filter cases and matching/immediate-classification tests.

**Done when:** delayed mail cannot overwrite newer accepted evidence, review behavior is correct, and live category filters show the correct emails and counts.

### M5 — Stable email selection without an Inbox reload

**Reported symptom:** opening a new email flashes/reloads the Inbox. **Code evidence:** selected message ID changes the entire Inbox query key; the Inbox renders a whole-pane skeleton for a cold query, and decision-signature changes can refresh unrelated caches. Confirm the exact runtime path before applying a fix.

1. **M5.1 — Build a focused reproduction.** Use synthetic loaded messages and an older unloaded message. Capture request counts, list/reader mounts, loading placeholders and selection/scroll behavior. Verify the reported flash rather than merely checking that rendering succeeds.
2. **M5.2 — Stabilize the candidate Inbox cache.** Keep the Inbox collection keyed by firm/candidate, with selection separate from collection identity. Selecting an already-loaded email must not request the whole Inbox again.
3. **M5.3 — Preserve exact deep links and missing-message loading.** Keep URL selection and Back/Forward behavior. Fetch/merge an older missing message without replacing the existing list. Reuse the scoped API where appropriate; register and isolate any new endpoint if one is actually required.
4. **M5.4 — Narrow updates and invalidation.** Update the selected read flag with appropriate failure rollback. Refresh applications/jobs/review queues after real classification/review changes, not merely because the user selected another email or a cold query temporarily produced no decisions.
5. **M5.5 — Preserve reader/list state correctly.** Retain list scroll/filter state, stable header/layout and keyboard navigation. Keep review application/status selections bound to their own message; never carry one email's decision into another. Avoid a filter silently opening a different email from an explicit review link.
6. **M5.6 — Verify interaction behavior.** Test cached selection, missing older links, rapid selection, Back/Forward, processing polling, read failure and completed review refresh. Assert that unrelated list content does not unmount or flash while the reader changes.

**Primary files:** candidate detail page, `use-candidate-workspace.ts`, `use-inbox.ts`, Inbox adapter/query keys, Inbox tab/reader and focused browser/hook tests.

**Done when:** only the necessary reader/read state changes on a cached selection, older review links stay exact, and classification/review updates still refresh persisted application state.

### M6 — Requested status order, filled progress and conditional Incomplete

**User requirements:** use the order in section 3, fill progress through the current stage, and show Incomplete application when a relevant email arrives.

1. **M6.1 — Centralize the requested display order.** Update shared status metadata and consume it consistently in candidate/global boards, drawer progress and relevant selectors. Preserve readable legacy statuses without rewriting their stored values.
2. **M6.2 — Define optional-stage evidence.** Derive Incomplete visibility per application from relevant linked email/classification evidence and confirmed history. An unmatched email remains in BDE review and must not attach an Incomplete stage to an unrelated application. Keep existing current/historical Incomplete records readable when original mail is unavailable.
3. **M6.3 — Implement conditional visibility.** Hide the optional Incomplete step when there is no relevant evidence. Show the corresponding board column when a visible application needs it. A low-confidence email may expose relevant evidence but must not move/fill the confirmed current status before review. Keep the backend vocabulary intact when the UI hides a stage.
4. **M6.4 — Fill the main progress path.** Fill earlier main-path positions and connectors through the current confirmed stage; emphasize the current marker and mute upcoming positions. At Shortlisted, the normal visible path shows Saved → Applied → Screening call → Shortlisted filled. This is a position indicator, not invented history.
5. **M6.5 — Handle outcomes and reversals.** Move on and Other are outcomes, not proof of successful interviews or offers. Use the most recent reliable confirmed main-path state before an outcome; do not use the highest stage ever seen. A manual reversal updates the visual current position while retaining real history.
6. **M6.6 — Preserve dates and BDE review.** Show dates only for recorded events. Do not generate stage events/timestamps to fill the graphic. Retain BDE review as a separate queue with current confirmed status and exact click-to-email navigation.
7. **M6.7 — Verify the presentation.** Test exact order, conditional visibility, Shortlisted fill, early rejection without a filled Offer, Other without reliable prior progress, Saved reversal, legacy reads and pending review. Check keyboard access, reduced motion, both themes and desktop/mobile widths.

**Primary files:** shared application status metadata, board, drawer/list/detail presentation, candidate Inbox evidence selectors and UI tests. A derived API summary may be needed for older evidence outside the Inbox page; document it in the contract/DTO before implementation rather than storing a redundant boolean or relying on only the latest messages.

**Done when:** the UI matches the requested order and screenshot-related behavior without changing application data just for presentation or misrepresenting rejected/unknown outcomes.

### M7 — Complete verification and PR readiness

1. **M7.1 — Run all new regressions together.** Include the eight saved backend cases and two saved UI cases; none may be hidden with xfail or omitted from the reported full collection.
2. **M7.2 — Run full backend and database checks.** Use Postgres `_test` databases with real provider credentials removed and `live` tests excluded. Include F7, same-firm assignment tests, migration heads, upgrade/downgrade/backfill tests and model/migration agreement. Manage test-only storage safely if repeated truncation needs checkpoints.
3. **M7.3 — Run the complete frontend gates.** Run typecheck, full ESLint, all Vitest files and a production build using the intended CI environment. Separate transient infrastructure/resource failures from reproducible product defects without weakening tests.
4. **M7.4 — Perform browser acceptance.** Verify Inbox selection/deep links, read/review behavior and stage UI with synthetic data, keyboard operation, 1440px/1024px/390px layouts, light/dark themes, reduced motion and accessibility checks. Check skeleton, empty, error and not-found states.
5. **M7.5 — Verify status/database alignment after fixes.** Confirm all eleven canonical values round-trip through authorized APIs and persistence in disposable tests. Recheck actual database metadata read-only if any migration is proposed. Preserve legacy rows and do not seed statuses into real records to satisfy the audit.
6. **M7.6 — Complete operational acceptance.** Record feature flags, provider/config prerequisites, single-worker scheduler restriction, retry recovery and bounded processing. Run only separately authorized live provider/mailbox checks; do not mistake mocked acceptance for live acceptance.
7. **M7.7 — Re-review and assemble the complete proposal.** Recheck the eight findings, all touched writers/tenancy boundaries, secrets and latest-main compatibility. Include necessary untracked runtime modules, DTOs, migrations and tests; keep unrelated theme/demo work separate. Do not commit, push or open a PR merely because checks ran.
8. **M7.8 — Record results and obtain merge review.** Update this plan's scope if necessary and tick the tracker only with actual evidence. Present remaining risks, migration/rollback notes and the previously authorized combined change-set exception. Required code-owner approval remains before merging.

**Done when:** the complete proposed change set passes the agreed gates, new safety regressions are green, manual/operational acceptance is accurately recorded, and remaining approval requirements are explicit. Passing an older collection alone is insufficient.

## 5. Verification commands and evidence rules

Use the repository's declared package manager and CI commands, or their direct installed binary equivalents when the launcher itself is the infrastructure problem:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
docker compose exec -T backend python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live" -p no:cacheprovider
```

Ensure pytest is pointed at a guarded test database and lifecycle/providers are mocked before running. An isolated latest-main checkout can be mounted into a one-off backend test container; keep it separate from the running development service. Never run destructive test fixture setup against the actual application database.

For every completed task record the date, changed files, commands, pass/fail/skips and remaining limits in [STATUS.md](./STATUS.md). A code edit, passing narrow test, document update or static hypothesis alone does not complete a module's acceptance gate. Re-run relevant checks after fixes; broader repeats require changed code, a failure or a genuine unresolved concern.

## 6. Deliverable boundary

This pass delivers the detailed correction plan and its checkbox tracker, including the verified database baseline. Product corrections are future work tracked below. Main remains untouched; no application/database updates are performed just to create these documents.


## Implementation decisions and evidence (2026-11-01)

User authorized execution with “start”. M1–M4 now have focused passing verification; see the paired tracker for exact counts. M2 required new revision 0011 for `InboxMessage.source_address` and account-scoped uniqueness/thread reuse. It adds no application statuses and changes no application status values. Existing pre-fix rows are attributed to their current mailbox address; this is reconstructible only where no unaudited historical account replacement already occurred. Before production migration, confirm that precondition or investigate original-account attribution separately: the old schema cannot reconstruct an account identity that was previously overwritten. New imports retain explicit account provenance and disconnect/reconnect no longer discards it. Downgrade refuses to collapse distinct account provenance or duplicate provider IDs.

M3 implements the proposed protected-history 409 response and validates the entire bulk batch before mutation. M4 introduces the existing-contract AGENT ledger seam with no human actor identity. M5 performs one initial persisted-decision freshness check, then refreshes applications only as decisions change; cached selection and local read state do not refresh application data. M6 shares the requested order and evidence policy across the board, drawer and status selectors. Historical/current Incomplete remains readable; low-confidence evidence stays in review until human confirmation. Drawer focus is contained while open and returned to its opener on Escape/close.

The proposal is tested in the isolated checkout `/tmp/benchq-inbox-pr`, now based on current main `1c6925f1edeab7de463046c0a949597ca5fe1bac`. Main's new rate-limit, retry and session behavior is preserved. The user's existing dirty branch and unrelated dependency patch remain separate. Code-owner approval remains required before any merge; this correction session does not authorize commit, push, PR creation or merge.
