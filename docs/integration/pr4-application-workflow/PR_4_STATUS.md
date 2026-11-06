# PR 4 status — live tracker

Plan: [PR_4_IMPLEMENTATION_PLAN.md](./PR_4_IMPLEMENTATION_PLAN.md) · Fixes: [DEBUG.md](./DEBUG.md)
Branch `codex/pr4-code-correction` · Folder `~/Documents/cloned` · Base main 3f8be61 (PR 3 merged)

**Rule:** tick a task only when its completion criteria in the plan are met and the evidence is written below.

<!-- LIVE -->
## Live

- **Now:** implementation and checks complete (36 of 38 tasks). Full backend 3852 passed / 0 failed; frontend 613 tests,
  typecheck, lint, build passed; live classification, review loop, automatic move, Undo and setup recovery verified.
- **Next:** reconcile docs (done 2026-11-06), then T5.5 PR **only on Samad's instruction**; T6.1 production activation
  after merge.
- **Approvals still needed (not obtained by implementing):** Abdul — G2 status mapping, G3 contracts, G4 Incomplete →
  Applied, G6 migration 0016, G7 logger change, G8 endpoint decision. Samad's go-ahead to build them was given; their
  sign-off happens at PR review.
- **Local only (not for the PR):** automation, setup recovery and real-mail switches are on in `cloned/backend/.env`;
  `.claude/launch.json` pnpm path; `.env.local`.
- **Progress:** 36 of 38 tasks complete.
<!-- END LIVE -->

## Gates
- [x] G1 Plan + DEBUG.md approved by Samad (2026-11-06)
- [ ] G2 Abdul signs docs/02 §2.1 status mapping
- [ ] G3 Contracts in docs/02 (`statusRevision`, counts endpoint, review list fields, Undo API, new review reasons)
- [ ] G4 Abdul decides Incomplete → Applied
- [x] G5 Dedicated test Gmail + test candidate; approval to write classifier settings in the dev DB (Samad, 2026-11-06)
- [ ] G6 Abdul approves the `AUTO_APPLIED` migration (0016)
- [ ] G7 Logger owner informed (`cost_usd`, `db` arguments) — not yet; deferred by Samad until after testing
- [ ] G8 Abdul accepts the endpoint decision — not yet; deferred by Samad until after testing

## Pre-work (done, not counted)
- [x] Applications adapter: live list/detail and Saved → Applied (uncommitted; reworked by T2.1, T2.2, T2.5).
      2026-11-05: typecheck, lint, 596 frontend tests; browser move verified.
- [x] Code and docs audit; PROBLEMS_AND_SOLUTIONS.md; DEBUG.md rounds 1–4; plan and tracker.
- [x] Dev data: 11 synthetic jobs for Rajesh (2 Applied). Personal Gmail connected to Rajesh (to be replaced, D-25).

## Phase 1 — Classification produces correct, counted results
- [x] T1.1 Config guard + pause/probe lease
- [x] T1.2 Confidence rules
- [x] T1.3 Reply/forward split + precedence over Other hiding
- [x] T1.4 AI spend accounting
- [x] T1.5 OPERATIONS.md setup + switch-on conditions
- [x] T1.6 Isolated live check (G5 done; G7/G8 deferred by Samad for this check)

## Phase 2 — Board shows every status
- [x] T2.1 Ten statuses + legacy group (G2)
- [x] T2.2 `statusRevision`, move lock, "Saving…" overlay (G3)
- [x] T2.3 `is_match_eligible`
- [x] T2.4 `newCommandId()`
- [x] T2.5 Counts endpoint, paged columns, `UNSUPPORTED_STATUS` (G3)
- [x] T2.6 Browser check

## Phase 3 — Review loop
- [x] T3.1 Review list order + fields
- [x] T3.2 Dismiss ignores applications
- [x] T3.3 Allowed review stages
- [x] T3.4 Frontend review hook, panel, column, reason labels
- [x] T3.5 Block known-invalid moves
- [x] T3.6 Isolated live review check

## Phase 4 — Automatic updates and Undo
- [x] T4.1 Migration + writer + replay cases (G6)
- [x] T4.2 Pending review vs newer email
- [x] T4.3 Undo endpoint + UI
- [x] T4.4 Incomplete → Applied (G4)
- [x] T4.5 Timeline source labels
- [x] T4.6 Isolated live automation + Undo check

