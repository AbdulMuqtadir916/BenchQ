# PR 2 — Candidate Gmail connection, sync and retained account identity

Branch: `codex/candidate-gmail-connection` → `main`. Base: `a1c7a92` (includes merged PRs #100, #102 and #103).
User confirmed minimum account-history protection in this slice; no merge is authorized by publishing this PR.

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
Initial OAuth sync is synchronous and bounded per provider request; provider latency and production scheduler
execution/topology remain deployment review items. No Gmail sends, deletions, attachment downloads or read changes.

Existing stored messages are attributed to their current mailbox during backfill. If mailbox identity was overwritten
outside this feature, investigate that history first; do not invent an original source. New imports retain explicit
verified identity and duplicate provider IDs from different accounts remain distinct. Downgrade refuses to erase
live credentials, active authorization attempts or provenance that cannot be reconstructed.

The older combined local development database has a different applied migration history. It was not stamped,
upgraded, downgraded or reset. Use a separate database following main for this branch until a data-preserving
reconciliation is separately approved. Required code-owner approval for auth, model, migration and contract changes
remains a merge gate. PR 3 starts from updated main only after this PR merges.
