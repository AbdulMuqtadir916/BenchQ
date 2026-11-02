# PR #104 completion plan

Updated: 2026-11-02. Owner: Samad. Product/code owner: Abdul Muqtadir.

PR: https://github.com/AbdulMuqtadir916/BenchQ/pull/104

Execution checklist: [prstatus.md](prstatus.md).

## Purpose and evidence

Finish the candidate Gmail connection/import PR, address all known must-fix items together, and verify the final diff before asking for merge. This document is a plan, not evidence that fixes are complete. No application code, database, PR or deployment is changed by creating these documents.

Baseline inspected: isolated checkout `/private/tmp/benchq-pr104-review`, branch `codex/candidate-gmail-connection`, published correction commit `c98538d7363f19a67cb8e81d71c4b687c5ac2ab7`. GitHub was checked on 2026-11-02: OPEN, unmerged, MERGEABLE. Abdul's follow-up review at 11:00 UTC identifies eight remaining must-fix items. MERGEABLE describes Git compatibility, not approval or correctness.

Sources: Abdul's GitHub reviews and his subsequent decisions supplied by Samad in this chat; `CLAUDE.md`, `CONTRIBUTING.md`, `docs/integration/README.md`, `docs/team/samad.md`, and the existing per-file PR report. Chat-supplied approval is not represented as a GitHub approval.

Earlier reported results for c98538d were 3,748 backend passes and 563 frontend passes, plus typecheck, lint, Webpack production build and synthetic browser checks. Those results do not validate the changes in this plan. The earlier report's statement that correction work was complete must be superseded when implementation resumes.

## Local implementation progress (2026-11-02)

Implementation is in `/private/tmp/benchq-pr104-review`; the running combined checkout/database are unchanged.
See prstatus.md for continuously updated checks. The eight correction modules are implemented locally;
all local technical verification has passed: full backend 3,767, focused hardening 243, final regression module
34, frontend 572, typecheck/lint/production build and synthetic browser acceptance. Counts overlap. Code-owner
approvals, publication and rollout gates remain pending. Nothing is pushed or merged.

Implementation details now explicit for review: provider grant operations use a short nonblocking global
advisory guard because identity is unknown before exchange; cleanup has a separate five-minute scheduler job
even with mailbox polling disabled. Cursor paging uses infinite query pages and URL/Zod inbox_pages restoration
(up to 50 pages restored automatically; manual older-page loading remains available). Deletion performs a scoped
SQL update without loading all full bodies, and rechecks Owner/Manager authority after Google I/O. The existing
ledger candidate relation is exposed through DTO/schema so candidate history follows current BDE assignment;
platform/support audit summaries and notes cannot disclose mailbox addresses. No database columns or migrations
were changed in this follow-up. These exact contract/permission amendments still require Abdul's sign-off.

## Scope and workflow

- PR #104 owns OAuth, mailbox confirmation, received-mail import, retention/deletion controls, Inbox loading and their security boundaries.
- Do not add matching, external classification, quarantine, sender-approval tables, automatic application changes, stage migration or recruiter-reply redesign to this PR.
- Finish #104 first. After merge, submit the revised classification/UI plan and proposed contracts for sign-off. Then classification PR 3, then UI PR 4, each from updated main; no stacked PRs.
- Preserve the dirty `/Users/abulsamad/Documents/inbox` working tree. Implement in the isolated PR checkout; never reset, stash or copy the combined draft over it without deliberate reconciliation.
- Fetch and integrate current main before publishing; recheck main and GitHub checks before merge. Do not edit merged migrations. Keep one unmerged revision for this PR and align its parent with current main.
- Consolidate known problems in this plan and checklist rather than repeatedly asking for broad review. Required code-owner approval and newly discovered critical decisions remain gates; no document can guarantee zero undiscovered bugs.
- Do not merge until Samad explicitly instructs it and repository approval/check requirements are satisfied. Use a merge commit, not squash or rebase-merge.

## Decisions and limits

