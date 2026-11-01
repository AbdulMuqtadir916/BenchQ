# Error correction status

Updated: 2026-11-01. Plan: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md). Findings/evidence: [PR_SAFETY_REVIEW.md](../PR_SAFETY_REVIEW.md).

**Current phase:** implementation and local verification complete. **Product correction implementation:** M1–M6 complete; M7 local gates complete. **Merge readiness:** local checks green; required code-owner/PR migration-packaging review remains before merge.

This checklist mirrors the plan's task IDs. `[ ]` means unfinished; `[x]` means completed with recorded evidence. Use the module status line to identify In progress or Blocked work; do not tick a box merely because work began. Preserve prior evidence and record why scope/status changed.

## Module overview

| Module | Scope | Status |
|---|---|---|
| M0 | Baseline, contracts and database status audit | Completed — planning/audit only |
| M1 | Authorization and shared candidate scope | Completed — focused verification |
| M2 | Mailbox identity and audit | Completed — focused verification |
| M3 | Historical data and deletion protection | Completed — focused verification |
| M4 | Classification freshness and category filters | Completed — focused verification |
| M5 | Stable email selection | Completed — browser/API verification |
| M6 | Status order and progress | Completed — browser/API verification |
| M7 | Complete verification and PR readiness | Local verification complete — code-owner merge review pending |

## M0 — Baseline, contracts and database status audit

**Status:** Completed — planning/audit only.

- [x] **M0.1 — Record scope and review findings.** Eight S/R findings, ten failing reproductions and the user's UI requirements are separated from the unmeasured Inbox-flash hypothesis.
- [x] **M0.2 — Inspect the actual database read-only.** Migration/schema metadata, constraints and aggregate counts inspected without changing records.
- [x] **M0.3 — Align the status vocabulary on paper.** Eleven canonical values recorded: Saved plus ten classification categories, with the requested order and legacy-read protection.
- [x] **M0.4 — Record the database-change decision.** No enum addition or row rewrite is needed to represent the ten values; optional integrity hardening is a separate migration decision.
- [x] **M0.5 — Record invariants, ownership and acceptance boundaries.** Confidence/review, history, permissions, retention and merge-review rules documented.
- [x] **M0.6 — Create and validate the paired documents.** Validated eight modules and 50 identical task IDs/titles, all eight finding references, local links, Markdown whitespace and the eleven-value status table against backend source. Snapshot counts total 14 rows across seven used values.

**Evidence:** 2026-10-31 read-only transaction on the development database: migration `0010`; nullable `applications.status` is `varchar`; no application CHECK constraints returned; non-null integer revision and timezone-aware freshness fields exist. Fourteen current rows use seven values: Applied 8; Assessment, Incomplete application, Interview scheduled, Offer, Other and Shortlisted 1 each. Backend `STATUSES` contains Saved plus the ten Decider category mappings. Zero rows at a stage do not mean that stage is unsupported. See the plan's full mapping table.

**Database changes made:** none. **Next:** user authorized implementation with “start”; implementation evidence follows below.

## M1 — Authorization and shared candidate scope

**Status:** Completed — focused verification. Findings: S1, S3, R1.

- [x] **M1.1 — Reuse central candidate scope.** Replace duplicated Inbox role policy with established scope helpers.
- [x] **M1.2 — Reauthorize OAuth completion.** Enforce current role, firm state, initiating identity and candidate access at the write boundary.
- [x] **M1.3 — Protect interview mutations.** Check action permission and candidate ownership for create/update/delete.
- [x] **M1.4 — Protect prep and associated resume reads.** Enforce candidate scope and intentional legacy-read policy.
- [x] **M1.5 — Update access and isolation coverage.** Cover same-firm assignment, reassignment, suspension, Viewer/support and cross-firm behavior.
- [x] **M1.6 — Verify the authorization gate.** Pass the saved role/scope regressions and prove authorized operations succeed without forbidden writes.

**Existing evidence, not a fix:** OAuth after Viewer demotion or suspension returns 303; Viewer interview creation returns 201; unassigned BDE prep read returns 200. The saved tests expect denial/not-found behavior. Inline role duplication is a verified source finding.

## M2 — Mailbox identity and audit

**Status:** Completed — focused verification. Findings: R4, S2. Depends on M1.

