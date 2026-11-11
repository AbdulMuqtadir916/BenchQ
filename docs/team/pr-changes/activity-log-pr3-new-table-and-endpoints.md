# Activity log PR 3: the new table, and everything the screen will read

Branch: `activity-log/pr3-new-table-and-endpoints` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on PR 1 (`activity/pr1-role-access-on-server`) and PR 2 (`activity/pr2-ledger-rules-as-tests`); both are merged
into this branch, so merge them first.

## Scope and dependencies

Backend only: the screen (PR 4) is unchanged, and the route stays `/ledger`. No table is changed but the new one.

- **New table, `activity_logs`** (model `ActivityEntry`; `ActivityLog` stays the old system log, `activity_log_v2`).
  It has every `ledger_entries` column, plus: `on_behalf_of_user_id`, `actor_role`, `team_manager_id`,
  `candidate_manager_id`, `candidate_bde_id`, `changes`, `request_id`.
- **Old data copied:** migration 0026 copies every `ledger_entries` row, with its id and date. Their stamps come from
  today's roles and assignments. `ledger_entries` itself is left as it was; nothing writes or reads it now, and the demo
  reset only clears it. Removing it is Abdul's call. A downgrade puts new rows back into it.
- **Can't be rewritten:** a database trigger refuses UPDATE and DELETE. The one way past it is the local demo reset, which
  may delete but never edit.
- **Time-based history:** what the role reads now follows the stamps on each row, so history stays with the manager and
  BDE at the time (07 Q56 replaces PR 1's today-based team lookup with this).
- **Reads:** filters by person (`actor_id`, which includes what their AI did), team (`team_id`), `actor_type`, candidate,
  dates and search (`q`), plus `cursor` paging. `GET …/ledger/people` gives the people and their counts, the firm's time
  zone and the action types the reader may filter by. `GET …/ledger/candidates` gives the candidates the reader can pick.
- **Days** are cut at `firms.primary_timezone`.
- **Before/after** is kept on candidate edits, assignments, a BDE changing manager and the BDE capacity, with email,
  phone and secrets masked and values over 500 characters left out.

Candidate data comes from `candidates` only; nothing here reads `personas`.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/migrations/versions/0016_activity_logs.py` | New: the table, the copy, the trigger, a real downgrade. |
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
| `docs/integration/01-ledger.md`, `docs/team/README.md`, `docs/team/umamah.md` | The new table, migration number 0026, status. |

## Migration number

0026 (renumbered 2026-11-12, after main's 0023 and PR #129's 0024–0025; it was 0016, following Zuhair's 0015, #112). 0015 dropped the ledger's `claim_state` and `evidence_ids`, so `activity_logs`
doesn't have them either.

## Known limit

Rows copied from the old ledger can't know the past: their stamps are today's assignments, as agreed, and they have no
before/after. An old assignment is therefore not seen by the side it came from.