| Topic | Recorded direction | PR #104 consequence |
|---|---|---|
| Classification disabled | Imported mail stays readable in Inbox, as in #104 | Never interpret classification-off as failure or quarantine; retain neutral unclassified labels |
| External model | Off for real mail until written retention/logging verification and updated consent | No external classifier call in this PR |
| Automatic updates | Approved in principle, but off until PR 4 is merged and Undo is usable | No application status mutation from this PR |
| Google/profile email | May differ; explicitly confirm candidate and selected verified account | Do not introduce an equality requirement |
| Access | BDE sees only currently assigned candidates and all their related data; enforced on server | Reassignment removes former BDE access and grants the new BDE access to retained candidate data |
| Disconnect | Stop sync, discard usable credentials, best-effort revoke; retained mail remains | Explain revocation failure and retained-mail behavior |
| Deletion | Owner/Manager only within authorized candidate scope | No BDE/Viewer/platform deletion; explain local versus Gmail deletion |
| Mailbox uniqueness | Samad confirmed one active candidate connection per Gmail globally; ERROR retains reservation until explicit disconnect | Reuse allowed after disconnect; generic collision message; Abdul's cross-firm sign-off remains pending |
| Read/empty-sync audits | Samad confirmed first transition to Read, every manual sync request including zero imports, and one background-job result | Reopening read mail creates no new read entry; Abdul's audit-policy sign-off remains pending |
| Retention | Auto-purge off; approved recoverable purge rule required before real candidates | No silent expiry or permanent purge policy invented in #104 |
| Notes | Existing Notes stay visible and authorized BDEs can add notes | Preserve data; presentation change belongs to PR 4 |

Consent must state continuing import of new Inbox mail, not just the initial three-day window; identify actual stored data, permitted readers, external processing state, encryption scope, retention and deletion/disconnect differences. Do not claim that all metadata is encrypted when only body/preview are. No real-candidate rollout until the outstanding privacy and Google gates are satisfied.

## Samad's decisions confirmed during grilling (2026-11-02)

These choices are confirmed by Samad in this chat. They are not additional GitHub/code-owner approvals from Abdul. Implementation and regression tests remain pending. Product-contract changes must be submitted for Abdul's sign-off where required.

| ID | Confirmed decision | Required behavior and verification |
|---|---|---|
| D1 | One Gmail may have only one active candidate connection across all firms at a time | CONNECTED and ERROR reserve the address; explicit disconnect releases it. Concurrent confirmation cannot create two active owners. A failed/abandoned attempt must not reserve it indefinitely. |
| D2 | Collision response is generic | Show “This mailbox cannot be connected. Contact your manager”; reveal no other candidate, BDE or firm. Abdul must still approve the global uniqueness/non-disclosure policy. |
| D3 | BDE access follows current candidate assignment | Only assigned candidates' mailboxes and related jobs, applications, statuses, Notes, history and mapped emails are accessible. Reassignment removes all former BDE access and gives the new BDE access to existing candidate data; no deletion/reset/reclassification. Owner/Manager retain existing authorized scope. |
| D4 | Reassignment does not disconnect Gmail | Candidate mailbox keeps syncing; no new OAuth required solely because its BDE changes. Candidate data and existing email mappings stay with the candidate. |
| D5 | Confirm rechecks current access | A former BDE cannot complete a pending confirmation after reassignment; revoke/cleanup safely without damaging a live grant. All operations, not just confirmation, enforce current access. |
| D6 | Two bulk-delete choices | “Delete stored emails” keeps future sync on. “Disconnect and delete” is selected by default and stops sync before erasure. Gmail originals are untouched. |
| D7 | Stored-only deletion has a fixed scope | Delete emails stored when confirmation is accepted by the server. Use a server-defined cutoff/target set; preview count is informational and must be refreshed if scope changes. New arrivals may appear afterward; old in-flight results must not restore erased content. |
| D8 | Disconnect-and-delete fences import | Stop pending/running work and block late results from saving. If Google revocation fails, local disconnect/deletion still complete, with a truthful warning and manual Google revocation instructions. Revoke retry must not later disable a newly authorized active connection. |
| D9 | Remove email content from every served surface | Subject/sender/preview/body disappear from linked recruiter-reply/evidence surfaces and list/detail caches. Application status and minimal audit/history references remain; do not silently roll back a status because its source was deleted. |
| D10 | Retain restricted connection evidence | Actor, candidate, verified Gmail and confirmation time survive email deletion. Disclose this exception in the dialog/retention policy. It is connection evidence, not a retained copy of the deleted message's sender/content. |
| D11 | Owner/Manager alone delete email content | BDEs can connect, sync and disconnect only assigned candidates. Viewers and platform/Super Admin cannot delete; use existing central permissions and scope helpers. |
| D12 | First-read/manual-sync/background audit balance | Audit first unread-to-read transition, each manual sync request even with zero imports, and one completion/partial result per background job. Reopening a read email adds no read row. Preserve safe concurrent/idempotent behavior. |
| D13 | Platform support sees operational metadata only | Mailbox health, safe sync diagnostics and counts are available; email subject, sender, preview and body are excluded server-side from every support response. Sanitize errors/audits so they cannot bypass this restriction; define the connection-attestation audit audience explicitly. |

