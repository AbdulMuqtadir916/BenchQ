# Module 02 — Jobs

**Status:** built (job search PRs 1–3: #123, #124, #135) · **Depends on:** 00 · **Owner:** Zuhair · **Contracts:**
docs/02 §6.y (the tables and routes), §6.z (the screens)

A candidate's jobs come from a **job search** run by the candidate's BDE (freehire.me first), or a job **captured** by
hand or from the extension. They live in `job_postings` (one row per candidate per job) and `scrape_jobs` (one row
per search or capture). The old shared `jobs` pool that this page used to describe is retired: its write routes
answer 410 and nothing on the screens reads it. It is deleted in the clean-up PR (see "Not in this module").

## Decisions (2026-11-09 to 2026-11-11)

- **Connect the existing screens; don't redesign them.** A DTO mapper (`src/lib/api/dto/jobs.ts`) turns a posting
  into the existing `Job`. What a posting doesn't know stays empty: no pay, work authorization unknown (shown, never
  filtered out), a company with only its name.
- **Jobs come only from the backend.** The jobs mock, its fixture and its `NEXT_PUBLIC_LIVE_MODULES` switch are
  deleted, and so are the candidates and résumé mocks and the seed's demo candidates: a candidate is made only by
  onboarding, from a real résumé.
- **No companies module.** No screen reads companies; a job carries its company's name, and freehire.me's H-1B mark
  (`us-h1b-sponsor`) shows as the "H-1B sponsor" tag. No mark means not known, never "doesn't sponsor". A company
  nobody checked shows no verification badge. The old `companies` table and its routes go with the old pool. Real
  company data (H-1B filings, client vs vendor) is a later feature.
- **Only the candidate's BDE searches or captures** (`canSearchJobs`, `job.search`). Owners, managers and viewers
  read; a support view reads only.
- **Daily limits** (since 6:30 PM IST): 100 new jobs per candidate, 20 searches and 20 captures per BDE. The same role
  searched again continues where the last search stopped.
- **The whole posting:** freehire.me's search cuts descriptions at about 1,000 characters, so a searched job's first
  open fetches the whole posting from freehire.me once and keeps it. Postings freehire.me itself only has a preview
  of (an Adzuna listing ends in "…") stay a preview; "Open original" has the rest.

## Frontend surface

| Kind | Path |
|---|---|
| Screens | `/[firm]/jobs` (the explorer), `/[firm]/jobs/[id]`, `/[firm]/jobs/capture` (BDE only); the candidate's Jobs tab, "Find jobs" in the candidate header, Best new matches; the BDE dashboard queue, Focus, the ⌘K job search |
| Adapter | `src/lib/api/jobs.ts`: `list`, `byId`, `capture`, `searches`, `startSearch`; the mapper `src/lib/api/dto/jobs.ts` |
| Hooks | `src/lib/hooks/use-jobs.ts`: `useJobs`, `useJob`, `useCaptureJob`, `useJobSearches` (polls while a search runs), `useStartJobSearch` |
| Types | `JobSchema` (+ `candidateIds`), `CaptureJobSchema` (per candidate) in `src/lib/schemas/job.ts`; `JobSearch*` in `src/lib/schemas/job-search.ts` |
| Layout of a posting | `src/lib/format/job-description.ts` (facts, headings, bullets from plain paragraphs), `src/components/app/jobs/job-description.tsx` |

## Backend endpoints

| Call | Endpoint |
|---|---|
| the firm's jobs (one per job, the visible `candidate_ids`, ≤ 400) | `GET /api/firms/{firm}/job-postings?candidate_id=&limit=` |
| one job (with the whole posting) | `GET /api/firms/{firm}/job-postings/{id}` |
| a candidate's jobs / one | `GET …/candidates/{id}/job-postings`, `…/job-postings/{posting_id}` |
| start a search (BDE) | `POST …/candidates/{id}/job-searches` `{query}` → 202 `{batch_id, run_id}` |
| searches and today's usage | `GET …/candidates/{id}/job-searches` |
| capture a job (BDE) | `POST …/candidates/{id}/job-postings` → 201, or 200 with `created: false` for the job the candidate has |

## Acceptance criteria

- [x] The job screens show the backend's jobs: company, location, remote / hybrid / on-site, source, posted date
- [x] A job opens from its id; a missing or malformed id is "Job not found"
- [x] A screen asking for up to 400 jobs gets them (the adapter never asks for more than the backend gives)
- [x] Skeleton, empty and error-with-Retry states on the job list, the candidate's Jobs tab, Best new matches, "Find
      jobs" and the capture form; no `SCHEMA_MISMATCH`
- [x] No jobs mock; checks green (CI runs the full suite on each PR)
- [x] Owner, manager, BDE, viewer, a second firm, Super Admin and a support view checked in the browser

## Not in this module

- **Saving and applying to a job:** `applications.job_id` still names the old pool. Arbaz repoints it onto
  `job_postings` (docs/team/arbaz.md); until then an application's job title links only when its job is found.
- **The clean-up PR (Zuhair):** delete the old pool (`jobs`, `job_locations`, `firm_jobs`, `candidate_jobs`,
  `companies`, their routes and scrapers) once applications no longer point at it.
- **The extension's capture** calls the capture route with `source: "extension"` (Arbaz).
- **Known limit:** a search runs in the API process; a restart loses one in flight (it shows as an error after 15
  minutes). A job queue is the deployment work's.
