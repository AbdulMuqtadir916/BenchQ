# Activity Log PR 5 part 1: applications and autofill

Branch: `activity-logs/pr5-part1-applications` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on PR 4 (`activity-logs/pr4-activity-screen`), which holds PRs 1 to 3. Merge those first.

## In plain words

The log used to miss most of what people do with applications. This part adds it, so the Activity screen shows:

- **Logging an application by hand** (no candidate), and **deleting** one or many at once: one entry for each.
- **Interviews:** adding, editing (with before and after) and removing one, on the candidate.
- **AI autofill answers:** an answer the AI wrote for a BDE shows as "AI agent (the BDE's name)", and counts towards that
  BDE. A failed answer writes nothing.
- **Status changes** on a hand-logged application now read "Moved <job>: <before> → <after>." like a candidate's.

Notes and answer text are never written to the log. The Chrome extension's "mark applied" already logged (it goes through
the candidate-status route); this part doesn't change it.

## Application status, every path (added 2026-11-12, after main's #127)

Main's #127 (Uzair) changed the statuses: a candidate's application now has **ten** (Saved, Applied, Screening call,
Shortlisted, Interview schedule request, Interview scheduled, Assessment, Offer, Move on, Incomplete application), and it
added automatic changes from email. Every way a status changes is an entry, with the candidate, who did it and the before
and after (`changes`). The notes people type and the email's own words are never written to the log.

| What happens | Entry | Who |
|---|---|---|
| A person moves an application to any of the ten | "Moved <job>: a → b." | The person, with their role |
| A BDE settles a review the AI raised | "Reviewed <job>: a → b." | The BDE |
| A person undoes an automatic change | "Undid automatic change …: a → b." | The person |
| The AI changes a status from an email | "Automatic status change from email: a → b." | AI agent, **for the candidate's BDE** |
| The AI sends an email to BDE review | "Email sent to BDE review (<reason>) for <job>." | AI agent, **for the candidate's BDE** |
| An unsupported or old status, a stale view, the same status again | Refused (400, 409) or no change: nothing is written | |

An AI agent working on a candidate works for that candidate's BDE, so these entries are the BDE's, and their manager's, as
the entries from autofill already were. Before this, a BDE could not see an automatic status change on their own
candidate unless they picked the candidate. The Actor column shows the BDE with the AI tag. Other teams' BDEs never see it.

Hand-logged applications (no candidate) still use the older four statuses (applied, interview, offer, rejected), and their
moves keep before and after too.

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
