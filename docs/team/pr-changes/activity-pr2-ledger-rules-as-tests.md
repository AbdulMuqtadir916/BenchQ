# Activity logs PR 2: the ledger's rules, as tests

Branch: `activity/pr2-ledger-rules-as-tests` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Base: `origin/main` at `3f8be61`. Does not depend on PR 1 (#113).

## Scope and dependencies

Until now nothing stopped a new route from changing data without a ledger entry. CI now fails a PR that:

1. adds a route that changes data and writes no ledger entry, unless the route is in `NOT_LOGGED` with the reason;
2. writes a ledger entry without stating `candidate_id` (now a required argument of `ledger.record`; `None` is a valid
   answer for an entry about no candidate);
3. builds a `LedgerEntry` outside `backend/auth/ledger.py`, or reads the ledger outside the listed routes, so no
   endpoint skips the role limit.

A route in `NOT_LOGGED` that starts logging, or no longer exists, also fails, so the list can only shrink. No behaviour
changes: no table, migration, route or response. Every ledger write keeps what it wrote.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/tests/test_ledger_rules.py` | New. The rules above, as static checks over the backend, in the style of `test_firm_scoping_lint.py`. A route counts as logging if it reaches a ledger write through the functions it calls, matched by exact file and function, or passes one by name to a thread pool. |
| `backend/auth/ledger.py` | `candidate_id` is required on `record`. An entry on a candidate still fills it in itself. |
| `backend/api/routes_admin.py`, `routes_auth.py`, `routes_candidates.py`, `routes_invites.py`, `routes_notifications.py`, `routes_team.py`, `backend/auth/invites.py`, `password_reset.py`, `support.py` | Each write now states `candidate_id`. |
| `backend/tests/isolation_support.py`, `test_migration_0007.py` | The same, in the tests that call `record`. |
| `.github/CODEOWNERS` | The rules test needs Abdul's review, so the list can't grow unseen. |
| `.github/pull_request_template.md` | One new checklist line. |
| `docs/integration/01-ledger.md` | The rules, and `candidate_id` in the example. |

## The `NOT_LOGGED` list

59 of the 96 write routes log nothing today. 17 are firm work the later Activity logs PRs log (`TO_LOG`). The other 42
have a decided reason: the two Persona routes, which go when the `personas` table is removed (the data is on `candidates`), no entries for reads and manual sync (Abdul, 2026-11-03), nothing saved, global reference data,
or a Super Admin operation.

## Known limit

The check is static: it proves a route can reach a ledger write, not that every path through it does. `sign_out` counts
as logging because it ends a support view, though a plain sign-out writes nothing yet (a later Activity logs PR).
