# Activity Log PR 5 part 2: background work

Branch: `activity-logs/pr5-part2-jobs-and-analysis` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on part 1 (`activity-logs/pr5-part1-applications`). Merge that first.

## In plain words

Besides what people do, the platform does things by itself: scrapes for jobs, scoring, checking Gmail, Telegram messages,
scheduled runs and AI calls. This part writes a line in the log for each of those, with **no firm**, so only the Super
Admin sees them (firm users never do). It keeps the log readable: a scoring run or email check that handled nothing
writes nothing, and a scheduled run writes one row, not one per step. Each AI call says what it did and its cost.

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

- `log_activity` writes a system row. Its 22 callers still say what happened. A scoring run or an email check that
  handled nothing writes nothing. The old pool's scrapers are left exactly as on main (each run writes its line): they
  aren't BenchQ's, so this part doesn't change them.
- A scheduled run that did something or failed writes one system row, named Scheduler. Manual runs and empty ones don't.
- **The old pool's scrape is not BenchQ's.** The timed scrape of every search and company (`run_all_scrapes`) is no
  longer scheduled (job search PR 2, 2026-11-10), and the Super Admin's manual scrapes only fill the old `jobs` pool,
  which BenchQ doesn't use. So no logging is added or changed for them. The scraping BenchQ uses is a BDE's job search and
  job capture (`scrape_jobs`, `job_postings`): each is a firm row with the candidate, so the owner, the candidate's
  manager and BDE see it.
- Every LLM call writes an AI agent row saying what it did, such as "AI agent scored 80 jobs against the résumés", with
  tokens and cost. A scheduled run writes one row for each kind of work, with the totals. These rows sit beside the
  person's own AI agent row, which is unchanged.
- The email check and the digest report their own counts for the run summary, scheduled or started by hand. They used
  to count rows in `activity_log_v2`. A reply read by the quick phrase check counts as well as one the AI read; a digest
  that Telegram refused counts as none sent ("No digest sent") and isn't logged as sent.
- A scheduled batch that used more than one model (a fallback joined in) names no model, rather than crediting the first
  with all of it.

`llm_call_log`, `scrape_log` and `job_runs` keep their rows as before.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/tests/test_ledger_rules.py` | Background work's own rows don't count as a route's entry; the old pool's routes are `RETIRED` and the cover letter routes `COVER_LETTERS_REMOVED`. |

## Review fixes (CodeRabbit and CodeAnt, 2026-11-14)

- **The manual "Check Gmail now" and "Send Telegram digest" crashed**: they imported a helper this part had replaced.
  They now use the counts their workers return, as the scheduled runs do (tested).
- **A digest Telegram refused**, **replies read by the phrase check**, and **a batch with two models**: as above.
- **The old pool's scrapers** (company pages, JobSpy, Levels.fyi) are back to main's code. The review found three ways
  the "empty scrape writes nothing" rule hid real work or a failure there; since that code isn't BenchQ's, it is left as
  it was rather than fixed.
- **The cover letter routes** stay in `NOT_LOGGED`: cover letters are being removed from BenchQ (decided 2026-11-12).

## Review fixes (CodeRabbit, third round, 2026-11-15)

- **An email check that handled a message leaves a row, whatever happened to it.** The row was skipped when no reply
  was counted, but a message the AI could not classify (or an auto-reply) is still marked handled and never looked at
  again. The row now depends on whether this check handled any new message, not on the replies count.
  `test_an_email_check_that_could_not_classify_a_new_message_still_leaves_a_row` drives `check_emails` with a fake Gmail.

## Up to date with main (2026-11-23)

Main's #147 to #151 merged in. Main deleted the old pool's freehire.me scraper (`backend/scraper/sources/freehire.py`),
so this part's one-line change there goes with it. Main's #147 moved the scheduler into its own worker process and
replaced the start-up clean-up with a heartbeat (`job_monitor.py`); a scheduled run that did something or failed still
writes its one Scheduler row when it finishes (`_log_run`), now from the worker.
