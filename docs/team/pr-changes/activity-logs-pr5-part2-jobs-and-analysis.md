# Activity Log PR 5 part 2: background work

Branch: `activity-logs/pr5-part2-jobs-and-analysis` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on part 1 (`activity-logs/pr5-part1-applications`). Merge that first.

## In plain words

Besides what people do, the platform does things by itself: scrapes for jobs, scoring, checking Gmail, Telegram messages,
scheduled runs and AI calls. This part writes a line in the log for each of those, with **no firm**, so only the Super
Admin sees them (firm users never do). It keeps the log readable: a scrape that found nothing, or a check that handled
nothing, writes nothing, and a scheduled run writes one row, not one per step. Each AI call says what it did and its cost.

## Scope and dependencies

No table, route or response changes.

**Changed 2026-11-12, after main's job search:** this part first also logged the old job feed (adding a job by hand or
from the extension, a job's status, bulk updates, asking for an analysis). Main's job search PR 2 retired those routes
(they answer 410 and go with the old pool in Zuhair's clean-up PR), so that logging could never run and is taken out. Jobs
now come from a candidate's search or capture (`job_postings`), which main already logs (`job_search`, `job_posting`) and
which this stack writes to `activity_logs`. In the rules test the six old-pool routes are `RETIRED`, and the four cover
letter routes `COVER_LETTERS_REMOVED`: cover letters are being removed from BenchQ, so the part that logged them (part 3)
is dropped. No route is left marked to log later.

## Background work, for the Super Admin only

Scrapes, scoring, Gmail and Telegram events, scheduled runs and AI calls write to `activity_logs`. Every one of these rows
has no firm, so a firm reader never gets one.

- `log_activity` writes a system row. Its 22 callers still say what happened. A scrape with no new jobs, nothing found and
  no error writes nothing, and neither does a scoring or email check that handled nothing.
- A scheduled run that did something or failed writes one system row, named Scheduler. Other manual runs and empty scheduled ones don't.
- A scrape someone starts by hand (all sources, one company, one search) always writes its result as a system row, named Scraper, even when it found nothing or failed: "Scrape all: 3 sources - +5 new". It sits beside the "Started every scrape" row from PR 6, which says who started it. Only the Super Admin reads these rows.
- Every LLM call writes an AI agent row saying what it did, such as "AI agent scored 80 jobs against the résumés", with
  tokens and cost. A scheduled run writes one row for each kind of work, with the totals. These rows sit beside the
  person's own AI agent row, which is unchanged.
- The email check and the digest report their own counts for the run summary. They used to count rows in `activity_log_v2`.

`llm_call_log`, `scrape_log` and `job_runs` keep their rows as before.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/tests/test_ledger_rules.py` | Background work's own rows don't count as a route's entry; the old pool's routes are `RETIRED` and the cover letter routes `COVER_LETTERS_REMOVED`. |
