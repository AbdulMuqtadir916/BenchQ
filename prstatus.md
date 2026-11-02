# PR #104 task tracker

Updated: 2026-11-02. Plan: [pr104_plan.md](pr104_plan.md).

`[x]` means completed with evidence; `[ ]` means pending, including work awaiting a decision. Only mark implementation complete after its regression/acceptance checks pass. This tracker is not a GitHub approval or authorization to launch.

## Current execution — local technical corrections verified

Implementation checkout: `/private/tmp/benchq-pr104-review`, branch `codex/candidate-gmail-connection`, based on published `c98538d` with main `a1c7a92` included. The running combined development folder and its database are unchanged. No push or merge.

Update this tracker after each completed module/check or meaningful failure. Never tick pending code-owner decisions as approved.

| Module/check | Current state | Evidence / remaining work |
|---|---|---|
| M1 confirmation | Implemented and verified | Cancel, expiry/restart, reassignment denial and callback failures passed |
| M2 grant lifecycle | Implemented and verified | Revocation/retry, identity failure, lifecycle guard, timeout and independent cleanup passed |
| M3 ERROR recovery | Implemented; API/browser checks passed | ERROR reserves ownership until disconnect; retained candidate data remains |
| M4 pagination | Implemented and verified | Cursor ties/malformed fields, new arrivals, selected older mail and URL reload passed |
| M5 callback errors | Implemented and verified | Actual fallback-page rendering tests, provider denial, missing/expired state and ended session passed |
| M6 ledger | Implemented; focused checks passed | One job entry updated with committed/partial total; first-read/manual-request policy awaits Abdul sign-off |
| M7 durable consent | Implemented; focused checks passed | Existing ledger retains verified address/actor/candidate/time/notice; platform redaction and current-assignment scope included |
| M8 deletion | Implemented and verified | SQL erasure, role loss during Google I/O, deletion during fetch/new arrivals, dialog and empty-Inbox warning passed |
| M9 contracts | Updated locally; approvals pending | Revised contracts, consent and per-file report; broader mock application/UI integration remains later scope |
| Frontend tests | Passed: 572 tests / 46 files | `/private/tmp/pr104-completed-frontend.log`; includes actual fallback-page rendering tests |
| Typecheck/lint/build | Passed | `/private/tmp/pr104-completed-types.log`, `pr104-completed-lint.log`, `pr104-pagination-build.log`; Node 22 installed tools; existing CSS warning retained |
| Browser acceptance | Passed including URL-reload extension | `/private/tmp/pr104-pagination-ui.log`; light/dark 1440/1024/390, keyboard/reduced motion, axe zero, no page errors; dialog screenshot visually checked |
| Focused backend | Passed: 243 hardening/isolation checks; final expanded regression module 34 passed | `/private/tmp/pr104-hardening-final.log`, `/private/tmp/pr104-verified-regressions.log`; counts overlap and are not added to the full-suite total |
| Full backend | Passed: 3,767; 11 skipped; 54 live deselected; 13 existing xfailed; 6 existing warnings | `/private/tmp/pr104-final-backend.log`; final late-added cases separately verified in hardening/race runs |
| Publication/merge | Not performed | Abdul sign-offs, final CI and explicit merge instruction remain gates |

## Baseline

- [x] Read repo contract and contribution/integration workflow.
- [x] Inspect PR #104 reviews and isolated correction checkout c98538d.
- [x] Confirm #104 is open and unmerged on 2026-11-02.
- [x] Create detailed plan and this module-based tracker; no product-code changes.
- [x] Record Samad's grilling decisions D1–D13 in the plan and map regression tasks below; implementation remains pending.
- [x] Recheck remote main/PR head before implementation; preserve dirty local combined checkout.
- [x] Mark obsolete completion claims in the existing PR report as superseded when corrections begin.

## M1 — Confirmation cancel/expiry

