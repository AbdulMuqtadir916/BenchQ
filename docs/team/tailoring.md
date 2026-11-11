# Résumé tailoring (module 3, Zuhair)

A BDE tailors a candidate's résumé for one job: BenchQ writes a `TAILORED` version of the résumé for that job posting.
This file is the design and the plan. It replaces the route tables in
`docs/integration/04-resumes-and-tailoring.md`, which are history now.

**The method:** Mads Lorentzen's `/apply` CV workflow, rebuilt on our parsed résumé ("Updated_focused" in
JobNavigator). Five GPT-6 Luna calls through OpenRouter (analyse, draft, review, revise, verify), then code that checks
every bullet against its own role and puts the copy together from the résumé's own facts. It never adds a skill, tool,
number or employer the résumé doesn't state. The source is Zuhair's tailoring handoff,
`BENCHQ_TAILOR_HANDOFF.md`, kept in the JobNavigator repository's `docs/`. Its prompts, response formats and code
are used as written; section 9 there says how they were measured.

**Status:** one branch and one PR, `feat/resume-tailoring`, in three commits, each tested on its own as a PR would be
(decided 2026-11-12): part 1 (the package) built; parts 2 and 3 not started. Committed, not pushed.

---

## 1. Decisions (grilling, 2026-11-11 and 2026-11-12, Zuhair)

| # | Decision |
|---|---|
| Split | One PR (`feat/resume-tailoring`) in three commits, each tested on its own: **part 1** the backend package and its tests, with no routes; **part 2** the route, the background run and storing the version; **part 3** the frontend. The ATS score and a PDF the server makes are later PRs. |
| Q1 | A tailoring starts from the candidate's **active base** by default; the BDE may pick any of the candidate's other bases that isn't hidden. It reads that base's **version 1** (resume-versioning.md §4, "the workflow always uses version 1"). A tailored résumé stays identified by base + job. |
| Q2 | Tailoring the same base for the same job again adds the **next version** of that tailored résumé; earlier versions, edited ones included, stay in its history. part 3 asks before it does. A version an application was sent with is never changed. |
| Q3, Q3c | Tracking: the **ledger** (who, when, the candidate, the résumé, model and prompt version), **`job_runs`** (every run: status, times, failure reason, the job, the firm), **`llm_call_log`** (each of the five calls: tokens, cost, under the firm) and **counts only** of the tailor's report in `job_runs.meta` (§5). No new table, no migration. |
| Q4b | The BDE sees only the tailored résumé. The gaps and stretch flags the workflow writes are not shown and not kept. |
| Q5 | The skills dictionary and its matcher come from JobNavigator unchanged (`backend/analyzer/keyword_match.py`, `data/skills_dictionary.json`, `known_skills.py`, and `clean_job_text` in `job_requirements.py`). |
| Q6, Q6b | The prompts **and** the response formats are kept in `settings` like the résumé parser's: seeded from code, read through `ai_config("resume_tailor")`, replaceable by a Super Admin. The tailor has its own model rows (OpenRouter, Luna); it never uses the shared model. |
| Q7 | No cap of our own: the existing concurrency limit for background work. Uzair's per-firm cap on AI routes comes later, sized with Zuhair (one tailoring = 5 paid calls, §6). |
| Q8 | A failed step fails the whole run: no partial version. The BDE sees "Tailoring failed, try again" with a reason class, never the model's or the résumé's text. No automatic retry. |
| Q9 | A ledger entry on success only ("Tailored Base N for <job title>", credited to the BDE). A platform admin in the support view can't start a tailoring. |
| Q10 | part 2 deletes `backend/analyzer/legacy_tailoring.py` and the old `tailoring` AI module (`cv_tailor_*`, `persona_tailor_prompt`) once nothing reads them. 422 when the posting has no description; 409 when the candidate has no usable base, or the same base and job is already being tailored. |
| Q11 | Part 1's tests port JobNavigator's (`test_mads_tailor.py`, `test_mads_fact_gate.py`) and add the handoff's §13 list and the mappers. |
| Q12 | A tailored version may leave out whole printed sections of the base (projects, certifications, awards). The header is the base's but for the title (the tailored headline). Every job stays. **Languages always stay as the base has them** (2026-11-12): they are never printed, and autofill reads them from the version. |

## 2. What part 1 holds (`backend/resume_tailor/`)

| File | What it does |
|---|---|
| `run.py` | `tailor_version(content, posting, job_title, setup=, firm_id=)`: the one entry point. A version's content and a posting in; `Tailored(content, counts)` out. Raises `TailorFailed` when a step fails. |
| `stored.py` | The version into the tailor's base résumé, and the copy back into a version (§4). `prepared_posting`: fake fence markers out, first 20,000 characters. |
| `pipeline.py` | The five steps, the exact edits (review Part A, verify), `call_model` (§3). From the handoff §5. |
| `fact_gate.py`, `checks.py` | Every bullet against its own role's lines (handoff §6, §7). |
| `copy_builder.py`, `resume_bits.py` | The copy from the final draft and the résumé's own facts (handoff §8, §9). `resume_bits` uses BenchQ's parser port (`candidates/base_resume.py`) where it has the same function. |
| `prompts.py`, `schemas.py` | The default prompts and formats, verbatim (handoff §2, §3). |
| `settings.py` | The setup rows, their defaults, the save check and `read_setup` (§3). |

