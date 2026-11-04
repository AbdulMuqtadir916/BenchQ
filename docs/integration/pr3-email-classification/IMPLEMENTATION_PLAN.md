# PR 3 implementation plan — approved scope

Updated 2026-11-04. Authority: [Abdul’s written approval](https://github.com/AbdulMuqtadir916/BenchQ/issues/110#issuecomment-6624344616), [samad.md](../../team/samad.md), [status mapping](../../02-DATA-CONTRACTS.md#21-application-status-vocabulary-and-legacy-mapping--d3). Older plans/drafts are historical, not implementation authority.

## Scope and gates

PR 3 implements classification/matching/review evidence, never automatic application-status writes. PR 4 owns automatic execution/Undo/UI. Other is hidden, encrypted for 30 days, not immediately deleted. Purge OFF until zero job-related shadow would-remove decisions are demonstrated; bind the approval to the exact model/prompt/policy fingerprint. External real-mail AI OFF until written provider/downstream retention/logging and consent/Google requirements are met. Sender approvals and private-release UI are not V1. No prefilter in V1; track future local/ATS/company/keyword prefilter in samad.md.

PR 4 policy metadata uses >=0.8 for the five approved forward targets; Offer/Move On always review. Normalize sender authentication: trusted Gmail DMARC pass or aligned SPF+DKIM pass; missing/untrusted evidence cannot qualify. Pending/failed processing remains readable and shows Not classified. Status vocabulary/mapping is documented; exact mapping sign-off remains a PR 4 prerequisite, not a PR 3 blocker.

## Modules and completion criteria

- **M1 Baseline/docs:** preserve dirty combined workspace, refresh main, update plan/tracker and canonical rules; record baseline. Do not push or merge as part of starting implementation.
- **M2 Schema:** one additive migration after current head, reuse inbox_messages/application_reviews/JobRun. Add versioned email_classifications, minimal processing/auth/time fields, hidden-Other retention and unmatched review/result linkage. Preserve legacy reads/events; downgrade must refuse destructive active-data loss. Avoid parallel job/history/sender tables; lean usage metadata is adequate initially.
- **M3 Input/provider:** transient decrypt, bounded minimization/redaction, ai_config seam and configurable preset identity, strict ten-category/probability validation, finite confidence, sanitized provider errors, bounded timeout/retry/usage. All sensitive flags default OFF; use injected synthetic providers in tests, not real candidate mail.
- **M4 Provenance/matching:** normalize trusted authentication and receive-time at import, no raw authentication header retained. Reuse safe scoped matcher; uniquely submitted applications/thread links only; no fixture shortcuts or status mutation. Unknown/duplicate/forged authentication remains UNKNOWN/FAIL. Preserve #104 Inbox label/deletion/source protections.
- **M5 Worker:** commit import batches then discover eligible unclassified current-source mail durably. Owner-token leases, finite retry and source/content/firm/config rechecks; no database locks during provider I/O. Reclaim abandoned work; explicit versioned reruns only; fence disconnect/replacement/deletion/suspension. Store usage quality honestly. Never update application status/favorites/manual times.
- **M6 Review/API/privacy:** central visibility hides Other from list/detail/read-mark/linked-mail surfaces, preserving encrypted recovery and count-only support. Pending/failed readable. Scoped review queue/link/resolve compatibility and retry/reclassify; avoid silent replacement of human decisions. Delete retained content and derivatives/fence jobs. Purge capability defaults OFF and cannot delete job-related/failed/pending mail. Explicit human review uses existing audited command service, not AI status writes.
- **M7 Verification:** scoped encrypted integration, Other no status change/hide/retention, auth fail/unknown, threshold/outcome review, worker races/off switches, tombstones/deletion/reconnect, legacy compatibility/migrations. Start with manageable labelled synthetic cases, report actual results/limits; zero job-related shadow would-remove before purge activation. No evaluated model as its own label oracle.
- **M8 Delivery:** per-file changes, required checks, refreshed main/one migration head, no secrets. Report remaining external launch gates. Raising/pushing/merge require the relevant user instruction; no merge without explicit request.

## Data/API approach

Use local email_classifications name, adapting it to immutable versioned results. Add category/model/prompt identity, scoped message/application revisions and normalized sender authentication/receive-time evidence. Reuse existing job_runs for attempt/usage metadata rather than making the earlier separate attempt-table proposal a dependency. Store no raw prompts/body/headers in diagnostics.

Extend existing inbox_messages with processing claim/retry/generation fields, auth/time verdicts, hidden_at and retention timestamps. Protect hidden Other metadata with encrypted storage for sender/subject as necessary; existing body/snippet remain encrypted. Scope tombstones by firm/candidate/source/provider ID. Other purge clears content/derivatives, preserves minimal dedup references and is gated independently.

Extend application_reviews with nullable matched application/revision and classification reference, preserving historical review/event foreign keys and avoiding duplicate pending review work. Read paths never infer missing application/stage.

Adapt existing candidate Inbox routes with minimal result/readability fields. Add scoped review listing, manual link/review commands, bounded retry and explicit Owner/Manager reclassification as needed. Existing candidate-status/review commands keep audit/idempotency and legacy replay; remove other from new-write validation without breaking historical reads/replays. PR 4 Undo endpoints and automatic writer remain out of this PR.

## Non-goals / sign-off boundaries

No manual sender allowlist, V1 quarantine-release UI, relevance prefilter, résumé changes or new Response status. Existing notes, résumé links and ledger visibility policy remain. Exact legacy mapping awaits Abdul before PR 4. Safety flags cannot be enabled just by changing the model or passing synthetic tests.

## Prior evidence

Existing isolated matching/status slice passed 79 affected tests before this approved implementation. It is baseline evidence only. HISTORY files preserve old proposals; do not implement their superseded 0.6/Offer/MoveOn/purge/sender-approval rules.
