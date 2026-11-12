# PR 4 — automatic status updates, Undo and the review UI (#127, `feat/inbox-masking-and-review`)

**#127 supersedes #116.** It holds all of Samad's PR 4 work (`codex/pr4-code-correction`, sections below from "Backend"
to "Phase 9"), plus Uzair's masking, Irrelevant and review-UI work, the date fix and three merges with main
(sections "#127 on top of #116" onward).

Authority: `docs/team/samad.md` §1.3–1.5, issue #110 (Abdul's decisions), PR #111 approval conditions. Plan, tracker and
problem log: `docs/integration/pr4-application-workflow/` (`PR_4_IMPLEMENTATION_PLAN.md`, `PR_4_STATUS.md`, `DEBUG.md`).
Base: main 3f8be61 (PR 3 merged), refreshed by merging main 09eb35b (#112 candidates final schema, #107 logging).
One migration, now **0025** (was 0016, then 0022, then 0026, as main took those numbers; it follows Abdul's 0024). Switches ship OFF.

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
| `backend/models/db.py`, `backend/migrations/versions/0025_email_outcome_auto_applied.py` | Outcome `AUTO_APPLIED`; guarded downgrade (renumbered 0015 → 0016 → 0022 → 0026 → 0025 as main took those numbers) |
| Tests (new) | `test_pr4_backfill.py`, `test_migration_0025.py`, `test_pr4_classifier_gate.py`, `test_pr4_confidence.py`, `test_pr4_email_parts.py`, `test_pr4_spend.py`, `test_pr4_match_eligibility.py`, `test_pr4_counts.py`, `test_pr4_review_api.py`, `test_pr4_automation.py`, `test_migration_0016.py` |
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

## Merge with main: PR 8 (#125), 2026-11-11

Conflicts resolved: Follow-ups is gone (main removed it, 07 Q61), so this branch's `useFollowups`, `followupsApi`,
`followupsMock`, `FollowUpTask`, the `followups` key and the board's follow-up date go with it; the live applications
adapter, counts, save/unsave, Undo, pending moves, the review column and Move On are kept; the Applications page has
main's URL filters and chips with this branch's "Saving…" state. `FIXTURE_VERSION` recomputed. PR 8's Activity dashboard
moved to the new stage list, placements became offers (Offer is the last stage): see
[pr8-owner-dashboard.md](./pr8-owner-dashboard.md) and [cross-area-changes.md](../cross-area-changes.md).

**Stage dates on live data** (`src/lib/api/dto/applications.ts`): the backend stores no response, interview or offer
date, and the mapper set all three to `null`, so Responses, % heard back and the Finance tab's Interviews showed 0.
They are now read off the history and the booked interviews, as docs/integration/03 planned: heard back = the first
move out of Applied (a correction back to Saved doesn't count; Move On does), interview = the earliest booking not
cancelled, else the first move to Interview scheduled, offer = the first move to Offer or a legacy Placed. Not counted
yet: a reply still waiting in BDE review (the new inbox doesn't fill `last_email_received`).

## Phase 9 — classification speed, auto-refresh and review UI (2026-11-07)

Added: `backend/tests/test_pr4_concurrency.py`, `src/lib/hooks/inbox-refetch.test.ts`.
Modified: `backend/config.py`, `backend/.env.example`, `backend/inbox/classification_worker.py` (classify up to 4 emails at once, 60 per sweep),
`src/lib/hooks/use-inbox.ts` (4 s poll while classifying; reload reviews and applications when it finishes),
`src/components/app/candidate/inbox/{inbox-reader.tsx, email-review-panel.tsx}` ("Review email" button beside the subject; form hidden until opened),
`src/components/app/candidate/applications/applications-tab.tsx` (Move On shown; counts split).
Migration: none. API: none. Limits: a submitted review decision was not run live in this phase.

## #127 on top of #116: masking, Irrelevant, BDE review UI (Uzair, 2026-11-09)

Supersedes #116 (Samad's commits kept). Decisions: Other shown as Irrelevant (2026-11-07); Presidio approved by Abdul.

| File | Change |
|---|---|
| `backend/inbox/masking.py` (new) | `mask_for_classifier(text, known)`: layer 1 the candidate's and sender's known values; layer 2 validated patterns (IN/US/GB phones, Aadhaar, bank, IFSC, UPI, PAN, addresses); layer 3 Presidio 2.2.362 with `en_core_web_lg`, threshold 0.4, no network (its email recognizer removed). Fails closed |
| `backend/inbox/classification_worker.py` | `_known_identity` (candidate name, email, phone, LinkedIn, mailbox, sender; never stored or logged) passed to the classifier; a confident Other is no longer hidden or encrypted, only given `other_purge_after` |
| `backend/inbox/decider.py` | The request is built from masked text (`build_request` → `mask_for_classifier`) |
| `backend/inbox/retention.py` | The purge selects Other by `other_purge_after` (earlier hidden mail still qualifies) and skips mail linked to an application |
| `backend/inbox/policy.py` | "next round" / "next interview" is a repeated round only when the email's category equals the application's current stage |
| `backend/inbox/sync_jobs.py` | Gmail `labelAdded` history events are imported: mail moved into INBOX from Spam or the archive arrives |
| `backend/api/routes_inbox.py`, `backend/auth/access.py` | `POST …/inbox-messages/{message_id}/review/open` (FIRM; `application.move`) |
| `backend/requirements.txt` | `presidio-analyzer==2.2.362`, `spacy==3.8.18`, `phonenumbers==9.0.42`, `en_core_web_lg` 3.8.0 pinned by URL and sha256 (**the image needs a rebuild**, about +600 MB) |
| Backend tests | masking (5), résumé identity reaches `known`, Other shown with a purge date and linked rows kept, next-round policy (3), `review/open` (3), moved-in mail imported once; isolation case for `review/open` |
| `applications-tab.tsx`, `irrelevant-emails.tsx` (new) | Tabs **Active · BDE review · Irrelevant** (was All · Active · Irrelevant); scroll kept on tab switch |
| `application-board.tsx`, `application-card.tsx`, `application-list.tsx`, `needs-review-badge.tsx` (new) | Drag overlay portalled to `body` (the frame's backdrop filter offset it); "BDE review" badge replaces the email stage badge |
| `inbox-tab.tsx`, `inbox-reader.tsx`, `inbox-connect.tsx`, `disconnect-mailbox-dialog.tsx` (new) | Filters All + every category; "Review email" on Irrelevant mail; body skeleton in place; confirm before disconnecting |
| `email-review-panel.tsx`, `review-reason.ts`, `signal-meta.ts`, `lib/api/inbox.ts`, `use-email-reviews.ts` | "Irrelevant" in the stage list, Dismiss removed; the open-review call |
| Frontend tests | board, card, Irrelevant list, disconnect dialog, review panel |

Evidence: masking parity 735 of 738 labelled emails classified the same; no network during masking; a real request
checked masked.

## Merge with main: #128 (resilient candidate links, one application count), 2026-11-11

#128 (BUG-005) gave every screen one count of applications, written on the old stages. On this branch: active =
submitted and not closed (every stage Applied to Offer), closed = Move On and the legacy closed values, a legacy Placed on
its own, a saved job never active (`src/lib/derive/application-counts.ts`). The candidate's Active board keeps its Saved
and Move On columns (no "All" view here); the line above it reads "N active · M closed · S saved". No "All" tab: this
is what Uzair agreed with Abdul Muqtadir (2026-11-12), although the #128 thread records "Active excludes Saved and Placed; All
shows them". Arbaz's review fix `689fbc0` brought All back; it was removed again for that reason; logged in
[cross-area-changes.md](../cross-area-changes.md).

## Merge with main: #135 (job screens on `job_postings`), 2026-11-12

The job screens read `job_postings`; the candidates, résumés and jobs mocks are gone (#135). PR 4's old-feed jobs code
(`GET /api/jobs`, its mapper and tests) is replaced by #135's. The heart keeps PR 4's save to Applications (Abdul's
decision 1 on #135); the preview's Open original saves too. Migration renumbered **0022 → 0026** (main took 0022–0023;
0024–0025 are Arbaz's #129); its test is `test_migration_0026.py`. CI's backend limit raised to 60 minutes (`adec998`).

## Merge with main: #120 and #126, 2026-11-12

Abdul's #120 added migration 0024 (drop `firms.bde_capacity`) after 0023, beside PR 4's 0026 (two heads). PR 4's
migration is now **0025**, after 0024 (`test_migration_0025.py`); Arbaz's #129 takes 0026–0027. Other conflicts: the
migration table and `FIXTURE_VERSION`. Umamah's #126 (extension) merged without conflicts.


## Abdul's review on #127 (2026-11-12)

| # | Finding | Fix |
|---|---|---|
| 1 (P1) | An email could still be sent after a disconnect or deletion during masking | `classification_worker._still_sendable` runs before masking and again just before the dispatch is marked; tests disconnect the mailbox and delete the email during masking (`test_pr4_classifier_gate.py`) |
| 2 | A stale purge date could erase an email no longer Irrelevant | The worker clears `other_purge_after` whenever a newer result isn't Irrelevant; the purge also requires the latest outcome `OTHER` (`test_pr3_pipeline.py`) |
| 3 | The heart sends a posting id the save route can't find | Open: the save route moves onto `job_postings` in Arbaz's #129 |
| 4 | "Résumé sent" said "Not submitted yet" for every live application | The application data carries `resume_id`; the mapper reads it (docs/02 §9) |
| 5 | The review tabs were hidden for a candidate with no applications | The empty state is inside the Active view; the tabs always show |
| 6 | Timeline entries from an email didn't link to it | "Open the email" on each such entry; the candidate page opens `?tab=inbox&message=<id>` (`status-timeline.test.tsx`) |
| 7 | Disconnect did nothing on an empty, expired inbox | The confirmation dialog renders on that screen too |
| 8 | The open email stayed on "Classifying…" | The open email is reloaded when a classification finishes |
| 9 | The Applications tab reset on Back | The tab is in the URL (`applications_tab`) |

Also: the Gmail connect card's consent-style text (CodeRabbit) is a short line with an info tip (`src/components/app/info-tip.tsx`).

## Remaining limits

- **Until Arbaz's #129 (applications on `job_postings`):** the heart answers "Job not found"; the application page's job
  is plain text, not a link. Whichever of #127 and #129 merges second points its first migration at the other's last,
  and **#127's two new `app.job.title` uses in `backend/applications/tracking.py` (automatic change ≈ l.258, Undo
  ≈ l.314) become `posting_job(app.posting).title`** — git may merge them without a conflict, and the ledger write would
  then fail.
- Responses: a reply still waiting in BDE review doesn't count as heard back (the new inbox doesn't fill
  `last_email_received`).
- axe findings on the dashboards and board (colour contrast, an empty table header, board roles) predate these merges.


Sign-offs needed at review: G2 status mapping, G3 contracts, G4 Incomplete → Applied, G6 migration, G7 logger, G8
endpoint (all Abdul). Board column paging deferred (D-20 note). Jobs: the backend has no per-candidate job list yet (Zuhair), so saving a
job that is not linked to the candidate is refused with a clear message; the job detail page's personal "Save" bookmark
and Hide are still mock marks; hand capture is refused while `jobs` is live (no backend endpoint). Mail imported before switch-on is classified by the historical batches behind
`CANDIDATE_EMAIL_HISTORICAL_ENABLED` (off by default; review only, D-23).
