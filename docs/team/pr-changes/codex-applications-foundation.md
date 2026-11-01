# PR 1 — Applications foundation

Branch: `codex/applications-foundation` → `main`.
Base checked on 2026-11-01: `aae29c8` (includes the résumé versioning documentation merged in PR #96).
This is the first standalone replacement slice of combined PR #95. Later slices wait for their predecessor to merge.

## Scope and dependencies

Candidate application status/history, BDE review storage and explicit confirmation, and migration **0008 only**.
Depends on the already-merged candidate core (0007), existing auth/ledger helpers and Postgres.
Each status command writes revision, event, legacy-compatible JSON and audit in one transaction. Existing review
records must be confirmed explicitly; this PR does not import or classify mail or create model decisions.
Saved/favorite bookkeeping and candidate-scoped interview/prep access are included because they share the
application lifecycle and public write boundaries. No frontend or dependency files change.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/api/routes_applications.py` | Adds candidate-filtered reads, application detail/status/review commands, revision-aware updates and candidate Saved lifecycle handling. Applies candidate scope to edits, interview CRUD and prep; isolates tailored résumés by candidate; audits edits and refuses deletion of retained history before mutating a batch. Saved creation explicitly clears the ORM submission timestamp default. Bulk commands reject malformed revision maps with 400 before changing candidate rows. |
| `backend/applications/__init__.py` | Creates the Applications service package for shared transaction commands. |
| `backend/applications/tracking.py` | Defines Saved plus ten candidate statuses, enforces permission/revision/idempotency rules, records immutable events and ledger entries, maintains Saved favorites and resolves persisted reviews atomically. The review creation seam validates firm/candidate/application/mailbox ownership without any classifier dependency. |
| `backend/auth/access.py` | Registers the application detail, candidate-status and review endpoints in the central access inventory so auth and F7 checks cover them. |
| `backend/email_monitor/gmail_client.py` | Excludes candidate applications from the legacy single-account match/write paths so it cannot bypass their new revision and history rules. |
| `backend/migrations/versions/0008_application_tracking.py` | Adds three application tracking fields, review/status-event tables, indexes and an append-only SQL trigger. Backfills valid legacy JSON transitions without rewriting originals or statuses; skips an untouched Saved receipt. Downgrade preserves JSON and refuses to discard review history. |
| `backend/main.py` | Restricts the manual auto-reject trigger to legacy applications, matching the scheduled path so a platform run cannot bypass candidate status revisions/history. |
| `backend/models/db.py` | Maps only the 0008 application fields and review/status-event tables and relationships. Classifier tables/fields from the combined branch are deferred. |
| `backend/scheduler.py` | Restricts legacy silent auto-rejection to non-candidate applications, preserving candidate decisions until their dedicated workflow runs. |
| `backend/tests/isolation_cases.py` | Adds F7 cases for the three application endpoints and supplies revision-aware bulk commands; uses separate legacy rows for valid deletion tests. |
| `backend/tests/isolation_support.py` | Seeds a separate deletable legacy application and a candidate application/email/pending review for isolation tests. Has no OAuth or classifier fixtures. |
| `backend/tests/test_application_foundation_regressions.py` | Tests role/assignment access for interviews/prep, candidate résumé isolation, atomic protected deletion, consistent legacy read/write scope, notes audit idempotency, Saved create/remove retention legacy scheduler/manual-trigger isolation and invalid bulk revision-map rejection. |
| `backend/tests/test_application_tracker.py` | Tests revision conflicts, command replays, immutable history, explicit review resolution and review scope, BDE visibility and legacy email-writer isolation; covers latest tailored résumé matching for candidate and legacy rows. |
| `backend/tests/test_candidate_application_status.py` | Tests Saved/Applied and all candidate status commands, actor attribution, timestamps, favorite bookkeeping, ledger writes and denied/invalid moves. Candidate Jobs feed assertions remain with the deferred Jobs integration rather than pulling that API into this foundation. |
| `backend/tests/test_firm_scoping_lint.py` | Includes both new history/review tables and models in the inventory used to enforce scoped reads. |
| `backend/tests/test_gmail_client_apply_llm.py` | Marks existing mock applications as legacy (candidate_id=None) so the tests continue exercising the intended legacy writer. |
| `backend/tests/test_migration_0008.py` | Exercises repeated real 0007→0008 upgrades/backfills/downgrades, preserves legacy JSON/status/actor information and checks that pending reviews block destructive rollback. |
| `docs/02-DATA-CONTRACTS.md` | Documents the backend foundation fields, statuses, commands, review/event storage, access and compatibility behavior; records required code-owner review without changing frontend schemas or the résumé versioning contract on main. |
| `docs/integration/03-applications.md` | Records the backend-only PR 1 scope and links the contract/change report; distinguishes it from the original full frontend integration tasks. |
| `docs/team/README.md` | Claims migration 0008 for this standalone foundation branch and records pending code-owner review. |
| `docs/team/samad.md` | Records the agreed PR raise rules: refresh main, sequential independent PRs, per-file Markdown reports, preserve remaining work and satisfy migration/approval gates. |
| `docs/team/pr-changes/codex-applications-foundation.md` | This per-file report records scope, dependencies, validation, migration impact and remaining review gates. |

## Migration and rollback

- One new Alembic head: `0007` → `0008`; no OAuth/classifier/account-provenance revisions are included.
- Existing status text and transition JSON remain readable. Valid old transitions gain normalized history;
  malformed JSON entries remain in the original array. Untouched Saved drafts remain removable.
- New tables have firm/candidate/application ownership and restricted foreign keys; database triggers prohibit
  status-event edits/deletes. Downgrade keeps original transition JSON and refuses to discard stored reviews.
- Tests run only on disposable Postgres databases. This PR preparation does not migrate the development database,
  which already contains later migrations from the combined local work. Do not run this older-schema checkout
  against that database; review/test it with a separate database at 0008.

## Validation

- Initial focused suite: **63 passed** (before adding the Saved create/remove and scheduler regression cases).
- Full backend suite: **3,574 passed**, 4 skipped, 54 live cases deselected, 13 expected failures, 6 warnings (498.13 seconds).
- After the final bulk input-validation adjustment, affected Applications/API/migration regressions: **256 passed**, 3 expected failures, 1 warning (41.39 seconds).
- Frontend: **554 passed**; typecheck, ESLint and production build passed through the installed script binaries. Existing CSS optimizer warning retained.
- Whitespace and changed-file inventory: checked before commit.

## Remaining gates and deferred work

Abdul's code-owner approval is required for auth inventory, schema, migration and contract changes before merge.
Gmail OAuth/import, email classification, account provenance, candidate Jobs feed integration and UI changes remain
in the preserved combined branch/local workspace for later PRs. The existing frontend continues its current mock
behavior; no provider calls, credentials or emails are used by these tests. No approval or merge is implied by local
checks or by opening this PR.
