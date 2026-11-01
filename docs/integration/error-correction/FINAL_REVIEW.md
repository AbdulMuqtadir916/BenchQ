# Final correction review — 2026-11-01

Implementation and local verification are complete. The tested proposal is `/tmp/benchq-inbox-pr`, branch `codex/inbox-applications`, based on main `1c6925f1edeab7de463046c0a949597ca5fe1bac` (remote rechecked). The local verification checkpoint preceded publication. The user subsequently authorized committing, pushing and opening this PR; merge approval remains outstanding. [STATUS.md](./STATUS.md) records the matching task checklist and evidence.

## Standards

All four original findings are corrected: OAuth reauthorizes current access/firm state at completion; Inbox uses shared candidate scope; successful human mailbox mutations audit transactionally and idempotently; protected application history returns a deliberate conflict before deletion. Final review additionally found notes-only edits without audit; changed notes and permitted legacy edits now record actor/firm/candidate without exposing note content. Follow-up Standards review: **zero actionable unresolved findings**. Duplicated invalidation calls are a nonblocking style observation.

## Spec

All four original findings are corrected: candidate-scoped interview/prep access and résumé isolation; same-status freshness watermark; live Calls/Not-selected filter aliases; disconnect required before mailbox identity replacement. Final review also closed legacy edit/bulk authorization, legacy detail compatibility, exact URL selection outside active filters, and OAuth initial-sync locking. Shared connection-generation checks prevent an old failed sync from overwriting a newer account's diagnostics/checkpoint. Follow-up Spec review: **zero actionable unresolved findings**.

Email classification still runs after committed imports, respects confidence/freshness/manual decisions, and sends actionable low-confidence, stale and unmatched mail to exact-email BDE review. Cached selection keeps the collection/list stable. The shared stage order and filled progress match the request; Incomplete needs application-specific accepted evidence or retained current/history, outcomes do not invent interviews/offers, reversals retain historical dates.

## Verification

| Gate | Final result |
|---|---|
| Complete backend, all final fixes and new regressions | **3684 passed**, 6 skipped, 54 deselected live tests, 13 pre-existing xfails, 6 existing warnings; 595.56s |
| Complete latest-main frontend | **608 passed**, 49 files |
| TypeScript / full ESLint / production build | Pass; existing CSS optimizer warning retained |
| Chromium real-component matrix | Pass; both themes, reduced motion, 1440/1024/390, **zero axe violations** |
| Actual built Next route | Pass; **0** cached-selection Inbox/RSC requests, exact email and native Back/Forward correct, stable list, **0** page exceptions |
| Database/model/migration/backfill/downgrade/F7 | Included and passed; separate focused evidence retained in tracker |
| Development restart/migration | Backend/frontend respond HTTP 200; schema **0011**, **14** application statuses unchanged, **107** emails preserved, no blank account namespaces |

Synthetic provider/browser fixtures were used. The Next smoke used the documented demo login and signed its session out; it did not write application or mailbox data. Normal background polling remains enabled; no manual live Gmail sync, live model request or email send was used as a test. Existing warnings/xfails were not suppressed or expanded to hide regressions. Browser scripts and their exact setup/limits are in [the acceptance README](../../../scripts/qa/inbox-corrections/README.md).

## Remaining merge gates

- Required code-owner approval has not been obtained; M7.8 remains unchecked (49/50 complete).
- The already-applied migration chain 0008–0011 is preserved and tested. The repository normally permits one revision per PR; settle combined-PR packaging/exception or rollout separation with the code owner before merge. Do not rewrite applied history to satisfy a cosmetic count.
- Migration 0011 backfills retained mail from the current mailbox identity. Production must verify no unknown historical replacement already erased original identity, or investigate attribution before rollout; the old schema cannot reconstruct overwritten provenance. New imports retain account namespaces.
- Production OAuth secrets/redirect, provider latency, worker/scheduler topology and separately authorized live acceptance remain deployment review items. Local interval is 5 minutes, with immediate after-commit classification dispatch and recovery fencing.

The user's original dirty branch and unrelated theme/dependency patch remain separate from the tested latest-main proposal. Include every necessary untracked source, migration, test and document when preparing the eventual PR.
