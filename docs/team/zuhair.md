# Zuhair — Candidate table improvement, then Job scraping, then Résumé tailoring (+ ATS score)

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md) (your tables: `resume_parses`,
`searches`, `candidate_jobs`, `jobs`, `resumes`, and changes to `candidates` **with Abdul's
OK**), `docs/candidate-onboarding/06-backend.md` (what was built for onboarding), `docs/integration/README.md`.

**Starts after** the candidate core PR (0007) is merged. One branch and one PR per numbered step, from `main`.

## 1. Candidate table improvement — the profile from the résumé

Built already (onboarding 06): the parser (`backend/candidates/parse.py`, your response format), `resume_parses`
(the file kept with its candidate), the new-candidate flow, `candidates` (its skills moved to the base résumé in 0015).

1. **Fields — built in migration 0015 (`feat/candidates-final-schema`):** `persona` removed; `preferred_industries`, `deal_breakers` flat; the Q50 fields final; sponsorship follows `work_auth` unless entered; a candidate with no file gets a `MANUAL` base. What `candidates` still needed for a complete profile (your provisional fields in Q50: work settings,
   preferred locations, contact notes; anything else). Write the list with types and why, **confirm it with Abdul**,
   then migrate (claim the number in the team README §6) and update `docs/02-DATA-CONTRACTS.md` §4.
2. **Parser quality:** the prompt (`resume_parse` AI module, `DEFAULT_PROMPT`), the fields it misses, tests on real
   résumés (anonymised fixtures). **Done in résumé versioning PR 2** ([resume-versioning.md](./resume-versioning.md)
   §2): the base-résumé parser on its own model, with the team's 14 test résumés and their recorded replies as fixtures.
3. **The Record: removed (2026-11-05).** BenchQ has no claim or verified states; `claims` and `evidence` are dropped in 0015,
   `candidates.skills` and `summary_state` with them. The summary and skills are the active base résumé's. The truth rules in
   the parser's prompts and its strict format stay.
4. **The base résumé:** made from the parse at candidate create, as the first of the candidate's bases
   (`base_resumes`, one active) and its version 1 in `resumes`. Spec and PR plan: [resume-versioning.md](./resume-versioning.md).
   **Done:** the tables (PR 3, migration 0008) and the first base on create (PR 4). **PR 5** (migration 0011):
   versions and bases through the API under the candidate's URL: save, use as base, pick, the BDE's later upload,
   delete / hide / show again; once a BDE is assigned only that BDE changes résumés (07 Q55). **PR 6** (migration
   0013): the old columns and JobNavigator's résumé code removed; its old rows deleted (resume-versioning §3.3, §4.8).
5. **Frontend live:** the Record (`src/lib/api/records.ts`) behind `records`, with a DTO mapper and a real sample.

## 2. Job scraping — per candidate (Q53b)