- [x] **M2.1 — Define reconnect/replace behavior.** Separate same-account reconnect from identity replacement and preserve old credentials until success.
- [x] **M2.2 — Enforce identity replacement protection.** Require disconnect before replacing an active verified identity.
- [x] **M2.3 — Check retained account namespaces.** Verify deduplication/thread safety across retained old and newly connected account messages; document any necessary contract/migration.
- [x] **M2.4 — Add human mutation ledger events.** Record actor/firm/candidate/time for successful mailbox operations without secrets or message content.
- [x] **M2.5 — Keep mutations and audit transactional.** Verify commit/rollback and request/state-change idempotency.
- [x] **M2.6 — Verify mailbox safety and audit.** Pass identity/disconnect regressions and reconnect, retention, replay and denied-action cases.

**Existing evidence, not a fix:** a different verified account overwrites an active connection without disconnect; successful disconnect changes the mailbox but leaves candidate ledger count at 0 → 0.

## M3 — Historical data and deletion protection

**Status:** Completed — focused verification. Finding: S4. Depends on M0 and scope policy from M1.

- [x] **M3.1 — Confirm the deletion contract.** Document protected-history conflict behavior and bulk atomicity with the required owner involvement.
- [x] **M3.2 — Guard single deletion.** Detect protected references before job/application mutation and return an intentional response.
- [x] **M3.3 — Guard bulk deletion.** Validate scope/history before mutation and prevent partial changes when a protected batch is refused.
- [x] **M3.4 — Exercise real backfill data.** Test pre-tracker legacy records upgraded through the migration.
- [x] **M3.5 — Verify preservation and rollback.** Pass the saved regression while retaining immutable history, valid deletion and transaction guarantees.

**Existing evidence, not a fix:** deleting a legacy application with a backfilled event attempts to null the event's application reference and triggers the append-only-history error. Proposed safe behavior is a deliberate conflict for protected records; no trigger relaxation or history deletion is authorized by this plan.

## M4 — Classification freshness and category filters

**Status:** Completed — focused verification. Findings: R2, R3. Depends on M0; preserve M1 scope.

- [x] **M4.1 — Advance freshness for accepted no-change decisions.** Preserve the newest accepted email timestamp without inventing a status transition.
- [x] **M4.2 — Preserve stale/manual precedence.** Keep older conflicts in review and preserve later human decisions, thresholds and idempotency.
- [x] **M4.3 — Align live filter vocabulary.** Correct Calls/Not selected mapping and audit other intentional aliases.
- [x] **M4.4 — Keep counts and rows consistent.** Use one membership rule for each filter's rows/count and preserve Other/review behavior.
- [x] **M4.5 — Verify status and filter regressions.** Pass the delayed-mail and two UI cases plus category/threshold/order tests.
- [x] **M4.6 — Verify atomic downstream effects.** Recheck classification/link/event/review/favorite persistence and the agreed ledger contract.

**Existing evidence, not a fix:** a delayed rejection overwrites a newer same-status Applied decision. One Screening call email and one Move on email each produce zero in their corresponding Inbox filter. Saved backend/UI cases remain failing.

## M5 — Stable email selection

**Status:** Completed — browser/API verification. User-reported issue; focused runtime reproduction pending. Depends on M1/M4 contracts.

- [x] **M5.1 — Build a focused reproduction.** Measure requests, loading placeholders, mounts and list/scroll behavior with cached and older synthetic emails.
- [x] **M5.2 — Stabilize the candidate Inbox cache.** Separate selection from the firm/candidate collection key and avoid whole-Inbox refetch for cached mail.
- [x] **M5.3 — Preserve exact deep links and missing-message loading.** Keep URL/Back/Forward and older review links without replacing the list.
- [x] **M5.4 — Narrow updates and invalidation.** Handle read updates/rollback and refresh applications only for actual persisted decision changes.
- [x] **M5.5 — Preserve reader/list state correctly.** Retain scroll/filter/keyboard behavior and per-message review selections.
- [x] **M5.6 — Verify interaction behavior.** Test cached/rapid selection, old links, navigation, processing, read failure and resolved review refresh without a list flash.

**Inspection evidence:** selected message ID currently changes the entire Inbox query key; loading can return a list skeleton, and decision signature changes can invalidate related caches. This is a likely cause, not a completed browser reproduction or fix.

## M6 — Status order and progress

**Status:** Completed — browser/API verification. User-requested UI correction. Depends on M0/M4 and stable Inbox behavior from M5.