- [x] Contract scoped, idempotent cancellation through existing permissions/access inventory.
- [x] Add Cancel; clear attempt URL/cache and return to Inbox without activation/import.
- [x] Add Connect again on expired attempt; retain Retry only for retryable failures.
- [x] Show cleanup errors truthfully without exposing credentials.
- [x] Test wrong account, expiry, repeated cancel, permission loss, keyboard and retained-mail access.
- [x] Test reassignment during OAuth: former BDE cannot confirm; candidate's existing connection continues syncing.

## M2 — Grant lifecycle/security

- [x] Verify official Google revoke semantics and document shared-grant implications.
- [x] Inventory callback/conflict/cancel/expiry/cleanup/activation/disconnect token exits.
- [x] Implement cleanup independent of another OAuth callback.
- [x] Prevent revocation from breaking a legitimate active connection.
- [x] Bound provider I/O; avoid row locks across requests; retain safe retry for revoke failure.
- [x] Fence confirm/cancel/cleanup/reconnect races; make cleanup idempotent.
- [x] Test timeouts, expiry, worker restart, active-account collision and failed revocation.
- [ ] Settle uniqueness scope and cross-firm existence disclosure with Abdul before changing policy.
- [ ] Submit Samad's global one-active-candidate proposal for sign-off; use generic collision message without candidate/BDE/firm disclosure.
- [x] Test concurrent global ownership claims and explicit disconnect releasing the address; failed pending attempts do not become permanent reservations.
- [x] Ensure stale revocation retries cannot disable a newly connected mailbox.

## M3 — ERROR recovery

- [x] Show authorized Disconnect for ERROR connection.
- [x] Verify same-account reconnect and disconnect-then-connect-different-account.
- [x] Preserve source identity and retained mail; fence obsolete jobs/credentials.
- [x] Test dead connection, replacement, reservation release and concurrent fetch/disconnect.
- [x] Keep ERROR address reserved until explicit disconnect; test transient errors cannot release ownership.
- [x] Test candidate reassignment preserves connection, retained data, statuses and existing email mappings without new OAuth.

## M4 — Pagination/cache

- [x] Document stable cursor/total/URL restoration contract.
- [ ] Obtain Abdul's sign-off on the exact revised transport contract before publishing/merge.
- [x] Implement deterministic timestamp/ID pagination, limit validation and explicit end state.
- [x] Preserve loaded pages during refetch; remove offset-count dependence.
- [x] Preserve selected older email and independent body loading.
- [x] Keep URL/Zod state and firm/candidate query-key isolation.
- [x] Test >200 rows, tied timestamps, new arrivals, duplicate avoidance, polling and end-of-list.
- [x] Test deletion/filter changes, malformed cursor, empty/error pages and no list remount.

## M5 — OAuth failure navigation

- [x] Return to trusted candidate Inbox when still safe/authorized.
- [x] Render a visible error at safe fallback for failures before trust exists.
- [x] Consume/clear message once; preserve no-open-redirect/no-existence-disclosure rules.
- [x] Test provider denial, missing/expired state, ended session, access changes and invalid callback.

## M6 — Import ledger

- [x] Keep batch commits but aggregate newly imported count per job.
- [x] Produce one completion or partial-failure SYSTEM result, not per-batch rows.
- [x] Handle interrupted jobs/retries without duplicate results or inflated counts.
- [x] Test 300-message import, partial failure, all-duplicate import and restart recovery.
- [ ] Obtain explicit read/empty-manual-sync audit decision and align behavior/docs.
- [x] Record Samad's confirmed policy separately from Abdul's pending sign-off: first unread-to-read, every manual sync request, one background result.
- [x] Test repeat/concurrent reads produce only the first read-transition audit; zero-import manual requests remain recorded.

## M7 — Durable attestation

