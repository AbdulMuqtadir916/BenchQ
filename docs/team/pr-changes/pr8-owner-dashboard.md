# PR 8: the Activity dashboard, the Managers page, Analytics and Follow-ups removed

Branch: `pr8-dashboards-managers-bdes-remove-analytics-followups`, built on `main`.
Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).

## Scope

The owner's dashboard has two tabs. Finance is the default and is the dashboard as it was. Activity goes down the firm
one level at a time, and the level is in the URL, so the browser's back button works and a link opens the same view:

1. **Whole firm:** candidates, applications, interviews and placements, then a table of managers.
2. **A manager:** their team's numbers, then a table of their BDEs.
3. **A BDE:** their candidates' numbers, then a table of candidates. Opening one goes to the candidate's profile.

The links above the cards go back up, and so does Esc. Each table is the app's `DataTable`, so J and K move through the
rows, Enter opens one, and the loading, empty and error states are the app's own.

## What each level shows

The same picture at every level, for whoever is in view:

- **Cards:** candidates, then applications, interviews and placements, each against the same length of time before
  ("+3 vs the 30 days before"). The period can be 24 hours, 7, 30 or 90 days.
- **The table:** managers, BDEs or candidates, busiest first, with a line naming the busiest. The BDE table shows
  workload: the number of candidates being worked (no capacity: 07 Q63 removed it; it was against the firm's BDE capacity, amber at capacity).
- **Bench health:** the share placed (bench utilization), candidates on the bench by how long they have waited (under
  30, 30 to 60, over 60 days), and the five longest, each opening the candidate's profile.
- **Needs attention:** candidates waiting for a BDE, BDEs with candidates and nothing submitted in the period, and
  candidates on the bench for 30 days or more. It says so when there is nothing.
- **Application trend** and **pipeline**, with submission-to-interview, interview-to-offer and applications per placement.
- **Time between stages:** average days for each step finished in the period, the slowest flagged, and days to place.
- **Roles in demand** (firm and team): the most-posted roles beside bench candidates in that role. Jobs load on their
  own, so a failure stays in that card.

Two ideas were adapted rather than built as asked. There are no client requisitions in BenchQ, only posted jobs, so
"requisitions to placements" is applications per placement. Candidates' skills live on their résumés, which this page
doesn't load, so the skill heatmap compares roles instead.

## How the numbers are counted

One rule at every level, in `src/features/dashboard/activity/activity-numbers.ts`:

- An application counts when it was **submitted** in the period. A saved job isn't one yet.
- An interview counts when it **happened** in the period, a placement when it **closed** in it.
- Candidates and BDEs are counted as they are now. A manager's BDEs are the active ones who report to them.
- "Without a BDE" is a manager's candidates nobody has been assigned yet.
- Bench utilization is placed candidates out of everyone being worked or placed. Paused and inactive don't count.
- "Nothing submitted this week" is a candidate on the bench with no application in the last 7 days.

## Changes after review (2026-11-10)

The first version had problems, fixed here:

- **Columns didn't line up.** Each row was one cell holding its own grid, so the values drifted away from the headers.
  The tables are now the app's `DataTable`.
- **Numbers disagreed.** "Team coverage" counted only candidates with a BDE (9) while the table counted all of them (11).
  That card is gone, and the table shows "2 without a BDE".
- **Wrong period.** Interviews and placements only counted applications submitted in the period, so an interview this
  week on an application from last month was missed.
- **Esc didn't go back**, and the tables couldn't be used from the keyboard.
- **Eight existing dashboard tests failed:** the tab reads the URL, and those tests had no router. They have one now.
- **The trend** was a line with "Start" and "End". It is bars with a date under each.

## The redesign, the links, Managers and Analytics (2026-11-10, decision 07 Q60)


**New look.** Each level is now pictures rather than lists, in the theme's chart colours (`--color-chart-1` to `-6`
and the status colours), light and dark:

- **Firm:** attention chips; four tiles (bench placed as a meter, then applications, interviews and placements, each
  with a small line of the period and the change against the period before); the pipeline funnel with the share that
  made each step; managers ranked as bars; bench aging as one bar in three bands with the longest waits; open jobs
  against the bench as mirrored bars; time between stages as a strip with the slowest flagged; job sources; every BDE
  in one table.
- **Manager:** the same tiles; submissions by BDE as stacked columns (the rest, candidates with no BDE or one from
  another team, in grey, so the columns add up to the Applications tile); the queue waiting for a BDE ("Assign" opens
  the profile, shown only to someone who may assign); one card per BDE with a workload meter; funnel, bench aging,
  stage speeds and demand.
- **BDE:** a ring for the last 24 hours against an ordinary day; where their applications are now, by stage; each
  candidate's furthest stage as a meter, a "Quiet" flag and today's count; funnel and bench aging.

