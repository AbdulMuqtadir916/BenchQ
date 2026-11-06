# PR 4 — automatic status updates, Undo and the review UI (`codex/pr4-code-correction`)

Authority: `docs/team/samad.md` §1.3–1.5, issue #110 (Abdul's decisions), PR #111 approval conditions. Plan, tracker and
problem log: `docs/integration/pr4-application-workflow/` (`PR_4_IMPLEMENTATION_PLAN.md`, `PR_4_STATUS.md`, `DEBUG.md`).
Base: main 3f8be61 (PR 3 merged). One migration (0015). Switches ship OFF.

## Backend

| File | Change |
|---|---|
| `backend/inbox/classifier_pause.py` (new) | Configuration-scoped pause after 401/403; atomic probe lease; recovery (D-03) |
| `backend/inbox/classification_worker.py` | Config/pause gate before any claim; dispatch marker; finalized check; cost accounting; reply/forward rules and uncertainty before Other hiding; email-history replay rules; automatic write before inserting the immutable result; aliases once per sweep; removed duplicate eligibility guard |
| `backend/inbox/decider.py`, `decider_categories.py` | `PROVIDER_AUTH_REJECTED`; structural checks only; `decision_value` (min) and `values_disagree` (> 0.10); `is_configured` (D-01, D-02) |
| `backend/inbox/application_matching.py` | `email_parts`/`ai_input`/`has_too_little_text` (reply vs forward, D-04); `is_match_eligible` (D-07); `company_aliases` (D-21) |
| `backend/inbox/delivery_evidence.py` | Gmail's own ARC seals no longer hide a valid verdict; foreign ARC hop stays UNKNOWN (D-26) |
| `backend/inbox/policy.py` | Thresholds use the decision value; Incomplete → Applied rule (D-14) |
| `backend/applications/tracking.py` | `automation_ready`, `email_history`, `apply_email_decision` (savepoint: status + event + ledger), `undo_email_decision` (D-11, D-12, D-13) |
| `backend/api/routes_applications.py` | Shared `_application_scope`; `GET /applications/counts`; `POST …/status-events/{event_id}/undo`; review route refuses `saved` |
| `backend/api/routes_inbox.py` | Review list newest first with subject/sender/received/total and cursor; Dismiss never links; review stages; message revisions in JSON; retry/reclassify 409 while paused |
| `backend/api` access: `backend/auth/access.py` | New routes registered (FIRM) |
| `backend/ai/config.py` | `AiModule.fallback`; email classification never borrows the primary provider |
| `backend/analyzer/llm_logger.py` | Optional `cost_usd` and `db` (savepoint, never commits the caller's transaction) — owner: Abdul |
| `backend/main.py` | `llm-costs` adds `candidate_email_classification.{unpriced_calls, unconfirmed_calls}` |
| `backend/config.py`, `backend/.env.example` | Automation switches (default off) |
| `backend/models/db.py`, `backend/migrations/versions/0016_email_outcome_auto_applied.py` | Outcome `AUTO_APPLIED`; guarded downgrade |
| Tests (new) | `test_pr4_classifier_gate.py`, `test_pr4_confidence.py`, `test_pr4_email_parts.py`, `test_pr4_spend.py`, `test_pr4_match_eligibility.py`, `test_pr4_counts.py`, `test_pr4_review_api.py`, `test_pr4_automation.py`, `test_migration_0016.py` |
| Tests (changed) | `test_pr3_provider.py` (mismatched confidence is no longer a failure; Gmail ARC cases), `isolation_cases.py`/`isolation_support.py` (counts and Undo routes, automatic-change fixture) |

## Frontend

| Area | Files | Change |
|---|---|---|
| Vocabulary | `schemas/enums.ts`, `components/app/applications/status-meta.ts`, `lib/derive/funnel.ts` | Ten statuses + read-only legacy group; one source for pipeline/labels/icons/tones; funnel from the pipeline |
| Applications live | `lib/api/applications.ts`, `lib/api/dto/applications.ts`, `schemas/application.ts` | All pages; counts; `statusRevision`, `pendingReviewCount`, event `source`/`revision`/`emailId`; Undo |
| Moves | `lib/hooks/use-applications.ts`, `lib/query/keys.ts`, `lib/utils.ts` | One move per application (lock), server-only cache with "Saving…" overlay, `newCommandId`, counts hook, Undo hook |
| Board/drawer/detail | `application-board.tsx`, `application-card.tsx`, `application-drawer.tsx`, `application-list.tsx`, `status-timeline.tsx`, `automatic-change.tsx` (new), pages | Ten columns + Older statuses; any-stage moves; pending-review block; Set status; automatic-change notice with Undo; timeline by source |
| Review loop | `schemas/inbox.ts`, `lib/api/inbox.ts`, `lib/api/dto/inbox.ts`, `lib/hooks/use-email-reviews.ts` (new), `email-review-panel.tsx` (new), `review-queue.tsx` (new), `review-reason.ts` (new), `inbox-reader.tsx`, `inbox-tab.tsx`, `applications-tab.tsx`, `use-candidate-workspace.ts` | Review contracts, panel, BDE review column, reasons |
| Inbox badges | `components/app/inbox/signal-meta.ts`, `activity-tab.tsx`, `attention-card.tsx`, `inbox-preview.tsx` | Category badges; processing states; no "Email: Email" |
| Mocks | `mocks/data/*.json`, `mocks/applications.ts`, `mocks/db.ts`, mock tests | Fixtures on the new values (legacy samples kept); fingerprint updated |
| Tests (new) | `dto/applications.test.ts`, `utils.test.ts`, `review-reason.test.ts`, `signal-meta.test.ts`, `automatic-change.test.ts` | |

## Docs

`docs/02-DATA-CONTRACTS.md` ("PR 4 as built"), `docs/integration/pr3-email-classification/OPERATIONS.md` (setup,
routing, spend, endpoint decision, switch-on conditions, automation and activation), this report, and the PR 4 folder.

## Not for the PR

`.claude/launch.json` (local pnpm path), `backend/.env`, `.env.local`.

## Remaining limits

Sign-offs needed at review: G2 status mapping, G3 contracts, G4 Incomplete → Applied, G6 migration, G7 logger, G8
endpoint (all Abdul). Board column paging deferred (D-20 note). Classifying mail imported before switch-on is a later PR
(D-23).
