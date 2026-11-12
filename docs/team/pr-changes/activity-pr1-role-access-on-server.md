# Activity logs PR 1: each role reads only its own part of the ledger

Branch: `activity/pr1-role-access-on-server` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Base: `origin/main` at `3f8be61`.

## Scope and dependencies

07 Q64: a MANAGER could read the whole firm's ledger through the API, because the server limited only BDEs. It now
reads the entries they and the BDEs who report to them made, plus the `ASSIGN` entries about the candidates they
manage (the handoff note). The OWNER, a VIEWER and a support view still read the firm; a BDE is unchanged (Q52). A
filter sits on top of the limit, so it can't widen it.

Reads only: no table, migration, contract or dependency changes. The Super Admin's audit is not touched.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/api/routes_ledger.py` | `_limit_to_reader` is the one place a role narrows the firm's rows; adds the MANAGER's limit (`team_scope`) beside the BDE's. |
| `backend/tests/test_ledger.py` | Replaces the test that asserted a MANAGER sees the firm. New: a MANAGER's team, nothing of another team or the firm, each filter stays inside the team, the handoff note still reads, a BDE never sees a teammate's work, the OWNER and a VIEWER still see every team. |
| `src/lib/auth/policy.ts`, `src/lib/auth/permissions.test.ts` | `scopeLedger` applies the same MANAGER rule as UX. |
| `src/app/[firm]/(app)/(manage)/ledger/page.tsx` | Comment only: the backend now scopes a MANAGER too. |
| `docs/07-ROUTES-AND-RBAC.md`, `CLAUDE.md`, `docs/integration/01-ledger.md` | Records Q64. |
| `docs/team/umamah.md`, this file | Status and change document. |

## Known limits, closed by later Activity logs PRs

- History follows today's team, not the team at the time: a moved BDE's past entries go with them. The approved
  time-based rule needs the at-the-time stamps of the Activity logs migration.
- AI agent and system rows have no user on them, so a MANAGER and a BDE don't see them yet.
- Picking a candidate to see everything on it comes with the same stamps. Until then a BDE's rule stays Q52 and
  `test_reassignment_preserves_inbox_access_without_broadening_q52_ledger` still holds.

## Not closed by this work

The frontend and the backend count a team slightly differently. `teamMemberIds` also takes the BDE of any candidate
the MANAGER manages; the backend takes only the BDEs whose `manager_id` is that MANAGER. Normal assignments keep these
equal, because `can_assign_to` needs the BDE to report to the candidate's manager. A BDE from before the hierarchy
(Q51) with no manager can differ. Nothing leaks, since the page filters what the server sends. Removing the
candidate-based line is a separate change: `teamMemberIds` is shared with follow-ups and the team page.

## Release note

A MANAGER's candidate activity no longer shows the OWNER's edits or the AI and system rows on the candidates they
manage. This is intended under Q64, and it is a visible change for MANAGERs on the live backend.