- [ ] Approve exact durable confirmation contract and audit audience.
- [x] Persist actor/candidate/verified address/time/attestation evidence without secrets.
- [x] Keep evidence after attempt cleanup, disconnect and account replacement.
- [x] Update contracts to name actual authoritative store; avoid unnecessary new table.
- [x] Test account A history survives cleanup and reconnect to B.
- [x] Preserve restricted actor/candidate/verified Gmail/time evidence after email deletion; explain retention exception in UI/policy.
- [x] Verify support/audit endpoints cannot expose email details through attestation records.

## M8 — Deletion safety

- [x] Move bulk erasure out of everyday toolbar; hide when nothing eligible.
- [x] Add accessible app dialog with candidate, scoped count and clear consequences.
- [x] Distinguish current permanent manual erasure from future recoverable automatic purge.
- [x] Provide Delete stored emails and Disconnect and delete; default to Disconnect and delete; explain Gmail originals remain untouched.
- [x] Bind stored-only deletion to server-confirmation-time scope, allow later arrivals and refresh stale preview counts; recheck permissions on execution.
- [x] Prevent duplicate submissions, stale body cache and content resurrection by concurrent import.
- [x] Preserve history/review references and required deduplication identity.
- [x] Test Owner/Manager scope; deny BDE/Viewer/platform writes; verify cancel/error/focus behavior.
- [x] Fence running imports before disconnect-and-delete; prove late results cannot restore content.
- [x] Complete local disconnect/deletion despite Google revoke failure; show warning/manual instructions without falsely claiming revocation.
- [x] Remove email content from all existing linked-email surfaces/caches while preserving statuses and minimal history.
- [x] Test stored-only deletion prevents old imports from restoring erased mail but allows genuinely new arrivals.

## M9 — Contract consistency and decisions

- [x] Record classification-off means readable Inbox; test no quarantine/status mutation/model calls.
- [x] Correct ongoing-import consent, actual encryption scope and permitted readers.
- [ ] Settle support-view metadata/privacy scope and retention/deletion semantics.
- [ ] Submit Samad's health/errors/counts-only support policy for contract sign-off; exclude subject/sender/preview/body from every support response and sanitize diagnostics.
- [x] Verify existing backend candidate/application guards and implement current-assignment Inbox/ledger access; test previous BDE loses candidate-linked access.
- [ ] Complete remaining mock-module/UI integration under the same assignment rule in the later approved tracks; do not claim those modules are made live by #104.
- [x] Test BDE A loses all subsequent access after reassignment and BDE B sees unchanged candidate history/mapped emails; clear inaccessible client caches.
- [x] Preserve original candidate/firm attribution; reconnect test proves retained records are not transferred.
- [ ] Resolve cross-candidate provider re-import/privacy policy before enabling that real-candidate workflow.
- [x] Record future automation approval with PR 4/Undo gate; eliminate contradictory policy wording.
- [x] Keep unresolved product choices explicitly pending; record approver/date when settled.
- [x] Update per-file PR change document with exact scope and verification evidence.
- [ ] Post evidence to review threads after authorized publication; no replies sent in this pass.
- [x] Confirm no classification, quarantine, stage mapping or sender table slipped into #104.

## M10 — Verification/publication/merge

- [x] Regression tests reproduce all eight must-fix problems and pass after fixes.
- [x] Previously confirmed sync/filter/crypto/reconnect/body-loading protections still pass.
- [x] F7 isolation inventory covers added routes; negative roles/candidates/firms/support tested.
- [x] Full backend suite passes on isolated PostgreSQL; document skips/xfails and warnings.
- [x] Frontend tests, typecheck and lint pass.
- [x] Production build passes; document any environment fallback honestly.
- [x] Browser light/dark, 1440/1024/390, keyboard, reduced motion and axe checks pass.
- [x] Verify skeleton/empty/error/not-found, cancel/expiry, pagination and deletion flows.
- [x] Single Alembic head; approved unmerged revision upgrade/backfill/downgrade guards pass.
- [x] Secret scan/diff checks pass; real credentials/mail/existing DB remain untouched.
- [ ] Fetch/integrate latest main; rerun affected verification after integration.
- [ ] Record final commit/commands/results/logs and per-file inventory.
- [ ] Push authorized corrections to existing #104; reply to review threads with evidence.
- [ ] GitHub CI green and Abdul code-owner approval obtained.
- [x] Report real-candidate launch gates separately; do not imply merge enables production.
- [ ] Receive Samad's explicit merge instruction; merge commit only; keep #95 draft.

