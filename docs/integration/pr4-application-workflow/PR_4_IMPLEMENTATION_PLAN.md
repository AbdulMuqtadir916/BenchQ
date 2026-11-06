# PR 4 implementation plan — email classification to application status

Revised 2026-11-06 (synchronised with DEBUG.md rounds 2–4) · Branch `codex/pr4-code-correction` (from main 3f8be61,
PR 3 merged) · Owner: Samad · Tracker: [PR_4_STATUS.md](./PR_4_STATUS.md) · Fixes: [DEBUG.md](./DEBUG.md)
Authority: `docs/team/samad.md` §1.3–1.5, issue #110 (Abdul's decisions), PR #111 approval conditions,
`docs/02-DATA-CONTRACTS.md` §2.1, `docs/integration/pr3-email-classification/OPERATIONS.md`, `CONTRIBUTING.md`.

**Rule:** nothing here is implemented until Samad approves. One phase at a time; each phase ends with a visible check.
Repository rules: new schema/permission/API details need canonical docs first (samad.md §1.5); a column on another
owner's table is added by that owner (docs/team/README.md §4); models and migrations need Abdul's code-owner approval.

## 1. Goal

A candidate's job emails are classified by the AI and the matching application ends up in the right stage on the
board: automatically when every approved check passes, otherwise through a BDE review click. Every automatic change
is labelled, links to its email and can be undone.

## 2. End-to-end workflow (target)

```text
Gmail ─► import (PR 2) ─► PENDING (only if classification ON; else NOT_QUEUED → historical batches, review only, T7.3)
      ─► worker: config guard / pause check ─► claim ─► dispatch marker
      ─► decrypt in memory → split reply/forward → redact/bound → OpenRouter Decisions → category + two numbers
      ─► match: is_match_eligible application (thread link, else full company + full title)
      ─► versioned classification row (+ cost row or unpriced marker, same transaction)
      ─► decide (in this order):
           forwarded / too little text / numbers disagree ...... review
           Other (min value ≥ 0.8) ......................... hide 30 days, no status change
           5 forward targets, ≥ 0.8, sender PASS, unique,
           fresh, revisions current, automation ON .......... AUTOMATIC change (savepoint: status + event + ledger)
           anything else (incl. Offer, Move On) ............ BDE review with the specific reason
      ─► BDE review: exact email → Confirm / Keep current / Link only / Dismiss
      ─► board: status from server ("Saving…" while a move is in flight); history shows source email; Undo
```

Approved policy (unchanged): threshold **0.8**; automatic targets **Screening call, Shortlisted, Interview schedule
request, Interview scheduled, Assessment**; **Offer and Move On always review**; Other never changes status; sender
Gmail-verified; freshness and unique match independent of confidence; a pending review does not block a newer
eligible email; manual decisions take precedence over older emails.

Safety switches ship **OFF**: classification, real-mail approval, auto status, automation approval/start time, purge.
Turned on locally only for isolated tests (D-25); switched on in production only by T6.1 after merge.

## 3. Current state (updated 2026-11-06, end of implementation)

| Step | State |
|---|---|
| Import, encryption | Works (PR 2) |
| Classification | Works live (T1.6): configured, tolerant confidence check, config guard and pause, spend counted |
| Matching | Works; one eligibility rule (D-07); reply/forward rules (D-04) |
| Reviews | Backend list/command fixed (T3.1–T3.3); review panel and BDE review column live (T3.4–T3.6) |
| Automatic status updates and Undo | Built (migration 0016); live automatic move and Undo verified (T4.6) |
| Frontend ten statuses | Built (T2.1); legacy values shown read-only |
| Setup recovery, older mail | Built (Phase 7); recovery run on 25 emails; historical switch off (0 eligible) |
| Checks | Full backend 3852 passed / 0 failed; frontend 613 tests, typecheck, lint, build passed; axe not run |
| Local environment | Backend runs from `cloned`; personal mailbox disconnected; automation and recovery switched on locally only |
| Open | PR (T5.5), Abdul's sign-offs (G2, G3, G4, G6, G7, G8), production activation after merge (T6.1) |

## 4. Gates