**Every number opens its records.** Tiles, funnel stages and stage counts open Applications; bench bands, roles, the
queue and attention chips open Candidates; people open their own level; candidates open their profile. To make that
work the two lists keep their filters in the URL:

- Applications: `view` (board, calendar, table), `status`, `reached`, `period` with `by` (submitted, heard back,
  interviewed, offer, placed), `manager`, `bde`, `candidate`.
- Candidates: `status` (was in-page only), `bench` (under 30, 30 to 60, over 60, 30 and over), `manager`, `bde`, `role`,
  with the existing `assignment`.
- Both show the filters as chips with Clear all, and a "nothing matches" state. With no filters they look as before.
- The lists and the dashboard count with the same rules (`src/lib/derive/list-filters.ts`), so a clicked number and
  the list it opens always agree. A test checks each pair.

**Who has the Activity tab.** The OWNER, MANAGER and VIEWER dashboards have two tabs (`dashboard-tabs.tsx`): their
overview, then Activity. A manager's Activity is their own team, with no way up to the firm. A viewer's is the firm,
read-only.

**Managers page** (`/[firm]/managers`, OWNER only, sidebar between Dashboard and Candidates, `g m`): search by name,
Table or Cards, a period, and each manager's BDEs, candidates, queue, applications, interviews and placements. Opening
one goes to their team on the dashboard. All in the URL; skeleton, empty and error states.

**Analytics removed.** Everything it showed is on the Activity tab: the funnel, applications and response rate per BDE
(the firm-wide BDE table, which gained a Responses column), the per-BDE performance table, and job sources. The page,
its registry entry and its sidebar item are gone; the route tests that used it as "a page a BDE can't open" use
Managers now.

**Also fixed:** the dashboard's focus rings used `--color-focus`, which doesn't exist, so keyboard focus was invisible
there; they use `--color-focus-ring` now.

## Follow-ups removed, and two layout fixes (2026-11-10, decision 07 Q61)

