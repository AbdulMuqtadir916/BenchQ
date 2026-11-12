# PR 3 operational boundaries

All external real-mail and purge switches ship OFF. PR 3 has no automatic status writer. PR 4 automatic execution/Undo is a separate gate.

Configure platform settings candidate_email_llm_provider, candidate_email_llm_model, candidate_email_llm_api_key, candidate_email_llm_effort and optional candidate_email_instructions through the platform `ai_config("email_classification")` seam. The intended configured model is the existing Perplexity Decider model via OpenRouter Decisions, not an arbitrary chat model. There is no new preset-admin UI and firms cannot select providers/prompts. Do not copy a development key into source/fixtures/logs.

Before enabling `CANDIDATE_EMAIL_CLASSIFICATION_ENABLED` AND `CANDIDATE_EMAIL_REAL_MAIL_APPROVED`, record written provider/downstream retention/logging verification, updated candidate consent and Google/delegated-access requirements. Redaction covers common direct identifiers/credentials, not arbitrary sensitive prose or all names. Every imported message is externally classified in enabled V1; no relevance prefilter is being implied.

A lease is two minutes, one bounded 35-second provider attempt per claim, at most three attempts with scheduled exponential retry. One import notifier thread is bounded; scheduler performs durable recovery every minute. Provider work holds no database row lock. Existing JobRun metadata stores minimal usage including UNKNOWN, not a parallel attempts table. Unknown cost is never reported as zero; a timed-out/crashed provider request can have unknown charged usage and needs operational reconciliation. Alerts/exhaustion are exposed as safe state/count metadata, not private email logs. Configure production worker topology with the runtime owner; existing single-process scheduler assumptions remain.

