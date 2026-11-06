# Activity Log PR 5 part 3: cover letters

Branch: `activity-logs/pr5-part3-cover-letters` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on part 2 (`activity-logs/pr5-part2-jobs-and-analysis`). Merge that first.

## Scope and dependencies

Logs cover letters, and so finishes the routes that were waiting to be logged: `TO_LOG` is gone from the rules test. No
table, route or response changes.

- Creating, editing and deleting a letter writes `CREATE`, `UPDATE` with before/after, and `DELETE`. The letter's text
  never goes in the log: an edit of the text says the letter changed, not what it says. An edit that changes nothing writes
  nothing.
- A generated letter writes `AI_GENERATE` as `AI agent (<person>)`, once the letter exists. A failed run writes nothing.
  The route passes who asked to the background worker.
- An entry names the candidate through the letter's résumé. A letter with no résumé is about no candidate.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/api/routes_cover_letters.py` | The entries above, through `_audit_letter`; `requested_by` to the worker. |
| `backend/tests/test_activity_cover_letters.py` | New: each entry, the text staying out, and a failed run. |
| `backend/tests/test_ledger_rules.py` | The last four routes leave the list, and `TO_LOG` goes. |
| `docs/team/umamah.md` | Status for all three parts. |

## Known limits

AI generation was tested with a stand-in model; the demo stack has no AI key. Résumé tailoring has no backend route yet,
so it can't be logged: whoever builds it logs it with `ledger.record_agent`, as these routes do.
