# Zuhair — Candidate table improvement, then Job scraping, then Résumé tailoring (+ ATS score)

Read first: [team README](./README.md), [00-candidate-core.md](./00-candidate-core.md) (your tables: `resume_parses`,
`searches`, `candidate_jobs`, `jobs`, `resumes`, `claims`, `evidence`, and changes to `candidates` **with Abdul's
OK**), `docs/candidate-onboarding/06-backend.md` (what was built for onboarding), `docs/integration/README.md`.

**Starts after** the candidate core PR (0007) is merged. One branch and one PR per numbered step, from `main`.

## 1. Candidate table improvement — the profile from the résumé

Built already (onboarding 06): the parser (`backend/candidates/parse.py`, your response format), `resume_parses`
(the file kept with its candidate), the new-candidate flow, `candidates` with skills stored UNVERIFIED in
`candidates.skills` (Q49).

1. **Fields:** what `candidates` still needs for a complete profile (your provisional fields in Q50: work settings,
   preferred locations, contact notes; anything else). Write the list with types and why, **confirm it with Abdul**,
   then migrate (claim the number in the team README §6) and update `docs/02-DATA-CONTRACTS.md` §4.
2. **Parser quality:** the prompt (`resume_parse` AI module, `DEFAULT_PROMPT`), the fields it misses, tests on real
   résumés (anonymised fixtures).
3. **The Record from the parse:** on create, turn the kept parse into **claims** (experience bullets, skills,
   education, certificates, summary), all `UNVERIFIED`, with `source`, and **evidence** pointing at the parse
   (`evidence.resume_parse_id`, the excerpt). Move `candidates.skills` into `claims` (then drop the column, with
   Abdul). Never VERIFIED here: the database refuses it without evidence, and verification is a person's act.
4. **The base résumé:** made from the parse (`resumes` with `is_base`, `resume_parse_id`, one per candidate).
5. **Frontend live:** the Record (`src/lib/api/records.ts`) behind `records`, with a DTO mapper and a real sample.

## 2. Job scraping — per candidate (Q53b)

The scraper runs firm searches into the shared pool (`jobs`, `firm_jobs`, 07 Q37). From 0007 a search belongs to a
candidate (`searches.candidate_id`) and what it finds is recorded per candidate (`candidate_jobs`).

1. Searches created for a candidate (from their target roles, locations, work authorisation); the route requires
   `candidate_id`.
2. A run writes the pool **and** `candidate_jobs` (with the search, and `match_score` when scored).
3. The candidate's job list in the app reads `candidate_jobs`; the Jobs page shows a candidate's jobs.
4. Frontend live (`docs/integration/02-jobs.md`, Track 02) behind `jobs`.

## 3. Résumé tailoring (+ ATS score) (Track 04, `docs/integration/04-resumes-and-tailoring.md`)

1. Its Phase 0 design review first (no code).
2. **Tailored résumés** from the base for one job (`is_base = false`, `parent_id` → base, `job_id`), many per
   candidate. The claims a tailored résumé uses keep their state; an UNVERIFIED claim blocks export (CLAUDE.md).
3. **Frozen once sent:** a résumé an application points at (`applications.resume_id`) is not changed by tailoring
   again; tailor a new one.
4. **ATS score** for a tailored résumé against its job (`cv_score` / `score-check` today).
5. Frontend live behind `resumes`.

## Rules for you

- `candidates` changes are confirmed with Abdul first, every time.
- Never produce a VERIFIED claim without evidence, in code, fixtures or mappers.
- Need a column on Samad's tables (e.g. on `applications`)? Ask him.
