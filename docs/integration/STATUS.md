# Candidate Jobs → Saved workflow status

**Last updated:** 2026-10-30
**Overall state:** [/] In Progress — The user confirmed both status directions, favorite/feed behavior, and reload persistence. The read-only database check confirms actor, submitter, applied timestamp, status history, and ledger activity. Frontend tests and the selected backend application/Saved ↔ Applied/isolation suites pass; owner/code-owner review remains open.
**Goal and module definitions:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

## Status key

- **Not Started** — no work has been done on this subtask.
- **[/] In Progress** — work has started but its completion criteria are not yet met.
- **Completed** — the stated work is complete and evidence is recorded below.
- **[!] Blocked** — work cannot proceed until its listed blocker changes.
- **[-] Deferred** — intentionally moved outside the current scope or to a later module.

## Current position

- **Current module:** Inbox D8 — design draft prepared for product-owner agreement; implementation has not started. The Jobs → Saved → Applied checks deferred by the user remain deferred.
- **Implementation modules complete:** 4 of 5 (Modules 1–4 implementation complete; Module 5 is verification and remains user-owned).
- **Applied slice progress:** Implementation and manual workflow verification are complete. Frontend tests and the selected backend application, Saved ↔ Applied, and isolation suites pass. Typecheck/lint and owner/code-owner review remain open.
- **Product/code changes:** Added a guarded, dry-run-first seed command for the approved demo target.
- **Database data changes:** The seed command added four synthetic jobs and four firm/candidate links to the three existing demo jobs, bringing the intended total to seven. No favorites or applications were created by seeding. Final table-count verification is left to the user.
- **UI changes:** Candidate Jobs and Applications/Saved now read through live candidate-scoped adapters; heart/unheart is wired to the backend with optimistic rollback.
- **Verification:** Frontend: `./node_modules/.bin/vitest run --reporter=verbose` passed (42 files, 546 tests). Backend: the selected application, Saved ↔ Applied, and full isolation suites passed (225 passed, 3 xfailed). The earlier `HTTPException` scoping failures no longer reproduce after removing the two local imports. Typecheck and lint have not been run; the backend deprecation warning is from Starlette's `httpx` TestClient integration.
- **Applied slice:** The user confirmed Saved → Applied and Applied → Saved, favorite clearing/restoration, feed hiding/restoration, and persistence after reload. A read-only database query confirmed the current Applied Senior DevOps Engineer (Demo) row has `applied_at`, Pan in `submitted_by_user_id`, actor IDs/timestamps in `status_transitions`, and matching application UPDATE ledger activity. The audit also contains Manager Sam's Saved ↔ Applied transitions. All ten email/application statuses are available in the candidate board and side-panel selector; active cards can move directly between canonical status columns. Cards pending BDE review remain locked in that queue until resolved from Inbox. The side panel now has a Progress timeline using these canonical application states; when moving to Applied, the BDE chooses the tailored resume to associate. Resume association and UI checks are pending.

## Module tracker and subtasks

### Module 0 — Ownership, contract, and safe target

**Status:** [/] In Progress

- **Completed** — Confirm Adna is in Adnan's firm and assigned BDE Pan using a read-only Adminer lookup.
- **Completed** — Record that BDE Pan will sign in and view the Jobs page for candidate Adna.
- **Completed** — Record the user priority: Jobs → Saved work comes before Inbox.
- **Completed** — Confirm migration 0007 is applied in the local `jobnavigator` database.
- **Not Started** — Confirm the backend URL/proxy, active module flags, and intended database without exposing secrets.
- **Not Started** — Reconfirm Adna's firm and Pan's assignment immediately before any future database seed.
- **Not Started** — Confirm candidate feed/favorite permissions for Owner, Manager, BDE, Viewer, and cross-firm access.
- **Completed** — Formalize the Saved application contract, including null submission time/submitter and optional resume.
- **Completed** — Record the user's untouched-Saved-draft rule for unheart, preserving work and history.
- **Not Started** — Coordinate the Samad-owned favorites/application work and shared contract approvals before coding.

**Evidence:** The candidate and BDE association were viewed read-only in Adminer. The user's workflow decisions are recorded in the implementation plan. No database rows were changed.

### Module 1 — Seed demo jobs and candidate links in PostgreSQL

**Status:** Completed (implementation; expanded table readback left to user verification)

- **Completed** — Add a separate seed command with a read-only preview by default, explicit `--apply`, production/environment guard, and no reset option.
- **Completed** — Define seven clearly labeled synthetic demo jobs with inert `.invalid` URLs.
- **Completed** — Run the read-only preview in the backend container and confirm the existing Adna/Pan/firm target.
- **Completed** — Add/reuse canonical job records in `jobs` without creating a candidate record; this turn added four jobs.
- **Completed** — Link each job to Adnan's firm in `firm_jobs`; this turn added four links.
- **Completed** — Link each job to candidate Adna in `candidate_jobs`; this turn added four links.
- **Completed** — Rerun the seed; it added zero duplicates and touched only its fixture links.
- **Completed** — Confirm seeding created no `favorite_jobs` records.
- **Not Started (user verification)** — Read back the expanded seven-job set and verify all new firm/candidate links.

**Depends on:** Module 0.

### Module 2 — Candidate-scoped feed API

