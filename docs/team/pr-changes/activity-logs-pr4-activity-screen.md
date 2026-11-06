# Activity Log PR 4: the activity screen

Branch: `activity-logs/pr4-activity-screen` → `main`. Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).
Built on PR 3 (`activity-log/pr3-new-table-and-endpoints`), which holds PR 1 and PR 2. Merge those first.

## Scope and dependencies

The Activity logs screen, on the reads PR 3 added. It logs nothing new: which actions exist is PR 5's work. The route
stays `/ledger`; the sidebar says **Activity** and the page **Activity logs**.

- **People list (left):** Owner and Viewer start at the whole firm (managers, their own actions, unassigned BDEs, former
  members). Opening a manager hides the others and lists Everyone, the manager, and the BDEs under a connector line.
  A manager starts at their own team, and a BDE sees one row with their own name and count. Past 6 people a search
  box appears. Back link, and `Esc` goes up one level.
- **Actor dropdown:** searchable, and it lists **names**, not types. Owner and Viewer: every manager and BDE, AI agent,
  System. Manager: their team and AI agent. BDE: their own name and AI agent.
- **Candidate dropdown:** searchable, "All candidates" first, only the candidates the reader can see, narrowed by
  the person or team picked. The Claim column is gone and a Candidate column replaces it.
- **Dates:** quick ranges and a calendar with dots on days that have activity, counted in the firm's time zone.
- **Table:** search, sort and paging run on the server. Everything is in the URL. A URL naming someone outside the
  reader's view falls back to their own root.

## Files changed

| File | Changes and reason |
|---|---|
| `src/features/activity/*` | New: the page, the people list, the columns, the date filter, the URL params, and `rail.ts`, the list's rules as plain functions with tests. |
| `src/components/ui/searchable-select.tsx` | New: the dropdown you can type into. |
| `src/app/[firm]/(app)/(manage)/ledger/page.tsx` | Now only mounts the screen. |
| `src/components/app/data-table.tsx` | Optional server paging and sorting, and a `countLabel`. Other tables are unchanged. |
| `src/lib/routes/registry.ts`, `src/components/layout/sidebar.tsx` | `nav.label`, so the sidebar can say Activity while the title says Activity logs. |
| `src/lib/api/analytics.ts`, `dto/ledger.ts`, `dto/session.ts`, `src/lib/hooks/use-ledger.ts`, `src/lib/query/keys.ts`, `src/lib/schemas/analytics.ts` | The new reads, and three optional fields on an entry. |
| `backend/api/routes_ledger.py` | `sort` and `dir`, the candidate's name on each row, `matching` on people, and `GET …/ledger/days` for the dots. |
| `backend/auth/serialize.py`, `backend/auth/access.py`, `backend/tests/*` | The same, and tests. |

## Differences from the zip

Agreed: Claim removed, Candidate added, the actor dropdown lists names, and a BDE has a one-row list and the dropdown.

Two choices of mine:

- 15 rows a page, not sized to the window, because that is the list convention here. The people list stays in view
  and scrolls in its own box.
- The screen pages by offset (`?page=2`), so a page number works in the URL. A row added while reading can move
  rows by one between pages. PR 3's `cursor` stays available.

## Known limit

Until PR 5 the log holds only what is written today, so there are no AI agent rows yet. The name in the Candidate
column is the candidate's current name. `when` shows IST for exact times, as `DualTimestamp` does everywhere.
