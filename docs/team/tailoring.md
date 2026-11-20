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
(decided 2026-11-12): part 1 (the package) and part 2 (the wiring) committed, `main` merged in after part 1; part 3
not started. Committed, not pushed.

---

## 1. Decisions (grilling, 2026-11-11 and 2026-11-12, Zuhair)

| # | Decision |
|---|---|
| Split | One PR (`feat/resume-tailoring`) in three commits, each tested on its own: **part 1** the backend package and its tests, with no routes; **part 2** the route, the background run and storing the version; **part 3** the frontend. The ATS score and a PDF the server makes are later PRs. |
| Q1 | A tailoring starts from the candidate's **active base** by default; the BDE may pick any of the candidate's other bases that isn't hidden. It reads that base's **version 1** (resume-versioning.md §4, "the workflow always uses version 1"). A tailored résumé stays identified by base + job. **Changed in part 3 (R3-Q1, §8):** the source may be any of a visible base's versions; a later version becomes a base of its own, not active, when the tailoring succeeds. |
| Q2 | Tailoring the same base for the same job again adds the **next version** of that tailored résumé; earlier versions, edited ones included, stay in its history. Part 3 asks nothing: the button reads "Tailor again" (§8, Q5). A version an application was sent with is never changed. |
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

## 7. Part 2: the wiring (grilled and built 2026-11-12)

**Decisions** (part 2 grilling, Zuhair, 2026-11-12):