One scenario remains outside these confirmed decisions: reconnecting a previously used Gmail to a different candidate must not automatically transfer retained history. Samad clarified ordinary BDE reassignment, not a cross-candidate data transfer policy. Preserve original firm/candidate attribution and seek explicit approval before any history-transfer feature. Initial provider re-import of the same messages under a new candidate is a separate privacy case to resolve before permitting that workflow; do not assume a new connection authorizes copying old retained data.

## Module 1 — Confirmation cancellation and expired attempts

Review: `4441562307`. Primary files: `src/components/app/candidate/inbox/inbox-tab.tsx`, Inbox adapter/hooks/query keys, `backend/api/routes_inbox.py`, central access inventory.

1. Add Cancel without activating the mailbox. Backend cancellation must be scoped to the initiating authorized principal/candidate and be safe to repeat.
2. Clear confirmation URL state and candidate-scoped cache after success/cancel; return to the retained Inbox. Existing mail remains usable.
3. Expired/invalid attempts offer Connect again rather than an endless Retry. Distinguish transient errors, which can retry.
4. Handle cancellation failures explicitly; do not falsely report grant cleanup. Do not expose tokens in responses or cache.
5. Recheck assignment immediately before confirmation. If reassigned, block the former BDE and safely clean the pending grant. Reassignment alone must not interrupt an existing candidate connection.

Acceptance: wrong-account selection can be abandoned; cancellation never imports; expired attempts cannot confirm; keyboard/loading/error states work in both themes.

## Module 2 — Pending-grant lifecycle and revocation safety

Review: `4441562330`. Primary files: `backend/api/routes_inbox.py`, `backend/inbox/google_oauth.py`, scheduler/cleanup, mailbox tests; existing model/migration only if the approved contract requires it.

1. Inventory every issued-token exit: callback failure, confirmation conflict, cancellation, expiry, abandonment cleanup, successful activation and disconnect.
2. Confirm Google's exact revocation semantics against official documentation before coding. Never revoke a grant that would disable another legitimate live connection to that account.
3. Make cleanup run without requiring another callback in the same firm. Bound provider calls; avoid holding mailbox row locks over network I/O.
4. Serialize relevant account lifecycle operations; test cancellation/cleanup racing with confirmation/reconnect. Clear inactive pending credentials after a safe cleanup outcome. A failed revoke requires visible operational state/retry without logging the secret.
5. Do not delete the only retryable cleanup credential before the revocation attempt can be recovered, and never restore abandoned grants as active mailboxes.
6. Submit D1/D2 for Abdul's sign-off: global one-active-candidate rule, ERROR reservation, release on explicit disconnect and generic collision response. Use D1/D2 as Samad's confirmed proposal, not an approved cross-firm contract. Test global concurrent confirmation, failed pending attempts and release/reconnect races.

