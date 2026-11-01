# Module 03 — Applications

**Difficulty:** Medium–hard · **Depends on:** 02 live · **Module name:** `applications`
**Product decisions needed before going live:** D1 (candidate on an application) and D3 (status
set) in [`06-open-decisions.md`](./06-open-decisions.md). You can build and test the mapper first.

## Applications foundation PR 1 — 2026-11-01

The backend foundation is isolated on `codex/applications-foundation`, based on current `main`.
Migration 0008 is the only revision included. It adds application revision/freshness fields, review records and
immutable status events, preserving legacy status/history data. Candidate status commands, review confirmation,
scoped application reads/edits and history deletion guards are included with tests.

See [the backend contract](../02-DATA-CONTRACTS.md#applications-backend-foundation--pr-1-2026-11-01) and
[the per-file change report](../team/pr-changes/codex-applications-foundation.md). Code-owner review remains pending.
The frontend workflow and mapper tasks below describe the original integration track; this foundation PR does not
switch Applications to live data. Gmail OAuth/import, model classification, account provenance and UI changes are
separate PRs after their dependencies merge. Candidate Jobs feed integration is also deferred; Saved/favorite
bookkeeping inside application commands is covered here without changing the Jobs API.

## Frontend surface

| Kind | Path |
|---|---|
| Screens | `src/app/(app)/applications/page.tsx` (kanban / table / calendar), `applications/[id]/page.tsx`, plus application data in the dashboards, `candidates`, `candidates/[id]`, `jobs`, `analytics`, `outreach`, `followups`, `focus`, `components/app/applications/application-board.tsx` |
| Hooks | `src/lib/hooks/use-applications.ts` — `useApplications(candidateId?)`, `useApplication(id)`, `useUpdateApplicationStatus()` (optimistic update with rollback on error) |
| Adapter | `src/lib/api/applications.ts` → `applicationsApi` (`followupsApi` in the same file is **not** part of this module) |
| Frontend type | `ApplicationSchema`, `ApplicationEventSchema` in `src/lib/schemas/application.ts`; `ApplicationStatus` in `enums.ts`; `UpdateApplicationStatus` in `inbox.ts` |
| Mock to delete | the `applicationsMock` half of `src/mocks/applications.ts`, `src/mocks/data/applications.json` (keep `followupsMock` and `followups.json`) |

## Backend endpoints

| Call | Endpoint | Source | Response |
|---|---|---|---|
| list | `GET /api/applications?status=&limit=<0..2000>&offset=` | `list_applications` in `backend/api/routes_applications.py` | `{ "total": n, "applications": [App] }` |
| byId | — **no single-item GET exists** | | fetch the list and find it (see Tasks) |
| updateStatus | `PATCH /api/applications/{app_id}` with `{ "status": "<value>" }` | `update_application`, same file | `App` |

The backend application shape comes from `_app_to_dict`: `id, job_id, status, applied_at,
cv_version_used, notes, next_action, next_action_date, last_email_received, last_email_snippet,
status_transitions, updated_at, company, company_canonical, title, url, best_cv, short_id,
location, salary_min, salary_max, source, has_cached_page, discovered_at, tailored_resume_id,
tailored_resume_name, has_cover_letter, interviews`.

- `status_transitions` is `[{ "from": "applied", "to": "interview", "at": "<iso>", "source": "ui" | "email" | … }]`
- `interviews` is `[{ id, what, when_at, where_text, status, prep, created_at }]`
- **Backend statuses: `applied | interview | offer | rejected` only** (`VALID_STATUSES`). Anything
  else → `400`.

> ⚠️ `PATCH` treats `notes` as "replace the whole notes field". Never send the frontend's
> per-transition `note` as `notes`, or you'll wipe the application's notes. Send `status` only.

## Field mapping → `Application`

| Frontend | Source | Rule |
|---|---|---|
| `id` | `id` | as is |
| `jobId` | `job_id` | as is (a backend job UUID, which is why Jobs must be live first) |
| `candidateId` | — | **Decision D1.** Interim: `process.env.NEXT_PUBLIC_DEFAULT_CANDIDATE_ID` (an existing mock candidate such as `cand_01`), so candidate screens still join |
| `submittedByUserId` | — | Interim: the current session user's id (`useSession` default `user_adnan`) — see D2 |
| `resumeVersionId` | `tailored_resume_id` | as is or `null` (a resume id, not a version id, until Module 04 settles versions) |
| `status` | `status` | `applied`→`APPLIED`, `interview`→`INTERVIEW`, `offer`→`OFFER`, `rejected`→`REJECTED`; unknown → log and use `APPLIED` |
| `companyNameAtApply` | `company_canonical ?? company` | `?? "Unknown company"` |
| `jobTitleAtApply` | `title` | `?? "Untitled role"` |
| `appliedAt` | `applied_at` | `toIsoOrNull` |
| `firstResponseAt` | `status_transitions` | `at` of the first transition out of `applied`, else `last_email_received`, else `null` |
| `interviewAt` | `interviews`, `status_transitions` | earliest `interviews[].when_at`, else first transition `to: "interview"`, else `null` |
| `offerAt` | `status_transitions` | first `to: "offer"` |
| `closedAt` | `status_transitions` | first `to: "rejected"` |
| `expiresAt` | — | `null` |
| `coverLetterText` | — | `null` (`has_cover_letter` is a boolean; cover letters live at `/api/cover-letters`) |
| `notes` | `notes` | as is |
| `events` | `status_transitions` | one event per transition: `{ id: \`${id}_t${i}\`, applicationId: id, fromStatus: mapStatus(from), toStatus: mapStatus(to), note: null, actorUserId: null, isAutomated: source !== "ui", createdAt: toIso(at) }` |
| `createdAt` | `applied_at ?? discovered_at ?? updated_at` | `toIso` |

Frontend → backend status for `updateStatus`: send the lower-case value when it's one of the four.
Until D3 is decided, **any other target status must fail in the adapter** with
`new ApiError("BenchQ can't move an application to <status> yet.", "UNSUPPORTED_STATUS", 400)`
before any request is sent. The hook's optimistic update then rolls back and the board shows the
error. Never silently map `SCREENING` → `interview` or `PLACED` → `offer`.

## Tasks

- [ ] Samples: `/api/applications?limit=20` with at least one moved application (non-empty
      `status_transitions`) and one with an interview → `__samples__/applications.json`
- [ ] `dto/applications.ts`: `BackendApplicationSchema`, `BackendApplicationListSchema`,
      `toApplication(app, { defaultCandidateId, currentUserId })`, `toBackendStatus(status)`
- [ ] Tests: status mapping both ways (including the rejected targets), date derivation from
      transitions and interviews, event building, `isAutomated`
- [ ] `applicationsApi.list`: fetch with `limit: 2000`, map, then filter by `candidateId` on the
      client (the backend can't filter by candidate)
- [ ] `applicationsApi.byId`: same list call, then find. Add a TODO to switch to
      `GET /api/applications/{id}` if the backend adds one — or add it to the backend (a small
      route reusing `_app_to_dict`; agree with the backend owner first)
- [ ] `applicationsApi.updateStatus`: validate the target, `PATCH { status }`, map the response
- [ ] With `NEXT_PUBLIC_LIVE_MODULES=jobs,companies,applications`: kanban drag between supported
      columns persists across reload; an unsupported drag rolls back with a message; table and
      calendar views; application detail timeline; candidate pipeline counts
- [ ] Delete the applications mock half and its JSON; update `src/lib/derive/derive.test.ts`
      (it imports `applications.json`) to use a small inline fixture

## Gaps (write new ones here)

- **D1 — No candidate on an application.** The backend is single-user. Until candidates exist in
  the backend, every live application attaches to one configured mock candidate.
- **D2 — No submitter.** "Who submitted" and per-BDE performance can't be real yet.
- **D3 — Four statuses vs. ten.** `SAVED`, `RESPONSE`, `SCREENING`, `PLACED`, `WITHDRAWN` and
  `EXPIRED` don't exist in the backend. `SAVED` is a *job* status there (`job.status = "saved"`).
- **Interviews are richer in the backend** (what / where / prep) than the frontend's single
  `interviewAt`. Surfacing them is new UI, so it's out of scope here.
- **Follow-ups** could come from `next_action` / `next_action_date`. That's decision D5, not this
  module.

## Acceptance criteria

- [ ] All boards and lists show backend applications with the right status, company, title and
      dates
- [ ] Status changes persist (reload shows them); unsupported moves roll back with a clear message
- [ ] Application detail renders its timeline from `status_transitions`
- [ ] Empty / error / skeleton states verified; no `SCHEMA_MISMATCH`; mock deleted; checks green