| # | Decision |
|---|---|
| Record | The run's `job_runs` row is its record: `firm_id` (new on `launch_background`), `target_job_id` (the posting), `meta` `{candidate_id, base_resume_id, job_posting_id, user_id}`, then `resume_id` + `counts` or `error_code`, and the heartbeat `seen_at`. No table, no migration. Every check reads these rows, so it holds on any number of workers. |
| Routes | `POST …/candidates/{c}/resumes/tailor` `{job_posting_id, base_resume_id?}` → 202 `{run_id}`; `GET …/resumes/tailorings` (newest first; `?running=true`); `GET …/resumes/tailorings/{run_id}` → `{status: running\|completed\|failed, resume_id, error_code, …}`. |
| Who | Starting: the candidate's BDE (`can_manage_resume`, 07 Q55). Reading: anyone who can see the candidate; a support view reads. |
| Refusals | 404 a posting or base that isn't the candidate's; 409 a hidden base, no active base, no v1, or the same base and job running; 422 a job with no description; 429 the BDE has 5 running (queued ones count); 500 naming the setting when the tailor isn't set up. Checked with the candidate row locked, held across the launch. |
| Limits | The tailor's own gate `resume_tailor`: `resume_tailor_max_concurrent`, 40 per worker (a Super Admin setting). 10 was too few: the gate is per worker and every firm shares it. Before real use, set it under the OpenRouter account's rate limit. Fairness between firms is Uzair's per-firm cap. |
| Lost | Each worker stamps its running and queued tailorings every 30 s (`runs.keep_stamping`, started with the app). Not stamped for 2 minutes, or running 30 minutes: failed as `lost`, and its 409 lifts. A row the startup clean-up failed (one worker today) reads as lost too. |
| Finish | With the candidate locked: the firm suspended, the candidate, base (deleted or hidden) or posting gone → `gone`, no version; a run already marked lost → stays lost, no version. A candidate handed to another BDE meanwhile still gets the version, credited to the BDE who started it. |
| Version | `versions._with_ids` against the base's v1, then v1 or the next version of base + job; name "Tailored"; the base v1's template and page format; autofill entries from the newest tailored version of that base and job (what the BDE typed for it), else the base v1's. |
| Ledger | On success only: `CREATE`, `resume`, "Tailored Base N for <job title>", by the BDE, `model_id` the model. |
| Failures | `provider_failed`, `unreadable_reply`, `gone`, `lost`, `setup`, and `internal` for an unexpected error (logged by its type only: a database error's text carries the résumé). |
| Deleted | `legacy_tailoring.py`, `call_cv_tailor_llm`, the six old settings (`cv_tailor_llm_*`, `cv_tailor_prompt`, `persona_tailor_prompt`) and the old `tailoring` AI module; rows a database already holds stay. |

**Files:** `backend/resume_tailor/runs.py` (admission, the run, lost runs, the heartbeat, the status),
`backend/api/routes_resume_tailoring.py` (registered before the résumé routes, so `…/tailorings` is never a résumé
id), `backend/job_monitor.py` (`firm_id`, the gate), `backend/main.py` (the router, the heartbeat). Tests:
`test_resume_tailor_routes.py`; the isolation and log sweeps know the three routes.

## 8. Part 3 and later

**Part 3, step 1: only that candidate's jobs (Zuhair, 2026-11-12; built).** Before any tailoring screen: a screen
about one candidate reads only that candidate's jobs, so every job id a Tailor button sends is the candidate's own
posting (the route's 404 for another candidate's stays as the safety net). Only screens that span candidates (the
Jobs page's "All candidates", the owner's dashboard, ⌘K) read more.
- Focus mode: the selected candidate's jobs, read again on a switch; skeleton, error and empty states added.
- The BDE dashboard's queue: its candidate's jobs (it read the BDE's newest 300 to show 6).
- The job page: `?candidate=<id>` from a candidate's screen reads that candidate's own job (`GET …/candidates/{id}/
  job-postings/{posting_id}`) and acts for them; the links from the queue, the candidate's matches, the job pane and
  the capture form carry it.
- Tailored résumé names: the résumé listing sends each tailored group's `job` (`{title, company}`,
  `versions._job_names`), so the tree and the studio no longer read the firm's newest 1000 jobs to name a copy, and
  a job shared by two candidates no longer leaves a copy unnamed.
- The job's text: the tailoring reads the posting through its source's reader (`runs.posting_text`, the job pages'
  `providers.reader_for(source).read()`), so a freehire.me or extension description's HTML reaches the model as plain
  text, a typed one as typed; "no description" (422) is checked on that text. It read `content["description"]` raw.

**Part 3, the screens (grilled and built 2026-11-12, Zuhair).**

| # | Decision |
|---|---|
| Q1 | A BDE starts a tailoring from the job pane (the button reads **"Tailor"**, was "Tailor & apply"), the job page opened for a candidate, the dashboard queue's sparkle, and Focus mode's **T**. **Focus mode is the BDE's only** (07 Q64, replaces Q3). |
| Q2 | The studio's "Tailor with AI" is removed: a tailoring starts from a job. |
| Q3 | The BDE stays where they are: the button dims while that tailoring runs; the panel says when it's done, with **Open**. The existing staged panel (`AgentRunPanel`) is reused. |
| Q4, R2-Q5 | The **Tailor** button and a picker beside it, on the job pane, the job page and the dashboard queue: the click uses the picked source, by default the active base's v1. Focus mode's T always uses the active base. |
| Q5 | No confirmation: once a copy exists for that base and job the button reads **"Tailor again"** (its next version), with **Open tailored** beside it. |
| Q6 | A job's id is the candidate's own posting: screens about a candidate read only their jobs (step 1 above). |
| Q7 | The `TailoringRun` contract (docs/02 §8.3), signed off by Zuhair; the old mock (`agentsApi.tailorResume`, `AgentDraft`) is deleted. |
| Q8 | One plain sentence per failure; **Try again** for `provider_failed`, `unreadable_reply`, `lost`, `internal`; none for `gone`, `hidden`, `setup`. |
| R2-Q1 | **Real steps:** the run records its step as it starts each (analyse, draft, review, revise, verify), then `save`; the panel shows exactly that. |
| R2-Q2, R3-Q2 | **One panel on every firm page** (the studio and Focus mode included): the BDE's tailorings that are running or finished in the last 30 minutes (`GET /firms/{firm}/tailorings`, their own only). A finished row has **Open**, a failed one its reason and Try again; **×** dismisses a finished row (remembered in that browser). |
| R2-Q3 | **Hide** folds the panel into a pill ("2 tailoring · 1 ready"); a tailoring can't be cancelled (later). |
| R2-Q4 | The panel and buttons read the runs again **every 3 s while one runs**, not at all otherwise. |
| R2-Q6 | The job page opened for no candidate (⌘K, "All candidates") has no Tailor: "Open this job from a candidate to tailor their résumé." |
| R3-Q1 | **The source is a version** (changes Q1): the picker lists each visible base's own versions. A v1 is its base. **Any other version gets a base of its own when the tailoring succeeds, not made active** (`versions.base_for_tailoring`; "Use as base" makes it active, as before). The active base, the profile and the job search don't change; a failed run leaves no base. |
| R3-Q3 | Only a base's versions: a tailored version can't be tailored again (409). |
| R3-Q4 | As "Use as base": the version's base made before comes back if deleted (ledger "Restored Base N (its v1) by using Base M vK again (for tailoring)"); if hidden, 409 "Show it again first", and the picker shows the version unavailable with the reason. A new one is logged "Made Base N from Base M vK (for tailoring)". |

**Files.** Backend: `runs.py` (`tailoring_source`, the step recorder, `_finish` makes the base, `my_runs`, a `hidden`
failure code), `routes_resume_tailoring.py` (`resume_id`, `firm_router`), `versions.py` (`_base_from` shared by
`use_as_base` and `base_for_tailoring`; `restore_base(activate=)`), `pipeline.py`/`run.py` (`on_step`), `access.py`,
`main.py`. Frontend: `schemas/tailoring.ts`, `api/tailoring.ts`, `api/dto/tailoring.ts`, `hooks/use-tailoring.ts`,
`components/app/tailoring/` (`tailor-button.tsx`, `tailoring-panel.tsx`, `messages.ts`, `stored.ts`), the panel in
`app/[firm]/layout.tsx`, the four entry points, the registry (Focus mode). Deleted: `tailor-run.tsx`, `schemas/agent.ts`,
the studio's tailor props, the agents mock's `tailorResume`.

**Abdul's review of the PR (2026-11-12), fixed:**
- The checks state a name only **as a whole** (`checks._is_stated`): "Java" is no longer supported by "JavaScript",
  nor a stem by a longer word ("Spring" by "Springfield"); the same name written together or with a plural still
  matches ("SpringBoot", "NodeJS", "microservices"). A change to the handoff's checker, with Abdul's case as a test.
- Projects are matched back by their fields compared as letters and digits (`stored._facts`), so a project dated
  "2021 – 2022" isn't lost when the copy prints "2021 - 2022"; a job or project keeps the version's own date text
  when only the punctuation differs (the dash finding of the live runs).
- A start takes the BDE's own lock (`runs.lock_bde`, an advisory lock, as the job search's) before counting the
  running tailorings: two starts for different candidates of one BDE can't both take the last of the 5 slots.