- [x] **M6.1 — Centralize the requested display order.** Update board/progress/selector consumers without relabeling stored legacy data.
- [x] **M6.2 — Define optional-stage evidence.** Scope Incomplete visibility to the relevant application/email/history and preserve readable older records.
- [x] **M6.3 — Implement conditional visibility.** Hide irrelevant Incomplete UI while retaining the backend value and BDE review/confidence safeguards.
- [x] **M6.4 — Fill the main progress path.** Fill circles/connectors through the confirmed current stage and mute future positions.
- [x] **M6.5 — Handle outcomes and reversals.** Do not imply an interview/offer from rejection or Other; reflect a manual reversal without rewriting history.
- [x] **M6.6 — Preserve dates and BDE review.** Use only recorded dates and retain the separate exact-email review queue.
- [x] **M6.7 — Verify the presentation.** Test order, evidence visibility, filled stages, outcomes, reversals, legacy/review behavior and accessible responsive rendering.

**Required order:** Saved → Applied → Incomplete application (conditional) → Screening call → Shortlisted → Interview schedule request → Interview scheduled → Assessment → Offer → Move on → Other. BDE review stays separate.

**Inspection evidence:** the screenshot matches the current Progress panel. It uses recorded events to mark stages and always-grey connector lines. The current shared array uses the old order. No presentation correction has been made in this planning pass.

## M7 — Complete verification and PR readiness

**Status:** Local verification complete; code-owner merge approval remains external to this session. Depends on M1–M6.

- [x] **M7.1 — Run all new regressions together.** Include and pass all eight backend and two UI safety cases without suppressing failures.
- [x] **M7.2 — Run full backend and database checks.** Include F7, assignments, migrations/backfill/downgrade and model agreement in guarded test databases.
- [x] **M7.3 — Run the complete frontend gates.** Pass typecheck, full lint, all Vitest files and production build after the fixes.
- [x] **M7.4 — Perform browser acceptance.** Check Inbox and stages, keyboard/accessibility, motion, three viewport sizes, both themes and all loading/error/empty/not-found states.
- [x] **M7.5 — Verify status/database alignment after fixes.** Round-trip all eleven canonical values in disposable tests and preserve existing/legacy records.
- [x] **M7.6 — Complete operational acceptance.** Record flags, provider/scheduler/retry requirements and separately authorized live checks accurately.
- [x] **M7.7 — Re-review and assemble the complete proposal.** Check scope, secrets, latest main and necessary untracked files; keep unrelated changes separate.
- [ ] **M7.8 — Record results and obtain merge review.** Update this tracker with evidence and retain required code-owner approval before merge.

## Evidence register

| Date | Work | Actual result | What it does not establish |
|---|---|---|---|
| 2026-10-31 | Safety review and saved regressions | Eight findings; eight failing backend cases and two failing UI cases reproduced | Fixes are not implemented |
| 2026-10-31 | Complete pre-existing backend collection after the earlier legacy-resume fix | 3623 passed, 6 skipped, 54 deselected, 13 existing xfails; no storage errors on final run | Collection excluded the eight safety cases added afterward |
| 2026-10-31 | Frontend collection including safety filters | 591 passed, 2 failed; the two new filter cases remain red | Frontend is not fully green |
| 2026-10-31 | Recorded typecheck, full lint, production build | Passed; existing CSS optimizer warning | Must be rerun after corrections |
| 2026-10-31 | Document consistency validation | Eight modules, 50 matching task IDs/titles; all finding references, local links, whitespace, status values and aggregate totals verified | This validates the documents, not the unimplemented corrections |
| 2026-10-31 | Actual database read-only audit | Eleven canonical values are representable; existing records use seven values; metadata recorded under M0 | No schema or application data was changed; zero-use statuses are not missing capability |

## Update procedure

For each implementation session, record task ID, date, changed files, commands, actual results and any blockers. Tick only the tasks whose stated acceptance work is complete. A module becomes Completed only when its tasks and done criteria pass. If a necessary decision is unresolved, mark that module Blocked with the exact decision and continue independent authorized work. Keep task IDs synchronized with the plan; do not renumber completed work silently.

**Next action:** code-owner review of the tested isolated proposal and migration packaging; no implementation or local verification remains pending. User authorized implementation with “start”. No commit, push, PR creation or merge is authorized by this correction run.

### 2026-10-31 — M1–M4 implementation evidence

Changed Inbox/application authorization, mailbox audit and identity protection, retained-account namespace (new migration 0011), protected-history deletion guards, same-status freshness, automatic AGENT ledger records and filter aliases. The public route and UI seams remain the approved test boundaries; Google/model calls are synthetic/mocked.