Agreed with Abdul: Follow-ups goes. It ran on demo data only (the backend never had it), its Done, Snooze and Cancel
saved nothing, and nobody was building it (Samad's plan only named it, as open decision D5, now closed).

- **Gone:** the `/[firm]/followups` page, its sidebar item and `g f`; the BDE dashboard's Follow-ups tile (now
  Interviews: applications at the interview stage now); the manager floor's Overdue column (now Placements); the
  "Follow-up in 2 days" line on board cards (the owner's avatar shows instead); the "Follow up with ..." items on a
  candidate's overview; the demo notification "4 follow-ups are overdue"; the Settings → Firm cadence row.
- **Code gone:** `useFollowups`, `followupsApi`, `followupsMock` and `followups.json`, `FollowUpTask` with its two
  enums, the `followups` query key, `scopeFollowups` / `scopeFollowupsUserId`, and the `followup.act` permission in
  `policy.ts`, `backend/auth/policy.py` and the shared `backend/auth/policy_table.json`. `FIXTURE_VERSION` changed with
  the fixtures, so every browser reseeds its demo data once. The BDE dashboard numbers lost `followUpsDueToday` and
  `followUpsOverdue`; the timeline kinds lost `FOLLOWUP`.
- **Kept:** the outreach "Follow-up" message templates. They are email templates, not this feature.

**Layout:** on the Activity tab the level you are on is plain text and only the levels above it are buttons ("Whole
firm" becomes a button once a manager is open). The Finance / Activity tabs sit at the top right, on the heading's line.

## A manager's dashboard and the BDEs page (2026-11-10, decision 07 Q62)

- **Why the board and the dashboard differ:** the Applications board counts where each application is now (Applied 50,
  Shortlisted 16 ...). The dashboard pipeline counts how far each one got in the period (Applied 143 = everything
  submitted; Shortlisted counts every one that was ever shortlisted, including those now at Interview or Placed). Both
  are right; nothing changed.
- **Manager dashboard:** no floor and no tab buttons, only the Activity dashboard. The OWNER and VIEWER keep their tabs.
- **New chart** beside the BDE cards: per BDE, applied / shortlisted / interview / placed (`bdeStageRows`); each opens
  that BDE's dashboard.
- **New page** `/[firm]/bdes` (MANAGER only, `g b`, sidebar after Dashboard): the manager's BDE table; a row opens the
  BDE's dashboard.

## Review fixes (2026-11-11)

- **Team = the policy's team** (07 Q47): a manager's BDEs are those who report to them and those holding one of their candidates. The dashboard's team, its BDE cards and the Managers page's BDE count all use `teamMemberIds`; a BDE with no manager of their own opens under the manager whose candidate they hold.
- **BDE dashboard** counts only the BDE's own submissions (`scopeApplications`), as the Applications page does.
- **Jobs limit** is 200, the most the backend lists at once (it was 400, which the backend would refuse). When the list stops there, the demand and source cards say they count the newest jobs only.
- **Applications and Candidates pages** wait for candidates as well as applications before showing "no match", name the team chips with a placeholder until the team arrives, and show "No candidates match these filters" when a dashboard link leaves none.
- **Search boxes** on the Managers and BDEs pages keep the typed text locally and write it to the URL after a short pause (`useSearchText`), so fast typing can't drop characters.
- **Smaller:** a placement dated before its application is left out of "days to place"; Esc that something else already handled (a closed menu) doesn't also go up a level.
- **Docs:** the sidebar diagram and table (BDEs added, Ledger back, no "Activity" item), the manager's single-dashboard wording, the file path, the integration inventory and the `FollowUpTask` mention in docs/02; and the two cards that do not link (job sources, time between stages) are named.

## Files changed

| File | Changes and reason |
|---|---|
| `src/features/dashboard/owner-dashboard.tsx` | The two tabs, through `dashboard-tabs.tsx`. |
| `src/features/dashboard/dashboard-tabs.tsx` | New: the overview and Activity tabs, shared by OWNER, MANAGER and VIEWER. |
| `src/features/dashboard/manager-dashboard.tsx` | The floor is now the first of two tabs. |
| `src/features/dashboard/owner-activity-dashboard.tsx` | Loads the data, keeps the level in the URL, Esc; a manager is held to their own team. |
| `src/features/dashboard/owner-activity-views.tsx` | The three levels, in the new design. |
| `src/features/dashboard/activity/*` | The numbers and insights (with tests), the tables, and the new tiles, firm, market, team and BDE cards, and the link builder. |
| `src/features/dashboard/activity-tab.test.ts` | New: the tab for owner, manager and viewer, and its links. |
| `src/lib/derive/list-filters.ts` (+ test) | New: the filter rules the lists and the dashboard share. |
| `src/lib/derive/funnel.ts` | Exports the "reached" rule. |
| `src/lib/schemas/list-search.ts` | New: the Applications, Candidates and Managers URL filters. |
| `src/lib/schemas/dashboard-search.ts` | The tab, period, manager and BDE in the URL. |
| `src/app/[firm]/(app)/(workspace)/applications/page.tsx` | View and filters in the URL, chips, filtered empty state. |
| `src/app/[firm]/(app)/(workspace)/candidates/page.tsx`, `components/app/candidate/assignment-filter.tsx` | Filters in the URL, chips. |
| `src/components/app/filter-chips.tsx` | New: the removable filter chips. |
| `src/app/[firm]/(app)/(manage)/managers/page.tsx`, `src/features/managers/managers-list.tsx` | New: the Managers page. |
| `src/app/[firm]/(app)/(manage)/analytics/page.tsx` | Deleted. |
| `src/lib/routes/registry.ts` (+ `registry.test.ts`, `landing.test.ts`, `src/lib/server/gate.test.ts`, `src/lib/auth/can.tsx`) | Managers in, Analytics out, sidebar order. |
| `src/features/dashboard/dashboard-errors.test.ts`, `seats-agree.test.ts` | A router for the server render. |
| Follow-ups (Q61): `followups/page.tsx` and `src/mocks/data/followups.json` deleted; `bde-dashboard.tsx`, `manager-dashboard.tsx`, `owner-dashboard.tsx`, `application-board.tsx`, `application-card.tsx`, `use-candidate-workspace.ts`, `overview/attention-card.tsx`, `notifications-menu.tsx`, `settings/firm/page.tsx`, `lib/api/applications.ts`, `lib/api/config.ts`, `lib/hooks/use-applications.ts`, `lib/auth/policy.ts`, `lib/schemas/{application,enums,analytics}.ts`, `lib/derive/dashboard.ts`, `lib/query/keys.ts`, `mocks/{applications,membership,db}.ts`, `backend/auth/policy.py`, `backend/auth/policy_table.json`, and their tests | The feature and everything that read it. |
| `docs/07-ROUTES-AND-RBAC.md` (Q60, Q61, route table, folders), `docs/04-SCREENS.md` (§3.5, §3.6, §8.2, sidebar, keys), `docs/01`, `02`, `03`, `05`, `docs/integration/03`, `05`, `06` (D5 closed), `docs/team/samad.md` | The decision and the screens. |

## Known limits

- Applications are still mock data on the live backend, so their numbers are zero there until that track is live. The
  demo applications are a few months old, so the 30-day view is mostly zero; 90 days shows them.
- A BDE with no manager doesn't show at the manager or BDE level (they are in the firm-wide BDE table).
- Job sources have no list to open: Applications has no "source" filter.
- The BDE's own dashboard (their work queue) is unchanged; the BDE picture is their level inside Activity.
