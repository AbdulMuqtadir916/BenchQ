# Activity Log PR 7: remove `activity_log_v2` and `ledger_entries`

Branch: `activity-logs/pr7-remove-old-log-tables`, built on `activity-logs/pr6-signin-events-and-super-admin`.
Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)). Removing the tables was agreed with Abdul.

## Scope

`activity_logs` is now the only log. No table named `activity_log_v2` or `ledger_entries` remains.

What each table held:

- `ledger_entries`: the old activity ledger. Migration 0019 copied it, and nothing has read or written it since.
- `activity_log_v2`: short event lines from background jobs, with no firm or person. Scores and jobs were never in it:
  they live in `jobs` and `candidate_jobs`. Since the PR 5 part 2 addition, those events are system rows.

Owner, Manager, BDE and Viewer see exactly what they saw before. Every new row has no firm, and those readers only read
their own firm's rows.

## Migration 0021

1. Copies each `activity_log_v2` row into `activity_logs` as a system row with no firm. It keeps the id, date and message.
   The actor is named by type (Scraper, H-1B refresh, Résumé scoring, Email monitor, Telegram digest), the company becomes
   the label and the details the note.
2. Copies any `ledger_entries` row not already there, the same way 0019 did. There were none on the development database.
3. Stops with an error if any row of either table is missing from `activity_logs`.
4. Drops both tables.

The downgrade brings both tables back empty. What was copied stays in `activity_logs`.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/migrations/versions/0021_remove_old_log_tables.py` | New, as above. |
| `backend/models/db.py`, `backend/models/tenancy.py` | `ActivityLog` and `LedgerEntry` removed. |
| `backend/main.py`, `backend/auth/access.py` | `GET /api/activity-log` removed. Only the Super Admin could call it, no screen did, and the Activity page now shows those events. |
| `backend/scripts/seed_demo.py` | The demo reset no longer clears `ledger_entries`. |
| `backend/api/routes_admin.py` | `GET /api/admin/audit`, see below. |
| `backend/tests/*` | Tests that used the old tables now use `activity_logs` or plain SQL against the older schema. New: `test_migration_0021.py`, and an audit test. |

## Keeping the Firms page the same

No screen changed. The Firms page, a firm's tabs and the admin Overview work out Last activity, plan history, Custom
limits and open support views from `GET /api/admin/audit`, which returned the newest 500 entries. Background rows would
have pushed firm entries out of those 500.

The route now returns the newest 500 entries that aren't background work, the newest 100 background rows, each firm's
latest entry, every plan change and every support view entry.

This also fixes a firm with old activity showing "—" for Last activity once the platform passed 500 entries. Its real date
shows now.

The admin Overview's Recent activity list shows background rows too.

## Before merging or running this

`scrape_log`, `job_runs` and `llm_call_log` are untouched.

The backend runs migrations on start, so restarting it on this branch drops both tables on that database. Back up first.