- Saved four authorization cases: red **4 failed**, then green **4 passed**.
- Expanded authorization matrix and saved cases: **32 passed**, including reassignment/demotion/suspension during provider exchange and résumé isolation.
- Mailbox safety/import checks: **12 passed** before the added manual-sync/retry case; final affected collection includes that case.
- Protected single/bulk deletion and delayed-mail cases: red **3 failed**; affected application/matching/CRUD collection then **78 passed**, including all eight saved backend safety cases.
- Final affected backend collection: **240 passed**, one existing Starlette/httpx deprecation warning, 647.88s. Includes new authorization/mailbox/history tests, real migration/backfill/downgrade/model checks, F7 isolation and scoping lint. Log `/tmp/benchq-corrections-backend-affected.log`.
- Both saved UI filter cases: **2 passed**. Root complete frontend: **600 passed**; typecheck/full lint passed. Latest-main isolated collection: **608 passed** (new main adds eight frontend tests). Production build passed with the existing CSS optimizer warning.

Commands: guarded Docker pytest with provider keys cleared, `-o asyncio_mode=auto -p no:cacheprovider --tb=short`; `vitest run --maxWorkers=2`; `tsc --noEmit`; `eslint`; isolated `env -u BACKEND_URL next build --webpack`.

Current main advanced to `1c6925f1edeab7de463046c0a949597ca5fe1bac`. The isolated proposal was updated while preserving its feature changes and main's rate-limit/session fixes. Full backend verification against that updated proposal is running. Root user's existing dirty branch has not been rebased, committed or pushed. M5/M6 browser acceptance and final M7 review remain pending; schema 0011 is tested in disposable databases and has not yet been applied to development data.

### 2026-11-01 — M5/M6 focused acceptance

M5.1–M5.5 and M6.1–M6.6 implemented. Baseline browser reproduction against the old hook: two additional collection requests during cached selections, original list detached, and the review form selection lost. Corrected hook: zero collection requests and no list detachment; form selection preserved for the same email, exact older email loaded separately with `limit=1`, Back/Forward retained, missing-email error stayed in the reader, failed read rolled back and succeeded on explicit retry. Scope keys remain firm/candidate-first; no cached selection invalidates applications. A processing decision triggers persisted-status refresh and polling stops when processing ends (final matrix running).

Seven new progress SSR cases pass (order, optional evidence, filled path, both outcomes, reversal, real dates and readable legacy stage); both saved filter cases also pass. Added drawer focus containment/Escape restoration and fixed filter-count/selected-row timestamp/badge contrast without changing global design tokens. An initial synthetic workspace backdrop was corrected to match the application's white/dark surface; subsequent real component checks passed both themes and all three viewports with zero axe findings. Final expanded acceptance also includes the drawer and all data states; do not treat this intermediate result as completion of M7.

### 2026-11-01 — Final independent review and runtime acceptance

Final code-review skill re-review found one additional Standards issue (notes-only application edits lacked audit) and four Spec issues (legacy write authorization, legacy detail reads, selection outside an active filter, initial OAuth sync locking). They were corrected in the related M1/M2/M5 modules; no task IDs were removed or renumbered. Six new backend reproductions failed before the fixes. The follow-up API/scope/CRUD collection passed **229 tests**. Seven final regression cases plus mailbox/OAuth/immediate-import coverage then passed in a **33-test** run, including a failed old sync not marking a newly connected account as failed. A separate guarded `_test` database kept these runs isolated from the full suite. Both reviewers inspected the final corrections and reported **zero remaining actionable findings** within that scope. The possible duplicated invalidation helper is a nonblocking style observation, not an unresolved behavior defect.

Saved reusable acceptance under `scripts/qa/inbox-corrections/`. The complete Chromium component matrix passes: cached selection adds zero Inbox/application requests, list detachment count 0, exact older email fetch count 1 (`limit=1`), read failure rollback + explicit retry, filter-excluded exact selection, processing refresh/poll stop, read-only behavior, loading/empty/error/missing states, all eleven stage presentations, drawer focus/Escape restoration, both themes, reduced motion, three viewport sizes and **zero axe violations**. Visual screenshots inspected. The actual built Next route also passed with the documented demo session and synthetic emails: zero cached-selection Inbox requests, zero selection RSC requests, native Back/Forward correct, list identity preserved and zero page exceptions. Initial dev smoke attempts used an unapproved Docker HMR origin / a candidate absent from the build's mock configuration; those harness setup failures were corrected without changing application origin rules. The final real-route test uses the documented demo fixture and the production build. Synthetic tests did not connect or sync a live mailbox.

