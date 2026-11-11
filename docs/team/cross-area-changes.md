# Changes made in a teammate's area

When a PR has to change something in another person's area (`docs/team/README.md` §2–§3), it is agreed first and
listed here: what changed, in whose area, and why. Newest PR first.

## Extension autofill — the form behind an application, and the extension's own tests (`feat/apply-extension-autofill`)

Not agreed yet: Samad reviews the applications change before merge. The branch's earlier `/config` change, its removal
of the AI answer routes and their `access.py` rows are undone (2026-11-09): the extension reads the picked résumé's
`GET …/resumes/{id}?autofill=true` instead, and removing the AI answer routes is a later PR of its own.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Applications (Samad) | `backend/models/db.py`, `backend/migrations/versions/0021_application_form_data.py`, `backend/applications/tracking.py`, `backend/api/routes_applications.py`, `test_candidate_application_status.py`, `docs/02-DATA-CONTRACTS.md` §9 | `applications.form_data`: `PATCH .../candidate-status` takes an optional `form_data` on a move to `applied`, a move back to `saved` clears it, and no response returns it. It also takes an optional `resume_id`, the résumé version the form was sent with (this candidate's, not deleted), which becomes the application's `resume_id` (docs/02 §9). | Marking a job applied from the extension keeps what the form held, and which résumé answered it. Talked through with Samad and Abdul before it was built. |
| Root tooling | `vitest.config.ts`, `package.json` | `pnpm test` skips `extension/**`; `pnpm ext:test` runs the extension's own tests. | They need the extension's jsdom and `vitest`, which the root doesn't have. |
| Candidates / résumés (Zuhair) | `backend/api/routes_candidate_resumes.py`, `backend/candidates/versions.py` (`uploaded_file`), `backend/auth/access.py` (one `F` row, approved by Arbaz), `isolation_cases.py`, `test_resume_file.py`, `docs/02-DATA-CONTRACTS.md` §8.2 | `GET …/resumes/{rid}/file`: an uploaded base's version 1 as its file, as uploaded; 404 for any other version. | The extension attaches the picked résumé to the form's résumé upload (07 Q49–Q52). A file for every version is asked of Zuhair (Q25). |

## The Autofill screen — phase 3 of résumé autofill (Arbaz; contract for Abdul's sign-off)

Not agreed yet: docs/02 §8.3 is proposed for Abdul's sign-off; the `access.py` row was approved by Arbaz (2026-11-09).

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Candidates / résumés (Zuhair, Abdul) | `backend/candidates/autofill.py`, `backend/candidates/versions.py` (`save_autofill`, `_family`), `backend/api/routes_candidate_resumes.py`, `backend/api/routes_firm_resumes.py`, `backend/auth/access.py` (one `F` row), `isolation_cases.py`, `test_autofill.py`, `test_autofill_screen.py`, `docs/02-DATA-CONTRACTS.md` §8.1, §8.3 | `resumes.autofill.custom` is a list of `{question, also, answer}` (07 Q40–Q41; nothing wrote the map); the read marks an edit that stopped applying (`replaced`, Q15) and, with `&editor=true`, lists unanswered questions with each answer's `type` (Q34); `PATCH …/resumes/{rid}/autofill` saves edits, resets, added and removed questions in place, for the rest of the résumé unless `only_this` (Q7, Q14, Q30, Q44). | The Autofill screen (`/[firm]/resumes/[id]/autofill`), where a BDE sees and changes what the extension fills. |

## Job search tables (`feat/jobs-table`, Zuhair)

`job_postings` and `scrape_jobs`, migration 0020 ([docs/02](../02-DATA-CONTRACTS.md) §6.y).

| Area (owner) | File | What changed | Why | Agreed |
|---|---|---|---|---|
| Logging checks (Uzair) | `backend/tests/route_sweep.py` `SEED_OVERRIDES` | `SEED_BATCH`; `"scrape_jobs": {"error": None, "batch_id": SEED_BATCH}`; `"job_postings": {"job_id": "0" * 64, "batch_id": SEED_BATCH}` | The sweep seeds one row per table from its columns. `scrape_jobs`: `state` takes the first allowed value (`success`) and every text column gets text, so `error` broke `ck_scrape_jobs_error_iff_error`. `job_postings`: its text `job_id` isn't a SHA256 hex digest (`ck_job_postings_job_id_sha256`), and its `batch_id` references `scrape_jobs.batch_id`, not its `id`, which the seed's key lookup assumes. The overrides give both rows a valid shape, as for `invites` or `notifications`. Test data only; no check is loosened. | **Pending: Uzair** |
| Candidates (Abdul) | `backend/models/candidates.py`, migration 0020 | `UNIQUE (firm_id, id)` on `candidates` (`uq_candidates_firm_id`) | The target of the `(firm_id, candidate_id)` foreign key on `job_postings` and `scrape_jobs`, so a row can't carry a firm other than its candidate's. `id` is already unique, so no existing row can break it. | Abdul, who suggested it in review (2026-11-10) |

## Résumé autofill (`feat/resume-autofill`, Zuhair; finished by Arbaz)

Decided by Zuhair 2026-11-07 (Abdul and Samad OK); finished 2026-11-08 from Abdul's review: every non-id fact about the
candidate is built from the résumé version and the profile each time one version is read with `?autofill=true`, each
answer with its `key`, and each version stores only the entries the user typed ([docs/02](../02-DATA-CONTRACTS.md)
§8.1, `backend/candidates/autofill.py`).

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Candidates table (Abdul) | `backend/models/candidates.py`, migration `0019_resume_autofill.py` (+ test) | `candidates.qa_bank` is dropped. The downgrade puts it back empty. | The answers live on each résumé version now. Only the demo seed ever filled it; the persona's own `qa_bank` stays with the persona. **One-way for the demo answers.** |
| Candidate JSON (Abdul) | `backend/candidates/serialize.py` | `qa_bank` leaves the candidate JSON. The edit route is unchanged: a profile edit writes nothing to the résumés. | The profile answers are built on each read, so the next read shows the edit. |
| Demo seed (Abdul) | `backend/scripts/seed_demo.py` | No `qa_bank` on the demo candidates; the unused camelCase helpers go. | The column is gone. |
| Candidate DTO (shared) | `src/lib/api/dto/candidates.ts`, its sample and test | The backend sends no `qa_bank`; the mapper gives `qaBank: []`. `CandidateSchema.qaBank` stays. | The Documents tab's Screening answers panel reads it and shows its empty state until the Documents section is removed (planned, [abdul.md](./abdul.md) §3). Mock mode still shows the fixtures' answers. |
| Autofill and the extension (Arbaz) | none | Nothing changed. **For you:** read the selected résumé's `GET …/resumes/{id}?autofill=true` instead of `persona.qa_bank`, and match each entry by its `key` before its wording. A hand-saved answer becomes one of the version's own entries (`resumes.autofill`); the route that writes them is planned ([persona-to-candidates.md](./persona-to-candidates.md) §5). | This PR builds the answers; switching the extension is your PR. |
| Old tailoring (JobNavigator leftover) | `backend/analyzer/legacy_tailoring.py` | Not changed. It isn't wired to anything and can't make versions (it reads columns 0013 dropped). | **For the tailoring module (Zuhair):** a tailored v1 copies its source version's typed entries (`autofill.entries_of`), as a save and a promote do (docs/02 §8.1, Abdul's third review). Its fixed answers are built from its own text, and an edit applies only where that text still gives the answer it replaced. |

