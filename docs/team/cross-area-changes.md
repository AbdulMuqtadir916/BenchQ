# Changes made in a teammate's area

When a PR has to change something in another person's area (`docs/team/README.md` §2–§3), it is agreed first and
listed here: what changed, in whose area, and why. Newest PR first.

## Candidates final schema and the Record — `persona`, `skills`, `summary_state` removed (`feat/candidates-final-schema`, Zuhair)

Plan: [zuhair.md](./zuhair.md) §1.1 and §1.3. Migration 0015. **Abdul approves every `candidates` change: his review of
this PR is that approval.**

| Area (owner) | File | What changed | Why |
|---|---|---|---|
| Applications (Samad) | `backend/api/routes_applications.py` | An application's response shows the résumé it was sent with (`resume_id`) even when deleted, and says so (`tailored_resume_deleted`); without a `resume_id` the lookup is unchanged. | A closed application no longer keeps a résumé from being deleted (§4.7), so it must still show what was sent. `move_on` is a rejection (Zuhair, 2026-11-04), so it counts as closed. **Left for Samad:** setting `resume_id` when an application is made. |
| Candidates table (Abdul) | `backend/models/candidates.py`, `backend/migrations/versions/0015_candidates_final_schema.py` | `persona`, `skills`, `summary_state` dropped; `preferred_industries` and `deal_breakers` added (copied out of `persona` first); the Q50 fields are final. | Nothing read `persona`; two of its values were stale copies of real columns, `tone_notes` was never filled, the summary is the base résumé's; skills and the summary are claims now. |
| Candidate create and edit (Abdul) | `backend/api/routes_candidates.py`, `backend/candidates/serialize.py`, new `work_auth.py`, `record.py` | The two new columns written and returned flat. `needs_sponsorship` / `needs_transfer`: an entered value wins, else worked out from `work_auth` on create and edit. A create always makes a base (`MANUAL` when no file) and writes the Record. | The flow computed sponsorship in the frontend only and an edit left it stale. **Question for Abdul:** a "Needs sponsorship? Yes / No" question for work authorization `OTHER` (a small screen change); until then `OTHER` with no entered value is `null` (unknown), and `needs_sponsorship` is nullable. |
| Frontend contract (onboarding) | `src/lib/schemas/candidate.ts`, `src/lib/api/dto/candidates.ts`, `src/mocks/candidates.ts`, `src/mocks/data/candidates.json`, `src/mocks/db.ts` (fixture fingerprint), the saved sample | `persona` replaced by `preferredIndustries` and `dealBreakers`. No screen changes. | The contract change above. |
| Demo seed (shared) | `backend/scripts/seed_demo.py` | Fills the two columns; no `persona`. | Same. |

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