Acceptance: no usable abandoned pending grant is silently forgotten; active accounts survive cleanup; repeated cleanup is safe; provider failure is bounded and recoverable.

## Module 3 — ERROR mailbox recovery

Review: `4441562344`. Primary files: Inbox controls, `routes_inbox.py`, mailbox tests.

Show Disconnect for an ERROR connection using existing permissions. Preserve same-account reconnect and provide the disconnect-then-connect-different-account route. Disconnect must fence running jobs and prevent stale writes. Do not allow an account switch to overwrite retained source identity. Resolve reservation behavior consistently with the approved uniqueness scope.

Samad confirmed that ERROR continues reserving the Gmail until explicit disconnect; a transient provider failure does not silently transfer ownership. BDE reassignment leaves this candidate-owned connection and all existing mappings intact.

Acceptance: an expired connection has a usable recovery path; replacing an account cannot merge identities, import under old credentials or erase retained messages.

## Module 4 — Stable pagination and selection

Review: `4441562376`. Primary files: `routes_inbox.py`, adapter/DTO/schema contract, `src/lib/hooks/use-inbox.ts`, query keys, Inbox tab and tests.

1. Document a stable cursor contract before schema changes: deterministic `(received_at, id)` ordering with matching tuple comparison and validated opaque cursor, bounded limit, next cursor and explicit end state. Handle timestamp ties and malformed cursors.
2. Replace offset/count merging with an infinite-query or equivalent page-aware cache. Refetch must preserve loaded older pages and avoid duplicates or gaps as new mail arrives.
3. Keep selection and body fetching independent; preserve selected older email during polls. Filtering/pagination state follows URL/Zod conventions; isolate all keys by firm/candidate.
4. Handle deletion, empty/end pages, connection changes, filters and errors without showing stale content from another scope. Avoid full-body list polling and list remounts on selection.

Acceptance: load >200 synthetic messages, open an older email, insert newer mail, refetch during import/normal polling and continue paging without missing/duplicated rows or lost selection. Load more ends correctly.

## Module 5 — Safe OAuth return and visible failure

Review: `4441562389`. Primary files: `backend/main.py`, callback route, safe fallback page/message handling.

Use the validated candidate Inbox return path when safe and still authorized. For failures before return-path trust, land at a safe destination that actually renders the message. Do not leak candidate existence after access is revoked. Show each message once, clear its URL parameter, and keep diagnostics free of tokens/raw provider errors. Cover missing state/code, expired attempt/session, changed permissions, provider denial and callback validation errors. No open redirects or raw JSON browser pages.

Acceptance: every failure produces an understandable next action without weakening scope checks or return-URL validation.

## Module 6 — One import audit per job

Review: `4441562365`. Primary files: `backend/inbox/sync_jobs.py`, scheduler and tests.

Keep batch commits for resilience; aggregate the total newly saved count separately. Write one SYSTEM completion entry per import job, or one partial-result entry after a failure with the number already saved. Retries/deduplication must not report old messages as new or duplicate the job result. Account for worker interruption and generation fencing. Samad confirmed auditing the first unread-to-read transition and every manual sync request, even zero-import requests; Abdul's policy sign-off remains required. Never label a request as completed import. Test concurrent read actions and repeated opens so only one first-read event is recorded.

Acceptance: a 300-message job creates one result, not 30; failure after two committed batches produces one truthful partial result; restart/retry does not double-count.

## Module 7 — Durable confirmation evidence

Review: `4441562355`. Primary files: `routes_inbox.py`, contract/team docs, existing ledger serializer/tests.

Persist a durable confirmation event containing actor, candidate, verified Google address, timestamp and attestation/version identifier as supported by an approved contract. Prefer the existing ledger rather than a new table. It must survive attempt cleanup, disconnect and mailbox replacement, and never contain a token. Ensure the permitted audit audience and retention implications are documented. Correct the contract to identify the actual authoritative record; do not claim the temporary OAuth row is permanent evidence.

