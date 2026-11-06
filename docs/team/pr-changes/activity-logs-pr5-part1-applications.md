# Activity Log PR 5 part 1: applications and autofill

Branch: `activity-logs/pr5-part1-applications` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on PR 4 (`activity-logs/pr4-activity-screen`), which holds PRs 1 to 3. Merge those first.

## An AI agent's person

An agent's entry stores its person's role in `actor_role`, and the API returns the person's name as `on_behalf_of_name`,
so the Actor column can show them (PR 4). A system entry has neither.

## Status changes on hand-logged applications

A status change on a hand-logged application used to read "Updated application details." or "Updated application
status." and kept no change. It now reads like a candidate application's, "Moved <job>: <before> → <after>.", and keeps
the status change. Note text is never written to the log, and an edit with no status change stays "Updated application
details.". This covers the single and the bulk route.

## Scope and dependencies

Logs the application work that wrote nothing. No table, route or response changes.

- A hand-logged application (no candidate) writes `CREATE`. This path was never logged, and PR 2's static check can't see
  it, because another path in the same route does log.
- Deleting one application, or several at once, writes `DELETE` for each.
- Adding, editing and removing an interview writes `CREATE`, `UPDATE` with before/after, and `DELETE`, on the candidate.
  An edit that changes nothing writes nothing.
- An AI answer from autofill writes `AI_GENERATE` as `AI agent (<person>)`, counted towards that person. The question
  itself stays out of the log, and a failed answer writes nothing. These entries have no candidate, because autofill
  isn't told which candidate it is for. Samad's rework can pass one.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/api/routes_applications.py` | The entries above; `_audit_application_edit` takes an action; `_audit_interview`. |
| `backend/api/routes_autofill.py` | Both answer routes know who asked, and log after a good answer. |
| `backend/auth/ledger.py` | `record_agent` for what an AI does for a person; `record_automated` takes `model_id`. |
| `backend/tests/test_activity_applications.py` | New: each entry, a refused delete, an empty edit, a failed AI answer. |
| `backend/tests/test_ledger_rules.py` | Seven routes leave `NOT_LOGGED`. |

## Known limit

The AI answer was tested with a stand-in model; the demo stack has no AI key.
