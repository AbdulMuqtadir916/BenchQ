> Historical baseline review. The findings below were corrected and re-verified on 2026-11-01. See [final correction review](./error-correction/FINAL_REVIEW.md) and [task status](./error-correction/STATUS.md) for current evidence and remaining merge-review gates.

# PR safety review — 2026-10-31

**Decision: not ready to merge.** The previously existing automated checks pass, but the deeper review found eight actionable findings and ten newly reproduced failing cases. Opening a draft PR does not change `main`; merging this proposal before these issues are resolved would carry avoidable authorization, history and status-correctness risks.

## Scope and method

- Base: freshly fetched `origin/main`, `55ebc4f9fa58ea4fa543249755e1092881db273b`. The isolated checkout `/tmp/benchq-inbox-pr` has that HEAD. The feature is uncommitted, so review used `git diff HEAD` plus every new file listed by `git ls-files --others --exclude-standard`, not only the staged snapshot.
- Reviewed Applications, candidate Jobs/favorites integration, candidate Gmail OAuth/sync, classification/matching/retry workers, review navigation, models, migrations 0008–0010, adapters, permissions and related tests.
- The isolated proposal excludes the unrelated theme patch and local seed/old planning files. The user's recorded combined Modules 1–3/migration sequencing exception was respected. Required code-owner approval remains outstanding.
- Applied the code-review skill's independent Standards and Spec reviews. Confirmed material findings with synthetic records, mocked Google/model responses, and a separate disposable database on `db-test`. No real email content or credentials were used in reproductions.
- This review added regression tests only, plus this report/tracker entry. It did not edit application behavior, commit, push, open/merge a PR, restart services, or change the development database.

## Standards

### S1 — P1: OAuth completion bypasses current write authorization