| Gate | Needed for | Owner |
|---|---|---|
| G1 Samad approves this plan and DEBUG.md | everything | Samad |
| G2 Status mapping sign-off, docs/02 §2.1 | Phase 2 | Abdul |
| G3 Contracts in docs/02: `statusRevision`, counts endpoint, review list fields, Undo API, new review reasons | Phases 2–4 | Samad + Abdul |
| G4 Incomplete → Applied rule (D-14) | T4.4 (else left out) | Abdul |
| G5 Dedicated test Gmail + synthetic test candidate; approval to write `candidate_email_llm_*` in the dev DB | T1.6 | Samad |
| G6 Migration approval (`AUTO_APPLIED` outcome) | T4.1 | Abdul (code owner) |
| G7 Logger owner informed of the additive `cost_usd`/`db` arguments | T1.4 | owner of `backend/analyzer/llm_logger.py` |
| G8 Endpoint decision accepted (D-16) | T1.6 live call | Abdul |

## 5. Phases and tasks

Backend tests on the disposable test DB: `docker compose exec -T backend python -m pytest backend/tests -q -o
asyncio_mode=auto -m "not live"`. Frontend: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

### Phase 1 — Classification produces correct, counted results (backend)

| Task | Work (DEBUG) | Main files | Completion criteria |
|---|---|---|---|
| T1.1 | Config guard + pause with probe lease (D-02, D-03) | `classification_worker.py`, `ai/config.py`, `routes_inbox.py`, OPERATIONS.md | No config ⇒ PENDING, attempts 0; concurrent sweeps ⇒ one probe; each probe outcome tested; endpoints 409 while paused |
| T1.2 | Structural checks; min value; disagreement ⇒ review (D-01) | `decider.py`, `policy.py`, tests | All provider tests incl. new cases |
| T1.3 | Reply/forward split; precedence over Other hiding (D-04) | `application_matching.py`, `classification_worker.py`, tests | Forwarded/short/disagreeing Other ⇒ review; plain Other hidden; forwards keep content |
| T1.4 | Spend: dispatch marker, token mapping, cost source, cost row in result transaction, `unpriced_calls`/`unconfirmed_calls` (D-15, G7) | `classification_worker.py`, `analyzer/llm_logger.py`, `main.py` stats | Amount tests; no double count; logger leaves caller transaction untouched |
| T1.5 | OPERATIONS.md: setup checklist, endpoint decision and switch-on conditions (D-16) | OPERATIONS.md | Written before any live call |
| T1.6 | Isolated live check (G5, G8): dedicated mailbox, one authored email | dev DB settings | Email `DONE` with classification + review; cost recorded; personal mail untouched |

### Phase 2 — Board shows every status (frontend + matching rule)

| Task | Work (DEBUG) | Main files | Completion criteria |
|---|---|---|---|
| T2.1 | Ten statuses + read-only legacy group (D-05, G2) | `schemas/enums.ts`, `schemas/application.ts`, `status-meta.ts`, board/list/drawer/progress, `lib/derive/*`, `dto/applications.ts`, mocks | Every backend value renders; nothing hidden |
| T2.2 | `statusRevision`; synchronous move lock; "Saving…" overlay from mutation state (D-06, G3) | `schemas/application.ts`, `dto/applications.ts`, `api/applications.ts`, `hooks/use-applications.ts`, status-reading helper hook, the three pages | Double move refused; lock released on every exit; no cache rollback; 409 path |
| T2.3 | `is_match_eligible` in one place; delete worker guard (D-07) | `application_matching.py`, `classification_worker.py`, `routes_inbox.py` | Every status through each caller |
| T2.4 | `newCommandId()` (D-18) | `src/lib/utils.ts` | Works on plain HTTP |
| T2.5 | Counts endpoint + paged columns + `UNSUPPORTED_STATUS` (D-20, D-22, G3) | `routes_applications.py`, `access.py`, `isolation_cases.py`, `api/applications.ts`, hooks, board | Counts match DB in every role scope; paging stable; move refreshes counts and both columns |
| T2.6 | Browser check through every column, reload | — | Evidence, both themes |

### Phase 3 — Review loop (delivers the goal with automation OFF)

| Task | Work (DEBUG) | Main files | Completion criteria |
|---|---|---|---|
| T3.1 | Review list order + fields (D-09, G3) | `routes_inbox.py` | Paging + field tests |
| T3.2 | Dismiss ignores applications (D-08) | `routes_inbox.py` | Stale revision ok; never links |
| T3.3 | Allowed review stages (D-10) | `routes_inbox.py`, panel | `saved`/`other` rejected |
| T3.4 | Review hook, inbox adapter/DTO, review panel, board BDE review column, reason labels incl. new codes | `api/inbox.ts`, `dto/inbox.ts`, `schemas/inbox.ts`, `hooks/use-email-reviews.ts`, `components/app/candidate/*`, `application-board.tsx` | Confirm/Keep/Link/Dismiss work; 409 clear; skeleton/empty/error/support view |
| T3.5 | Known-invalid moves blocked up front (D-19) | board, drawer | No refused change shown |
| T3.6 | Isolated live check: email ⇒ card ⇒ Confirm ⇒ column | — | Evidence |