## Résumé screens live — no claim states, the tree (`integrate/resumes`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §5 and §7. Decided 2026-11-05: BenchQ has no Verified / Unverified /
Contradicted states, no evidence record and no export gate.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Ledger page (Umamah) | `src/app/[firm]/(app)/(manage)/ledger/page.tsx` | The "Claim" column and its chip import are removed. | There are no claim states. The ledger schema still carries `claimState` / `evidenceIds` as the backend sends them (`src/lib/schemas/analytics.ts`: `claimState` is now a plain string); whether the backend columns go is for the ledger's owner. |
| BDE dashboard (candidate/dashboard owners) | `src/features/dashboard/bde-dashboard.tsx` | The "Unverified claims" card is a "Candidates" card (the BDE's own count, derived). | The unverified count has no meaning without claim states. |
| Outreach page (Samad) | `src/app/[firm]/(app)/(workspace)/outreach/page.tsx` | The "No unverified claims in this message" banner and the subtitle wording are removed. | Same. |
| HTTP client (foundation) | `src/lib/api/http.ts`, `src/lib/api/client.ts` | An error whose `detail` is an object (`{message, …}`) keeps its message, and the object as `ApiError.details`. | The résumé upload's 409 names the base the file already is (and whether it's hidden); the résumé adapter turns it into a frontend error. Before, the message was lost ("Request failed with status 409"). |
| Work authorization labels (shared) | `src/lib/constants/work-auth.ts`, `src/components/app/work-auth-chip.tsx` | `WORK_AUTH_LABEL` moved to the constants (the chip re-exports it). | The mock résumé builder (`src/lib/resume-doc/build.ts`) needs it, and `lib` shouldn't import a component. |
| Mock write tests (shared) | `src/mocks/write-authorization.test.ts`, `src/mocks/membership.test.ts` | The résumé writes are in the write inventory; a second control signs in as the candidate's BDE for what only they do (Q55). | The résumé mock has writes now. |
| Mock layer (shared) | `src/mocks/membership.ts` | `shelf`, `shelfByCandidate` and `open` are read names, like `list` / `byId` / `byCandidate`. | The résumé mock's new reads (a firm's or a candidate's bases and résumés, one version's text). |
| Candidates routes (Abdul) | `backend/api/routes_candidates.py` | Not changed: the new `routes_firm_resumes.py` reuses its `_visible` / `_candidate` / `_member_of`, so the résumé list has the candidates list's scope (Q47). | One rule for who sees which candidate. |
| Job detail (Zuhair's jobs track) | `src/app/[firm]/(app)/(workspace)/jobs/[id]/page.tsx` | One caption: "AI draft — read it over before you rely on it". | Same. |
| Firms table and the firm JSON (Abdul, tenancy) | `backend/models/tenancy.py`, `backend/migrations/versions/0016_drop_truth_guard_mode.py`, `backend/auth/serialize.py`, `backend/scripts/seed_demo.py`, `backend/tests/test_auth_sessions.py`; frontend `src/lib/schemas/session.ts`, `src/lib/api/dto/session.ts`, the firm mock, the create-firm comment, the plans mock ("Truth Guard" feature line) | `firms.truth_guard_mode` and its CHECK are dropped (migration 0016); `truth_guard_mode` / `truthGuardMode` leaves the firm JSON and the schema. | A claim-era setting (STRICT / BALANCED / LENIENT); nothing read it. Zuhair's call, 2026-11-05. **One-way for the stored value**; the downgrade restores the column on BALANCED. Needs Abdul's OK (his table). |
| New candidate flow and create route (Abdul) | `step-resume.tsx` (no Skip), `model.ts` (step 1 needs the résumé), `src/lib/schemas/candidate.ts` (`resumeParseId` required), `routes_candidates.py` (400 without a résumé), `first_base.py`, migration `0018_no_manual_bases.py` (+ test), `seed_demo.py` (a generated résumé per demo candidate), tests: `test_candidates_api.py` (`_create` attaches a résumé read), `isolation_support.py` / `isolation_cases.py` (a pending read for the create case) | No candidate without their résumé; MANUAL bases gone. | 07 Q58, **your decision** (2026-11-06). |
| Logging route sweep (Uzair) | `backend/tests/route_sweep.py` `SEED_OVERRIDES` | The seeded `base_resumes` row is active and live, and its `resumes` row isn't deleted. | 07 Q57: a candidate's name is read from the active base's newest version; without it the candidate edit and assign had no name and the planted-name check missed `/leak/record`. Found by the full suite on PR 7. |
| Candidates contract test (Abdul) | `backend/tests/test_migration_0006.py` | The `ck_candidates_full_name_not_blank` case is removed. | That constraint left with `candidates.full_name` in 0017 (07 Q57). |
| Shared résumé test helpers | `backend/tests/resume_support.py`, `backend/tests/r4_support.py` | A candidate name a test passes becomes the version's `full_name`; an explicitly empty résumé stays empty. | 07 Q57: scoring labels a résumé by the name in it. |
| Logging canary (Uzair) | `backend/tests/test_logging_canary.py` | Its candidate creates send a résumé read. | 07 Q58: a create without one is refused. |
| Candidates table (Abdul) | `backend/models/candidates.py`, migration `0017_resume_fields_off_candidates.py` (+ `test_migration_0017.py`), `backend/candidates/profile.py`, `serialize.py`, `routes_candidates.py` (the list reads them in one query), `backend/analyzer/cv_scorer.py` (labels by the version's own name), `backend/scripts/seed_demo.py` (a MANUAL base per demo candidate; reset clears résumés first), `backend/tests/resume_support.py` | `full_name`, `email`, `phone`, `linkedin_url`, `city`, `state`, `country` dropped from `candidates`; read from the active base's newest version. The API keeps the same keys, so no screen changed. | 07 Q57 (Zuhair, 2026-11-03 and 2026-11-06): what the parser's strict format holds lives in `resumes` only. **Needs your review: it's your table.** |
| The permission policy (Abdul) | `backend/auth/policy.py`, `src/lib/auth/policy.ts`, `backend/auth/policy_table.json` (regenerated), `policy-table.test.ts`, `access.py` comment | A new action `candidate.editProfile` (OWNER, MANAGER) guards `PATCH …/candidates/{id}`; `candidate.edit` (with the BDE) is unchanged and keeps the inbox and documents. | 07 Q56 (decided by Zuhair 2026-11-03): the profile isn't the BDE's; the BDE edits the résumés (Q55). |
| Candidate edit route and its tests (Abdul) | `backend/api/routes_candidates.py` `update_candidate`, `backend/tests/test_candidates_api.py` (the edit tests run as the manager; the BDE and viewer get 403; the owner edits any candidate; v1's country expects US), `src/mocks/candidates.ts`, `src/mocks/db.test.ts` | The route requires `candidate.editProfile`. | Same. |
| Frontend candidate contract (Abdul approves) | `src/lib/schemas/candidate.ts` `UpdateCandidateSchema`, `src/lib/api/dto/candidates.ts`, `docs/02` | `needsSponsorship` and `needsTransfer` added (existing fields); a changed work authorization sends both (`workAuthChange`, the new-candidate flow's rule). | The edit route refuses a new `work_auth` without both, so changing it on the candidate page always failed (found in the Module 1 browser test). |
| The new-candidate flow (built by Abdul, onboarding 04) | `src/components/app/candidate-wizard/tag-input.tsx`, `docs/candidate-onboarding/04-wizard-steps.md` | Chips are added only with Enter (or the Add button); a comma is text ("Columbus, OH"); a chip can be clicked to edit. | A location's comma split it into two chips. |
| Candidate contract and the new-candidate flow (Abdul) | `backend/candidates/serialize.py`, `src/lib/schemas/candidate.ts` (`country` nullable), `src/lib/api/dto/candidates.ts`, `src/components/app/candidate-wizard/model.ts`, `step-basic.tsx`, `model.test.ts`, `backend/tests/test_resume_versions.py`, `docs/02-DATA-CONTRACTS.md` §4, `docs/candidate-onboarding/04-wizard-steps.md` | No default country: the API sends `country: null` when the active résumé names none (was `"US"`); the Country box starts empty, takes the parsed résumé's country, else is typed. The Job schema's `"US"` default is unchanged. | Your PR 7 review #5 (2026-11-07): `country or "US"` invented a country. Decided by Zuhair, approved in your re-review; docs/02 updated after it. |

## Candidates final schema — `persona`, `skills`, `summary_state` removed, and no claims (`feat/candidates-final-schema`, Zuhair)

Plan: [zuhair.md](./zuhair.md) §1.1 and §1.3. Migration 0015. **Abdul approves every `candidates` change: his review of
this PR is that approval.**

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Applications (Samad) | `backend/api/routes_applications.py` | An application's response shows the résumé it was sent with (`resume_id`) even when deleted, and says so (`tailored_resume_deleted`); without a `resume_id` the lookup is unchanged. | A closed application no longer keeps a résumé from being deleted (§4.7), so it must still show what was sent. `move_on` is a rejection (Zuhair, 2026-11-04), so it counts as closed. **Left for Samad:** setting `resume_id` when an application is made. |
| Candidates table (Abdul) | `backend/models/candidates.py`, `backend/migrations/versions/0015_candidates_final_schema.py` | `persona`, `skills`, `summary_state` dropped; `preferred_industries` and `deal_breakers` added (copied out of `persona` first); the Q50 fields are final. | Nothing read `persona`; two of its values were stale copies of real columns, `tone_notes` was never filled, the summary is the base résumé's; skills and the summary are claims now. |
| Candidate create and edit (Abdul) | `backend/api/routes_candidates.py`, `backend/api/routes_candidate_resumes.py`, `backend/candidates/serialize.py`, `record.py` | The two new columns written and returned flat. The create request now checks its mandatory fields (`full_name`, `primary_role`, `email`, `phone`, `years_experience`, `country`, `work_auth`, `needs_sponsorship`, `needs_transfer`, `employment_types` ≥ 1, `target_roles` ≥ 1, `manager_id`) and names a missing one (422); an edit that changes `work_auth` must carry `needs_sponsorship` and `needs_transfer` (400). **Nothing is worked out in the backend**: the new-candidate flow works the two out from the work authorization and sends them. A résumé save requires the header's `full_name` and `email`. A create always makes a base (`MANUAL` when no file). The Record is gone: `claims` and `evidence` are dropped (0015), nothing writes claims. | Request validation (Abdul's review of the candidates PR). |
| Frontend contract (onboarding) | `src/lib/schemas/candidate.ts`, `src/lib/api/dto/candidates.ts`, `src/mocks/candidates.ts`, `src/mocks/data/candidates.json`, `src/mocks/db.ts` (fixture fingerprint), the saved sample | `persona` replaced by `preferredIndustries` and `dealBreakers`. No screen changes. | The contract change above. |
| Demo seed (shared) | `backend/scripts/seed_demo.py` | Fills the two columns; no `persona`. | Same. |
| Claims and evidence (Zuhair's own tables) | `backend/models/candidates.py`, migration 0015, `backend/candidates/record.py` (deleted) | `claims` and `evidence` dropped; nothing writes or reads them. The "in use" rule for a base is now only a live application or a tailored résumé sent in one. | Product decision (2026-11-05): BenchQ has no claim or verified states. |
| Ledger (Abdul) | `backend/models/tenancy.py`, migration 0015, `backend/auth/serialize.py`, `test_ledger.py`, `test_admin_reads.py`, `test_auth_tenancy_schema.py` | `ledger_entries.claim_state` (with `ck_ledger_entries_claim_state`) and `evidence_ids` dropped; the ledger JSON no longer has them. The downgrade puts them back empty with the CHECK. No row ever had a value. | **Abdul asked (2026-11-06)**, in his review of this PR: no claim states anywhere. |
| Ledger, frontend (Abdul's ledger, Umamah's page) | `src/lib/api/dto/session.ts`, `src/lib/schemas/analytics.ts`, `src/app/[firm]/(app)/(manage)/ledger/page.tsx`, `live-ledger.test.ts`, `live-onboarding.test.ts`, `assignment.test.ts`, `platform.test.ts` | `evidenceIds` and `claimState` removed from the ledger entry, its mapper and the fixtures; the Ledger page's Claim column removed. | **Abdul asked (2026-11-06):** the backend stops sending them, so the page would fail to parse. The rest of the frontend clean-up (studio, schemas, mocks) stays in résumé versioning PR 7. |
| Candidates table and the new-candidate flow (Abdul) | `backend/models/candidates.py` `WORK_AUTHS`, migration 0015 (`ck_candidates_work_auth`), `src/lib/schemas/enums.ts`, the step 3 cards, `WORK_AUTH_LABEL`, `candidate-wizard/model.ts`, `step-basic.tsx`, `summary-card.tsx`, `test_first_base.py`, `test_migration_0015.py` | Work authorization has no `OTHER`: the upgrade stops and names how many candidates still have it; the downgrade allows it again. The flow has a Country box (free text, `US` until the person or the parsed résumé says otherwise) instead of always sending `US`. | **Abdul asked (2026-11-06):** every status has a sponsorship rule; a TN candidate from Canada or Mexico is saved with their country. |
| Docs that described Truth Guard | `CLAUDE.md`, `product.md` §3, `docs/02` | Truth Guard, the three claim states, the export gate and "no VERIFIED without an evidenceId" removed (the same wording as PR 7); `docs/02` loses `ClaimState`, the evidence and claim schemas, the export gate and the ledger's two fields. | **Abdul asked (2026-11-06).** `firms.truth_guard_mode` stays until PR 7's 0016. |
| Logging (Uzair, production layer 4a) | `backend/tests/test_logging_canary.py` `test_creating_and_editing_a_candidate` | The create body sends the fields this PR makes mandatory (`country`, `years_experience`, both sponsorship values, `target_roles`) and a skill as `{name, family}`. What it checks is unchanged: no canary value reaches the log. | Without them the create is a 422 and the test never reaches the created candidate (found merging main, #107). |
| Team plans (Samad, Abdul, Uzair) | `docs/team/samad.md` §3, `abdul.md` §3, `uzair.md` | Docs only: a pointer to the new [persona-to-candidates.md](./persona-to-candidates.md). The `personas` table is to be dropped (later, in Abdul's clean-up); autofill reads the candidate and their résumé instead (the mapping is a suggestion, Samad decides); the stale "persona is being dropped" line in uzair.md corrected. No code changed. | Abdul's decision (2026-11-05): keep `personas` for now, stop reading it, drop it once nothing does. |

## Logging, production layer 4a (`feat/logging`, Uzair)

The `access.py` change: Abdul's review note 5 on PR #107, agreed with Abdul 2026-11-03.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Candidate inbox (Samad) | `backend/inbox/classification_worker.py`, `backend/inbox/retention.py`, `backend/api/routes_inbox.py` | Log lines with ids, counts and error codes only: each classification's outcome or failure code, a summary per worker run with work, the purge count, the three caught Google failures (attempt id and the error's type), and queued retries, reclassifications and resolved reviews. Each provider call is written to `llm_call_log` with its firm (`_log_ai_call`). No behaviour changed; the exception text stays out, as the code intended. **Added on Uzair's decision (2026-11-05) before Samad agreed; for Samad to review in #107.** | The new email jobs and these routes wrote nothing to the log, so a stalled classifier, a failed Gmail connect or a grant left live at Google was invisible; the classifier's AI calls were missing from AI spend (Q33). |
| The team plan (Abdul) | `docs/team/README.md` §4, §5 | Rule 9 (logs carry ids and counts, never a person's data; the two checks that fail a PR otherwise; what to do when they fail) and a §5 row pointing to uzair.md §1, step 4a. **Added on Uzair's decision (2026-11-05); approved by Abdul in his review of #107 (2026-11-05).** | Every teammate reads the README first; the rule was only in uzair.md, which they don't. |
| Access control (Abdul) | `backend/auth/access.py` `enforce` | Uses the route the request log already matched (`SAVED_ROUTE` in the request's state) when it was matched for the same method and path, otherwise matches it again as before (`_request_route_key`). Classification, refusals, the Origin check and sessions are unchanged; `test_access.py` and the isolation suite pass unchanged. | `RequestLog` and `enforce` both walked all ~200 routes for every request. |

## Résumé versioning PR 6 — the old résumé columns and JobNavigator's résumé code removed (`feat/drop-legacy-resume-columns`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §3.3, §4.8, §8; decided 2026-11-02 (Abdul approved the drops
on 2026-10-31). Migration 0013.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Applications (Samad) | `backend/api/routes_applications.py` | Interview prep reads the tailored résumé's text from its columns (`resume_text`), newest by `created_at` and `version`; the documents lookup filters `category = 'TAILORED'` instead of `is_base`. Behaviour is the same. | `json_data`, `is_base` and `updated_at` are dropped. An application with no candidate (from before candidates) now shows no tailored résumé: every résumé has a candidate since 0012. **Left for Samad (Abdul's review of PR 6):** interview prep is a JobNavigator leftover that BenchQ's screens don't call; with no tailored résumés (the tailoring module comes later) it can print "[résumé content unavailable]". Whether to keep it, and to fall back to the candidate's active base v1, is Samad's call with the applications work. |
| The same, tests | `test_application_tracker.py`, `test_application_review_feedback.py`, `test_application_foundation_regressions.py` | Résumés built as versions (`backend/tests/resume_support.py`); the legacy-application cases expect no tailored résumé. | As above. |
| Upload size limits (Uzair, production layer 2a) | `backend/body_limit.py` | `resumes/import-pdf` and `persona/import` leave the 11 MB upload routes. | Both routes are removed (PR 5 added the candidate's résumé upload there). |
| Uzair's notes | `docs/team/uzair.md` | The upload and slow-route lists no longer name the removed routes. | They name routes that no longer exist. |
| Route access and isolation (Abdul, F7) | `backend/auth/access.py`, `backend/tests/isolation_cases.py`, `isolation_support.py`, `test_isolation.py`, `test_firm_scoping_lint.py` | The `/api/resumes` routes and `POST /api/persona/import` removed from the tables; the test world's résumés are versions; the lint also scans `backend/api/render_shared.py`. | The routes are gone; the helpers that moved keep their lint. |
| Support views (Abdul) | `backend/tests/test_support_views.py` | The read and write checks use PR 5's candidate résumé routes instead of `/api/resumes`. | The old routes are gone. |
| The candidate core doc (Abdul) | `docs/team/00-candidate-core.md` | The drops marked done; every résumé has a base and a candidate. | Facts only. |
| Startup seed (shared) | `backend/seed.py` | The "Sample PM" résumé and its seed removed (`seed_mock_resume`). | Q1: a fake person scoring every firm's jobs; a résumé needs a candidate. |
| Settings (shared) | `backend/api/routes_settings.py` | Imports `reset_tailoring_semaphore` from `render_shared.py`. | Moved with the other helpers. |
| Ledger (Abdul) | `docs/integration/06-open-decisions.md`, `docs/integration/01-ledger.md` | D10 added: keeping deleted résumé versions for the ledger, **a suggestion by Zuhair Baig, chosen and built in this PR as a soft delete on `resumes` / `base_resumes` (Zuhair's tables); the ledger table is unchanged. Abdul is asked to confirm**; one line under the ledger's "Gaps" points to it. | Today a delete keeps who/what/when in the ledger but loses the version's content; the ledger is Abdul's to decide. |
| Candidate Gmail migration test (Samad) | `backend/tests/test_migration_0012.py` | The refused-downgrade test checks the database is still at **head** (`head_revision()`) instead of the literal `'0012'`. | With PR 6's 0013 on top (PR 6 merged after #104, so it renumbered), a refused downgrade leaves the database at 0013; the test's point (nothing moved) is unchanged. |
| Jobs, applications (Abdul's review of PR 6) | `backend/api/routes_jobs.py` (list, detail), `routes_applications.py` (interview prep, the tailored link), `routes_cover_letters.py`, `render_shared.py` | Each lookup of a résumé skips soft-deleted versions (`Resume.deleted_at IS NULL`). | A deleted version is invisible to the app; without it a job's "tailored résumé" could point at a deleted v2. One test (`test_r4_cov_routes_jobs.py`). |

Not changed, left to the owner:

- **Cover letters** stay (Zuhair, "maybe later"): they read the résumé from its columns now, nothing else changed.
- **The shared persona** stays except its résumé import; the rest needs Samad (autofill reads it).

## Résumé versioning PR 5 — versions and bases through the API (`feat/resume-versions`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §3.1, §3.2, §4.3, §4.6, §4.7, §6; decided with Abdul
2026-11-02, who asked for it to be written into the docs in this PR.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Routes and permissions (Abdul) | `docs/07-ROUTES-AND-RBAC.md` | Q55 added (who changes a candidate's résumés; numbered after #105's Q54, password recovery); a line under the §2.2 route map (résumé actions are per candidate); a Phase C row for the two helpers. The route map's access levels and the registry are unchanged. | Abdul's decision: once a BDE is assigned, only that BDE changes the candidate's résumés. |
| The permission policy (Abdul) | `backend/auth/policy.py`, `src/lib/auth/policy.ts` | Two helpers, `can_change_resume` / `canChangeResume` and `can_manage_resume` / `canManageResume`, next to `can_assign_to`. The role table (and `policy_table.json`) is unchanged: `resume.edit` stays OWNER, MANAGER, BDE, and the helpers narrow it by the candidate's BDE. | Q55 depends on the candidate (has a BDE, and which), which a role table can't express; the project forbids inline role checks in routes. The screens switch to the helpers in PR 7. |
| The frontend contract (Abdul approves) | `docs/02-DATA-CONTRACTS.md` §8.1 | `BaseResume` gains `promotedFromResumeId` and `archivedAt` (both nullable); the studio's content gains `summaryId`. Not built in `src/lib/schemas/` until PR 7. | The dropdown leaves out promoted versions and hidden bases (§3.2, §4.7). |
| The candidate core doc (Abdul) | `docs/team/00-candidate-core.md` | One bullet in the résumé section: who changes résumés, and what PR 5 adds. | The section described the résumés without Q55. |
| The team flows (team doc) | `docs/team/FLOWS.md` | A row for editing résumé versions (who, which tables); Q55 added to the rules under the table. | The same. |
| Applications migration test (Samad) | `backend/tests/test_migration_0009.py` | The refused-downgrade test checks the database is still at **head** (`head_revision()`) instead of the literal `"0009"`. | With PR 5's migration (0011) on top, a refused downgrade leaves the database at 0010; the test's point (nothing moved) is unchanged. |
| Upload size limits (Uzair, production layer 2a) | `backend/body_limit.py` | The candidate's résumé upload (`POST …/candidates/{candidate}/resumes/upload`) joins the 11 MB upload routes. | A résumé file over 1 MB was refused (413) before reaching the route; the route keeps its own 10 MB check, like parse-resume. |

Not changed, left to the owner:

- **Email required and unique per firm (Abdul, `candidates`):** decided 2026-11-02 (one candidate per person per
  firm, never checked across firms). The create route already requires and lowercases it; the unique rule and its
  migration are Abdul's.

## Password reset by approval (`feat/password-reset-notifications`, Mohammed Abdul Ahad Umamah)

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Applications (Samad) | `backend/tests/test_migration_0009.py` `test_tracking_downgrade_refuses_to_discard_pending_reviews` | After the refused downgrade, the test checks `alembic_version` is what it was before (the head), instead of `"0009"`. | This PR adds migration `0010` on top, so the head is no longer `0009`; the test's intent (a refused downgrade changes nothing) is unchanged. |

## Résumé versioning PR 4 — the first base on candidate create (`feat/base-resume-from-parse`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §4.2 (approved with PR 1).

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| The candidate create route (built by Abdul, onboarding 06 PR 4) | `backend/api/routes_candidates.py` `create_candidate` | When the create keeps an uploaded résumé, it also writes the candidate's first `base_resumes` row (UPLOAD, active) and its version 1 in `resumes`, before the route's one commit. The mapping lives in `backend/candidates/first_base.py`. | §4.2: the candidate, the kept parse, the base and v1 in one transaction, so any failure saves nothing. Without an upload the route works exactly as before; its body, permission and checks are unchanged. |

## Résumé versioning PR 2 — the base-résumé parser (`feat/parser-format-v2`, Zuhair)

Design: [resume-versioning.md](./resume-versioning.md) §2–§2.2.

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Timeouts (Uzair; AI timeouts handed to Zuhair for now) | `next.config.ts` | `experimental.proxyTimeout: 360_000`: the `/api` rewrite waits up to 6 minutes for the backend instead of Next's default 30 s. Applies to every `/api` request. | The parse may take 80 s an attempt and 4 attempts (about 5.5 minutes at worst). At 30 s, a slow parse failed in the browser while the backend kept running and paying for it. Uzair can tighten it per route in the production layer. |
| AI call timeouts and retries (Uzair; handed to Zuhair for now) | `backend/analyzer/llm_client.py` | `call_llm` has five new optional arguments: a strict response format (with `provider.require_parameters`), reasoning off, no backup model, a cut-off reply retried, and a deadline per attempt (`LLMDeadlineError`). | The parser needs them (§2.1). They are off by default, and a call that doesn't pass them is dispatched exactly as before; the existing client tests pass unchanged. |
| The new-candidate parse route (built by Abdul, onboarding 06 PR 3) | `backend/api/routes_candidates.py` `parse_resume` | Text extraction runs in a worker thread (`asyncio.to_thread`). | Reading a PDF is CPU work; on the event loop it held up every other firm's requests while it ran. The route's path, permission and checks are unchanged. |
| The same | `backend/candidates/parse.py` `read_resume` | The read transaction ends (`db.commit()`) before the model call. | The parse held a database connection for the whole AI call, up to minutes. The pool has 30 connections, so about 30 parses at once would have made the whole app answer 503 (`backend/models/db.py`: nothing may hold a connection across an LLM call). |
| AI spend per firm (Abdul, tenancy: docs/integration/07-auth-and-tenancy.md Q33) | `backend/analyzer/llm_logger.py` | `track_llm_call` and `log_llm_call` take an optional `firm_id` and store it in `llm_call_log.firm_id`; the parse passes its firm. | Q33: "every LLM entry point must carry the firm down", and the column was never filled. Optional, so every other AI call logs exactly as before until its owner passes its firm (tailoring, cover letters, email, autofill, scoring). |
| Onboarding docs (Abdul) | `docs/candidate-onboarding/06-backend.md` §4 and §6 | The parser lines now describe the new parser: its own model instead of the primary, the format with `city`/`state`/`country`, `certifications` and `awards` as entries, `languages`; gap G8 (location as one string) marked done. | The doc described the format this PR replaces; anyone reading it (or their Claude) would build against the old one. Facts only; no decision in it changed. |
| Résumé format approved by Abdul (resume-versioning.md §1) | `resume-versioning.md` §2 and §3.3 | `certifications` is `[{name, issuer, date, detail}]` (was `[string]`), like awards; the planned `resumes.certifications` column follows. | In the live test, one string per certification made the model glue its description to the name. With the entry shape, 28 of 28 test parses kept the name clean and the description in `detail`. |

Not changed, left to the owner:

- **A limit on parses at once (Uzair, production layer step 1: per-firm limits for the AI routes).** Scoring and
  tailoring have one (`scoring_max_concurrent`, `tailoring_max_concurrent`); the parser has none, so many uploads at
  once would hit OpenRouter's rate limits (429).