At [routes_inbox.py:155](../../backend/api/routes_inbox.py#L155), callback validation checks the initiating user/firm and candidate visibility, but not current `candidate.edit` permission or suspended-firm restrictions. The callback is `SIGNED_IN`, so the ordinary firm-route suspension gate is bypassed. An owner can start OAuth, be demoted to Viewer or have the firm suspended, then still complete credential storage and connection.

**Evidence:** both regression cases return **303** and complete the callback where **403** is required. Standards: `docs/team/samad.md` §1.0 prohibits Viewer connections; `docs/07-ROUTES-AND-RBAC.md` §2.5 restricts suspended firms.

**Required correction:** enforce current write permission and firm state before exchange/storage, using the established policy and scoping infrastructure.

### S2 — P2: mailbox mutations omit the business ledger

[routes_inbox.py:254](../../backend/api/routes_inbox.py#L254) clears a connection without recording the actor or a candidate ledger event. OAuth connection, manual sync, marking read and classification retry similarly lack ledger writes. Standards: `docs/integration/07-auth-and-tenancy.md` §5.5 and `docs/team/samad.md` require human writes through the existing ledger writer with `candidate_id`.

**Evidence:** successful disconnect returns **200** and changes the mailbox, but the candidate's ledger count remains **0 → 0**.

**Required correction:** record successful human mutations in the same transaction without including credentials or email content in summaries.

### S3 — P2: Inbox duplicates role policy in its router

[routes_inbox.py:36](../../backend/api/routes_inbox.py#L36) adds explicit BDE/Manager role branches, despite the established candidate visibility helpers. The auth/tenancy standards prohibit new inline role checks in routers.

**Evidence:** static inspection of the added helper. No extra runtime reproduction is needed for this documented-standard violation.

**Required correction:** reuse the central candidate lookup/scope helper so future policy changes do not leave the Inbox with a separate authorization implementation.

### S4 — P1 compatibility risk: legacy deletion fails after history backfill

[db.py:348](../../backend/models/db.py#L348) adds `status_events` without deletion handling, while migration 0008 backfills events for legacy applications. [routes_applications.py:752](../../backend/api/routes_applications.py#L752) still deletes the legacy application directly. SQLAlchemy attempts to null a child application's foreign key, and the append-only trigger rejects that update. Bulk deletion has the same underlying relationship risk.

**Evidence:** the single-delete regression raises `Application status events are append-only` during `UPDATE application_status_events SET application_id=NULL`. Existing tests that create legacy applications after migration do not exercise backfilled historical rows.

**Required correction:** decide and implement an explicit history-preserving deletion policy, or return a deliberate conflict response, for both single and bulk deletion. Do not silently cascade away immutable history. This is a compatibility finding, not an optional style heuristic.

## Spec

### R1 — P1: the required legacy-route scope audit is incomplete

The implementation plan, Module 1 item 6, requires candidate scope on “every read/write, including legacy endpoints.” [routes_applications.py:1089](../../backend/api/routes_applications.py#L1089) checks only firm membership when creating interviews. Interview update/delete and prep retrieval similarly omit the necessary action/candidate authorization.

**Evidence:** a Viewer creates an interview and receives **201** instead of **403**; a BDE reads an unassigned candidate's prep and receives **200** instead of **404**. These handlers predate the proposal; they are an unmet explicit integration requirement rather than a newly introduced route.

**Required correction:** apply action policy and candidate visibility consistently to interview create/update/delete and prep reads, including associated resume lookup.

### R2 — P2: a newer same-status decision does not protect against older mail

The plan's Q3 resolution says older emails cannot overwrite a newer effective state. [classification_worker.py:43](../../backend/inbox/classification_worker.py#L43) returns `NO_CHANGE` before advancing the freshness watermark.

**Evidence:** start with Applied at t0; classify an Applied email at t2, then a delayed rejection email at t1. The application becomes **move_on**, overriding the newer Applied decision. This ordering is possible with delayed import, retries or concurrent/batched processing.

**Required correction:** preserve the newer effective timestamp even when the category does not change status. The older conflicting message must enter review without overwriting that state.

### R3 — P2: live Calls and rejection categories do not match Inbox filters

The screens spec requires Calls and Not selected filters, and the plan requires all ten live categories to be reflected in filters. [inbox-tab.tsx:25](../../src/components/app/candidate/inbox/inbox-tab.tsx#L25) uses `CALL_REQUEST` and `REJECTED`, whereas the live DTO supplies `SCREENING_CALL` and `MOVE_ON`.

**Evidence:** the new rendering cases each contain one corresponding live-classified email, but both filters display **0** instead of **1** and exclude those emails when selected.

**Required correction:** map the live categories to the correct filters, preserving any required legacy aliases.

### R4 — P2: connected mailbox identity is replaced without disconnect

The plan's Module 2 item 2 explicitly requires disconnect before replacing identity. [routes_inbox.py:183](../../backend/api/routes_inbox.py#L183) unconditionally overwrites an existing connected mailbox's address and credentials after another account completes OAuth.

**Evidence:** the connected mailbox changes to a different verified synthetic address without disconnect. Existing imported messages remain on the reused mailbox row.

**Required correction:** distinguish same-account reconnect from identity replacement and enforce the approved disconnect requirement. Review the retained message/thread namespace when changing accounts.

## Verification

| Check | Result |
|---|---|
| Complete previously existing backend suite, after the approved legacy-resume fix | **3623 passed, 6 skipped, 54 deselected, 13 xfailed**, 6 warnings; exit 0; 640.20 seconds |
| Newly saved backend safety regressions | **8 failed**; these reproduce the confirmed gaps and must not be hidden with xfail |
| Complete frontend suite including the new filter cases | **591 passed, 2 failed** in 47 files; failures are the two new filter cases |
| TypeScript after adding the tests | Passed |
| Full-project ESLint after adding the tests | Passed |
| Production build without `BACKEND_URL`, matching the CI build environment | Passed; existing CSS `::highlight` optimizer warning |
| Diff whitespace check | Passed |
| High-confidence secret-pattern scan of proposed text files | No matching credential values found; example environment files have no populated credential assignments |

The first frontend run during concurrent heavy validation also hit an existing test's 5-second dynamic-import timeout. A complete rerun after the backend finished, with two Vitest workers, passed that test and left only the two reproducible filter failures. No timeout threshold or test assertion was relaxed.

The full backend run used the isolated latest-main feature tree, removed real provider/mailbox credentials from its environment, and excluded `live` tests. Test-only PostgreSQL checkpoints prevented the previous temporary-space issue. The eight new backend cases ran in a separate test database, which was removed afterward. The complete backend collection began before those eight new cases were added; the green full-run result therefore does not include them. They were executed separately and failed as documented.

Saved cases:

- [backend/tests/test_pr_safety_regressions.py](../../backend/tests/test_pr_safety_regressions.py)
- [src/components/app/candidate/inbox/inbox-tab.test.ts](../../src/components/app/candidate/inbox/inbox-tab.test.ts)

## Before raising a ready-for-review PR

1. Resolve the eight findings, retaining the failing regressions as checks of the fix; add update/delete and bulk coverage where applicable.
2. Run all backend and frontend tests with the new regressions included, plus typecheck, lint and production build. Do not describe the current proposal as green while these tests fail.
3. Perform remaining manual browser/theme/viewport and authorized live-provider acceptance; these were not repeated in this review.
4. Assemble the complete change set. Essential runtime modules, DTOs, migrations and tests are still untracked; committing only the staged/tracked files would omit required files. Keep unrelated local theme/seed changes separate.
5. Include the combined migration/scope exception and operational prerequisites in the PR; obtain the required code-owner review before merging.

**Review summary:** Standards: **4 findings**, worst OAuth write-authorization bypass (P1). Spec: **4 findings**, worst unscoped legacy application access/mutation (P1). No automated or manual review can prove the absence of every possible defect; the reproduced failures above are sufficient to block a ready-to-merge claim now.