**Status:** Completed (implementation; expanded-feed and isolation checks left to user verification)

- **Completed** — Extend existing `GET /api/jobs` with optional `candidate_id`, preserving its firm-scoped route and pagination.
- **Completed** — Filter through `candidate_jobs` and intersect with the existing `firm_jobs` visibility scope.
- **Completed** — Resolve candidate visibility through the existing candidate helper, enforcing firm, manager, and BDE scope.
- **Completed** — Preserve the existing stable sort, pagination, totals, and canonical job IDs.
- **Completed** — Include candidate favorite IDs in the response when a candidate filter is requested.
- **[-] Deferred** — Add automated isolation tests; user will perform verification in this pass.
- **Completed** — Earlier feed check confirmed Pan received the original three seeded jobs for Adna and an empty favorite-ID list.
- **Not Started (user verification)** — Confirm the expanded feed exposes all seven jobs and preserves favorite IDs.
- **Not Started** — Verify unauthorized candidate and firm scopes are refused.

**Depends on:** Modules 0–1.

### Module 3 — Favorite and Saved application backend

**Status:** Completed (implementation; transaction and unheart edge-case checks left to user verification)

- **Completed** — Implement candidate-scoped save/unfavorite behavior through the existing application create/update routes, avoiding new endpoint paths.
- **Completed** — Derive firm and actor from session context; check candidate visibility and BDE/manager/owner action permission.
- **Completed** — On a candidate save action, verify job and candidate-job visibility, then commit the favorite plus Saved application in one transaction.
- **Completed** — Store the canonical `jobs.id` in both `favorite_jobs` and `applications`.
- **Completed** — Lock the candidate row and use existing unique constraints so repeat and concurrent heart operations converge on one record.
- **Completed** — Re-hearting preserves an existing application's status and work fields.
- **Completed** — Unheart removes the favorite and only deletes a Saved draft that has no notes, resume, next action, email, interview, or subsequent status history.
- **Completed** — Saved drafts have null submitter and `applied_at`; save/remove actions are recorded through the existing ledger writer.
- **Completed** — Return stable application/favorite state for UI reconciliation.
- **[/] In Progress** — Verify transaction persistence and the saved row/application pair in PostgreSQL; the heart action produced a favorite row, the candidate Saved tab rendered the application, and both remained after reopening the workspace. Unfavorite, rollback, and progress-preservation are pending.

**Depends on:** Modules 0–2 and table-owner coordination.

### Module 4 — Connect the 3000 Jobs and Saved UI

**Status:** Completed (implementation; user will verify the final 3001 comparison)

- **Completed** — Add DTO schemas and mapping for backend jobs and companies, including candidate-feed response metadata.
- **Completed** — Add a paginated candidate-specific live adapter that reads through `http.ts` and does not fall back to mocks.
- **Completed** — Extend the existing Applications list with an optional candidate filter guarded by the same candidate visibility helper.
- **Completed** — Add an Applications DTO mapper and make the frontend submitter field nullable for unsent Saved drafts.
- **Completed** — Update the candidate workspace hooks to use firm+candidate query keys and live candidate Jobs/Applications adapters.
- **Completed** — Read candidate Jobs, favorite IDs, and Applications/Saved from PostgreSQL through the backend APIs.
- **Completed** — Wire the heart to save/unfavorite APIs and optimistically update both favorite IDs and Saved drafts with rollback.
- **Completed** — In candidate context, make “Tailor & apply” and source/original URL clicks ensure the job is Saved before opening the external posting; this does not mark Applied.
- **Completed** — Keep a hearted Saved job visible in the feed; the existing job-row click continues to select/preview only.
- **Completed** — Default the candidate-specific feed to “Any score” so seeded jobs are visible immediately; retain the existing 70+ default on the general Jobs flow.
- **Completed** — Saved remains excluded from submitted-application stats by the existing derived-stat rule.
- **Completed** — Show backend save errors and restore both cached views when a save/unfavorite request fails.
- **Completed** — Keep later-stage moves disabled in the candidate Applications board until the Applied/status workflow is implemented; show this scope in the UI.
- **Completed** — Route the candidate workspace Jobs, favorite IDs, and Saved Applications through live adapters with no mock fallback in those paths.
- **Not Started (user verification)** — Compare the resulting Jobs/Saved interactions with the approved 3001 reference.

**Depends on:** Modules 2–3.

### Module 5 — End-to-end verification and mock retirement

**Status:** [/] In Progress — implementation for this slice is complete; the user will perform the remaining checks.

- **Not Started (user verification)** — Verify seed idempotence, seven feed associations, and pagination.
- **Not Started (user verification)** — Verify heart → `favorite_jobs` + Saved application → refresh persistence.
- **Not Started (user verification)** — Verify Apply/source URL clicks save before navigation, and a failed save does not open the employer page.
- **Not Started (user verification)** — Verify repeated/concurrent heart requests do not create duplicates or partial writes.
- **Not Started (user verification)** — Verify unheart removes an untouched draft but preserves work/progress/history.
- **Not Started (user verification)** — Verify candidate and firm isolation, including BDE Pan viewing Adna's jobs.
- **Not Started (user verification)** — Verify frontend/backend failure states do not show false saved success.
- **Not Started (user verification)** — Verify Saved does not affect Applied counts and hearted jobs remain in the feed.
- **Not Started (user verification)** — Run the approved frontend/backend and database isolation checks on the disposable test database.
- **Not Started (user verification)** — Record exact results and rollback/configuration notes; only this slice's candidate Jobs/Saved paths should use the live APIs.