## Launch gates — not required to implement later PRs inside #104

- [ ] Name Google verification/security-assessment owner and verify delegated-access requirements.
- [ ] Verify candidate OAuth project isolation from legacy Google clients; document project-wide revocation implications before real-candidate rollout.
- [ ] Obtain approved import/privacy/consent/support-reader policy.
- [ ] Approve recoverable purge rule/recovery period and lawful accuracy-data source.
- [ ] PR 3 matching/review/privacy is ready before real-candidate enablement.
- [ ] Written provider retention/logging verification and updated consent before real-mail external AI.
- [ ] PR 4 merged and Undo usable before enabling automatic status updates.

## Follow-up handoff after #104 merges

- [ ] Create one revised PR 3/PR 4 plan from updated main, without stacking branches.
- [ ] Send sender approval contract/table for sign-off, including authentication field and exact-sender/candidate scope.
- [ ] Define lawful 1,000-email dataset with at least 500 job-related; zero job-related erasures; model/prompt-change retests.
- [ ] Specify quarantine Owner/Manager release, sender/time visibility, exhausted-retry alert and deletion coverage.
- [ ] Specify pending classification versus disabled versus failed states without hiding disabled-mode Inbox mail.
- [ ] Specify recoverable purge, matched Other readability, transition gates and Undo suppression.
- [ ] Inventory all legacy statuses and send explicit mapping/migration proposal for sign-off.
- [ ] Preserve visible editable Notes; keep Other out of new status selections/progress and Move On as outcome.
- [ ] Add cost tracking, off switches, prompt-injection tests and retained-mail processing rules.

## Evidence log

| Date | Evidence | Limit |
|---|---|---|
| 2026-11-02 | Read GitHub #104 and Abdul's follow-up; inspected source at c98538d | No new implementation/test validation |
| 2026-11-02 | Created plan and tracker | Documentation only; all correction tasks remain unchecked |
| 2026-11-02 | Updated both documents with Samad's grilling decisions D1–D13 and additional regression tasks | At document-update time no application code was changed; implementation began afterward in the isolated checkout |
| 2026-11-02 | Local follow-up implementation and check results recorded above; tracker updated during execution | Full suite/final hardening and required approvals remain pending; no push/merge |
| 2026-11-02 | URL pagination restoration browser checks, typecheck/lint and production build passed | Full backend and final hardening regressions still running/pending; no push or merge |
| 2026-11-02 | Final frontend rerun: 568 passed / 45 files; diff whitespace and credential-pattern checks passed | Backend full run passed its halfway point with no unexpected failure so far; result still pending |
| 2026-11-02 | Full suite reached approximately 80% without unexpected failure; launched final hardening/isolation on a separate disposable database | Both backend runs still pending; application database untouched |
| 2026-11-02 | Final focused backend: 243 passed, one existing warning; full suite around 94% without unexpected failure | Added one end-to-end deletion/fetch race regression and started it; no product-code changes after hardening run |
| 2026-11-02 | Full backend passed: 3,767 passed, 11 skipped, 54 deselected, 13 existing xfailed, 6 existing warnings; integrated deletion-during-fetch passed | Final follow-up module rerun in progress; no push/merge |
| 2026-11-02 | Final 30-case follow-up module passed, including 300-message audit, simultaneous read marks, interrupted-worker recovery and unchanged reassigned application/email history | Added fallback-page rendering regressions and started final frontend checks; no product-code changes |
| 2026-11-02 | All local technical checks passed: full backend 3,767; hardening 243; final regression module 34; frontend 572; typecheck/lint/build/browser | Counts overlap; approvals, publication, live rollout and later PRs remain pending |
