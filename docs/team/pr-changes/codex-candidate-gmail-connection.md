# PR 2 — Candidate Gmail connection, sync and retained account identity

Branch: `codex/candidate-gmail-connection` → `main`. Base: `a1c7a92` (includes merged PRs #100, #102 and #103).
Samad requested minimum account-history protection in this slice; no merge is authorized by publishing this PR.

## Scope

Google-hosted read-only consent per candidate, encrypted refresh credentials and PKCE verifier, one-use state,
initial 3-day import and incremental five-minute polling, manual sync, local read marks and disconnect/reconnect
with retained messages and source-account namespaces. One new migration, **0010** after **0009**.
No new application matching, model classification, BDE routing, automatic status updates, or polished tracker UI.
The merged PR #100 application command/response fixes are preserved unchanged.

## Files changed

| File | Changes and reason |
|---|---|
| `.env.example` | Documents the optional Inbox live adapter flag and keeps candidate OAuth secrets in backend configuration. |
| `backend/.env.example` | Adds blank candidate-specific Google client, callback and encryption-key settings; contains no credentials. |
| `backend/api/routes_inbox.py` | Implements scoped OAuth/read/import/disconnect/local-read endpoints, fresh authorization checks around provider exchange, single-use state, generation locks, private diagnostics and idempotent human audits. Imports cannot match/classify or update applications. |
| `backend/auth/access.py` | Registers candidate Inbox read/connect/sync/disconnect/read-mark routes and the signed-in Google callback in the central access inventory. |
| `backend/auth/ledger.py` | Adds the shared SYSTEM/AGENT audit helper so automated imports never impersonate a human. |
| `backend/config.py` | Loads separate candidate Gmail environment settings without changing the legacy global account settings. |
| `backend/inbox/__init__.py` | Creates the candidate Inbox package. |
| `backend/inbox/gmail_sync.py` | Imports three recent days then Gmail history, decodes bounded plain/HTML bodies without attachments, deduplicates per verified source account, bounds expired-checkpoint recovery and records errors only for the connection that failed. |
| `backend/inbox/google_oauth.py` | Builds Google read-only/PKCE consent, validates same-origin return paths, encrypts secrets, exchanges codes and accepts only a verified non-empty Google account identity. |
| `backend/main.py` | Registers only the candidate connection/import router; preserves merged Applications fixes and request-body limits. |
| `backend/migrations/versions/0010_candidate_gmail_connection.py` | Adds OAuth and provenance in one additive revision after 0009, backfills current source identity and changes deduplication. Downgrade guards live credentials, active OAuth attempts and irrecoverable retained namespaces. |
| `backend/models/candidates.py` | Adds OAuth-attempt state and mailbox credential/checkpoint fields plus retained source-account identity and account-scoped message uniqueness. Other owners’ models remain unchanged. |
| `backend/requirements.txt` | Adds cryptography for authenticated Fernet encryption of credentials and PKCE verifiers. |
| `backend/scheduler.py` | Adds configurable five-minute polling with a cross-worker advisory lock, mailbox row locks, suspended-firm filtering, generation-safe errors and SYSTEM import audit; no classification is scheduled. |
| `backend/tests/isolation_cases.py` | Adds F7 cases for all new firm routes and documents the callback’s signed-in, bound-state security boundary. |
| `backend/tests/isolation_support.py` | Uses synthetic OAuth and sync responses during isolation tests; no provider or real credentials are used. |
| `backend/tests/test_candidate_gmail_sync.py` | Tests MIME/attachment handling, three-day import, history checkpoints, inserted-ID reporting and duplicate retries without application linking. |
| `backend/tests/test_candidate_google_oauth.py` | Tests read-only scopes, PKCE and return-path safety, plus credential encryption and wrong-key refusal. |
| `backend/tests/test_candidate_mailbox.py` | Tests current-authority changes before/after Google exchange, one-use state, Viewer denials, account replacement, retained duplicate IDs, audit privacy/idempotency, row locks, generation races, import rollback, bounded checkpoint recovery and SYSTEM scheduled imports. |
| `backend/tests/test_firm_scoping_lint.py` | Includes OAuth state in the firm-owned inventory and documents the sole opaque-state lookup exception before current-identity authorization. |
| `backend/tests/test_migration_0009.py` | Compares a blocked downgrade with its starting revision so rollback safety stays valid when newer migrations exist; review-history preservation remains asserted. |
| `backend/tests/test_migration_0010.py` | Exercises real upgrade/backfill/downgrade round trips and verifies guarded rollback preserves emails, Applications reviews, credentials and active OAuth state. |
| `docs/02-DATA-CONTRACTS.md` | Records unclassified imports, source address, nullable pre-sync timestamp, connection states, retention and authorization contracts before the frontend schema changes. |
| `docs/integration/README.md` | Marks the Applications backend foundation merged and records the connection/sync slice separately from later classification. |
| `docs/team/README.md` | Records PR #100 merged and claims migration 0010 after main’s 0009. |
| `docs/team/pr-changes/codex-candidate-gmail-connection.md` | This per-file scope, validation and rollout report. |
| `docs/team/samad.md` | Records the agreed Gmail design, three-day import, read-only consent, credential handling, minimal account protection moved from PR 4, and remaining PR boundaries. |
| `scripts/qa/candidate-gmail/README.md` | Documents the reproducible local synthetic browser acceptance runner and installed axe asset mounting. |
| `scripts/qa/candidate-gmail/harness.tsx` | Renders the real Inbox hooks/components with a synthetic firm and candidate; adds no product route. |
| `scripts/qa/candidate-gmail/index.html` | Provides the standalone acceptance entry document. |
| `scripts/qa/candidate-gmail/next-link.tsx` | Provides the browser harness’s minimal Next Link boundary. |
| `scripts/qa/candidate-gmail/next-navigation.ts` | Provides local navigation/search-param hooks only for the standalone harness. |
| `scripts/qa/candidate-gmail/serve.mjs` | Starts the installed Vite runtime for acceptance without adding dependencies. |
| `scripts/qa/candidate-gmail/verify.py` | Blocks external traffic and verifies synthetic Google navigation, retained mail, no read retry loop, explicit retry, sync POST, read-only controls, loading/error/empty states, keyboard interaction and light/dark viewport axe checks. |
| `scripts/qa/candidate-gmail/vite.config.mjs` | Aliases the real source and local Next boundaries, uses only the Inbox live adapter, and serves the isolated harness on port 4185. |
| `src/app/[firm]/(app)/(workspace)/applications/[id]/page.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/applications/application-card.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/activity-tab.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/applications/application-drawer.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/applications/application-list.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/inbox/inbox-connect.tsx` | Replaces simulated consent/progress with Google-hosted authorization navigation, visible callback/errors, read-only explanation and retained-mail reconnect support. |
| `src/components/app/candidate/inbox/inbox-reader.tsx` | Shows the source mailbox on retained messages and safely labels unclassified imports; uses factual unlinked-mail text without claiming a failed classification. |
| `src/components/app/candidate/inbox/inbox-tab.tsx` | Wires real manual sync, retained disconnected messages, permission-aware controls and visible mutation errors; prevents read-failure retry loops, supports explicit retry, and corrects selected-timestamp contrast. |
| `src/components/app/candidate/overview/attention-card.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/overview/inbox-preview.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/inbox/signal-meta.ts` | Adds one neutral null-signal presentation helper and prevents unclassified messages from becoming application signals. |
| `src/lib/api/dto/inbox.ts` | Maps snake_case backend messages/connection data to the existing frontend boundary; leaves imports truthfully unclassified and preserves verified source addresses. |
| `src/lib/api/inbox.test.ts` | Tests scoped cookie requests, live OAuth redirect validation, sync/read failure handling and retained disconnected metadata. |
| `src/lib/api/inbox.ts` | Switches only in the adapter between live/mock data; scopes every request by firm/candidate, validates Google authorization URLs, and supports sync/disconnect/local read marking. |
| `src/lib/hooks/use-inbox.ts` | Keeps stable firm/candidate queries, polls connected mailboxes, navigates only from user consent actions, updates cache after sync/disconnect and rolls back failed optimistic read marks. |
| `src/lib/schemas/inbox.ts` | Represents an imported but unclassified email, optional source identity, disconnected/error connection state and a nullable first-sync time while preserving old fixtures through defaults. |
| `src/mocks/inbox.ts` | Keeps mock disconnect behavior consistent with retained-mail semantics and validates the candidate when marking a message read. |
| `src/mocks/membership.test.ts` | Supplies candidate scope to the read-mark adapter authorization tests. |

## Validation

- Initial protocol/schema/access checks: **49 passed**. Focused final Gmail/schema regressions: **42 passed** before
  adding the active-OAuth downgrade case; the final full suite includes that case.
- Frontend typecheck, ESLint, **563 tests**, and production build passed; existing CSS optimizer warning retained.
- Synthetic browser acceptance passed in light/dark, reduced motion, at **1440/1024/390**, with zero axe violations
  and page errors. Verified Google-only navigation, local read failure/no loop/explicit retry, retained messages,
  source-address display, real sync POST, read-only behavior and loading/error/empty states.
- Full backend suite on updated main: **3727 passed, 11 skipped, 13 expected failures**, with 54 live tests
  deselected; no unexpected failures. Ran on dedicated temporary PostgreSQL. No existing database or Google
  account was used. The first run exposed a fixed-revision assumption in the older rollback test; it now asserts
  preservation of its actual starting revision and review history.
- Final inventory covers all **53 changed files**; whitespace and secret-pattern checks passed. Latest main
  `a1c7a92` is included, retaining résumé creation and database timeout protections.

## Rollout and rollback

Configure candidate Google client ID/secret, exact callback origin, and a separately stored Fernet key through
backend secrets. Enable `inbox` in the frontend live-module list for evaluation. Mock mode uses synthetic fixtures.
Initial OAuth hands off to confirmation, then a leased batch import; production scheduler execution/topology remains a deployment review item. No Gmail sends, deletions, attachment downloads or read changes.

Existing stored messages are attributed to their current mailbox during backfill. If mailbox identity was overwritten
outside this feature, investigate that history first; do not invent an original source. New imports retain explicit
verified identity and duplicate provider IDs from different accounts remain distinct. Downgrade refuses to erase
live credentials, active authorization attempts or provenance that cannot be reconstructed.

The older combined local development database has a different applied migration history. It was not stamped,
upgraded, downgraded or reset. Use a separate database following main for this branch until a data-preserving
reconciliation is separately approved. Required code-owner approval for auth, model, migration and contract changes
remains a merge gate. PR 3 starts from updated main only after this PR merges.


## Review correction work (2026-11-02)

These changes address Abdul’s review; Samad requested the product direction, and Abdul’s approval remains open.
The earlier verification above describes the original PR commit. Final correction results are recorded separately
below; do not treat earlier checks as validation of the corrections.

| Additional/updated file | Review correction |
|---|---|
| `backend/inbox/sync_jobs.py` | Persisted lease, generation fencing, provider fetch outside row locks, ten-message batch commits, retry/reconnect state and SYSTEM audit. |
| `backend/inbox/content_storage.py` | Key-dependent bounded retained body/preview conversion in the unmerged migration; preserves content on reviewed rollback. |
| `backend/api/routes_inbox.py` | Pending OAuth confirmation, cross-firm identity lock, body-on-selection, pagination, revocation and Owner/Manager audited content erasure preserving review references. |
| `backend/inbox/gmail_sync.py` | Deleted-message 404 skip, Inbox-label enforcement, invalid-text skip, encrypted body/preview, distinct invalid-grant error. |
| `backend/inbox/google_oauth.py` | Disabled-by-default rollout gate, key validation/keyring, versioned content crypto and bounded revocation helper. |
| `backend/models/candidates.py` | Persist job lease/state, pending consent fields, confirmation time and deletion marker on Samad-owned tables. |
| `backend/migrations/versions/0010_candidate_gmail_connection.py` | Extend unmerged single revision for these fields and retained-content encryption; no merged revision changed. |
| `backend/config.py`, `backend/.env.example` | Explicit rollout gate and documented keyring. |
| `backend/main.py` | Startup key validation when enabled; safe browser redirect on callback errors. |
| `backend/scheduler.py` | Schedule generation-fenced import jobs, including recovery after restart; skip suspended/disconnected/expired connections. |
| `backend/auth/access.py` | Register confirmation/content-removal routes and restrict confirmation metadata in support views. |
| `backend/tests/conftest.py` | Synthetic test-only key/enable settings for isolated provider tests. |
| `backend/tests/isolation_cases.py`, `backend/tests/isolation_support.py`, `backend/tests/test_isolation.py` | New route inventory, pending-attempt canaries and synthetic provider jobs; support-view denial. |
| `backend/tests/test_candidate_gmail_sync.py`, `backend/tests/test_candidate_google_oauth.py`, `backend/tests/test_candidate_mailbox.py` | Sync errors/filtering, key rotation, consent/replay/current scope, lock-free fetch, disconnect during fetch, saved-batch failure, deletion/history and revocation fallback. |
| `backend/tests/test_firm_scoping_lint.py` | Narrowly documented global identity collision check. |
| `backend/tests/test_migration_0010.py` | Clear pending synthetic consent where testing independent rollback guards. |
| `src/lib/query/keys.ts` | Central tenant-scoped confirmation/body query keys. |
| `src/lib/schemas/inbox.ts`, `src/lib/api/dto/inbox.ts` | Documented sync state contract mapped through DTO. |
| `src/lib/api/inbox.ts`, `src/lib/hooks/use-inbox.ts` | Confirmation, body-on-demand, deletion, older-page loading and import/normal polling. |
| `src/components/app/candidate/inbox/inbox-tab.tsx` | Confirmation with candidate details, importing indicator, independent reader loading, delete confirmation, load more and reconnect errors. |
| `src/components/app/candidate/inbox/inbox-connect.tsx` | Explain read scope, permitted readers, retained content and deletion; callback message moved to Inbox. |
| `src/components/app/candidate/overview/inbox-preview.tsx`, `src/components/app/candidate/overview/attention-card.tsx` | Correct disconnected/expired state and reconnect prompt while retaining saved emails. |
| `docs/02-DATA-CONTRACTS.md`, `docs/team/samad.md` | Record requested decisions, separate PR 3 classification, and leave product-owner approval open. |

Final correction validation: **3748 backend tests passed**, 11 skipped, 54 live tests deselected, 13 existing
expected failures and 6 existing warnings; **563 frontend tests passed**. Typecheck and full ESLint passed.
Production build passed with `next build --webpack`; Turbopack could not bind its internal CSS worker port in this
execution environment. The initial node_modules symlink was replaced with an isolated dependency copy. No product
build configuration was changed. Browser checks passed: both themes, 1440/1024/390, reduced motion, keyboard,
zero axe violations/page errors, confirmation details and dismissal, import indicator, content removal, URL filters,
read retry, retained mail and stable list identity during selection. No live Google/model calls or existing database
changes were used. An earlier full run exposed a pending-consent test fixture interfering with the independent
0009 history guard; that fixture was corrected and the final full run above passed. Latest main `a1c7a92` is included.

The c98538d checks above validate only that earlier correction. Abdul subsequently identified additional blockers; see the follow-up section below. Do not treat this older completion statement as current merge readiness. Google verification/security assessment,
production worker topology and Abdul's product/code-owner sign-off remain open rollout/merge gates. Candidate Gmail
remains disabled by default, and PR 3 matching/classification decisions remain separate.


### Exact correction file inventory

- `backend/.env.example`
- `backend/api/routes_inbox.py`
- `backend/auth/access.py`
- `backend/config.py`
- `backend/inbox/content_storage.py`
- `backend/inbox/gmail_sync.py`
- `backend/inbox/google_oauth.py`
- `backend/inbox/sync_jobs.py`
- `backend/main.py`
- `backend/migrations/versions/0010_candidate_gmail_connection.py`
- `backend/models/candidates.py`
- `backend/scheduler.py`
- `backend/tests/conftest.py`
- `backend/tests/isolation_cases.py`
- `backend/tests/isolation_support.py`
- `backend/tests/test_candidate_gmail_sync.py`
- `backend/tests/test_candidate_google_oauth.py`
- `backend/tests/test_candidate_mailbox.py`
- `backend/tests/test_firm_scoping_lint.py`
- `backend/tests/test_isolation.py`
- `backend/tests/test_migration_0009.py`
- `backend/tests/test_migration_0010.py`
- `docs/02-DATA-CONTRACTS.md`
- `docs/team/pr-changes/codex-candidate-gmail-connection.md`
- `docs/team/samad.md`
- `scripts/qa/candidate-gmail/harness.tsx`
- `scripts/qa/candidate-gmail/next-navigation.ts`
- `scripts/qa/candidate-gmail/verify.py`
- `src/components/app/candidate/inbox/inbox-connect.tsx`
- `src/components/app/candidate/inbox/inbox-tab.tsx`
- `src/components/app/candidate/overview/attention-card.tsx`
- `src/components/app/candidate/overview/inbox-preview.tsx`
- `src/lib/api/dto/inbox.ts`
- `src/lib/api/inbox.ts`
- `src/lib/hooks/use-inbox.ts`
- `src/lib/query/keys.ts`
- `src/lib/schemas/inbox.ts`

The additional QA navigation shim mirrors Next’s History API integration; browser tests cover URL filters and confirmation dismissal. The 0009 test changes only its independent fixture cleanup, not the merged migration or history-protection assertion.


## Follow-up to Abdul's c98538d review (2026-11-02)

Local work only: not pushed, no new PR, no merge. Worktree `/private/tmp/benchq-pr104-review` preserves the
combined dirty development folder. Main `a1c7a92` was fetched and is included. The root `pr104_plan.md` and
`prstatus.md` record the detailed decisions/checklist; Samad's choices are distinguished from Abdul's pending
code-owner/contract approvals. Required review remains; no promise of zero unknown bugs or Google approval.

### Resulting behavior

- Confirmation can be cancelled or restarted after expiry; cleanup persists failed encrypted grants for scheduled
  retry, protects active grants, and also handles issued-token/identity-lookup failures.
- A short nonblocking global grant-operation advisory lock prevents exchange/activation/revoke races. Busy
  operations return a retryable error. Google revokes project-wide grants, so this intentionally trades concurrent
  OAuth throughput for safety; it does not lock mailbox rows across provider calls or block ordinary Inbox reads.
- ERROR retains ownership and has Disconnect. Reassignment does not disconnect a candidate mailbox; former BDE
  cannot access it or finish confirmation. Candidate-linked ledger history follows current assignment instead of
  continuing to expose the original actor's old candidates. No historical attribution is guessed for unlinked rows.
- Stable cursor paging/infinite cache preserves older pages and independent selected-email bodies across refresh.
- Callback errors return to a trusted destination or an explanatory root screen; no silent redirect or raw JSON.
- Each import job has one ledger record, updated with committed counts; a worker crash leaves a truthful partial
  count. This is an explicit mutable job-summary record, not a new ledger row for each batch.
- Connection confirmation survives in the existing ledger with actor/candidate/address/time/notice version.
  Platform audit/support cannot read message content, sender or attestation email address.
- Owner/Manager deletion uses a proper candidate/count dialog outside the everyday toolbar. Bulk defaults to
  Disconnect and delete; stored-only remains available. In-flight results are fenced, tombstones prevent repeat
  import, erasure runs as a SQL update rather than loading every full body, and current delete authority is checked
  again after Google I/O. Google revoke failure cannot prevent local erasure; warnings remain visible even with an
  empty Inbox. Gmail originals, application statuses and minimal history/connection evidence remain.
- External classification, automatic status changes and real-candidate rollout remain gated; no classifier,
  quarantine table, sender approval table, status migration or new database column is added by this follow-up.

### Per-file follow-up inventory

| File | Change and reason |
|---|---|
| `backend/api/routes_inbox.py` | Cursor/total response, selected lookup, operational-only support response, guarded pending grant cleanup/cancel, generic global collision, durable consent, ERROR disconnect and fenced SQL erasure with fresh authorization. |
| `backend/inbox/google_oauth.py` | Preserve issued grants when identity lookup fails; bounded authenticated identity recovery for cleanup without logging tokens. |
| `backend/inbox/sync_jobs.py` | Update one candidate-scoped SYSTEM result per job with committed total/partial progress. |
| `backend/scheduler.py` | Retry expired encrypted grant cleanup independently of browser callbacks. |
| `backend/main.py` | Preserve safe validated callback destinations and fallback error message. |
| `backend/auth/access.py` | Register cancellation in central access policy. |
| `backend/api/routes_ledger.py` | Current-candidate BDE audit scope and support redaction. |
| `backend/api/routes_admin.py` | Prevent platform audit from exposing connection addresses. |
| `backend/auth/serialize.py` | Redacted email audit summary/note option and existing candidate_id relation in transport. |
| `backend/tests/isolation_cases.py` | F7 cancellation route coverage. |
| `backend/tests/test_pr104_followup.py` | Reproduce review blockers, grant outages/races, ownership/assignment, stable cursors, deletion/fresh permissions and platform audit privacy. |
| `backend/tests/test_candidate_mailbox.py` | Support acceptance now requires no email rows/metadata while authorized candidate reader retains content access. |
| `backend/tests/test_candidate_google_oauth.py` | Issued token survives failed identity lookup for cleanup and is absent from error messages. |
| `backend/tests/test_scheduler_configure.py` | Grant cleanup remains scheduled even with Inbox polling disabled. |
| `backend/tests/test_ledger.py` | Contract shape and history-follows-assignment expectations explicitly updated. |
| `backend/tests/test_firm_scoping_lint.py` | Narrow reasons for internal global grant safety probes and scheduled cleanup; not general user access. |
| `src/lib/api/inbox.ts` | Cancel, cursor reads and explicit disconnect-and-delete request. |
| `src/lib/api/dto/inbox.ts` | Map cursor/end and total count at the adapter boundary. |
| `src/lib/schemas/inbox.ts` | Compatible nextCursor/totalCount UI contract. |
| `src/lib/hooks/use-inbox.ts` | Infinite page-aware cache, independent bodies, cancellation, safe mutation invalidation and inaccessible-body cache removal. |
| `src/lib/hooks/inbox-pagination.test.ts` | Real TanStack observer proves loaded pages survive refetch and reach an end state. |
| `src/lib/api/inbox.test.ts` | Cursor encoding, cleanup result and deletion-mode contracts. |
| `src/components/app/candidate/inbox/inbox-tab.tsx` | Cancel/expiry components, retained pagination/selection, ERROR disconnect, storage controls, empty-Inbox revocation warning. |
| `src/components/app/candidate/inbox/mailbox-confirmation.tsx` | Focused confirmation/cancel/restart UI with truthful retry errors. |
| `src/components/app/candidate/inbox/inbox-content-dialog.tsx` | Accessible existing dialog primitive, named candidate/count, irreversible local deletion, disconnect default and retained-audit disclosure. |
| `src/components/app/candidate/inbox/inbox-connect.tsx` | Ongoing-import/storage/readers/disabled-AI disclosure and clear stale confirmation parameter before new OAuth. |
| `src/app/page.tsx` | Parse fallback callback result through installed Next async searchParams API. |
| `src/components/routes/landing-mailbox.test.ts` | Render the actual root fallback and prove its failure/continue UI and strict query parsing. |
| `src/components/routes/landing.tsx` | Display failed connection before deliberate continue to the normal landing destination. |
| `src/lib/schemas/analytics.ts` | Optional existing candidate relation for ledger ownership checks; no new persistence. |
| `src/lib/api/dto/session.ts` | Map ledger candidate relation without leaking backend shape. |
| `src/lib/auth/policy.ts` | Frontend ledger scope mirrors current-candidate backend rule. |
| `src/lib/auth/permissions.test.ts` | Old actor loses moved candidate; current BDE sees prior candidate history. |
| `src/mocks/inbox.ts` | Include neutral cursor for disconnected fixture compatibility. |
| `scripts/qa/candidate-gmail/harness.tsx` | Synthetic cache-refetch hook to exercise real page retention. |
| `scripts/qa/candidate-gmail/verify.py` | Cancel/expiry/ERROR recovery, older-page selection after refresh, dialog accessibility and revoke-failure warning after bulk deletion; all provider traffic synthetic. |
| `docs/02-DATA-CONTRACTS.md` | Exact revised proposed contracts, retention/readability, ownership, transport, audit and rollout decisions. |
| `docs/team/samad.md` | Updated two-PR sequence and conditional automation approval; remove obsolete contradictory policy. |
| `docs/integration/01-ledger.md` | Explicit proposed assignment/attestation/support privacy contract amendment. |
| `docs/team/pr-changes/codex-candidate-gmail-connection.md` | This inventory/evidence; supersedes old completion claim. |
| `pr104_plan.md`, `prstatus.md` | Decisions, execution evidence and honest approval/rollout gates. |

### Verification log (follow-up)

- New baseline regressions: **10 failed, 1 passed**, exposing actual defects before fixes.
- Focused backend verification before final cursor/SQL-erasure hardening: **224 passed**, one existing warning;
  includes F7 isolation, scoping lint, OAuth, mailbox, reassignment/audit and provider failures.
- Final frontend: **572 passed (46 files)**; typecheck and ESLint pass on installed Node 22.23.4 tools.
- Production `next build --webpack` passes, retaining the existing CSS `::highlight` warning. The machine's pnpm
  executable stalled before output; installed Node-based tools were invoked directly. No dependency/config change.
- Browser acceptance passes on synthetic mail/provider responses: both themes, 1440/1024/390, reduced motion,
  keyboard, axe zero, no page errors; stable list selection, cursor older pages/refetch, confirmation cancel/expiry,
  ERROR disconnect, proper delete dialog and revoke warning even after all local mail is erased.
- Full backend: **3,767 passed**, 11 skipped, 54 live deselected, 13 existing expected failures, 6 existing
  warnings (1,000.29s). Final hardening/isolation after the last production changes: **243 passed**. The expanded
  follow-up regression module then passed **34 cases**, including 300-message import, concurrent reads, durable
  reconnect attestation, interrupted-worker recovery, deletion during fetch and callback failures. These runs
  overlap; do not add their counts. All exit codes were zero. Logs: `/private/tmp/pr104-final-backend.log`,
  `/private/tmp/pr104-hardening-final.log`, `/private/tmp/pr104-verified-regressions.log`.
- Final frontend/type/lint logs: `/private/tmp/pr104-completed-frontend.log`, `pr104-completed-types.log`,
  `pr104-completed-lint.log`; production/browser logs: `pr104-pagination-build.log`, `pr104-pagination-ui.log`.
- Diff whitespace/credential-pattern checks passed. No model/migration or dependency files changed in this follow-up.
- No real Google/model calls, main merge, PR comments/push, or existing application database changes.

### Remaining sign-off/launch limits

Abdul must sign off the exact global mailbox reservation policy, revised read/empty-sync audits, current-candidate
ledger permission/transport amendment, and proposed endpoint/consent changes. Approval was not invented by checking
local tests. Candidate Gmail stays disabled by default. Google requires a named verification/security-assessment
owner, legacy Google project-isolation check and policy confirmation for delegated reading; provider logging/retention approval and recoverable purge/data
provenance remain later launch requirements. The post-#104 plan must also explicitly settle provider re-import when
an address is reused for a different candidate; retained records themselves never move candidates/firms. Legacy
mock application/UI integration remains the later tracks; this PR does not rewrite all mock modules.
