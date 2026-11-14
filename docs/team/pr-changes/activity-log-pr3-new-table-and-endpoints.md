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
- **Old data copied:** migration 0028 copies every `ledger_entries` row, with its id and date. Their stamps come from
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
| `docs/integration/01-ledger.md`, `docs/team/README.md`, `docs/team/umamah.md` | The new table, migration number 0028, status. |

## Brought up to date with main (2026-11-12)

- **Names.** Main moved a candidate's name onto their résumé (07 Q57), so `candidates.full_name` is no longer a column. The
  candidate pick-list (`/ledger/candidates`) reads names through `profile.prime` and sorts them in Python.
- **Order of rows at the same moment.** Newest first, then lowest id first, as on main. Both page markers (`cursor`, and
  main's `cursor_at` + `cursor_id`) read on in that order.
- **A row not yet saved** has no page marker (`created_at` is empty until it is written).
- **Main's tests** for job search and résumé versions read the entry from `activity_logs`.
- **Capacity.** Main removed the capacity route (07 Q63), so its change here is gone.

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

0028 (renumbered 2026-11-12, after main's 0024 to 0027 (#127, #129); it was 0016, following Zuhair's 0015, #112).
If another PR takes 0028 first (Zuhair's ATS score module may), this becomes the next free number: rename the file,
`revision` / `down_revision`, the number in the tests and the row in the team README. 0015 dropped the ledger's `claim_state` and `evidence_ids`, so `activity_logs`
doesn't have them either.

## Known limit

Rows copied from the old ledger can't know the past: their stamps are today's assignments, as agreed, and they have no
before/after. An old assignment is therefore not seen by the side it came from.