**Depends on:** Modules 1–4.

### Module 6 — Candidate Saved → Applied

**Status:** [/] In Progress — implementation is in place; runtime verification and owner review remain pending.

**Goal:** Any firm user allowed by the existing `application.move` policy (OWNER, MANAGER, or BDE) can move an application between Saved and Applied. The backend records each status change and actor/time; Applied sets `applied_at` and, for now, `submitted_by_user_id` to the authenticated actor, removes the favorite, and hides the job from that candidate's feed. Returning to Saved clears the current applied fields, restores favorite/feed visibility, and preserves prior history. Other statuses remain out of scope.

#### Phase 6.1 — Ownership and behavior decisions

- [ ] **TASK-6.1.1: Coordinate route ownership**
  - Files: `docs/team/README.md`, `docs/team/samad.md`, `docs/team/zuhair.md`, `CONTRIBUTING.md`.
  - Dependencies: none.
  - Implementation details: obtain Samad's coordination for the Applications/favorite transition and Zuhair's coordination only for the Applied/Saved filter in the existing candidate feed endpoint. Modules 1–2 already seed jobs and provide the candidate-scoped feed; do not repeat that work. Follow Abdul's route/code-owner review requirement; do not alter database schema without product-owner approval.
  - Verification: record owner/reviewer agreement here before code work.
  - Acceptance criteria: both route owners are coordinated and review gates are identified.
  - Status: NOT STARTED.
- [x] **TASK-6.1.2: Decide submitter field semantics**
  - Files: `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/02-DATA-CONTRACTS.md` only if the contract needs a product-approved change.
  - Dependencies: TASK-6.1.1.
  - Implementation details: resolved that the actor is whichever authorized firm user moves the status, derived from the authenticated session; existing policy permits OWNER, MANAGER, and BDE. Pan is only an example. For now, set that actor ID in `submitted_by_user_id` too; revisit the field's meaning in a future phase.
  - Verification: user's product decision recorded in the plan and tracker.
  - Acceptance criteria: actor attribution is session-derived and the initial `submitted_by_user_id` behavior is explicit; no unapproved contract/schema change.
  - Status: Completed.
- [x] **TASK-6.1.3: Decide whether Applied can be undone**
  - Files: `docs/integration/IMPLEMENTATION_PLAN.md`.
  - Dependencies: none.
  - Implementation details: resolved: support Applied → Saved as a new transition; restore favorite/feed, clear current applied fields, and preserve prior history.
  - Verification: user decision recorded in plan and tracker.
  - Acceptance criteria: UI and API support exactly Saved ↔ Applied.
  - Status: Completed.

#### Phase 6.2 — Backend atomic transition and feed filtering

- [x] **TASK-6.2.1: Persist Saved ↔ Applied atomically**
  - Files: `backend/api/routes_applications.py`, `backend/models/db.py` only if the existing helper needs a compatible extension, `backend/tests/` relevant route tests.
  - Dependencies: TASK-6.1.1–6.1.3.
  - Implementation details: authorize the signed-in actor and candidate; allow only Saved ↔ Applied for this path. Applied sets server `applied_at` and current `submitted_by_user_id`, appends history, deletes the favorite, and writes an actor/time/candidate ledger record. Saved clears current applied fields, appends history, recreates the favorite for the actor, and writes the ledger record. Commit/rollback together and preserve idempotency.
  - Verification: API/database tests cover both directions, correct fields, duplicate/retry behavior, missing favorite, invalid source state, and rollback after a simulated failure.
  - Acceptance criteria: no partial status/favorite/ledger state; no migration unless code inspection proves the existing schema insufficient and Abdul approves.
  - Status: IMPLEMENTED; verification pending.
- [x] **TASK-6.2.2: Filter candidate Jobs feed by application status**
  - Files: `backend/api/routes_jobs.py`, `backend/tests/` candidate job feed/isolation tests.
  - Dependencies: TASK-6.2.1.
  - Implementation details: exclude Applied jobs for the requested candidate and return them to the feed when moved back to Saved; scope filtering to that firm and candidate. The job must remain visible to other candidates with their own links.
  - Verification: API/database tests for both transitions and an unrelated candidate/firm with the same shared job.
  - Acceptance criteria: Applied job and favorite ID are absent from that candidate's feed; Saved job and favorite ID return after reverse move; unrelated visibility is unchanged.
  - Status: IMPLEMENTED; verification pending.
- [x] **TASK-6.2.3: Preserve backend error and permission behavior**
  - Files: `backend/api/routes_applications.py`, `backend/tests/isolation_cases.py`, relevant `backend/tests/`.
  - Dependencies: TASK-6.2.1.
  - Implementation details: ensure Viewer, unauthorized candidate, cross-firm request, and non-Saved application cannot use this move; do not silently coerce unsupported statuses.
  - Verification: API authorization/isolation cases.
  - Acceptance criteria: unauthorized/invalid requests are refused without modifying application, favorite, ledger, or feed state.
  - Status: IMPLEMENTED; verification pending.