Samad explicitly approved retaining actor/candidate/verified Gmail/time after email deletion and disclosing this exception. Restrict its audience; platform operational support must not gain candidate email details through an audit endpoint. The attestation/version field remains a contract proposal, not a newly approved schema field.

Acceptance: confirm account A, clean attempts, disconnect and connect account B; A's original attestation is still attributable and cannot be overwritten by B.

## Module 8 — Safe deletion UI and concurrency

Review: `4441562401`. Primary files: Inbox tab/dialog components, deletion endpoint/hooks, tests.

Move bulk erasure out of the everyday toolbar. Use an accessible in-app confirmation dialog naming the candidate and the actual server-scoped email count. Hide/disable when nothing is eligible. Explain irreversibility of current manual erasure, local storage versus Gmail originals, and whether future mail will continue syncing. Do not conflate this with the future recoverable automatic-purge proposal.

Provide both Samad-approved choices from D6, with Disconnect and delete selected by default. Stored-only deletion covers the server-defined confirmation-time target set and permits later arrivals. Disconnect-and-delete first fences jobs; Google revoke failure cannot prevent local disconnection/erasure and must produce a warning/manual revocation path. Protect later authorized reconnections from stale cleanup retries.

A count preview is not authorization: recheck permission/scope and bind the confirmed target set server-side. Disable duplicate submissions, retain truthful errors and invalidate list/body caches. Remove content from all served linked-email surfaces, preserving application statuses, protected review/history references and minimal deduplication identity; concurrent in-flight imports must not resurrect erased content. State the retained connection-audit exception explicitly. No new recruiter-reply redesign is required here: apply deletion restrictions to existing surfaces and carry them into PR 4.

Acceptance: Owner/Manager can erase only authorized content; BDE/Viewer/platform writes fail; cancel is harmless; keyboard focus returns correctly; UI and stored result agree. Future quarantine deletion must use the same permission boundary, but quarantine itself is PR 3 scope.

## Module 9 — Contracts and unresolved decisions

Review also includes `4441562410`. Update `docs/02-DATA-CONTRACTS.md`, `docs/team/samad.md` and the per-file PR report to remove contradictory completion/sign-off claims.

Record the newer automatic-update approval accurately: approved direction, gated off until PR 4/Undo; #104 performs no classification or status changes. Do not preserve an obsolete unconditional human-acceptance statement as the future product policy, or imply auto-update is active now.

Before publishing the completed correction, settle any affected contract/access changes, global-mailbox uniqueness, read/empty-sync audits, import/privacy/support metadata scope and deletion/reimport semantics with Abdul. Identify which unresolved decisions block merge versus only real-candidate rollout. Unknown decisions remain visibly open; do not choose silently.

Implement access revocation through existing backend scope helpers across candidate-related endpoints, including selected-email reads and mutations. Clear inaccessible candidate data from frontend cache on detected reassignment/authorization failure; never claim the system can retract content a user has already downloaded. Test subsequent API requests and client refresh/navigation after reassignment. If required changes affect another owner's module, document the dependency and obtain sign-off rather than broadening #104 silently.

## Module 10 — Final verification and delivery

