# PR 4 — automatic status updates, Undo and the review UI (`codex/pr4-code-correction`)

Authority: `docs/team/samad.md` §1.3–1.5, issue #110 (Abdul's decisions), PR #111 approval conditions. Plan, tracker and
problem log: `docs/integration/pr4-application-workflow/` (`PR_4_IMPLEMENTATION_PLAN.md`, `PR_4_STATUS.md`, `DEBUG.md`).
Base: main 3f8be61 (PR 3 merged), refreshed by merging main 09eb35b (#112 candidates final schema, #107 logging).
One migration (**0016**, after main's 0015). Switches ship OFF.

## Backend

| File | Change |
|---|---|
| `backend/inbox/backfill.py` (new) | Setup-failure recovery and historical (`NOT_QUEUED`) classification: connected mailbox only, 20 per sweep, oldest first, once-only `job_runs` marker, ledger summary; historical is review only; read-only counts CLI (D-23, D-27) |
| `backend/inbox/classifier_pause.py` (new) | Configuration-scoped pause after 401/403; atomic probe lease; recovery (D-03) |
| `backend/inbox/classification_worker.py` | Config/pause gate before any claim; dispatch marker; finalized check; cost accounting; reply/forward rules and uncertainty before Other hiding; email-history replay rules; automatic write before inserting the immutable result; aliases once per sweep; removed duplicate eligibility guard |
| `backend/inbox/decider.py`, `decider_categories.py` | `PROVIDER_AUTH_REJECTED`; structural checks only; `decision_value` (min) and `values_disagree` (> 0.10); `is_configured` (D-01, D-02) |
| `backend/inbox/application_matching.py` | `email_parts`/`ai_input`/`has_too_little_text` (reply vs forward, D-04); `is_match_eligible` (D-07); `company_aliases` (D-21) |
| `backend/inbox/delivery_evidence.py` | Gmail's own ARC seals no longer hide a valid verdict; foreign ARC hop stays UNKNOWN (D-26) |
| `backend/inbox/policy.py` | Thresholds use the decision value; Incomplete → Applied rule (D-14) |
| `backend/applications/tracking.py` | `automation_ready`, `email_history`, `apply_email_decision` (savepoint: status + event + ledger), `undo_email_decision` (D-11, D-12, D-13) |
| `backend/api/routes_applications.py` | Shared `_application_scope`; `GET /applications/counts`; `POST …/status-events/{event_id}/undo`; review route refuses `saved` |
| `backend/api/routes_inbox.py` | Review list newest first with subject/sender/received/total and cursor; Dismiss never links; review stages; message revisions in JSON; retry/reclassify 409 while paused; count-only `hidden_count` (D-29) |
| `backend/api` access: `backend/auth/access.py` | New routes registered (FIRM) |
| `backend/ai/config.py` | `AiModule.fallback`; email classification never borrows the primary provider |
| `backend/analyzer/llm_logger.py` | Optional `cost_usd` and `db` (savepoint, never commits the caller's transaction) — owner: Abdul |
| `backend/main.py` | `llm-costs` adds `candidate_email_classification.{unpriced_calls, unconfirmed_calls}` |
| `backend/config.py`, `backend/.env.example` | Automation, setup-recovery and historical switches (all default off) |
| `backend/models/db.py`, `backend/migrations/versions/0016_email_outcome_auto_applied.py` | Outcome `AUTO_APPLIED`; guarded downgrade (renumbered from 0015 after main's 0015) |
| Tests (new) | `test_pr4_backfill.py`, `test_migration_0016.py`, `test_pr4_classifier_gate.py`, `test_pr4_confidence.py`, `test_pr4_email_parts.py`, `test_pr4_spend.py`, `test_pr4_match_eligibility.py`, `test_pr4_counts.py`, `test_pr4_review_api.py`, `test_pr4_automation.py`, `test_migration_0016.py` |
| Tests (changed) | `test_pr3_provider.py` (mismatched confidence is no longer a failure; Gmail ARC cases), `isolation_cases.py`/`isolation_support.py` (counts and Undo routes, automatic-change fixture), `conftest.py` (every candidate-email switch off per test; no `.env` inheritance), `test_pr3_pipeline.py` (stub accepts `aliases`), `test_inbox_ai_spend.py` (from main: a classifier that isn't set up now leaves the email waiting, T1.1) |

## Frontend

| Area | Files | Change |
|---|---|---|
| Vocabulary | `schemas/enums.ts`, `components/app/applications/status-meta.ts`, `lib/derive/funnel.ts` | Ten statuses + read-only legacy group; one source for pipeline/labels/icons/tones; funnel from the pipeline |
| Applications live | `lib/api/applications.ts`, `lib/api/dto/applications.ts`, `schemas/application.ts` | All pages; counts; `statusRevision`, `pendingReviewCount`, event `source`/`revision`/`emailId`; Undo |
| Moves | `lib/hooks/use-applications.ts`, `lib/query/keys.ts`, `lib/utils.ts` | One move per application (lock), server-only cache with "Saving…" overlay, `newCommandId`, counts hook, Undo hook |
| Board/drawer/detail | `application-board.tsx`, `application-card.tsx`, `application-drawer.tsx`, `application-list.tsx`, `status-timeline.tsx`, `automatic-change.tsx` (new), pages | Ten columns + Older statuses; any-stage moves; pending-review block; Set status; automatic-change notice with Undo; timeline by source |
| Review loop | `schemas/inbox.ts`, `lib/api/inbox.ts`, `lib/api/dto/inbox.ts`, `lib/hooks/use-email-reviews.ts` (new), `email-review-panel.tsx` (new), `review-queue.tsx` (new), `review-reason.ts` (new), `inbox-reader.tsx`, `inbox-tab.tsx`, `applications-tab.tsx`, `use-candidate-workspace.ts` | Review contracts, panel, BDE review column, reasons |
| Inbox badges and states | `components/app/inbox/signal-meta.ts`, `classification-status.tsx` (new), `activity-tab.tsx`, `attention-card.tsx`, `inbox-preview.tsx`, `inbox-tab.tsx` | Category badges; Not yet queued / Classifying… / Waiting for classifier setup / Classification failed with reason and Retry; hidden-count note; no "Email: Email" |
| Mocks | `mocks/data/*.json`, `mocks/applications.ts`, `mocks/db.ts`, mock tests | Fixtures on the new values (legacy samples kept); fingerprint updated |
| Jobs feed and heart (Phase 8) | `lib/api/jobs.ts`, `lib/api/dto/jobs.ts` (new), `lib/api/applications.ts`, `lib/hooks/use-applications.ts`, `lib/query/keys.ts`, `components/app/jobs/job-explorer.tsx`, `mocks/applications.ts`, mock inventory tests | Jobs from `GET /api/jobs` when `jobs` is live (empty feed = no jobs); heart and Open source save the job for the candidate in context (favourite + Saved draft), un-heart removes it; a saved job stays in the feed; without a candidate the heart is disabled. Hide stays a personal mark (mock) |
| Tests (new) | `live-jobs.test.ts`, `dto/applications.test.ts`, `utils.test.ts`, `review-reason.test.ts`, `signal-meta.test.ts`, `automatic-change.test.ts` | |

## Docs

`docs/02-DATA-CONTRACTS.md` ("PR 4 as built"), `docs/integration/pr3-email-classification/OPERATIONS.md` (setup,
routing, spend, endpoint decision, switch-on conditions, automation and activation), this report, and the PR 4 folder.

## Not for the PR

`.claude/launch.json` (local pnpm path), `backend/.env`, `.env.local`.

## Merge with main (09eb35b)

Conflicts resolved: `classification_worker.py` (PR 4 flow kept; main's log lines kept; AI spend now one row per
dispatched call — main's Q33 rule — written inside our result transaction, unknown cost also flagged as unpriced),
`src/mocks/db.ts` (fixture fingerprint recomputed), migration renumbered to 0016. A developer database that ran this
branch before the merge has `alembic_version = 0015` meaning *our* old revision: set it to `0014` and restart the backend
so main's 0015 and our 0016 both run (only the outcome CHECK differs between our old 0015 and 0016).

## Phase 9 — classification speed, auto-refresh and review UI (2026-11-07)

Added: `backend/tests/test_pr4_concurrency.py`, `src/lib/hooks/inbox-refetch.test.ts`.
Modified: `backend/config.py`, `backend/.env.example`, `backend/inbox/classification_worker.py` (classify up to 4 emails at once, 60 per sweep),
`src/lib/hooks/use-inbox.ts` (4 s poll while classifying; reload reviews and applications when it finishes),
`src/components/app/candidate/inbox/{inbox-reader.tsx, email-review-panel.tsx}` ("Review email" button beside the subject; form hidden until opened),
`src/components/app/candidate/applications/applications-tab.tsx` (Move On shown; counts split).
Migration: none. API: none. Limits: a submitted review decision was not run live in this phase.

## Remaining limits

Sign-offs needed at review: G2 status mapping, G3 contracts, G4 Incomplete → Applied, G6 migration, G7 logger, G8
endpoint (all Abdul). Board column paging deferred (D-20 note). Jobs: the backend has no per-candidate job list yet (Zuhair), so saving a
job that is not linked to the candidate is refused with a clear message; the job detail page's personal "Save" bookmark
and Hide are still mock marks; hand capture is refused while `jobs` is live (no backend endpoint). Classifying mail imported before switch-on is a later PR
(D-23).
