# Activity logs PR 2: the ledger's rules, as tests

Branch: `activity/pr2-ledger-rules-as-tests` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Base: PR 1 (`activity/pr1-role-access-on-server`, #113) since 2026-11-12, so the diff shows only this PR's changes. It
doesn't need PR 1's code to work; merge #113 first and GitHub moves this PR's base to `main`.

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

## Review fixes (CodeAnt, 2026-11-12)

CodeAnt found six ways a change could get past the checks. None is in the code today, and the scan finds the same
routes and writes as before (97 write routes, 98 logging functions, 30 ledger writes). Each now has a test that feeds the
check a small file doing it:

- `import backend.auth.ledger as ledger` (or by its full path) is read like `from backend.auth import ledger`.
- A helper defined inside a route but never called no longer counts as the route logging.
- A route added with `api_route(..., methods=[...])` or `add_api_route(...)` counts as a write route.
- `LedgerEntry` imported under another name, or reached as `module.LedgerEntry`, is still seen when built or read.
- The isolation setup's candidate entry names the real candidate: `record` fills a missing `candidate_id` from
  `entity_id`, so the random id it had pointed at a candidate that doesn't exist.

## Up to date with main (2026-11-14)

Main added `start_tailoring` (`api/routes_resume_tailoring.py`), which changes data and writes no entry itself: it only
starts a background run, and the run writes the entry once it has made the tailored version (`resume_tailor/runs.py`).
It is in `NOT_LOGGED` with that reason (`RUN_LOGS`), so the check passes again.

## Review fixes (Abdul, 2026-11-14)

Three more ways a change could get past the checks, each now with a test that feeds the check a small file doing it:

- **Two routes with a helper of the same name.** `main.py` has several handlers that each define their own `_do()`. The
  check named every function by its file and name only, so one `_do` that logs made every `_do` count as logging. Now a
  function is named by where it sits (`run_all_scrapes._do`), and a call finds the helper the way Python does: the one
  defined inside the function first, then one level out.
- **A function only named, never run.** `unused = write_audit` used to count as the route calling `write_audit`. Now a
  function passed by name counts only when it is handed to a call that runs it: `asyncio.to_thread`,
  `run_in_threadpool`, `run_in_executor`, `add_task`, `launch_background`, `submit`, `Thread`, `partial`,
  `create_task`, `ensure_future`.
- **A ledger read passed by keyword.** `db.get(entity=LedgerEntry, ident=row_id)` is now seen as a read, like
  `db.get(LedgerEntry, row_id)`.

The real backend passes all three as it is: no route depended on the old, looser reading.
