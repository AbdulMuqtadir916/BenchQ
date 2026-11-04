# PR 3 — Email classification and review backend

Problem: imported encrypted candidate mail has no durable category/match/review evidence. This slice classifies transiently decrypted/redacted input, records versioned results and scoped reviews, hides encrypted Other, and preserves readable pending/failed mail. It makes no automatic application-status writes. Current base: merged main c3f5c6b, preserving #104 and its résumé migration 0013.

Authority: [Abdul’s written decision](https://github.com/AbdulMuqtadir916/BenchQ/issues/110#issuecomment-6624344616). Exact vocabulary/legacy mapping sign-off remains a PR 4 UI gate. The accepted direction does not itself enable production provider processing, automatic updates or purge.

## Per-file changes

| File | Change and purpose |
|---|---|
| `.env.example` | Document independently OFF external-classification and retention/purge gates, including evaluated configuration identity. |
| `backend/.env.example` | Document safe backend defaults; no credential or operational approval is supplied. |
| `backend/ai/config.py` | Register a dedicated candidate-email module through the shared AI configuration seam. |
| `backend/api/routes_inbox.py` | Central Other/deleted visibility, readable pending/failed metadata, version-safe review/link/retry/reclassification, scoped command idempotency and complete explicit erasure/cancellation. |
| `backend/applications/tracking.py` | Remove Other from new-write statuses while preserving identical historical command replay before new-write validation. |
| `backend/auth/access.py` | Classify each new review/classification endpoint centrally as firm scoped. |
| `backend/config.py` | Default all sensitive processing/purge gates OFF and bind purge to the evaluated model/policy fingerprint. |
| `backend/inbox/application_matching.py` | Reuse conservative submitted-app matching with transient decryption, source/tombstone guards, quote/signature removal and opt-in validated thread context; no fixture-specific title shortcuts. |
| `backend/inbox/classification_worker.py` | Durable versioned evidence, bounded owner-token leases/retries, current-source backfill, provider-I/O fencing and lean JobRun usage; no automatic status writes. |
| `backend/inbox/decider.py` | Configurable bounded Decisions adapter, one HTTP attempt, strict categories/probability/confidence checks, minimization and safe usage/errors. |
| `backend/inbox/decider_categories.py` | Retain the ten email categories and approved 0.8 boundary; remove unused direct status mapping and hardcoded dispatch model. |
| `backend/inbox/delivery_evidence.py` | Conservative Gmail authentication normalization and exact From-domain alignment; retain only PASS/FAIL/UNKNOWN, not raw headers. |
| `backend/inbox/evaluation.py` | Offline independent-label scoring, per-category metrics and shadow would-remove detection; never enables runtime gates or calls a model. |
| `backend/inbox/gmail_sync.py` | Capture normalized sender authentication and trusted receive-time provenance while preserving encrypted Inbox import protections. |
| `backend/inbox/policy.py` | Record review/no-op reasons for threshold, outcomes, authentication, time, rounds and stage context; never execute status changes. |
| `backend/inbox/retention.py` | Central readability and gated 30-day Other cleanup, protected prior human/job evidence, derivative erasure and minimal dedup tombstones. |
| `backend/inbox/safe_text.py` | Bounded redaction of common contact/credential/government/financial identifiers; not a claim of anonymization. |
| `backend/inbox/sync_jobs.py` | Wake a bounded classifier after import commits; durable pending rows recover lost notifications. |
| `backend/migrations/versions/0014_candidate_email_classification.py` | One additive schema revision: versioned results, normalized provenance, processing/retention fields, legacy-safe review versioning and immutable evidence protection; guarded downgrade. |
| `backend/models/candidates.py` | Add lean processing/retry/lease, normalized authentication/time and hidden-Other retention fields and constraints. |
| `backend/models/db.py` | Define versioned classifications and nullable/versioned review linkage while preserving application and immutable status history structures. |
| `backend/scheduler.py` | Schedule bounded classification recovery and independently gated retention cleanup. |
| `backend/seed.py` | Recognize dedicated candidate-email AI runtime setting keys without seeding secrets or copying legacy model configuration. |
| `backend/settings_scope.py` | Keep all candidate-email provider/model/key/prompt settings in platform AI preset scope. |
| `backend/tests/fixtures/email_classification/initial_labels.json` | 24 authored synthetic examples; independent of Decider outputs; owner adjudication and actual model predictions remain pending. |
| `backend/tests/isolation_cases.py` | Inventory all new routes with valid payloads and isolated operation preconditions. |
| `backend/tests/isolation_support.py` | Disable provider I/O in F7 while permitting safe synthetic classification command preconditions. |
| `backend/tests/test_application_tracker.py` | Preserve revision/immutable-event tests using supported stage selections instead of Other. |
| `backend/tests/test_candidate_application_status.py` | Remove Other from allowed new-stage expectations; explicit rejection tests cover it separately. |
| `backend/tests/test_isolation.py` | Apply each route's explicit fixture preconditions equally to both tenants before isolation assertions. |
| `backend/tests/test_migration_0012.py` | Compare protected rollback with the current migration head so the existing Gmail safety regression remains valid after a new additive revision. |
| `backend/tests/test_migration_0013.py` | Preserve main’s résumé-versioning migration regression tests. |
| `backend/tests/test_migration_0014.py` | Verify classification migration roundtrip and refuse downgrade when classification claims would be lost. |
| `backend/tests/test_pr3_evaluation.py` | Ensure incomplete predictions and job-related Other outcomes cannot produce a false safe-purge report; not a real-model accuracy test. |
| `backend/tests/test_pr3_matching.py` | Encrypted matching, wrong scope/source/deletion, unique/ambiguous threads/names, aliases, legacy drafts and quoted/signature evidence regressions. |
| `backend/tests/test_pr3_pipeline.py` | Synthetic end-to-end no-status-write, auth/threshold/outcomes, visibility/erasure, retry/fencing, review versioning/idempotency and retention-gate regressions. |
| `backend/tests/test_pr3_provider.py` | Strict output validation, redaction/injection boundary, aligned/forged/duplicate sender evidence and one-attempt provider errors. |
| `backend/tests/test_pr3_status_policy.py` | Reject Other via direct/review/bulk/legacy candidate mutation, preserve historical reads/replay. |
| `docs/02-DATA-CONTRACTS.md` | Document final selectable vocabulary, no-loss legacy mapping awaiting PR 4 sign-off, and exact PR 3 schema/API/readability boundaries. |
| `docs/integration/06-open-decisions.md` | Resolve the obsolete D3 design options and record truthful remaining vocabulary-mapping sign-off. |
| `docs/team/samad.md` | Canonical reviewer source for Abdul's approved PR split, 0.8 policy, outcome review, 30-day retention and future prefilter. |
| `src/components/app/candidate/activity-tab.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/candidate/applications/application-drawer.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/candidate/inbox/inbox-reader.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/candidate/inbox/inbox-tab.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/candidate/overview/attention-card.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/candidate/overview/inbox-preview.tsx` | Pass Inbox processing state into the shared badge helper; no layout/stage-order or review-workflow redesign. |
| `src/components/app/inbox/signal-meta.ts` | Show Not classified for pending/failed and generic Classified for completed state without new application-stage mapping. |
| `src/lib/api/dto/inbox.ts` | Carry safe processing state through the Inbox adapter; detailed stage UI stays in PR 4. |
| `src/lib/schemas/inbox.ts` | Add optional processing-state compatibility without changing application status vocabulary. |
| `docs/integration/pr3-email-classification/IMPLEMENTATION_PLAN.md` | Approved modular implementation scope, database/API approach and PR 4 boundaries. |
| `docs/integration/pr3-email-classification/STATUS.md` | Verified implementation checklist, test evidence and explicit external launch gates. |
| `docs/integration/pr3-email-classification/OPERATIONS.md` | Default-OFF gates, provider setup, trust limitations and retention/evaluation requirements. |
| `docs/team/pr-changes/codex-pr3-local-review.md` | This per-file scope, verification and operational-limit record. |

Publish the current implementation plan, status checklist and operations boundaries with this PR. Other local drafts/historical proposals are excluded and are not product contracts. No existing dirty development-source files were overwritten by the isolated implementation.

## Schema and compatibility

One additive revision 0014 after main revision 0013 (résumé versioning). Main’s migration tests remain at 0013; PR 3 tests and downgrade target 0014/0013. New-to-main email_classifications adapts the existing local concept; no parallel sender, job, history or attempt table. Existing JobRun stores minimal usage/command metadata. Existing application_reviews preserve legacy constraints and append classified result versions, including unmatched mail. Removing content cancels pending review without accepting an AI status; actor/audit and immutable historical events remain.

Other is no longer selectable for new candidate status commands, but identical historical Other command replays/reads remain valid. Existing Notes, applications.resume_id/submission facts and firm/candidate access remain. The only UI change here is processing-state/badge compatibility; PR 4 owns stages, review workflow integration, automatic execution and usable Undo.

## Verification (updated as checks finish)

- Final affected schema/pipeline/provider/matching/status/evaluation suite: **102 passed**, including migration roundtrip and guarded downgrade. Earlier 58-test endpoint/isolation slice also passed.
- Frontend: 588 tests passed; typecheck and lint passed using the same installed Node CLI entry points as package scripts (native pnpm launcher stalled locally).
- Production build: passed (Next 16.3.5, webpack).
- Full non-live backend suite on disposable synthetic Postgres: **3,976 passed, 11 skipped, 54 live deselected, 13 expected failures, 6 warnings** (32m09s), zero unexpected failures. Existing Starlette/httpx and unrelated scraper coroutine warnings remain.
- Final new endpoint tenant-isolation checks: **4 passed** in two focused runs. Main fetched and unchanged at **42dedb6**; one migration head verified through model/migration checks.
- Compile and diff-whitespace checks passed. No real Gmail or candidate messages/provider calls used in tests. No actual model-accuracy claim.

## Limits and launch gates

All classification/real-mail and purge flags default OFF. External real-mail calls need written provider/downstream retention/logging and consent/Google checks. Automatic status changes require PR 4/Undo and >=0.8 with approved targets/authentication; Offer/Move On always review. No automatic writer ships in this PR.

Hidden Other stays encrypted 30 days. Purge needs evaluated zero job-related shadow would-remove decisions AND a matching recorded model/prompt/policy fingerprint; flags/report cannot inherit approval after model/policy changes. A correct Other label can still describe job-related under-review mail: the initial corpus exposes this risk, so purge evaluation/activation remains blocked until a safe selection rule is demonstrated. Evaluation harness tests do not prove model accuracy.

Sender header normalization is conservative: missing/duplicate/ARC/unproven evidence stays UNKNOWN; validate Gmail trust-boundary fixtures before PR 4 relies on PASS. Usage can be UNKNOWN after timeouts/crashes and needs reconciliation, never reported as free. Current single-process scheduler assumptions remain; no worker-platform redesign, manual sender approval or quarantine-release UI.

User authorized PR publication after local review on 2026-11-04. No merge, real-mail AI activation or purge activation is authorized by publishing this PR.