#### Phase 6.3 — Live frontend mutation and restricted board interaction

- [x] **TASK-6.3.1: Replace the candidate board's mock status mutation**
  - Files: `src/lib/api/applications.ts`, `src/lib/api/dto/applications.ts`, `src/lib/hooks/use-applications.ts`.
  - Dependencies: TASK-6.2.1.
  - Implementation details: PATCH the existing backend endpoint via `http.ts`, parse/map the backend response, and remove the mock mutation path for this candidate workflow. Do not remove unrelated follow-up or other module mocks.
  - Verification: adapter tests for supported/unsupported targets, response mapping, and API errors.
  - Acceptance criteria: candidate status changes call the backend; no mock success or silent fallback is possible.
  - Status: IMPLEMENTED; verification pending.
- [x] **TASK-6.3.2: Enable only Saved ↔ Applied**
  - Files: `src/components/app/applications/application-board.tsx`, `src/components/app/candidate/applications/applications-tab.tsx`.
  - Dependencies: TASK-6.3.1.
  - Implementation details: constrain allowed transitions specifically for the candidate board; do not set shared `canMove` in a way that enables Applied → later stages.
  - Verification: component tests or focused UI check for allowed and refused drags, including keyboard drag support.
  - Acceptance criteria: Saved can be moved to Applied and Applied back to Saved; all other status moves remain blocked.
  - Status: IMPLEMENTED; verification pending.
- [x] **TASK-6.3.3: Reconcile optimistic Applications, favorite, and Jobs state**
  - Files: `src/lib/hooks/use-applications.ts`, relevant candidate favorite/jobs hooks and query keys, `src/app/[firm]/(app)/(workspace)/candidates/[id]/page.tsx` if mutation wiring requires it.
  - Dependencies: TASK-6.3.1–6.3.2.
  - Implementation details: optimistically synchronize status, applied fields, favorite IDs, and candidate Jobs cache in both directions; restore all affected caches on failure; invalidate/refetch the three views after success.
  - Verification: tests for rollback and invalidation, then manual reload check.
  - Acceptance criteria: Applied removes the favorite/feed row; Saved restores them; on failure the prior card, heart, and feed state return with an error shown.
  - Status: IMPLEMENTED; verification pending.

#### Phase 6.4 — Verification and review

- [ ] **TASK-6.4.1: Verify backend transaction and isolation**
  - Files: tests under `backend/tests/`; no production database writes.
  - Dependencies: TASK-6.2.1–6.2.3.
  - Implementation details: run relevant backend tests against the approved disposable test database and capture exact results.
  - Verification: both-direction transaction rollback, correct actor/time, applied fields, favorite add/remove, feed hide/restore, permissions, and unrelated candidate visibility.
  - Acceptance criteria: all relevant API/database tests pass; exact command/result recorded.
  - Status: [/] IN PROGRESS — Read-only database inspection confirmed the current Applied row's applied date, Pan submitter, transition actor/time, matching ledger events, and Manager Sam's recorded moves. Four focused Saved ↔ Applied tests and the full selected application/isolation suite pass (225 passed, 3 xfailed). A failure-injection test for rollback remains unimplemented; typecheck/lint and owner review remain pending.
- [ ] **TASK-6.4.2: Verify frontend behavior and owner review**
  - Files: frontend tests/UI; implementation diff and this tracker.
  - Dependencies: TASK-6.3.1–6.3.3.
  - Implementation details: use Pan/Adna as the demo example. The user confirmed Saved → Applied, Applied → Saved, favorite clear/restore, feed hide/restore, reload persistence, and that Owner and Manager can move status in either direction. Automated checks now cover Owner/Manager moves and Viewer refusal. Owner/code-owner review remains pending.
  - Verification: frontend Vitest suite passed (42 files, 546 tests); backend application/Saved ↔ Applied/isolation suites passed (225 passed, 3 xfailed). Typecheck/lint remain unrun; owner/code-owner review remains pending.
  - Acceptance criteria: UI/API/database state agree after refresh; review gates are met; no other workflow is changed.
  - Status: [/] IN PROGRESS — manual workflow checks are user-confirmed; frontend and selected backend suites pass, typecheck/lint and owner/code-owner review remain pending.

**Depends on:** existing Modules 2–4 and completion of their remaining user verification where it affects the candidate feed. Backend changes require coordination with Samad and Zuhair; route review follows Abdul's code-owner requirement. No schema change is currently planned.

**Open decisions / blockers:**

- **RESOLVED:** Record whichever authorized firm user moves the status, using their authenticated session ID; existing policy allows OWNER, MANAGER, and BDE. Pan is only an example.
- **RESOLVED FOR NOW:** Set `submitted_by_user_id` to the authenticated user who moves the application to Applied; revisit this meaning in a future phase.
- **RESOLVED:** A BDE may move Applied back to Saved; preserve history and restore favorite/feed state.
- **OWNER REVIEW PENDING:** Samad owns Applications/favorite routes; Zuhair owns the candidate Jobs feed route; Abdul reviews route/contract changes. The user authorized implementation; obtain owner/code-owner review before merge.

## Deferred work

## Deferred work