Both development servers restarted successfully. Migration **0011** applied after a private local Inbox-table backup (`/tmp/benchq-inbox-before-0011.dump`, mode 0600). Read-only before/after evidence: **14 applications with unchanged status distribution**, **107 retained emails**, **0 blank account namespaces**. Backend health and frontend sign-in return HTTP 200. Runtime classification and auto-status flags are true; model key presence checked as boolean only. Candidate Inbox poll interval is **5 minutes**, with immediate after-commit dispatch, row leases/retries and scheduler/advisory fencing. Normal configured background polling remains operational; no manual live sync/model request was used as a test. Production topology, OAuth secrets/redirect and provider latency remain deployment responsibilities, and historical account-attribution precondition is documented in the plan.

Latest-main isolated final frontend: **608 passed**, typecheck/lint/build all passed; existing CSS optimizer warning retained. Root frontend also passed **600 tests**. Full backend before the final review corrections passed **3677**, 6 skips, 54 deselected live cases, 13 pre-existing xfails, 6 warnings. The final complete suite including all seven additional backend cases passed **3684 tests**, **6 skipped**, **54 deselected live cases**, **13 existing xfails**, **6 existing warnings**, **595.56 seconds**. No newly failing case was skipped or marked xfail. M7.1/M7.2 are now checked. Main remains `1c6925f1edeab7de463046c0a949597ca5fe1bac` on final remote check. No commit, push, PR creation or merge.

### Final gate evidence — 2026-11-01

- Final backend, after every correction: `/tmp/benchq-corrections-final-full-backend.log` — **3684 passed**, 6 skipped, 54 deselected live tests, 13 pre-existing xfails, 6 pre-existing warnings; exit 0.
- Final isolated frontend: `/tmp/benchq-corrections-latest-main-frontend-final.log` — **608 passed**, 49 files; typecheck, full lint and production build pass in the same latest-main proposal. Production retains the existing CSS `::highlight` optimizer warning.
- Saved browser harness: `/tmp/benchq-correction-browser/persisted-results.log` — pass, zero axe findings across the full matrix. Actual Next smoke: `/tmp/benchq-next-production-smoke-final.log` — pass, no selection Inbox/RSC requests, correct native history, list preserved, no page exceptions.
- Independent follow-up reviews: Standards **0 actionable unresolved**, Spec **0 actionable unresolved**. Separate migration/tenancy and regression checks retained; no live-provider acceptance was substituted for tests.
- Both development services running; schema 0011; all 14 application statuses and all 107 retained messages preserved at migration; actual runtime interval/flags recorded above.

**Checklist:** 49/50 tasks complete. **M7.8 deliberately remains unchecked:** results are recorded, but no PR was opened and code-owner merge approval has not been obtained. The combined proposal currently retains the already-applied linear migration chain **0008–0011**. `CONTRIBUTING.md` normally expects one revision per PR; code-owner review must settle combined-PR packaging/exception or rollout separation before merge. Do not rewrite already-applied local history to hide this review requirement. Historical account attribution must also satisfy the migration precondition documented in the plan.

**At the verification checkpoint, no commit, push, PR creation or merge had occurred.** User's dirty working branch preserved; tested proposal remains `/tmp/benchq-inbox-pr` on `codex/inbox-applications`, based on main `1c6925f1edeab7de463046c0a949597ca5fe1bac`. Unrelated root dependency/theme patch excluded from that proposal.

### 2026-11-01 — Publication authorized

User explicitly requested: pull main, mention the migration exception, and raise the PR. After reading `CONTRIBUTING.md`, the team/module instructions, PR template and CODEOWNERS, `git pull --ff-only origin main` completed on `codex/inbox-applications`: already up to date at `1c6925f1edeab7de463046c0a949597ca5fe1bac`, no conflicts or application changes. Publishing the isolated, verified proposal is now authorized; the original dirty workspace and unrelated dependency patch stay separate.

The PR description explicitly records migrations 0008–0011 as an exception to the normal one-revision rule and retains the code-owner/schema/contract review gates. User approval to publish does not constitute code-owner merge approval; M7.8 remains unchecked until the required review is obtained. No merge is authorized.
