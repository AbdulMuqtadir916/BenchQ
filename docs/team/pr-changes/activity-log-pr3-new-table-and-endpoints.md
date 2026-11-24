# Activity log PR 3: the new table, and everything the screen will read

Branch: `activity-log/pr3-new-table-and-endpoints` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on PR 1 (`activity/pr1-role-access-on-server`) and PR 2 (`activity/pr2-ledger-rules-as-tests`); both are merged
into this branch, so merge them first.

## In plain words

Until now the ledger was a table that anyone could in principle edit, that remembered only today's teams, and that
could only be read whole. This PR gives it a new home, `activity_logs`, that **can only be added to** (the database
refuses edits and deletes). Every entry now remembers who was responsible *when it happened*: the actor's role and team,
and the candidate's manager and BDE. So when a BDE moves to another manager, their old work stays with the old manager.
The server can also filter the log by person, team, candidate, date and text, and page through it. Nothing on the screen
changes yet; PR 4 builds the Activity screen on these reads.

## Scope and dependencies

Backend only: the screen (PR 4) is unchanged, and the route stays `/ledger`. No table is changed but the new one.

- **New table, `activity_logs`** (model `ActivityEntry`; `ActivityLog` stays the old system log, `activity_log_v2`).
  It has every `ledger_entries` column, plus: `on_behalf_of_user_id`, `actor_role`, `team_manager_id`,
  `candidate_manager_id`, `candidate_bde_id`, `changes`, `request_id`.
- **Old data copied:** migration 0033 copies every `ledger_entries` row, with its id and date. Their stamps come from
  today's roles and assignments. `ledger_entries` itself is left as it was; nothing writes or reads it now, and the demo
  reset only clears it. Removing it is Abdul's call. A downgrade puts new rows back into it.
- **Can't be rewritten:** a database trigger refuses UPDATE and DELETE. The one way past it is the local demo reset, which
  may delete but never edit.