**Reworked, in progress (decided 2026-11-09):** the shared-pool design below (`jobs` + `candidate_jobs` +
`firm_jobs`) is being replaced for new scraping by two separate tables (`backend/models/job_search.py`, docs/02
§6.y): `job_postings` (migration 0020) — one row per job a search finds for one candidate, deduped per candidate
by content hash, with everything about the job itself (title, description, location, salary, etc.) in one
`content` JSONB column rather than typed columns, since the set of sources isn't fixed to any one aggregator — and
`scrape_jobs` (same migration), a log of finished batches (`success`/`empty`/`error`, the error detail only on
`error`), not a queue. A successful batch's row and its postings are written in one transaction, batch row first
(`job_postings.batch_id` references it). `job_postings` has no status: saved/applied live in `applications`.
Live source right now: freehire.me. **Built so far:** both tables (0020), and the search pipeline
(`feat/job-search-pipeline`, migration 0022, docs/02 §6.y "The search pipeline"): `backend/job_search/` (providers
behind one contract, freehire.me first; `content` is the provider's job as sent, read through its `read()`), the
background search (`POST …/candidates/{id}/job-searches`, the candidate's BDE only; its `scrape_jobs` row is
`running` until it finishes), the caps (100 new jobs per
candidate, 20 attempts per BDE, per 6:30 PM IST day) and the reads (`GET …/job-searches`, `…/job-postings`). **PR 2**
(`feat/job-postings-repoint`, migration 0023): tailored résumés, cover letters and the two logs point at
`job_postings`; captures (`POST …/job-postings`, manual and extension); a repeated search continues; the old pool's
scheduled scrape and write routes retired (410). **Not yet built:** Arbaz's `applications` repoint, the frontend
(PR 3: show the jobs, the Search button frozen while one runs), and the clean-up PR: delete the old pool (`jobs`,
`job_locations`, `firm_jobs`, `candidate_jobs`, its routes and scrapers) once `applications` no longer points at it.
The flow described below (steps 1–5) is the old pool's: its scheduled scrape and write routes are retired (PR 2), its
reads still answer until the clean-up.

The scraper runs firm searches into the shared pool (`jobs`, `firm_jobs`, 07 Q37). From 0007 a search belongs to a
candidate (`searches.candidate_id`) and what it finds is recorded per candidate (`candidate_jobs`).

1. Searches created for a candidate (from their target roles, locations, work authorisation); the route requires
   `candidate_id`.
2. A run writes the pool **and** `candidate_jobs` (with the search, and `match_score` when scored).
3. The candidate's job list in the app reads `candidate_jobs`; the Jobs page shows a candidate's jobs.
4. Frontend live (`docs/integration/02-jobs.md`, Track 02) behind `jobs`.
   **Dated follow-up (2026-11-04, from Abdul's review of résumé versioning PR 6):** until the job module, a job is scored
   against **every candidate's active base** in one prompt (`cv_scorer.py`: `_get_resume_texts`). That is a stopgap:
   with many candidates it costs a lot and is less accurate (the short score reply is capped). Per-candidate scoring
   comes with the job module; the stopgap is not for real firms until then.
5. **Deleting a job** (Abdul, 2026-11-01): before a BDE deletes one, ask "Are you sure you want to delete this job?"
   and name the résumés tailored on it (they are deleted with it, `resumes.job_id` CASCADE). The per-candidate
   delete proposal is in [resume-versioning.md](./resume-versioning.md) §7.

## 3. Résumé tailoring (+ ATS score) (Track 04, `docs/integration/04-resumes-and-tailoring.md`)

1. Its Phase 0 design review first (no code).
2. **Tailored résumés** from the active base's version 1 for one job (`category = 'TAILORED'`, `base_resume_id`,
   `job_id`; [resume-versioning.md](./resume-versioning.md) §4), many per candidate.
   Tailoring creates them; editing one is résumé versioning PR 5's save (the next version), and only the
   candidate's BDE tailors (07 Q55, `can_manage_resume`). Decide here whether tailoring may choose the base per job
   (a candidate has several target roles but one active base).
3. **No persona** (decided 2026-11-05, Abdul): cover letters, job scoring and tailoring stop reading the shared
   `personas` row; what each read moves to the candidate and their résumé ([persona-to-candidates.md](./persona-to-candidates.md) §6–§7).
4. **Frozen once sent:** a résumé an application points at (`applications.resume_id`) is never changed: every edit
   or re-tailoring inserts the next version.
5. **ATS score** for a tailored résumé against its job. The old `score-check` route and the old tailor route were
   removed in résumé versioning PR 6; their pipeline is kept, unwired, in `backend/analyzer/legacy_tailoring.py`
   (with the prompts in settings and `llm_client.call_cv_tailor_llm`) to port to the versions.
   A PDF the server makes itself (extension, email, tracer links, the export gate on the backend) is built here
   from the studio's designs (resume-versioning.md §8).
6. Frontend live behind `resumes`.

## Rules for you

- `candidates` changes are confirmed with Abdul first, every time.
- Need a column on Samad's tables (e.g. on `applications`)? Ask him.
