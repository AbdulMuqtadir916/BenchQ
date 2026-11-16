# Upstream

`backend/` is a copy of the `backend/` package from **JobNavigator**
(https://github.com/vesaias/JobNavigator, MIT — see `LICENSE` in this folder).

| | |
|---|---|
| Upstream commit | `cdc7273d4951fdda182a5c00598eb0995ec24708` (`main`) |
| Copied on | 2026-10-06 |
| Also copied to the repo root | `Dockerfile.backend`, `pytest.ini`, `docker-compose.yml` (frontend + Caddy services removed) |
| Not copied | JobNavigator's `frontend/`, `extension/`, `Caddyfile`, root `tests/` (e2e for its own UI), `docs/` |

To pull in an upstream fix, diff the upstream `backend/` at a newer commit against this folder
and apply what applies; then update the commit above.

## The Match calculator (`backend/match/`, 2026-11-14)

The job list's Match score (decided 2026-11-14, Q30–Q49; docs/team/ats-score.md). Copied from **JobNavigator's
working tree**, not a commit: the match-1.1 files were uncommitted in `~/Desktop/Projects/ats_repo_2/JobNavigator`,
last changed 2026-11-12 (before the ATS lab copied them), and are unchanged since.

| BenchQ file | From JobNavigator `backend/` |
|---|---|
| `match/ats_match.py`, `ats_match_terms.py`, `match_words.py`, `keyword_match.py` | `analyzer/` (same names) |
| `match/main_skills.py`, `title_fit.py`, `seniority.py`, `clearance.py`, `job_quality.py`, `work_auth.py` | `job_search/` (same names) |
| `tests/test_match_upstream.py` | `tests/test_ats_match.py` (39 tests) |

Imports point at `backend.match`; the rest they need is BenchQ's own (`analyzer/job_requirements.py`
`clean_job_text`, the skills dictionary in `analyzer/data/`, `models/db.py` `sanitize_text`). BenchQ's own
`analyzer/keyword_match.py` (tailoring's checks) is a separate, older copy and is left as it is.

**On top of match-1.1: the ATS lab's patches (2026-11-13), in order** (v18 = "match-1.6-lab"; v15 was dropped):
- v13: "no new H-1B petitions, transfers welcome" doesn't cap a transfer candidate; "no C2C" also reads "not open to
  C2C", "W2 only".
- v14: common technologies the dictionary holds only as tags (Perl, JBoss, Tomcat, …); lists of the only statuses taken
  ("Only US citizens and Greencard holders") and ruled out; more citizenship wordings; two-role and slash titles; a
  clearance label read with the next line; freehire's lower-case country code; foreign cities.
- v16: "W2 Contract Only"; "USC/GC" shorthand; "U.S. citizenship … are required".
- v17: a title with no subject never caps; "GC/Citizen"; a clearance named in the title; a required language.
- v18: the title cap only for a title with another subject.

**BenchQ's changes** (version `match-1.6+benchq.2`, each tested in `tests/test_match_patches.py`):
1. A candidate's country that isn't known (None) is never assumed to be the US: no job reads as abroad.
2. A required language is checked against the résumé's languages also when the résumé is passed read once
   (`ResumeFacts`); the lab's v18 read none then.
3. `work_auth.py`: word boundaries (`plus citizens only`, `casino sponsor`), "don't/doesn't sponsor", curly
   apostrophes, "sponsorship unavailable", "unable to consider transfers", and a US citizen takes a job open to
   green-card holders: what BenchQ's first rules (job search part 3) caught and the lab's v18 missed.

benchq.2 (2026-11-16, Q58–Q62; found by scoring one résumé against three real postings, not measured against the
lab's labelled sets, which are gone):
4. `work_auth.py`: "not able to / unable to / not in a position to" offer sponsorship or a (visa, H-1B) transfer, in
   either order ("not able to offer visa transfer or sponsorship") rules out both (Q58).
5. `keyword_match.py` `CORE_CONCEPTS`: Multithreading, Concurrency, JVM, OOP, Design Patterns, Memory Management, Data
   Structures, Algorithms, System Design and Distributed Systems count as technologies, in their usual spellings
   (the dictionary held some as lower-case tags, which are left out, and two as other keywords); `main_skills.py`
   `NEVER_MAIN` keeps them from being what a job is mainly about (Q59).
6. `main_skills.py` `IMPLIES`: TypeScript used in a role is JavaScript used (Q61).

`match/score.py` is BenchQ's own: the only door into the package.