- The panel's Try again shows its own refusal on the row ("Not started again: …").
- Focus mode: on the last job, T waits for the answer, so a refused start keeps the job open with the reason; its
  "Tailored" counts the started runs that saved a résumé (and says how many are still tailoring).

**Abdul's second review (2026-11-12), fixed:** projects, certifications and awards are matched back by a key that
keeps the symbols telling names apart (`stored._identity`: letters, digits, `+`, `#`), so "C# Tracker" is never saved
as "C++ Tracker"; dashes, spaces and case still don't count, so a project dated "2021 – 2022" survives.

**Known issues, follow-up (Abdul's second review and CodeRabbit, 2026-11-12).** None starts a second tailoring: the
backend refuses the same source and job while one runs (409).
1. Focus mode: switching candidates while the last job's start is pending lets the old answer mark the new
   candidate's queue complete (each start should carry the Focus session it belongs to).
2. The panel: an older running tailoring can drop out of the read behind 50 newer finished ones (`runs.MOST_LISTED`);
   it still runs, but the panel stops checking it (read every running one, then the newest finished).
3. Focus mode: the key handler doesn't see that the last job's start is pending, so a second T sends another start
   (answered 409); guard with a ref shared by the key and the button.
4. The panel: only the newest Try again counts as in progress, so an earlier row's button comes back early (keep a set
   of rows retrying).
5. The panel: two retries finishing together can bring back a row dismissed by the first (merge each dismissal into
   the latest state).

**Scale (2026-11-12):** the candidate's tailoring list and the panel's read filter by candidate or user in the
database and read at most 50 (they read every tailoring of the firm and picked in Python). Still to do before scaling
out, outside this PR: a job queue with a separate worker (deployment), `cleanup_stale_runs` per worker and a per-firm
cap (Uzair), the OpenRouter rate limit and per-firm spend.

**Later:** the ATS score of a tailored version against its job, and a PDF the server makes (extension, email).