- **[/] In Progress** — Inbox D8 design review; implementation is gated on product-owner agreement with `docs/team/samad.md` §1.0.
- **[-] Deferred** — Browser extension and application submission capture.
- **[-] Deferred** — Statuses after Applied and email-derived status suggestions until the product owner approves the D3 status set and whether email changes are suggestions or automatic.
- **[-] Deferred** — Live job scraping, owned by the teammate responsible for that module.

## Change and evidence log

| 2026-10-31 | Theme compatibility bug fix | `package.json`, `pnpm-lock.yaml`, `patches/next-themes@0.4.6.patch`, `docs/integration/STATUS.md` | Added a reproducible pnpm patch for `next-themes` 0.4.6 that renders its anti-flash script only on the server, avoiding React 19 client-render script warnings while preserving the server bootstrap. | Applied the patch to the installed package and confirmed both ESM and CommonJS bundles are targeted. `next build --webpack` succeeded, including its TypeScript validation; standalone `tsc --noEmit` passed after build generation. Patch path and SHA-256 references match in the manifest and lockfile. Browser-console verification was not run because no dev server was listening on localhost:3000. |
Record every implementation change here, including a one-line code change. Update this file in the same work session as the code edit. Record every affected file and what verification was performed; “not run” or “pending” is valid and must not be replaced by an assumption.