1. Add reproducing regression tests for each module before fixing behavior; use synthetic provider responses and isolated PostgreSQL. No real credentials/mail in fixtures.
2. Test concurrency and negative authorization paths: replay, expired session, reassignment, suspended firm, cross-firm/candidate access, platform support, revoked permission after provider exchange, disconnect during fetch and cleanup during confirm.
3. Preserve previously confirmed fixes: individual-message 404/NUL skips, Inbox-only filtering, batched lock-free provider fetch, reconnect state, body-on-demand, callback clearing, Overview state, key rotation/startup validation and migration guards.
4. Run full backend suite with documented skips/xfails; frontend tests, typecheck, lint and production build. Do not count expected failures as newly passing tests. Record command, commit, date and logs; explain any build fallback.
5. Browser-check actual affected components: light/dark, 1440/1024/390, keyboard, reduced motion, axe; skeleton/empty/error/not-found. Verify no remount on email selection, older-page persistence, accessible deletion, cancel and expiry recovery.
6. Verify one Alembic head, upgrade/backfill/downgrade on temporary data, encryption/key failure safety, isolation inventory, secret scan and clean diff. Never migrate/reset the existing development database for these checks.
7. Refresh main and GitHub review/check state; document every changed file and its reason. Push to existing #104 after authorized verification; reply to relevant threads with actual evidence, not unverified promises.
8. Require passing CI and Abdul's code-owner approval. Report remaining launch gates. Merge only on explicit Samad instruction, with a merge commit. Preserve draft #95.

## Real-candidate launch gates (not automatically satisfied by merging #104)

- Named person accepts ownership of Google verification/security assessment and obtains current written policy guidance for delegated BDE access. No claim of Google approval based on consent alone. Verify project isolation from the legacy Google integration: a different client ID alone does not isolate Google project-wide revocation; account/project coexistence must be resolved before real connections.
- Approved import/privacy policy, consent and permitted-reader/support metadata behavior.
- Approved recoverable purge rule and recovery period; lawful labelled-data source and first accuracy gate.
- PR 3 matching/review/privacy flow ready and authorized for real candidates; external processing remains off until provider retention/logging verification in writing and consent update.
- Automatic updates remain off until PR 4 merges and Undo is usable. Do not bypass this through a legacy monitor.

## Decisions to carry into the post-#104 plan, not implement here

- Job-related mail goes to BDE review when human action is needed; only failed or possibly personal mail is quarantined. Classification disabled is a distinct readable-Inbox state.
- Owner/Manager release quarantine; see sender/time before release; alert when retries exhaust. Release does not trust sender or mutate application status. This supersedes the earlier proposal hiding sender from all quarantine reviewers; ordinary-reader content restrictions remain to be contracted.
- First accuracy gate: 1,000 labelled messages, at least 500 job-related; any job-related erasure fails. Use synthetic/authored examples and appropriately licensed or explicitly authorized, minimized real samples only after lawful source approval. No arbitrary candidate export. Re-test on every model/prompt change. Dataset composition and recovery duration still need concrete approval.
- Sender approval: exact sender, per candidate, by a BDE with current candidate access, audited; capture sender-authentication evidence in the contract. Missing authentication never qualifies for automation. Measure repeated approvals. Send contract and proposed table for sign-off before creating fields/table.
- Matched Other stays readable without status change; only unmatched Other may eventually qualify for approved recoverable purge. Failures alone never justify erasure; local exclusions use the same rule. Auto-purge stays off.
- Allowed transition matrix is approved as a starting point. Offer, Move On, backward changes and repeated rounds require review. Every automatic change needs Automatic ledger label, exact email and safe Undo; suppress reapplication of undone decisions.
- Notes remain visible/editable by authorized BDEs; recruiter replies link to exact Inbox email separately.
- Other remains an email category and is rejected as a new application-status selection by frontend/backend; existing records keep displaying it. No destructive backfill.
- Display order approved: Saved, Applied, conditional Incomplete application, Screening call, Shortlisted, Interview schedule request, Interview scheduled, Assessment, Offer. Move On is a separate outcome; Other is excluded from progress. Origin: Samad's earlier requested order, subsequently approved for display by Abdul.
- Inventory actual stored legacy statuses (including Response, Screening, Interview and all others), counts and provenance. Propose mappings and ambiguity handling for Abdul's schema sign-off; do not assume Response means Shortlisted or generic Interview means scheduled. Preserve history/source and prepare rollback before migration.
- Include off switches, AI cost tracking, prompt-injection tests and retained-mail classification/reprocessing behavior in the next plan. Do not trigger bulk historical automatic updates.