Low-confidence Other stays readable in review under the below-0.8 review rule. Confident Other is shown in the Inbox as Irrelevant, subject and sender in clear (decided 2026-11-07, #127); Other mail hidden and encrypted before #127 stays hidden. Either is kept for 30 days, then erased only by the gated purge below. Explicit Owner/Manager retained-content deletion includes hidden rows and classification derivatives. An existing human review is preserved rather than silently lost to rerun; automatic statuses remain off. There is no V1 hidden-mail inspection/release UI.

`CANDIDATE_EMAIL_PURGE_ENABLED` AND `CANDIDATE_EMAIL_PURGE_EVALUATED` and the exact CANDIDATE_EMAIL_PURGE_EVALUATION_CONFIG_ID fingerprint are required to run due-content cleanup. A different model/prompt/taxonomy/policy fingerprint cannot inherit earlier purge approval. Neither is enabled by a test/report. Retry failures never qualify. Purge never erases mail linked to an application, mail with a pending BDE review, or mail an earlier result classified as job-related; it erases derivatives, leaving scoped provider/source dedup references. The initial synthetic corpus includes job-related updates whose correct category may be Other (e.g. “application still under review”). This explicitly exposes a risk in treating every Other as non-job-related: the current shadow-removal rule cannot be declared safe solely from category accuracy. **Purge accuracy approval remains outstanding** and its selection rule may need further refinement after actual model evaluation. A labelled/harness test is not a model-accuracy claim.

Sender evidence is normalized at import as PASS/FAIL/UNKNOWN; raw Authentication-Results are never stored. Parser conservatively accepts a single Google MX authentication result after a Gmail Received boundary, exact-domain aligned DMARC or SPF+DKIM and no ambiguous ARC/duplicate evidence. Old mail/missing/forwarded evidence stays UNKNOWN. It is not a cryptographic verifier and automation remains disabled in PR 3; validate the trust boundary on approved delivery fixtures before PR 4 can rely on PASS. No manual sender approval table/endpoint is added.

Initial evaluation labels are authored synthetic examples, independently from the evaluated Decider model. Owner adjudication and recorded actual model/prompt predictions remain required. Use `python -m backend.inbox.evaluation LABELS.json PREDICTIONS.json` for offline scoring; no real candidate bodies are needed. This utility never calls a model or changes flags. Start with a small reviewed set per Abdul’s approval, then extend coverage/calibration before rollout/purge. Never represent model-label fixture identity tests as measured AI accuracy.


## PR #111 review follow-up

Switching on classifies only mail imported after that point. Existing and disabled-import mail is NOT_QUEUED; historical classification requires a separate future explicit action. Retry/reclassify cannot queue it. Dedicated email.retry (Owner/Manager/BDE) and email.reclassify (Owner/Manager) preserve current candidate scoping. Normalize source addresses; preserve existing application links; invalidated work does not consume retries. Low-confidence unmatched Other remains in BDE review. Confident Other retains the approved encrypted 30-day recovery policy and gated purge; Gmail is untouched. Item #2 (shared AI client/endpoint and Super Admin spend integration) is deferred to PR 4; real-mail AI remains gated. Item #9 stays unchanged.

**Updated 2026-11-06 (PR 4):** Samad confirmed with Abdul that older emails are also classified. Retained `NOT_QUEUED` mail of the current connected mailbox is processed in bounded batches, oldest first, behind `CANDIDATE_EMAIL_HISTORICAL_ENABLED` (default off); historical results can only create BDE reviews, never automatic status changes. See PR 4 DEBUG.md D-23.


## PR 4 additions (2026-11-06, branch codex/pr4-code-correction)

### Setup checklist (platform settings, AI preset scope)

| Setting | Value |
|---|---|
| `candidate_email_llm_provider` | `openrouter` (the only accepted provider) |
| `candidate_email_llm_model` | the Perplexity Decider model on OpenRouter Decisions (used in testing: `perplexity/pplx-decider-v1.2`; confirm the id in OpenRouter) |
| `candidate_email_llm_api_key` | the OpenRouter key; never in code, logs or docs |
| `candidate_email_llm_effort`, `candidate_email_instructions` | optional |

- The classifier **never borrows the primary model's settings** (`llm_*`). If any of the three required settings is empty,
  classification is "not configured": mail stays `PENDING`, no attempt is spent, and the log says so once per sweep.
- A key the provider refuses (401/403) **pauses** this configuration: mail stays `PENDING`, no attempt is spent, retry and
  reclassify answer 409 "Classifier paused". Changing the key or model resumes at once; otherwise one probe email is sent
  after 15 minutes, then hourly while still refused (15 minutes after a 429/5xx/timeout). The pause is a `job_runs` row
  (`job_type='candidate_email_classifier_pause'`) holding only a hash of the configuration.

### Routing rules added by PR 4 (before any status or hiding decision)

- **Forwarded email** (forward header or `Fwd:` subject): always BDE review (`FORWARDED_EMAIL`), never hidden as Other.
  Forwarded history may identify the application; it is sent to the AI labelled as history, never as a current decision.
- **Quoted reply history** is never matching evidence and never sent to the AI; replies are linked through the thread.
- **Too little current text** (under 20 characters, not a forward): review (`INSUFFICIENT_CONTENT`).
- **Two provider numbers**: the reply's `confidence` and the chosen category's probability are both stored; every
  threshold uses the lower one. A gap larger than 0.10 routes to review (`CONFIDENCE_DISAGREEMENT`), never a failure.
  Only structurally invalid replies fail.

### AI spend

Each dispatched call is counted once. A provider charge (ACTUAL) or OpenRouter price × tokens (ESTIMATED) is written to
`llm_call_log` (`purpose='email_classification'`) in the same transaction as the result. An unknown charge writes no row
(no false zero) and is reported by `GET /api/stats/llm-costs` as `candidate_email_classification.unpriced_calls`; an
attempt that started dispatch but never finished is `unconfirmed_calls` (possibly charged). Credential refusals are not
counted. The Super Admin AI-spend card stays hidden until its contract (07 Q29) is approved.

### Endpoint decision (DEBUG D-16) — for Abdul's acceptance

Keep OpenRouter **Decisions** (`/api/alpha/decisions`): it returns the per-category probabilities the policy needs; the
shared chat client does not. Its alpha quirks are contained: structural validation only (the confidence/probability gap
seen live is routed to review, not failed), one bounded attempt per claim with worker retries, a pause on refused
credentials, and full spend counting. If Abdul prefers the shared `backend/analyzer/llm_client.py`, the decider seam
(`decider.classify`) is the only place that changes.

### Switch-on conditions — do not enable classification for real mail until all are true

1. Provider/downstream retention and logging confirmed in writing; candidate consent updated; Google/delegated-access
   requirements met (unchanged from PR 3).
2. Abdul has accepted the endpoint decision above.
3. Spend counting is live (this section) and checked on a test call.
4. Local tests use a **dedicated test Gmail** connected to a synthetic test candidate, never a personal mailbox.
5. Automatic status updates stay OFF until PR 4 is merged and Undo is verified (activation checklist, plan T6.1).

### Automatic status updates (PR 4) and activation checklist

Switches: `CANDIDATE_EMAIL_AUTO_STATUS_ENABLED`, `CANDIDATE_EMAIL_AUTOMATION_APPROVED` and
`CANDIDATE_EMAIL_AUTOMATION_START_AT` (ISO 8601 with a time zone). All three are required; mail received before the
start time is never executed automatically, so switching on cannot replay earlier mail. Every automatic change writes an
`email_classifier` history event (with the source email), an AGENT ledger entry ("Email classifier") and a classification
outcome `AUTO_APPLIED`. Undo (drawer and application page) writes an `email_undo` event; the same email is never applied
again, and a reclassification after Undo goes to review (`AUTOMATIC_CHANGE_UNDONE`).

Activation (plan T6.1), in order: PR 4 merged → Abdul's G4 sign-off on the Incomplete → Applied rule (D-14) recorded,
or that rule taken out first (plan T4.4) → Undo verified on a production-like environment → switch-on conditions
above met → set the start time, the approval and the switch → review every automatic change and Undo use on the first day.
Turn the switch off again to stop all automatic writes immediately; classification and reviews continue.

Local note: the backend container runs uvicorn without auto-reload; after changing backend code or `backend/.env`,
restart (code) or recreate (`docker compose -p benchq-pr4 up -d --no-deps --force-recreate backend`, env) the container.