| Date | Module | Files changed | Change made | Verification / evidence |
|---|---|---|---|---|
| 2026-10-30 | Module 6 | `backend/api/routes_applications.py`, `backend/api/routes_jobs.py` | Added a dedicated atomic Saved ↔ Applied endpoint using the authenticated firm actor, server timestamp, transition history, ledger activity, favorite removal/restoration, and candidate feed exclusion/restoration. The existing general status endpoint remains unchanged. | User confirmed both directions and related UI behavior. Read-only Adminer inspection confirmed current Applied fields and matching ledger/history; automated test cases and owner review remain open. |
| 2026-10-30 | Module 6 bug fix | `backend/auth/access.py`, `docs/integration/STATUS.md` | Classified the new candidate-status PATCH route as a firm-user endpoint. The backend's default-deny access middleware had been rejecting the route before its handler ran. | Confirmed the route was absent from `ROUTE_ACCESS`; added it and restarted `inbox-backend-1`. Reloaded Safari, then the user confirmed Saved → Applied changed the board status. Direct `curl` from this shell is isolated from the host loopback. |
| 2026-10-30 | Module 6 user verification | `docs/integration/STATUS.md` | Recorded the user's initial confirmation that Saved → Applied changes the board status after the route-access fix and backend restart. | Superseded by the later manual UI confirmation and database audit below. |
| 2026-10-30 | Module 6 database audit | `docs/integration/STATUS.md` | Recorded a read-only audit of application status fields, actor-attributed transition history, and application ledger entries; also recorded the user's manual confirmation of reverse moves, favorite/feed restoration, reload persistence, and Manager moves. | Adminer SELECT showed Senior DevOps Engineer (Demo) currently Applied with Pan as submitter, `applied_at` set, matching Saved → Applied transition actor/time and ledger UPDATE; Manager Sam's Saved ↔ Applied activity is also present. User reports manual UI checks passed. Automated tests were not run and remain deferred; code-owner review remains pending. |
| 2026-10-30 | Module 6 test run | `docs/integration/STATUS.md` | Recorded the requested existing test-suite run; did not add or modify test cases. | Frontend `./node_modules/.bin/vitest run --reporter=verbose`: 42 files, 546 passed. Backend `docker compose exec -T backend python -m pytest backend/tests/test_routes_applications.py backend/tests/test_r4_contract_applications.py backend/tests/test_isolation.py -q -o asyncio_mode=auto -m 'not live' -p no:cacheprovider`: 206 passed, 14 failed, 3 xfailed. Failures include `UnboundLocalError` for `HTTPException` in the existing applications endpoints and missing isolation registration for the new candidate-status route. Typecheck/lint and owner review not run. |
| 2026-10-30 | Module 6 focused tests | `backend/tests/test_candidate_application_status.py`, `backend/tests/isolation_cases.py`, `docs/integration/STATUS.md` | Added coverage for Owner and Manager Saved ↔ Applied moves, actor/submitter and timestamp/history, favorite and feed reconciliation, invalid status, Viewer refusal, and registered the endpoint in the shared cross-firm isolation matrix. | New route tests: 4 passed. Focused isolation checks (route inventory + candidate-status matrix case): 2 passed. Broader suite has not been rerun; prior broad run still identified separate `HTTPException` scoping failures in legacy `/api/applications` handlers. No production code or database schema changed. |
| 2026-10-30 | Module 6 bug fix | `backend/api/routes_applications.py`, `docs/integration/STATUS.md` | Removed redundant function-local `HTTPException` imports from `create_application` and `update_application`; both functions use the module-level import, avoiding Python local-variable shadowing and `UnboundLocalError`. | Re-ran the selected backend application, Saved ↔ Applied, and isolation suites: 225 passed, 3 xfailed. The previously failing `HTTPException` cases now pass. No schema or database data changes. |
| 2026-10-30 | Module 6 verification | `docs/integration/STATUS.md` | Recorded the successful post-fix backend run. | `docker compose exec -T backend python -m pytest backend/tests/test_routes_applications.py backend/tests/test_r4_contract_applications.py backend/tests/test_candidate_application_status.py backend/tests/test_isolation.py -q -o asyncio_mode=auto -m 'not live' -p no:cacheprovider`: 225 passed, 3 xfailed. Typecheck/lint not run; owner review pending. |
| 2026-10-30 | Module 6 | `src/lib/api/applications.ts`, `src/lib/api/dto/applications.ts`, `src/lib/hooks/use-applications.ts`, `src/app/[firm]/(app)/(workspace)/candidates/[id]/page.tsx` | Connected candidate status changes to the live PATCH adapter, mapped transition actor IDs, added optimistic application/favorite/feed reconciliation with rollback, and deferred Inbox suggestion moves. | Source reviewed only. No typecheck, automated tests, or browser verification run. |
| 2026-10-30 | Module 6 | `src/components/app/applications/application-board.tsx`, `src/components/app/candidate/applications/applications-tab.tsx`, `src/components/app/candidate/applications/application-drawer.tsx`, `docs/integration/STATUS.md` | Enabled only Saved ↔ Applied on the candidate board and drawer and updated this tracker in the same work session. | Source reviewed only. No typecheck, automated tests, or browser verification run. |
| 2026-10-30 | Planning — Module 6 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Clarified that demo-job seeding and the candidate-scoped Jobs feed are already implemented in Modules 1–2; Module 6 only adds Applied/Saved visibility behavior to the existing feed query. | Cross-checked against completed Module 1–2 entries and current route description. Documentation-only change; no code or data changed. No tests run. |
| 2026-10-30 | Planning — Module 6 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Recorded that BDEs can move applications in both directions between Saved and Applied. Moving back restores the favorite and candidate feed row, clears current applied fields, and appends history instead of deleting it. | User decision recorded. Documentation-only change; no application code, database schema, or data changed. No tests run. |
| 2026-10-30 | Planning — Module 6 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Recorded that the authenticated BDE who moves a job to Applied is the actor and, for now, their ID also goes in `submitted_by_user_id`; Pan remains only an example. The field semantics can be revisited later. | User decision recorded. Documentation-only change; no application code, database schema, or data changed. No tests run. |
| 2026-10-30 | Planning — Module 6 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Clarified that any authorized BDE is the status-change actor and the actor ID must come from the authenticated session; Pan is an example only. Kept separate the unresolved meaning of `submitted_by_user_id`. | User clarification recorded. Documentation-only change; no application code, database schema, or data changed. No tests run. |
| 2026-10-30 | Planning — Module 6 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Added the planned Saved → Applied slice: live status update, atomic favorite removal and ledger activity, `applied_at`, candidate Jobs feed exclusion, status restriction, ownership gates, acceptance criteria, risks, and 11 tracked tasks. Recorded unresolved submitter/undo decisions. | Read existing adapters, board, FastAPI routes, SQLAlchemy models, ledger helper, feed query, team ownership docs, and integration module docs. Documentation-only change; no application code, database schema, or data changed. No tests run. |
| 2026-10-30 | Module 4 | `src/components/app/jobs/job-explorer.tsx`, `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | In candidate context, “Tailor & apply” saves before opening the apply URL; “Open source,” “Open in new tab,” and “Open original” save before opening the exact clicked source URL. Existing Saved jobs open directly; a failed save closes the pending tab and surfaces the existing error. This records Saved only, not Applied. | Source updated as requested; final click-through verification is left to the user. No tests run. |
| 2026-10-30 | Module 4 | `src/components/app/jobs/job-explorer.tsx`, `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Candidate Jobs now starts at Any score because the default 70+ filter hid six of the seven synthetic jobs (score 45); general Jobs retains its previous 70+ default. | Browser inspection showed one row at 70+ and seven rows when Any score was selected. Code now initializes candidate workspace to Any score; user will verify the final display. No tests run. |
| 2026-10-30 | Module 1 | Development PostgreSQL via `backend/scripts/seed_candidate_jobs.py` | Applied the expanded seed, adding four synthetic jobs and four `firm_jobs` plus `candidate_jobs` links. | Command output: `Seeded: 4 jobs, 4 firm links, 4 candidate links. No favorites created.` User will verify the final seven-row totals and feed. |
| 2026-10-30 | Module 1 | `backend/scripts/seed_candidate_jobs.py`, `docs/integration/STATUS.md` | Fixed an indentation error in the expanded seed's dry-run output after the first apply attempt stopped before any database write. | First container invocation raised `IndentationError` before the seed ran; corrected the source. Apply is pending. |
| 2026-10-30 | Planning | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Updated the plan from a proposal to the current implementation state and clarified that final verification is user-owned. | Documentation reviewed against current source and the user's instruction; no tests run. |
| 2026-10-30 | Module 1 | `backend/scripts/seed_candidate_jobs.py`, `docs/integration/STATUS.md` | Expanded the idempotent demo catalog from three to seven synthetic jobs; four new job rows and links were applied. | Seed output: four jobs, four firm links, four candidate links added; final readback left to user verification. |
| 2026-10-30 | Modules 3–4 | Pan candidate workspace; Adminer `favorite_jobs` table | Reopened the candidate workspace after saving to verify the heart state and Saved application reload from the backend. | `Unsave job` remained set after reopening; Applications showed Senior DevOps Engineer (Demo) in Saved; Adminer showed the corresponding favorite row for Adna with Pan as actor. No further data changes and no tests run. |
| 2026-10-30 | Modules 3–4 | Development PostgreSQL `favorite_jobs`; Pan candidate workspace | Hearted Senior DevOps Engineer (Demo) in the candidate Jobs tab. | Adminer shows one favorite for Adna, with the canonical seeded `job_id` and Pan as `marked_by_user_id`; after reopening the workspace, the candidate Jobs tab still shows a filled heart and Applications still shows the job under Saved. Unheart and progressed-record preservation not verified. |
| 2026-10-30 | Module 4 | `docs/integration/STATUS.md` | Recorded that the frontend typecheck stayed active without output and was interrupted; no successful typecheck result is claimed. | `pnpm typecheck` started and was stopped with exit 130 after about one minute; no tests run. |
| 2026-10-30 | Module 4 | `src/components/app/applications/application-board.tsx`, `src/components/app/candidate/applications/applications-tab.tsx`, `docs/integration/STATUS.md` | Disabled candidate application stage moves while the live adapter supports this phase's Saved workflow only, and added a short explanatory note so Saved cannot be moved through the still-mocked status mutation. | Source reviewed; UI not yet verified; no automated tests run. |
| 2026-10-30 | Module 4 | `src/lib/hooks/use-candidate-favorite.ts`, `src/components/app/applications/application-board.tsx`, `docs/integration/STATUS.md` | Tightened the optimistic cache snapshot type and made the application board handle a null submitter on an unsent Saved draft; corrected the tracker to reflect completed seed/API work and current frontend status. | Source reviewed; UI/typecheck not run; no automated tests run. |
| 2026-10-30 | Module 4 | `src/lib/query/keys.ts`, `src/lib/api/applications.ts`, `src/lib/hooks/use-applications.ts`, `src/lib/hooks/use-jobs.ts`, `src/components/app/candidate/use-candidate-workspace.ts`, `src/components/app/candidate/candidate-jobs-tab.tsx`, `src/app/[firm]/(app)/(workspace)/candidates/[id]/page.tsx`, `src/lib/api/favorites.ts`, `src/lib/hooks/use-candidate-favorite.ts`, `src/components/app/jobs/job-explorer.tsx` | Connected the candidate page to live candidate Jobs and Applications, initialized hearts from backend favorites, wired optimistic heart/unheart to the backend, added rollback/error handling, kept Saved jobs visible in the feed, and preserved preview-only row selection. | Source reviewed; UI/runtime not yet verified after frontend changes; no tests run. |
| 2026-10-30 | Module 2 | Local API via the signed-in Pan session | Confirmed `GET /api/jobs?candidate_id=<Adna>&limit=10` returns the three seeded canonical jobs, the matching `candidate_id`, and `favorite_job_ids: []`. | Manual read-only browser request after restarting the local backend; no data changed and no tests run. |
| 2026-10-30 | Module 4 | `src/lib/api/jobs.ts` | Typed the paginated live-feed accumulator with the backend Jobs DTO type. | Source reviewed; typecheck not run. |
| 2026-10-30 | Module 4 | `docs/02-DATA-CONTRACTS.md` | Recorded the approved distinction between candidate favorites/Saved applications and personal JobMark data; documented nullable submitter on an unsent SAVED draft. | Contract reviewed against the user-approved workflow; no tests run. |
| 2026-10-30 | Module 4 | `src/lib/api/dto/applications.ts`, `src/lib/schemas/application.ts` | Added backend application DTO mapping for candidate/status/events and made `submittedByUserId` nullable so a Saved draft is not presented as submitted by Pan. | Source reviewed; typecheck/runtime not run. |
| 2026-10-30 | Module 4 | `backend/api/routes_applications.py` | Added optional `candidate_id` filtering to the existing Applications list and authorized it through the candidate visibility helper. | Source reviewed; API/runtime and isolation checks not run. |
| 2026-10-30 | Module 4 | `backend/api/routes_applications.py` | Imported the existing UUID query validator used by the new candidate filter. | Source reviewed; runtime and tests not run. |
| 2026-10-30 | Module 4 | `src/lib/api/dto/jobs.ts` | Added strict DTO schemas and mapping from backend Jobs/Companies into the existing frontend Job/Company contracts, including provenance, location, salary, and candidate-work-auth-safe empty requirements. | Source reviewed; typecheck/runtime not run. |
| 2026-10-30 | Module 4 | `src/lib/api/jobs.ts` | Added a paginated candidate feed adapter using `http.ts`; it validates candidate response identity, returns favorite IDs, and has no mock fallback. | Source reviewed; typecheck/runtime not run. |
| 2026-10-30 | Module 4 | `docs/integration/STATUS.md` | Recorded the live candidate feed DTO/adapter work and moved Module 4 to In Progress. | Documentation updated alongside code; no tests run. |
| 2026-10-30 | Module 3 | `backend/api/routes_applications.py` | Added a candidate-scoped Saved-job branch to application creation and an `unfavorite` branch to application updates. Heart validates candidate/job links, locks the candidate, writes favorite and Saved application together, preserves existing progress, and records actor actions in the ledger. | Source reviewed; backend runtime and database behavior not yet verified; no tests run. |
| 2026-10-30 | Module 3 | `backend/api/routes_applications.py` | Passed the authenticated principal into the update handler so unheart permission checks use the signed-in session. | Source reviewed; runtime and tests not run. |
| 2026-10-30 | Module 2 | `backend/api/routes_jobs.py` | Added the `Principal` type annotation to the new list-route dependency. | Source reviewed; runtime and tests not run. |
| 2026-10-30 | Module 2 | `backend/api/routes_jobs.py` | Added an optional candidate filter to the existing firm-scoped Jobs list; candidate visibility is checked with the shared helper, jobs are intersected with `candidate_jobs` and `firm_jobs`, and candidate favorite IDs are returned for heart state. | Source reviewed; API/runtime and isolation checks not run. |
| 2026-10-30 | Module 2 | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/02-jobs.md` | Documented the candidate-scoped extension to the existing Jobs endpoint and its conditional favorite-ID response. | Documentation reviewed against the route change; no runtime verification. |
| 2026-10-30 | Module 2 | `docs/integration/STATUS.md` | Marked the candidate feed API substeps complete and kept Module 2 in progress pending isolation/runtime verification. | Source inspection only; no tests run. |
| 2026-10-30 | Module 1 | Development PostgreSQL (`jobs`, `firm_jobs`, `candidate_jobs`) | Applied three synthetic demo jobs and linked each to Adnan's firm and Adna. | Backend seed command reported `3 jobs, 3 firm links, 3 candidate links`; Adminer read-only view showed 3 candidate links. |
| 2026-10-30 | Module 1 | Development PostgreSQL (`jobs`, `firm_jobs`, `candidate_jobs`, `favorite_jobs`) | Reran the seed to verify idempotency; no additional rows were inserted and no favorites were created. | Seed reported `0 jobs, 0 firm links, 0 candidate links`; Adminer showed three jobs, three firm links, three candidate links, and zero favorites. |
| 2026-10-30 | Module 1 | `docs/integration/STATUS.md` | Resolved the earlier host-Python preview blocker by running the command in the backend container; marked Module 1 complete and moved the current position to Module 2. | Backend container preview/apply succeeded; Adminer read-back completed; no tests run. |
| 2026-10-30 | Module 1 | `backend/scripts/seed_candidate_jobs.py` | Labeled the synthetic records with the backend's supported `manual` source value so the existing Jobs DTO can map its provenance without inventing a source enum. | Source reviewed; seed preview remains blocked by missing host SQLAlchemy; no database writes or tests. |
| 2026-10-30 | Module 1 | `docs/integration/STATUS.md` | Recorded that the seed preview is blocked in host Python because SQLAlchemy is unavailable; no database writes were made. | `python3 -m backend.scripts.seed_candidate_jobs` stopped at `ModuleNotFoundError: sqlalchemy`; no tests run. |
| 2026-10-30 | Module 1 | `docs/integration/IMPLEMENTATION_PLAN.md` | Resolved the seed-tool choice to the new preview-first `seed_candidate_jobs.py` command, with a requirement to apply only after its target preview is confirmed. | Documentation cross-checked against the added script; command not run and database unchanged. |
| 2026-10-30 | Module 1 | `backend/scripts/seed_candidate_jobs.py` | Added a target-checked, dry-run-first idempotent seed command for synthetic jobs and their firm/candidate links; it refuses production, validates Adna and active BDE Pan, and never writes favorites or resets data. | Source reviewed. Command not run; no DB writes and no tests. |
| 2026-10-30 | Module 1 | `backend/scripts/seed_candidate_jobs.py` | Corrected firm-link existence detection to use the `FirmJob` model directly before calling the idempotent link helper. | Source reviewed. Command not run; no DB writes and no tests. |
| 2026-10-30 | Planning | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Created the scoped implementation plan and initial progress tracker. No application code or database data changed. | Read-only source, browser, Adminer, and team-document review; implementation tests not run. |
| 2026-10-30 | Planning decision | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | User confirmed Jobs → Saved comes before Inbox; heart writes the canonical seeded `jobs.id` to `favorite_jobs.job_id`. | User direction; no code or database records changed. |
| 2026-10-30 | Planning decision | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Selected existing candidate Adna in Adnan's firm; no mock candidate is to be created. | User direction; no code or database records changed. |
| 2026-10-30 | Read-only target check | `docs/integration/IMPLEMENTATION_PLAN.md`, `docs/integration/STATUS.md` | Confirmed Adna is assigned to active BDE Pan; Pan is the intended signed-in actor viewing Adna's Jobs page. | Adminer read-only lookup; no data changed. Sensitive account fields were not recorded. |
| 2026-10-30 | Status format | `docs/integration/STATUS.md` | Added the requested status indicators and explicit status entries for each module subtask. | Markdown review; no application code or database data changed. |

## Update rules

1. After every code change, including one-line edits, update current position, affected subtask, and the change log in this file during the same work session.
2. List every changed file and the actual behavior or contract change. Do not report intended work as completed work.
3. Record exact verification performed or explicitly state “not run” / “pending.”
4. Mark a module Completed only after its done criteria in `IMPLEMENTATION_PLAN.md` are met and supporting evidence is recorded.
5. If a change fails, breaks behavior, or is reverted, append that fact and update current status. Do not erase history or claim success by assumption.
6. Before updating this tracker, inspect the actual diff and verification results; do not rely on memory alone.