## Phase 5 — Finish and delivery
- [x] T5.1 Inbox badges + "Email: Email"
- [x] T5.2 Alias loading
- [x] T5.3 Docs + per-file report
- [x] T5.4 Full checks
- [ ] T5.5 PR (only on Samad's instruction)

## Phase 7 — Setup recovery, clearer states, older mail
- [x] T7.1 Setup-failure recovery
- [x] T7.2 Inbox states, failure reason, Retry
- [x] T7.3 Historical classification, review only
- [x] T7.4 Tests control automation settings; PR 3 stub fixed
- [x] T7.5 Live counts reported and approved before running

## Phase 6 — Activation (after merge)
- [ ] T6.1 Activation checklist signed off

## Open questions
- "How we use disconnect": unlinking a wrongly linked email? Not in PR 4 unless decided.
- Saved as a review choice? (Selected: no.)

## Evidence log
2026-11-06: DEBUG.md revised through review rounds 2–4; plan and tracker synchronised (migration, Phase-1 spend and
endpoint decision, dedicated test mailbox, counts endpoint, activation phase). No code changed.

2026-11-06, Phase 1 (T1.1–T1.5), branch `codex/pr4-code-correction`, uncommitted. Tests run in a throwaway container
mounting `cloned/backend`, both database URLs on the disposable `jobnavigator_test` (dev DB untouched).
- Baseline before changes: PR 3 suites 101 passed.
- T1.1 `classifier_pause.py` (new), worker gate before claim, `PROVIDER_AUTH_REJECTED`, no fallback for
  `email_classification` (`ai/config.py`), retry/reclassify 409 while paused. New `test_pr4_classifier_gate.py`: 9 passed.
- T1.2 structural checks only, `decision_value` = min, `CONFIDENCE_DISAGREEMENT` > 0.10 (in `config_identity`).
  `test_pr3_provider.py`: the `wrong_confidence` strict case replaced by `out_of_range_confidence` (intended change).
  New `test_pr4_confidence.py`.
- T1.3 `email_parts`/`ai_input`/`has_too_little_text` in `application_matching.py`; reply vs forward rules; forwarded,
  too-little-text and disagreement before Other hiding. New `test_pr4_email_parts.py`. PR 3 matching tests unchanged and passing.
- T1.4 dispatch marker before the call, finalized check under lock, `_account` writes one `llm_call_log` row
  (ACTUAL/ESTIMATED) in the result transaction; `log_llm_call` gains optional `cost_usd`/`db` (additive; G7 pending);
  `GET /api/stats/llm-costs` adds `candidate_email_classification.unpriced_calls/unconfirmed_calls`. New `test_pr4_spend.py`: 6 passed.
- T1.5 OPERATIONS.md: setup checklist, routing rules, spend, endpoint decision, switch-on conditions.
- Affected backend set (41 files touching logger, stats, AI config, inbox, classification, isolation): **734 passed,
  3 xfailed** (pre-existing). Full non-live suite on this branch: **3807 passed, 13 skipped, 51 deselected (live), 13 xfailed** (pre-existing), 0 failed, 20m31s.
- No frontend change in Phase 1; new review reasons get labels in T3.4.

2026-11-06, T1.6 gate check (read-only): Manoj's test Gmail CONNECTED; `candidate_email_llm_*` absent; no G7/G8
record on #110/#111 since 2026-11-05 (llm_logger owner per cross-area-changes.md:76: Abdul); Rajesh's personal
mailbox still CONNECTED with classification on (94 emails ERROR `CLASSIFIER_NOT_CONFIGURED`); Manoj 25 ERROR;
`benchq-pr4-backend-1` mounts `benchq-pr4/backend` (old code). No live call made.

2026-11-06, T1.6 setup (Samad: "do all change as you want"; G7/G8 deferred until after this performance check — recorded
override of OPERATIONS.md switch-on condition 2 for this isolated test only):
- Rajesh's personal mailbox disconnected through the app API (token revoked, 94 emails retained). Only Manoj's test
  mailbox is connected.
- Dev DB settings written: `candidate_email_llm_provider=openrouter`, `candidate_email_llm_model=perplexity/pplx-decider-v1.2`,
  `candidate_email_llm_api_key` (from `.env.llm-key`, not printed).
- `backend/.env` copied into `cloned` (gitignored); backend container recreated from `~/Documents/cloned/backend`
  (`--no-deps`; databases untouched). Flags: classification ON, real-mail approval ON, auto status OFF, automation approval OFF.
- Synthetic job "Data Platform Engineer — Synthetic Demo" (company "BenchQ Synthetic Demo") linked to Manoj, saved and
  moved to Applied through the app API (revision 1). Waiting for one newly authored test email.

2026-11-06 ~12:00 UTC, **T1.6 passed** (Manoj's test mailbox; 8 emails authored by Samad, imported 11:51–11:57):
- All 8 `DONE`, no errors. Categories match the subjects: screening_call, applied, shortlisted,
  interview_schedule_request, interview_scheduled, assessment, move_on, other. Provider confidence vs chosen probability
  differed by ~0.001 (e.g. 0.9849 / 0.9864): accepted, no `INVALID_CONFIDENCE` (D-01 fix proven live).
- 7 pending reviews `UNMATCHED` (the emails named companies/roles that are not Manoj's applications); the confident
  Other was hidden and encrypted; Manoj's application stayed `applied`, revision 1 (no status write).
- Spend: 8 `llm_call_log` rows, purpose `email_classification`, ACTUAL, total $0.000077; 8 job runs `completed`,
  `dispatch_started`, `cost_quality=ACTUAL`. The Decisions API returns `usage.cost` only (no token counts), so tokens are 0.
- Finding D-26: every email's sender verdict was `UNKNOWN` although Gmail recorded dkim/spf/dmarc=pass. Cause: the
  parser rejects any `ARC-*` header, and Gmail adds its own ARC seals (authserv `mx.google.com`) to ordinary mail.
  Fixed in Phase 1 follow-up (see DEBUG.md D-26).

2026-11-06, **Phase 2 done** (Samad approved proceeding; G2/G3 sign-off by Abdul still needed at PR review):
- T2.1 `ApplicationStatus` = the ten docs/02 §2.1 values; `LegacyApplicationStatus` (read-only, labelled "(legacy)",
  never selectable or hidden); `StoredApplicationStatus` for records/events. `status-meta.ts` is the single source
  (pipeline, closed, labels, icons, tones, `isActive`, `reachedOffer`). Board: ten columns (pipeline, Incomplete,
  Move On) plus a read-only "Older statuses" column whenever a legacy value exists; drops to any stage (D1).
  Drawer: shared progress, Incomplete and legacy notes, "Set status" picker, "Mark not selected" = Move On.
  Funnel rebuilt from the pipeline (skipped stages count as reached; legacy Placed = Offer, D6). Mapper: exact
  conversion, legacy table, UNKNOWN; no row is hidden. Mock fixtures moved to the new values (legacy samples kept).
- T2.2 `statusRevision` on `ApplicationSchema`; hidden revision map removed; move lock (module `Set`, released in
  the mutation's `onSettled`), cache holds server data only, pending overlay via `useMutationState` shown as
  "Saving…"; refused second move shows a message.
- T2.3 `is_match_eligible` + query in `application_matching.py`; worker guard deleted. `test_pr4_match_eligibility.py`.
- T2.4 `newCommandId()` in `src/lib/utils.ts` with a `getRandomValues` fallback; `utils.test.ts`.
- T2.5 `GET /api/applications/counts` sharing `_application_scope` with the list; registered in `access.py` and
  `isolation_cases.py`; adapter `counts()` and `useApplicationCounts`. **Deviation from D-20 (recorded):** instead of
  paged board columns, the adapter reads every page (500 per request, de-duplicated) so dashboards and counters
  built from the list are never truncated; column paging is a later change. `test_pr4_counts.py`.
- T2.6 Browser (dev server from `cloned`, live candidates/applications/inbox): ten columns in order; React Frontend
  Developer moved Applied → Interview scheduled → Move On → Incomplete → Applied through the drawer; events revisions
  2–5 in the DB, no conflicts; reload keeps Applied (firm board Applied 3).
- Checks: frontend typecheck, lint, **599 tests** passed; backend matching/pipeline/eligibility 85 passed; counts +
  F7 isolation + tracker suites 169 passed.

2026-11-06, **Phase 3 done** (review loop):
- T3.1 `/email-reviews` newest first (`created_at DESC, id DESC`), cursor `"<created_at>|<id>"`, returns subject,
  sender, received time and `total_count` (support view: count only). T3.2 Dismiss resolves the review only: no
  link, no application revision check. T3.3 a review may set any stage except Saved (inbox review route and the
  application review route). Messages now carry `content_revision` and `classification_version`.
  New `test_pr4_review_api.py`: 3 passed.
- T3.4 Frontend: `EmailCategory`, `EmailReview`, review page and command contracts (`schemas/inbox.ts`); DTO + adapter
  (`reviews`, `review`; Dismiss sends no application fields); `use-email-reviews.ts` (stable command id per
  decision; refreshes reviews, inbox, opened email and applications); `review-reason.ts` (+ test); review panel in
  the Inbox reader; BDE review column on the candidate Applications tab with loading / error / empty / support-view.
- T3.5 `pendingReviewCount` on applications (from `pending_reviews`): card not draggable and drawer explains why.
- T3.6 Live (Manoj): column showed 7 reviews with reasons; the screening-call email opened from its card; panel
  preselected Screening call; linked to "Data Platform Engineer" and confirmed → review `RESOLVED`
  (`screening_call`), email linked, application `screening_call` rev 2 with event source `bde_review`; column 7 → 6,
  card in Screening call. Found and fixed: the opened email was not refreshed after a decision.
- Checks: frontend typecheck, lint, **602 tests**; backend review/isolation/PR 3/PR 4 suites 327 passed (the 3
  `test_test_preview_body_exclusion.py` failures are a `jobspy` import quirk when that file runs alone; main fails
  identically, and the file passes in the full-suite order).
- Note: the backend container runs uvicorn without reload; it was restarted to load the Phase 2/3 code.

2026-11-06, **Phase 4 (T4.1–T4.5) and Phase 5 (T5.1–T5.3) done**; T4.6 waits for one live email; T5.4 full suite running.
- T4.1 Migration 0016 (`AUTO_APPLIED`, guarded downgrade; `test_migration_0016.py` 2 passed, 0014 still passes).
  Writer `apply_email_decision`: lookup by `(application, command)` first, savepoint around status + event + AGENT
  ledger entry, duplicate returns the existing decision. Classification rows are immutable (DB trigger), so the
  worker writes the status first and inserts the result once with outcome `AUTO_APPLIED`. Replay: same command ⇒
  nothing new; reclassified after an automatic change ⇒ same stage `NO_CHANGE`, different `EMAIL_ALREADY_APPLIED`
  review; after Undo ⇒ `AUTOMATIC_CHANGE_UNDONE` review. Automation off ⇒ specific review reasons as before.
- T4.2 the writer ignores pending reviews; the older review's stale revision gets 409; no silent overwrite.
- T4.3 `POST /api/applications/{id}/status-events/{event_id}/undo` (access FIRM; isolation case with an automatic
  fixture — F7 150 passed); compensating `email_undo` event; idempotent; 409 after a later decision.
  Frontend: `AutomaticChangeNotice` (drawer + application page) with Open email, Undo, conflict/denied messages.
- T4.4 Incomplete + `applied` email ⇒ Applied (all other gates still apply); anything else on Incomplete ⇒
  `MANUAL_STAGE_REVIEW`. (G4 sign-off pending; Samad approved building it.)
- T4.5 History labelled by source (automatic / confirmed from review / undone) with event `source`, `revision`, `emailId`.
- `test_pr4_automation.py`: 14 passed (off, on, each gate, start time, idempotent, reclassify, Undo, later-decision 409,
  pending review vs newer email, Incomplete rule).
- Config: `CANDIDATE_EMAIL_AUTO_STATUS_ENABLED`, `…_AUTOMATION_APPROVED`, `…_AUTOMATION_START_AT` added (default off).
  **Locally switched on** at Samad's request: start time 2026-11-06T12:38:50Z; purge stays off.
- T5.1 category badges (label + icon + tone), Classifying…/Not classified states, no "Email: Email"; cards use
  classified job emails as news; inbox filters read categories; review emails count as "Needs update".
- T5.2 `company_aliases` built once per sweep and passed to each email; identical results (test).
- T5.3 docs/02 "PR 4 as built", OPERATIONS.md automation + activation, DEBUG D-20 deviation, per-file report
  `docs/team/pr-changes/codex-pr4-code-correction.md`.
- Also fixed while checking: candidate "Active" counter, owner/BDE placements (reached Offer or legacy Placed, D6),
  dashboard interviews, pipeline card and outreach still used old status names as plain strings.
- Checks so far: frontend typecheck, lint, **610 tests**, production build passed; dark theme and 390 px (no
  horizontal scroll) checked in the browser; axe is not installed in this repo, so no automated a11y scan was run.

2026-11-06 12:53 UTC, T4.6 attempt 1 (automation ON, start 12:38:50Z): "Shortlisted for Data Platform Engineer" imported by
the scheduled sync, `DONE`, sender `PASS` (D-26 fix live), linked to Manoj's application, classified `shortlisted`
0.9977/0.9980, cost ACTUAL with an `llm_call_log` row. Routed to review `REPEATED_ROUND` because the drafted text said
"next round" (approved rule: repeated rounds go to a person). No status change — correct behaviour; the test email
wording was the problem. Attempt 2 requested without round wording.

2026-11-06, full non-live suite (T5.4 attempt): 3834 passed, **9 failed**. 8 tests expected automation OFF but inherited
`backend/.env` (automation ON locally) via `load_dotenv()`; with automation forced off for the test process they pass.
1 real: `test_normalized_source_is_swept` stubs `process_one` without the new `aliases` argument (T5.2). Both fixed in T7.4.
2026-11-06, decision change: Samad confirmed with Abdul that older (`NOT_QUEUED`) mail is classified too, review only
(D-23 updated; PR 3 docs annotated). Phase 7 added.

2026-11-06, **Phase 7 built** (T7.1–T7.3 done; T7.4 full suite running; T7.5 counts reported, approval pending):
- `backend/inbox/backfill.py` (new): setup recovery (`CLASSIFIER_NOT_CONFIGURED`, `PROVIDER_AUTH_REJECTED`) and
  historical classification (`NOT_QUEUED`), connected mailbox of an active firm only, readable mail only, 20 per sweep,
  oldest first; once-only `job_runs` marker per email (fixed id) inserted before the requeue; one ledger summary per
  candidate and sweep; runs from `process_pending` only when the classifier is configured and not paused.
  Historical emails never trigger an automatic status write (`is_historical` check in the worker).
  Switches `CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED`, `CANDIDATE_EMAIL_HISTORICAL_ENABLED` (default off).
  Read-only counts: `python -m backend.inbox.backfill`.
- `test_pr4_backfill.py`: 9 passed — recovered once and classified; repeat failure not recovered again (one audit);
  skipped when switched off, disconnected, paused or a non-setup error; historical is review-only even with automation
  on; oldest-first, bounded, once-only; disconnected excluded and counted.
- T7.2 frontend: `classificationError`/`classificationRetryExhausted` on messages; five states (Not yet queued,
  Classifying…, Waiting for classifier setup, Classification failed, category); readable failure reasons;
  `ClassificationStatus` in the reader with Retry for roles with `email.retry`; list/overview show "Not yet queued".
  Frontend typecheck, lint, **613 tests** passed.
- T7.4: `conftest.py` autouse fixture turns every candidate-email switch off for each test (no `.env` inheritance);
  PR 3 stub accepts the new `aliases` argument.
- T7.5 live eligible counts (read-only, 2026-11-06): setup recovery **25** (Manoj's test mailbox, received
  2026-11-03 15:51 – 2026-11-06 05:04, all before the automation start 12:38:50Z ⇒ review only); historical **0**;
  excluded (disconnected) **94** (Rajesh's personal mailbox). Batch 20 per sweep ⇒ 2 sweeps (~2 minutes).
  Both switches remain OFF until Samad approves.

2026-11-06 14:38 UTC, **T7.5 setup recovery run** (approved by Samad): `CANDIDATE_EMAIL_SETUP_RECOVERY_ENABLED=true` in
`cloned/backend/.env`, backend recreated. Two sweeps (20 + 5) by 14:41:
- Manoj: all 34 emails `DONE`; the 25 recovered were all classified `other` (promotional mail) ⇒ hidden and encrypted,
  outcome `OTHER`; 25 once-only recovery markers; 2 ledger summaries (20, 5), no duplicates.
- Rajesh (disconnected): 94 still `ERROR` — untouched, as required.
- No status events since 14:38; cost 25 `llm_call_log` rows, ACTUAL, total $0.000744.
- Note: Manoj's application is `shortlisted` rev 6 from actions in the app as Imran Shaikh at 13:05–13:24 (review
  resolved with Keep current, then manual moves), not from this run.
- Historical switch stays OFF (0 eligible).

2026-11-06 14:43 UTC, T4.6 attempt 2: the corrected Shortlisted email (subject "Data Platform Engineer", received
14:38:14) imported, sender `PASS`, matched Manoj's application, classified `shortlisted` 0.9956/0.9960, no repeated-round
wording ⇒ passed every gate; the application was already `shortlisted` (manual moves at 13:24) ⇒ `SAME_STAGE`, outcome
`NO_CHANGE`, no review — correct. A forward-stage email (Assessment) was requested; not yet in the Gmail inbox as of
14:54 (three syncs imported 0). Frontend dev server restarted from `cloned` (it stopped when the session folder changed).

2026-11-06 14:56 UTC, **T4.6 passed** (automation ON locally, start 12:38:50Z): "Assessment for Data Platform Engineer"
(Samad, moved from Spam to Inbox) imported 14:56:29, sender `PASS`, classified `assessment` 0.9918/0.9926, matched Manoj's
application ⇒ **automatic move Shortlisted → Assessment** (rev 7): event `email_classifier`, no human actor, linked
email; classification outcome `AUTO_APPLIED`; AGENT ledger "Email classifier"; no review. Browser: drawer showed
"Moved automatically to Assessment from Shortlisted because of a recruiter email" with Open email and Undo; card badge
"Assessment". **Undo** clicked ⇒ back to Shortlisted (rev 8): `email_undo` event by Imran Shaikh referencing the original
event; original event kept; USER ledger "Undid automatic change …"; drawer back to Shortlisted, notice gone; recruiter
emails listed with category badges.

2026-11-06, **T5.4 / T7.4 passed**: full non-live backend suite on this branch (switches forced off per test by the
conftest fixture): **3852 passed, 0 failed**, 13 skipped, 51 deselected (live), 13 xfailed (pre-existing), 24m03s.
Frontend: typecheck, lint, 613 tests, production build passed. Not run: automated axe scan (axe not installed).

2026-11-06, docs reconciled (plan out-of-scope and current state, DEBUG summary rows D-23/D-27/D-28/D-29, status Live
section; Abdul's gates G2/G3/G4/G6/G7/G8 remain open — implementing them is not approval). D-29 "older emails not
showing": 27 of Manoj's 37 emails hidden as Other (all verified non-job), first import covers 3 days (PR 2). Added a
count-only `hidden_count` to the inbox response and an Inbox note. Checks: frontend typecheck, lint, 613 tests;
backend inbox/review/pipeline suites 73 passed (new hidden-count test). Browser: note shows "27 emails were hidden…".

2026-11-06, decision (Samad): keep the 3-day first import window (PR 2 behaviour unchanged).

2026-11-06, **merged origin/main 09eb35b** (candidates final schema #112, logging #107) into the branch. Conflicts:
`classification_worker.py` (kept PR 4 flow, kept main's log lines, AI-spend rows now follow main's one-row-per-call rule
inside our transaction — DEBUG D-15 note), `src/mocks/db.ts` (fixture hash recomputed), `test_migration_0015.py` (main's
0015 is the candidates schema; ours renumbered to **0016**, test `test_migration_0016.py`). Main's
`test_inbox_ai_spend.py` updated for the T1.1 not-configured behaviour. Focused backend suites 363 passed; frontend
lint and 616 tests passed.
