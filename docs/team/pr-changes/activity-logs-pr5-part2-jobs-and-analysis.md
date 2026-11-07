# Activity Log PR 5 part 2: jobs and analysis

Branch: `activity-logs/pr5-part2-jobs-and-analysis` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on part 1 (`activity-logs/pr5-part1-applications`). Merge that first.

## Scope and dependencies

Logs the firm's job feed. No table, route or response changes. Job entries are about no candidate.

- Adding a job by hand or from the extension writes `CREATE`. A posting the firm already sees writes nothing.
- A change to a job's `status` or `saved` writes `UPDATE` with before/after, one entry a job in a bulk update. Setting
  `seen` writes nothing, because opening a job is a read (Abdul, 2026-11-03). A change to the same value writes nothing.
- Marking a job applied from the feed also creates an application, and now logs that too.
- Asking for a job to be analysed writes `AI_GENERATE` as `AI agent (<person>)`, when the run starts.

`POST /api/jobs/linkedin-import` moves to `NOT_FIRM_ACTIVITY` in the rules test: only a Super Admin can reach it, like
searches and settings, so it isn't a firm's activity.

## Background work, for the Super Admin only

Scrapes, scoring, Gmail and Telegram events, scheduled runs and AI calls write to `activity_logs`. Every one of these rows
has no firm, so a firm reader never gets one.

- `log_activity` writes a system row. Its 22 callers still say what happened. A scrape with no new jobs, nothing found and
  no error writes nothing, and neither does a scoring or email check that handled nothing.
- A scheduled run that did something or failed writes one system row, named Scheduler. Manual runs and empty ones don't.
- Every LLM call writes an AI agent row saying what it did, such as "AI agent scored 80 jobs against the résumés", with
  tokens and cost. A scheduled run writes one row for each kind of work, with the totals. These rows sit beside the
  person's own AI agent row, which is unchanged.
- The email check and the digest report their own counts for the run summary. They used to count rows in `activity_log_v2`.

`llm_call_log`, `scrape_log` and `job_runs` keep their rows as before.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/api/routes_jobs.py` | The entries above, through `_audit_job` and `_audit_job_change`. |
| `backend/main.py` | `POST /api/analyze/{job_id}` knows who asked, and logs when the run starts. |
| `backend/tests/test_activity_jobs.py` | New: each entry, and the cases that must write nothing. |
| `backend/tests/test_ledger_rules.py` | Six routes leave the to-log list. |
