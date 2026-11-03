# PR #104 — Candidate Gmail connection, import and retained mail

Branch: `codex/candidate-gmail-connection` → `main`. Current integration base: `fc1bf67` (includes password-reset notifications #105). This report supersedes earlier mutable-ledger/broad-BDE-scope descriptions. Local working plans/checklists remain outside the PR.

## Scope and review corrections

Read-only Google OAuth with explicit candidate/address confirmation, encrypted credentials/body/preview storage, initial three-day Inbox import and incremental sync, background progress, retained mail, current candidate access and Owner/Manager deletion. No matching, external classification, quarantine, sender tables or application-status automation is added.

- Cancel/expiry/conflict cleanup retains safe encrypted retry and protects a live Google grant; ERROR connections expose Disconnect. Callback failures show an explanation at a trusted destination or safe fallback.
- **Ledger is append-only.** Existing JobRun JSON metadata stores candidate/mailbox/generation, committed count and finalized marker. Email batches/counts commit together. Completion/failure/recovery appends one immutable SYSTEM result for a nonempty run; no-change polls add no result. Disconnect/reconnect/deletion fence and finalize prior work. A dedicated cleanup pass recovers expired/detached/suspended runs independently of import polling.
- **Q52 remains unchanged.** A BDE sees authored entries plus ASSIGN entries for currently handled candidates; candidate Inbox access does not expose other actors’ ledger activity. No new frontend ledger field or broader ledger permission ships.
- Known Google identities use normalized-account locks (and a candidate lifecycle lock for replacement). Unknown-identity exchanges can proceed concurrently across firms, and different-account revocations can also overlap. Two-group coordination prevents exchange/revocation overlap; a short global admission lock is never held during Google I/O. Admission has a five-second total lock-wait budget and releases on error; Google I/O holds no mailbox row locks. An opposite-group operation can temporarily delay admission; unrelated confirmations do not take the global barrier. Pending confirmations invalidated by disconnect cannot activate a revoked grant.
- Cursor ordering is received time descending/ID ascending, with first-page total count and explicit end state. Ordinary refresh makes no HTTP requests for cached historical pages; when counts indicate older backfill or erasure, loaded history is refreshed once before cache reuse resumes; new-arrival overflow is bridged to the prior head before keeping its historical cursor. Automatic URL restoration is capped at three pages. Selected bodies remain independently addressable. Expired confirmation uses **Return to Inbox**, followed by a separate Connect action.
- Owner/Manager deletion uses an accessible named-candidate/count dialog outside the everyday toolbar, defaults to Disconnect and delete, and permits stored-only erasure with ongoing-sync disclosure. Local erasure completes even when Google revocation fails, with an honest warning. Gmail originals, statuses and minimal history references remain.

## Decisions and approval provenance

- Abdul’s 2026-11-03 GitHub review approves health/counts-only support visibility. Support receives no email rows, subject/sender/body/preview or identifying audit text.
- Samad reports Abdul approved **one active candidate connection per Gmail globally** in person; recorded on 2026-11-03. Explicit disconnect releases ownership; ERROR retains it; collision messages disclose no other firm/candidate/BDE. This is attributed reporting, not a GitHub approval.
- Samad reaffirmed first unread-to-read auditing, every manual Sync request even with zero imports, and cursor pagination. Reopening read mail adds no event. Exact audit/pagination/attestation contracts still require Abdul’s code-owner sign-off; the in-person uniqueness discussion is not treated as approval of those contracts.
- Classification off means imported mail stays readable and Unclassified in Inbox. External real-mail classification stays off until written provider retention/logging verification and consent update. Automatic updates stay off until PR 4 is merged and Undo is usable.

## Migration and data safety

One unmerged Gmail migration: **0011 after main’s notifications 0010**. The rename resolves a number collision after #105; no merged migration is edited. Upgrade backfills current mailbox provenance and encrypts retained text; guarded downgrade refuses to discard live credentials, active OAuth or irrecoverable account history. Existing development data was not migrated, reset or stamped. Configure deployment OAuth/callback and Fernet keys before enabling/migrating retained content; preserve old keys until re-encryption. Job progress uses existing columns only.

## Verification — current revision

- Latest targeted frontend check: 582 passed; typecheck/lint passed. Production Webpack build passed with the existing CSS optimizer warning.
- Synthetic Chromium acceptance passed in light/dark, 1440/1024/390, keyboard/reduced motion, axe zero and no page errors. The actual hook also proves a refresh issues only a newest-page request while preserving the older selected reader. Actual components and hooks are exercised; no real Google/model requests or candidate mail.
- Final affected backend/isolation/migration suite: **256 passed**, one existing warning. Complete backend suite is running on a separate disposable PostgreSQL database; its result remains pending. Counts overlap, not additive. The final group-coordination hardening occurred after the complete-suite snapshot; the 256-case affected run validates that group-coordination change and additional concurrency cases. A subsequent **75-case** callback/lifecycle run passed after the final permission/expiry recheck was added following admission. No product code changed after that final affected run.
- New regressions cover immutable ledger history, atomic batch counts, restart recovery, concurrent accounts across firms, bounded lock waiting/release, cancellation after coordination wait, pending-grant invalidation and newest-only history refresh.

## Remaining review and launch limits

Code-owner/contract approval, new-head CI and explicit Samad merge instruction are required. Existing review threads remain open for Abdul to verify. PR #95 stays draft. Do not enable real-candidate access merely because local checks pass.

Candidate Gmail remains disabled by default. Launch needs a named Google verification/security-assessment owner, delegated-reading policy confirmation, and verified OAuth project isolation from legacy clients: separate client IDs do not isolate project-wide revocation. Import/consent/retention and cross-candidate provider re-import policy remain explicit approval gates. Retained rows never transfer between candidates/firms; future provider re-import is a separate privacy decision. Recoverable purge rule/recovery period and lawful accuracy-data provenance are required before real candidates. PR 3 matching/review and PR 4 Undo remain later work. Remaining mock application/UI integration is not delivered by this PR.

## Per-file changes

| File | Change and reason |
|---|---|
| `.env.example` | Documents the optional Inbox live adapter flag and keeps candidate OAuth secrets in backend configuration. |
| `backend/.env.example` | Adds blank candidate-specific Google client, callback and encryption-key settings; contains no credentials. |
| `backend/api/routes_admin.py` | Prevent platform audit from exposing connection addresses. |
| `backend/api/routes_inbox.py` | Scoped confirmation/cancel/recovery, current authorization, per-account lifecycle, project-grant-safe revocation, pending-confirmation invalidation, first-page counts, retained-mail reads and fenced deletion. |
| `backend/api/routes_ledger.py` | Restore approved Q52 own/ASSIGN ledger scope; retain approved support email-summary redaction. |
| `backend/auth/access.py` | Register cancellation in central access policy. |
| `backend/auth/ledger.py` | Adds the shared SYSTEM/AGENT audit helper so automated imports never impersonate a human. |
| `backend/auth/serialize.py` | Redacted email audit summary/note option and existing candidate_id relation in transport. |
| `backend/config.py` | Loads separate candidate Gmail environment settings without changing the legacy global account settings. |
| `backend/inbox/__init__.py` | Creates the candidate Inbox package. |
| `backend/inbox/content_storage.py` | Key-dependent bounded retained body/preview conversion in the unmerged migration; preserves content on reviewed rollback. |
| `backend/inbox/gmail_sync.py` | Deleted-message 404 skip, Inbox-label enforcement, invalid-text skip, encrypted body/preview, distinct invalid-grant error. |
| `backend/inbox/google_oauth.py` | Preserve issued grants when identity lookup fails; bounded authenticated identity recovery for cleanup without logging tokens. |
| `backend/inbox/grant_locks.py` | Bounded account locks plus two-group exchange/revocation coordination; unrelated exchanges and unrelated revocations overlap safely, with no exclusive global lock over provider I/O. |
| `backend/inbox/import_progress.py` | Finalize durable counts once under row lock; recover expired, detached or suspended runs without editing ledger history or adding a table. |
| `backend/inbox/sync_jobs.py` | Commit imported messages and existing JobRun progress atomically; append an immutable terminal/recovery result, with generation/lease fencing. |
| `backend/main.py` | Preserve safe validated callback destinations and fallback error message. |
| `backend/migrations/versions/0011_candidate_gmail_connection.py` | Single unmerged Gmail revision after main notifications 0010: OAuth/provenance/encrypted retention and guarded downgrade. No merged migration edited. |
| `backend/models/candidates.py` | Persist job lease/state, pending consent fields, confirmation time and deletion marker on Samad-owned tables. |
| `backend/requirements.txt` | Adds cryptography for authenticated Fernet encryption of credentials and PKCE verifiers. |
| `backend/scheduler.py` | Import polling plus independent expired-grant and abandoned-run recovery, including when import polling is off. |
| `backend/tests/conftest.py` | Synthetic test-only key/enable settings for isolated provider tests. |
| `backend/tests/isolation_cases.py` | F7 cancellation route coverage. |
| `backend/tests/isolation_support.py` | Uses synthetic OAuth and sync responses during isolation tests; no provider or real credentials are used. |
| `backend/tests/test_candidate_gmail_sync.py` | Tests MIME/attachment handling, three-day import, history checkpoints, inserted-ID reporting and duplicate retries without application linking. |
| `backend/tests/test_candidate_google_oauth.py` | Issued token survives failed identity lookup for cleanup and is absent from error messages. |
| `backend/tests/test_candidate_mailbox.py` | Support acceptance now requires no email rows/metadata while authorized candidate reader retains content access. |
| `backend/tests/test_firm_scoping_lint.py` | Document narrow internal global grant-safety probes and same-account pending invalidation; user-facing access remains scoped. |
| `backend/tests/test_isolation.py` | Extend reusable F7 support-view expectations: confirmation details are refused in read-only support; existing negative routes remain covered. |
| `backend/tests/test_ledger.py` | Keep backend Q52 own/ASSIGN expectations; deny other actors’ updates while preserving handoff notes. |
| `backend/tests/test_migration_0009.py` | Compares a blocked downgrade with its starting revision so rollback safety stays valid when newer migrations exist; review-history preservation remains asserted. |
| `backend/tests/test_migration_0011.py` | Real PostgreSQL upgrade/backfill/downgrade and credential/provenance guards, aligned to parent 0010. |
| `backend/tests/test_pr104_followup.py` | Review regressions including current-assignment Inbox isolation, stable cursors, pending cleanup, immutable recovery and safe erasure. |
| `backend/tests/test_pr104_revision.py` | Immutable ledger/progress atomicity, crash recovery, cross-firm concurrent callbacks/confirmation, lock release and revoked pending-confirmation regressions. |
| `backend/tests/test_scheduler_configure.py` | Grant cleanup remains scheduled even with Inbox polling disabled. |
| `docs/02-DATA-CONTRACTS.md` | Document actual OAuth/retention/support/ledger/cursor behavior and distinguish approval provenance from remaining sign-offs. |
| `docs/integration/01-ledger.md` | Keep Q52 unchanged; describe immutable JobRun-backed import results and restricted consent evidence. |
| `docs/integration/README.md` | Marks the Applications backend foundation merged and records the connection/sync slice separately from later classification. |
| `docs/team/README.md` | Preserve main notifications ownership of 0010 and claim unmerged Gmail 0011. |
| `docs/team/pr-changes/codex-candidate-gmail-connection.md` | Lasting per-file scope, review decisions, test evidence and merge/launch limits; local working notes excluded. |
| `docs/team/samad.md` | Record corrected PR boundaries, migration 0011, latest review decisions and disabled rollout/AI/automation gates. |
| `scripts/qa/candidate-gmail/README.md` | Documents the reproducible local synthetic browser acceptance runner and installed axe asset mounting. |
| `scripts/qa/candidate-gmail/harness.tsx` | Synthetic cache-refetch hook to exercise real page retention. |
| `scripts/qa/candidate-gmail/index.html` | Provides the standalone acceptance entry document. |
| `scripts/qa/candidate-gmail/next-link.tsx` | Provides the browser harness’s minimal Next Link boundary. |
| `scripts/qa/candidate-gmail/next-navigation.ts` | Provides local navigation/search-param hooks only for the standalone harness. |
| `scripts/qa/candidate-gmail/serve.mjs` | Starts the installed Vite runtime for acceptance without adding dependencies. |
| `scripts/qa/candidate-gmail/verify.py` | Synthetic actual-component acceptance for confirmation, expiry label, stable reader/history, privacy, erasure, themes, responsive layout, keyboard and axe. |
| `scripts/qa/candidate-gmail/vite.config.mjs` | Aliases the real source and local Next boundaries, uses only the Inbox live adapter, and serves the isolated harness on port 4185. |
| `src/app/[firm]/(app)/(workspace)/applications/[id]/page.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/app/page.tsx` | Parse fallback callback result through installed Next async searchParams API. |
| `src/components/app/applications/application-card.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/activity-tab.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/applications/application-drawer.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/applications/application-list.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/inbox/inbox-connect.tsx` | Ongoing-import/storage/readers/disabled-AI disclosure and clear stale confirmation parameter before new OAuth. |
| `src/components/app/candidate/inbox/inbox-content-dialog.tsx` | Accessible existing dialog primitive, named candidate/count, irreversible local deletion, disconnect default and retained-audit disclosure. |
| `src/components/app/candidate/inbox/inbox-reader.tsx` | Shows the source mailbox on retained messages and safely labels unclassified imports; uses factual unlinked-mail text without claiming a failed classification. |
| `src/components/app/candidate/inbox/inbox-tab.tsx` | Cancel/expiry components, retained pagination/selection, ERROR disconnect, storage controls, empty-Inbox revocation warning. |
| `src/components/app/candidate/inbox/mailbox-confirmation.tsx` | Confirm/Cancel flow and accurate Return to Inbox expiry action; preserve provider cleanup and separate OAuth restart. |
| `src/components/app/candidate/overview/attention-card.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/candidate/overview/inbox-preview.tsx` | Uses the shared neutral metadata for a null signal so newly imported mail cannot crash the existing surface or pretend to have a classification; existing layout/behavior is preserved. |
| `src/components/app/inbox/signal-meta.ts` | Adds one neutral null-signal presentation helper and prevents unclassified messages from becoming application signals. |
| `src/components/routes/landing-mailbox.test.ts` | Render the actual root fallback and prove its failure/continue UI and strict query parsing. |
| `src/components/routes/landing.tsx` | Display failed connection before deliberate continue to the normal landing destination. |
| `src/lib/api/dto/inbox.ts` | Map cursor/end and total count at the adapter boundary. |
| `src/lib/api/inbox.test.ts` | Cursor encoding, cleanup result and deletion-mode contracts. |
| `src/lib/api/inbox.ts` | Cancel, cursor reads and explicit disconnect-and-delete request. |
| `src/lib/auth/permissions.test.ts` | Prove current candidate assignment does not reveal other actors’ ledger entries; preserve Q52 assignment visibility. |
| `src/lib/hooks/inbox-pages.ts` | Refresh newest mail/overflow with stable history cursors; detect count-indicated backfill/deletion and refresh history once, otherwise reuse cached pages. |
| `src/lib/hooks/inbox-pagination.test.ts` | Exercise actual cache loader with request counts, new-arrival overflow, backfill/erasure recovery, older-page preservation and failed refresh. |
| `src/lib/hooks/use-inbox.ts` | Infinite cache with ordinary newest-page network refresh, count-triggered historical refresh, three-page automatic restoration cap, independent body reads and scoped mutations. |
| `src/lib/query/keys.ts` | Central tenant-scoped confirmation/body query keys. |
| `src/lib/schemas/inbox.ts` | Compatible nextCursor/totalCount UI contract. |
| `src/mocks/inbox.ts` | Include neutral cursor for disconnected fixture compatibility. |
| `src/mocks/membership.test.ts` | Supplies candidate scope to the read-mark adapter authorization tests. |