### Phase 4 — Automatic updates and Undo (switches OFF by default)

| Task | Work (DEBUG) | Main files | Completion criteria |
|---|---|---|---|
| T4.1 | Migration (`AUTO_APPLIED`) + writer with savepoint + replay cases (D-11, G6) | `migrations/versions/00xx_…py`, `models/db.py`, `tracking.py`, `classification_worker.py` | Automation off keeps reviews; all gates; replay table; concurrent insert keeps other work; guarded downgrade |
| T4.2 | Pending review vs newer email (D-13) | `tracking.py`, `routes_inbox.py` | Ordering tests |
| T4.3 | Undo endpoint + access + isolation + UI (D-12) | `routes_applications.py`, `access.py`, `isolation_cases.py`, drawer/timeline | Undo, repeat, 409, no re-apply; F7 passes |
| T4.4 | Incomplete → Applied (D-14, G4) | `policy.py` | Left out if not signed off |
| T4.5 | Timeline labels by source with email link | `status-timeline.tsx`, DTO | Each source labelled |
| T4.6 | Isolated live check with automation on locally; Undo returns it; switches back OFF | — | Evidence |

### Phase 5 — Finish and delivery

| Task | Work (DEBUG) | Completion criteria |
|---|---|---|
| T5.1 | Inbox category badges, "Email: Email" (D-17) | Ten categories + states with label + icon |
| T5.2 | Alias loading once per sweep (D-21) | Same results |
| T5.3 | Docs: docs/02 as built, samad.md status, per-file report `docs/team/pr-changes/codex-pr4-code-correction.md` | Reviewed by Samad |
| T5.4 | Full checks: frontend typecheck/lint/test/build; backend non-live suite; migration up/down; F7; both themes; keyboard; 390/1024/1440; axe | All green, recorded |
| T5.5 | Refresh from main; PR via template; request Abdul — **only on Samad's instruction** | PR opened |

### Phase 7 — Setup recovery, clearer states, older mail (added 2026-11-06, Samad + Abdul)

| Task | Work (DEBUG) | Main files | Completion criteria |
|---|---|---|---|
| T7.1 | Recover setup failures once, connected mailboxes only, bounded (D-27) | `classification_worker.py`, `config.py` | Requeued once; no loop; no duplicate audit; disconnected untouched; repeat failure shows Retry |
| T7.2 | Inbox states, readable failure reason, Retry (D-28) | `schemas/inbox.ts`, `dto/inbox.ts`, `api/inbox.ts`, hooks, `signal-meta.ts`, inbox reader | Five states render with label + icon; Retry only where permitted |
| T7.3 | Historical classification, review only (D-23) | `classification_worker.py`, `config.py`, OPERATIONS.md | Oldest first, bounded, exactly-once; no automatic status write; no duplicate result or review |
| T7.4 | Tests control automation settings explicitly; PR 3 stub accepts `aliases` | `backend/tests/conftest.py`, `test_pr3_pipeline.py`, new tests | Full suite passes regardless of the developer's `.env` |
| T7.5 | Report live eligible counts and scope; run only after Samad approves | — | Counts reported; approval recorded before switching on |

### Phase 6 — Activation (after merge)

| Task | Work | Completion criteria |
|---|---|---|
| T6.1 | Activation checklist: PR merged; Undo verified in production-like env; OPERATIONS.md switch-on conditions met (provider retention/consent, endpoint, spend); set `AUTOMATION_START_AT`, approval and auto-status switches; first-day review of automatic changes and Undo use | Signed off by Samad and Abdul; recorded in STATUS |

## 6. Out of scope

Relevance prefilter, local classifier, manual sender allowlist, quarantine-release UI, purge enablement, Super Admin
AI-spend card UI (07 Q29), résumé changes, new Response stage, relinking a wrongly linked email (open question), board
column paging (D-20 note). Classifying mail imported before switch-on moved **into** scope on 2026-11-06 (Phase 7, D-23).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Most real mail is "sender unverified" ⇒ few automatic changes | Expected; Phase 3 is the main path |
| G2/G3/G6 delay | Ask Abdul now; Phase 1 needs only G5, G7, G8 |
| Personal mail processed during tests | Dedicated test mailbox; personal mailbox disconnected or classification off (D-25) |
| Migration rollback | Guarded downgrade; documented decision for `AUTO_APPLIED` rows |
| Frontend structure change (status helper hook) | Small, one hook; covered by tests on the three pages |