- **Time-based history:** what the role reads now follows the stamps on each row, so history stays with the manager and
  BDE at the time (07 Q65 replaces PR 1's today-based team lookup with this).
- **Reads:** filters by person (`actor_id`, which includes what their AI did), team (`team_id`), `actor_type`, candidate,
  dates and search (`q`), plus `cursor` paging. `GET …/ledger/people` gives the people and their counts, the firm's time
  zone and the action types the reader may filter by. `GET …/ledger/candidates` gives the candidates the reader can pick.
- **Days** are cut at `firms.primary_timezone`.
- **Before/after** is kept on candidate edits, assignments and a BDE changing manager, with email, phone and secrets
  masked and values over 500 characters left out.

Candidate data comes from `candidates` only; nothing here reads `personas`.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/migrations/versions/0028_activity_logs.py` | New: the table, the copy, the trigger, a real downgrade. |
| `backend/models/tenancy.py` | `ActivityEntry`. `LedgerEntry` stays, marked as frozen. |
| `backend/auth/ledger.py` | Writes to the new table, stamps every entry, `diff` for before/after with masking, `on_behalf_of` for AI actors. |
| `backend/api/routes_ledger.py` | Rewritten on the new table: the role limit by stamps, `Filters`, cursor paging, the two new routes. |
| `backend/auth/serialize.py` | The new fields on an entry, and its `cursor`. New fields only: nothing was removed. |
| `backend/auth/access.py`, `backend/tests/isolation_cases.py` | The two new routes. |
| `backend/api/routes_candidates.py`, `routes_team.py` | Pass before/after. |
| `backend/api/routes_admin.py`, `backend/auth/password_reset.py`, `backend/scripts/*` | Use the new table. `seed_demo.py` also names itself to the trigger for its reset. |
| `backend/tests/test_activity_logs.py` | New: stamps, the trigger, each role, time-based history, filters, paging, people, candidates, the migration. |
| `backend/tests/test_ledger_rules.py` | The rules now watch the new table, and nothing may use the old one but the demo reset. |
| Other `backend/tests/*` | Read the new model's name. No expectation changed except the entry's shape. |
| `docs/integration/01-ledger.md`, `docs/team/README.md`, `docs/team/umamah.md` | The new table, migration number 0033, status. |

## Brought up to date with main (2026-11-12)

- **Names.** Main moved a candidate's name onto their résumé (07 Q57), so `candidates.full_name` is no longer a column. The
  candidate pick-list (`/ledger/candidates`) reads names through `profile.prime` and sorts them in Python.
- **Order of rows at the same moment.** Newest first, then lowest id first, as on main. Both page markers (`cursor`, and
  main's `cursor_at` + `cursor_id`) read on in that order.
- **A row not yet saved** has no page marker (`created_at` is empty until it is written).
- **Main's tests** for job search, résumé versions, tailoring and the autofill screen read the entry from
  `activity_logs` (tailoring and autofill added 2026-11-14).
- **`test_migration_0025.py`.** No change: main's own version already checks the newest migration with
  `head_revision()` (now 0033), and its refused downgrade still expects 0026.
- **Capacity.** Main removed the capacity route (07 Q63), so its change here is gone.

## Review fixes (CodeRabbit and CodeAnt, 2026-11-14)

- **`TRUNCATE` is refused too.** A row trigger doesn't fire on `TRUNCATE`, so the table has a statement trigger with the
  same rule as a delete: only a reset that names itself for one transaction gets through (the demo reset, and now the
  test suite's clean-up in `tests/conftest.py`, which empties every table between tests).
- **A support view can't search what it reads replaced.** It already couldn't search email summaries. Now it can't search
  the summaries or labels of job searches and captured jobs either (the same list as `serialize._RESTRICTED`), so a
  search can't reveal a hidden job title or query by which rows come back.
- **A picked former member stays pickable.** If the filters find none of their rows, they used to drop out of the people
  list and the screen then cleared the pick. They now stay, with 0 actions, as long as the reader can see any of their
  history.
- **The route example in `docs/integration/01-ledger.md`** shows the real role limit (`_limit_to_reader`), not the old
  BDE-only filter.

Left as they are, with the reason given on the PR:

- **The reset setting.** Any database session could set it, but a session that can do that can also drop the trigger.
  The trigger guards against the app's own code rewriting history, not against someone with database access; that is
  the database's permissions' job in production.
- **The team filter in the people counts.** Picking a team is a pick, like picking a person, so the counts beside the
  list leave it out on purpose ("the list doesn't shrink as someone is chosen").
- **A BDE's move to another manager** stays one entry about the BDE, naming how many candidates moved. One entry per
  candidate is a product decision about how much the log holds.

## Edge cases checked

Each has a test in `test_activity_logs.py`:

- **Two actions at exactly the same microsecond:** one fixed order on every read; paging by offset, by `cursor` and by
  `cursor_at` + `cursor_id` returns every row once, in that order.
- **Rows a microsecond apart:** the page marker keeps the microseconds, so they are separate rows on separate pages.
- **A row added while paging:** the next page doesn't shift.
- **Midnight, to the microsecond:** in the firm's time zone, the last microsecond before midnight is still that day and
  midnight itself is the next. Checked in Asia/Kolkata (UTC+5:30).
- **A 23-hour day:** New York on 8 March 2026, when the clocks go forward.
- **A bad or half page marker** is refused (400 / 422), and a marker with no time zone too.
- **Someone who left, a deactivated user, a moved BDE:** their rows stay, as a former member.
- **A support view** can't search or read what it can't see.

## Migration number

0033, after main's 0028 to 0032 (#150). It was 0016, then 0028 (2026-11-12, after #127 and #129), then 0033
(2026-11-23). If another PR takes 0033 first, this becomes the next free number: rename the file,
`revision` / `down_revision`, the number in the tests and the row in the team README. 0015 dropped the ledger's `claim_state` and `evidence_ids`, so `activity_logs`
doesn't have them either.

## Known limit

Rows copied from the old ledger can't know the past: their stamps are today's assignments, as agreed, and they have no
before/after. An old assignment is therefore not seen by the side it came from.

## Up to date with main (2026-11-23)

Main's #147 to #151 merged in. What changed here because of them:

- **Migration 0033** (was 0028): main's 0028 to 0032 took the numbers. `down_revision` is 0032; the tests and docs
  name 0033.
- **Four of main's new tests read the log:** `test_ai_presets.py`, `test_candidates_api.py` (the edit entry),
  `test_firm_work_hours.py` and `test_job_search_linkedin.py` now read `ActivityEntry`, as the other tests do since this
  PR.
- **Candidate edit and assignment** (`routes_candidates.py`): main now refuses an edit that isn't the BDE's, names only
  the fields whose value changed, and restarts a new BDE's Days (`workday.assign`). The entry keeps its before and after
  values on top of that.
- **`test_migration_0025.py`** is main's again: main made it read `head_revision()` itself, so only this PR's
  comments were left, and its row in `cross-area-changes.md` is gone.
- **Résumé versions test:** main replaced the name test (07 Q68: the name and email stay the candidate's); it reads
  `ActivityEntry`.

## Abdul's review issues (2026-11-24)

- **#152, the candidate picker.** `GET /ledger/candidates` listed only candidates with a row the reader sees without
  picking one, so a candidate whose readable history matched the search only through a row someone else wrote while
  it was theirs (the Owner's edit on Bea's candidate) was missing. The list now reads each candidate as if it were
  picked (`_visible(..., any_candidate=True)`), with the other filters. Test:
  `test_the_candidate_list_keeps_a_candidate_whose_history_the_reader_can_open`.
- **#153, the candidate edit test.** Main lets only the candidate's BDE edit their details (07 Q17), so the test now
  edits as Bea, and sends a preferred location because an edit needs a place (Q20). It also checks that the entry is
  Bea's.