Also in part 1: `without_fake_markers` in `backend/analyzer/prompt_fence.py` (now the same file as JobNavigator's), the
`resume_tailor` AI module (`backend/ai/config.py`), the 16 seeded rows (`backend/seed.py`, `settings_scope.py`).

**Checked against the source (2026-11-12):** the handoff's code was compared function by function with JobNavigator's
`mads_tailor/`, `focused_tailor_checks.py`, `focused_v2.py`, `resume_schema.py`, `prompt_fence.py`, `model_json.py`
and `keyword_match.py` (at its last commit). Every difference is an import or a module prefix, and the documented
`requirements_met: []`.

## 3. Setup (`settings`)

| Row | Value |
|---|---|
| `resume_tailor_llm_provider` | `openrouter` (the only value accepted) |
| `resume_tailor_llm_model` | `openai/gpt-6-luna` |
| `resume_tailor_llm_api_key` | Seeded **empty**; set on the settings page, never in code or commits. Until it is set, every tailoring fails naming this row. |
| `resume_tailor_system_prompt`, `resume_tailor_review_system_prompt`, `resume_tailor_writing_style`, `resume_tailor_cv_rules` | The two system prompts and the rules filled into `{writing_style}` and `{cv_rules}` |
| `resume_tailor_{analyse,draft,review,revise,verify}_prompt` | The five step templates. Each must keep its placeholders (`settings.PLACEHOLDERS`). |
| `resume_tailor_{analyse,draft,review,verify}_format` | The strict response formats, stored whole (`json_schema`, `strict: true`). Revise answers in the draft's, named `mads_revise`. Each schema must require the fields the code reads (`settings.READ_FIELDS`). |

- **The request** (handoff §1) is BenchQ's `call_llm` with: the strict format and `provider.require_parameters`,
  `reasoning: {enabled: false}`, no temperature, `max_tokens` 12,000, no fallback model, a reply cut off at the cap
  retried. Four attempts with 2, 4 and 8 s between them. A reply that isn't JSON is asked for once more.
- **The checks:** a save through `/api/settings` refuses a broken prompt or format (`invalid_setting_values`), and every
  run reads the rows through `read_setup`, which raises `TailorSetupError` naming the row. part 2 answers that with a 500.
- **A prompt or format change needs re-testing:** they were measured as written.

## 4. A version in and out (`stored.py`)

A version is stored as columns with ids on every item (`versions.content_of`). The tailor reads the parser
handoff's base résumé (`build_base_resume`).

- **In:** the version is written back in the parse's shape (the reverse of `first_base`) and built into the base. A
  job or project with no bullets is left out of the base, as `build_base_resume` does. `tailor_input` notes which
  stored entries the base kept, since the copy points at the base's numbers.
- **Out:** the copy is laid over the version.
  - The header fields are the version's; the title is the copy's headline.
  - The summary and skills are the copy's: each competency label is a skill category, and each name in its line a
    skill.
  - Every job keeps its facts, with the copy's bullets and printed dates (a plain hyphen). A job with no bullets was
    never tailored and is kept as stored.
  - Projects, certifications and awards are the version's own entries that the copy kept. Education and languages
    are the version's own (languages are never printed; autofill answers "which languages" from them).
- **Ids:** an unchanged item or bullet carries its id. `versions._with_ids` (the save's rule, resume-versioning.md
  §4.5) keeps it, and gives a changed one a new id. part 2 calls it before inserting the version.

## 5. What is kept of a run (`run.report_counts`, Q3c)

Into `job_runs.meta`, counts only:
- `gaps`;
- `fact_gate_changes`;
- `review_edits_applied` and `review_edits_missed`, and the same two for verify;
- `keywords`: covered, synonym only, missing (has it), missing (gap);
- `seconds` and `tokens` (input, output) per step.

The gaps, stretch flags, checklist and the steps' replies end with the run.

**Failures** (`pipeline.TailorFailed.code`):
- `provider_failed`: every attempt of a call failed;
- `unreadable_reply`: a second reply in a row wasn't JSON.

`TailorSetupError` is a setup problem, not the run's. The posting check (422) and the base check (409) are part 2's,
before the run starts.

## 6. Time and cost

From the handoff, measured on 6 pairs (2026-10-27): 55–73 s per tailoring, 31,000–39,000 input tokens and 5,500–8,000
output tokens across the five calls. It runs in the background (part 2), never inside a request.

## 7. Parts 2 and 3 (to plan, each grilled first)

**Part 2, the backend wiring:**
- the route on the candidate and the job, with an optional base: `can_manage_resume`, the firm's scope, the support
  view refused;
- the 422 and the 409s (Q10);
- the background run (`launch_background`) and its `job_runs` row with the counts;
- the `TAILORED` version: `_with_ids`, then v1 or the next version of base + job (`versions._group`); its `name`;
- its autofill entries copied from the source version (`autofill.entries_of`), as a save and a promote do
  (`cross-area-changes.md`, the autofill PR's note for the tailoring module);
- the ledger entry, and the run's status read;
- deleting the old tailoring (Q10).

**Part 3, the frontend:**
- the studio's tailoring (`tailor-run.tsx`, `useAgentRun`) and the job pane run the real thing;
- a base picker and the re-tailor confirmation;
- skeleton, empty, error and 409 states.

**Later:** the ATS score of a tailored version against its job, and a PDF the server makes (extension, email).
