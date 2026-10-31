# Module 02 — Jobs (and companies)

**Difficulty:** Medium · **Depends on:** 00 · **Module names:** `jobs`, `companies` (enable together)

## Why companies are folded in

No screen calls `useCompanies`. Company data reaches the UI only as the `company` object nested
inside every `Job`. The backend sends a job's company as a plain name string, so this module joins
jobs to `GET /api/companies` to build that object.

## Frontend surface

| Kind | Path |
|---|---|
| Screens | `src/app/(app)/jobs/page.tsx` (feed), `src/app/(app)/jobs/[id]/page.tsx` (detail), plus job lists in `dashboard` (BDE), `analytics`, `focus`, the candidate workspace (`use-candidate-workspace.ts`), `applications/[id]`, and the command palette |
| Hooks | `src/lib/hooks/use-jobs.ts`, `use-companies.ts` (unused today) |
| Adapters | `src/lib/api/jobs.ts`, `src/lib/api/companies.ts` |
| Frontend types | `JobSchema` in `src/lib/schemas/job.ts`, `CompanySchema` in `src/lib/schemas/company.ts`, enums in `enums.ts` |
| Mocks to delete | `src/mocks/jobs.ts`, `src/mocks/companies.ts`, `src/mocks/data/jobs.json` (53k lines), `src/mocks/data/companies.json` |

## Backend endpoints

| Call | Endpoint | Source | Response |
|---|---|---|---|
| list | `GET /api/jobs?limit=<0..200>&offset=<n>&sort_by=date` (+ many filters); candidate workspace adds `candidate_id=<uuid>` | `list_jobs` in `backend/api/routes_jobs.py` | `{ "total": n, "jobs": [Job] }`; with `candidate_id`: also `candidate_id` and `favorite_job_ids` |
| detail | `GET /api/jobs/{job_id}` | `get_job`, same file | `Job` |
| companies | `GET /api/companies?active=<bool>&tier=<int>` | `list_companies` in `backend/api/routes_companies.py` | `[Company]` (bare array) |

The backend job shape comes from `_job_to_dict`: `id, external_id, company (string), title, url,
source, search_id, description, location, remote, arr_remote, arr_hybrid, arr_onsite, salary_min,
salary_max, salary_source, h1b_company_lca_count, h1b_company_approval_rate, h1b_jd_flag,
h1b_jd_snippet, h1b_verdict, cv_scores, best_cv, scoring_report, best_score, has_cached_page,
page_cached_at, seen, saved, status, discovered_at, has_tailored_resume, tailored_resume_id,
in_flight, in_flight_detail`.

The backend company shape comes from `_company_to_dict`: `id, name, aliases, active, scrape_urls,
tier, detected_scrape_types, application_count, open_jobs, h1b_lca_count, h1b_approval_rate,
h1b_median_salary, h1b_last_checked, last_scraped_at, notes, …`.

Job `status` is one of `new | saved | applied | skip`. `source` is free text: `manual`,
`linkedin_extension`, `playwright_url`, `jobspy`, `jobspy_linkedin`, `jobspy_indeed`, `indeed`,
`levels_fyi`, `jobright`, ….

> ⚠️ **The limit trap.** Screens ask for `limit: 300` and `400`, but the backend rejects
> `limit > 200` with a 422. `jobsApi.list` must fetch pages of 200 (`offset += 200`) until it has
> `limit` rows or reaches `total`. Never pass `brief=1`: it drops `description`.

## Field mapping → `Company`

Build a lookup once per `jobsApi` call: lower-cased `name` and every alias → company.

| Frontend | Source | Rule |
|---|---|---|
| `id` | `id` | as is |
| `name` | `name` | as is |
| `normalisedName` | `name` | trimmed, lower-case |
| `domain` | `scrape_urls[0]` | hostname without `www.`, else `null` |
| `websiteUrl`, `linkedinUrl`, `employeeBand`, `hasUsPresence` | — | `null` |
| `clientType` | — | `"UNKNOWN"` (staffing-specific; not in the backend) |
| `atsProvider` | `detected_scrape_types` | first value, else `null` |
| `h1b` | `h1b_*` | `null` if `h1b_lca_count` is null; else `{ sponsorsH1b: lca_count > 0, lcaCount, lcaYear: null, medianLcaWage: h1b_median_salary, topLcaTitles: [], dataSource: "JobNavigator", lastCheckedAt: toIsoOrNull(h1b_last_checked) }` |
| `verification` | — | `null` |

**A job whose company isn't in `/api/companies`** (common for aggregator jobs) gets a synthesized
company: `id: "company:" + slug(name)`, the name fields filled in, `h1b` built from the job's own
`h1b_company_lca_count`, and everything else null / `"UNKNOWN"`. A job with `company: null` uses the
name `"Unknown company"`.

## Field mapping → `Job`

| Frontend | Source | Rule |
|---|---|---|
| `id` | `id` | as is |
| `companyId`, `company` | `company` | from the lookup above |
| `title` | `title` | as is |
| `normalisedTitle` | `title` | trimmed, lower-case, whitespace collapsed |
| `description` | `description` | `?? ""` |
| `city`, `state`, `country` | `location` | parse `"City, ST"` → city/state; `"Remote"` or unparseable → both `null`; country `"US"` unless the string clearly names another country |
| `remoteMode` | `arr_*`, `remote` | `arr_remote` and not `arr_onsite` → `"REMOTE"`; `arr_hybrid` → `"HYBRID"`; `remote === true` → `"REMOTE"`; else `"ONSITE"` |
| `employmentType` | — | `null` |
| `rateMin`, `rateMax` | — | `null` (hourly C2C rates aren't in the backend) |
| `salaryMin`, `salaryMax` | `salary_min`, `salary_max` | as is |
| `allowedWorkAuth` | — | `[]` — see Gaps |
| `excludesC2C` | — | `false` |
| `postedAt` | `discovered_at` | `toIsoOrNull` (backend has no posting date) |
| `applicantCount` | — | `null` |
| `applyUrl` | `url` | as is if it's a valid URL, else `null` |
| `requirements` | — | `[]` — see Gaps |
| `dedupe` | `external_id`, `url` | `{ urlHash: external_id ?? id, contentHash: id, canonicalUrl: url, duplicateOfJobId: null }` |
| `provenance.sourceType` | `source` | `manual` → `"MANUAL"`; `linkedin_extension` → `"USER_SUBMITTED"`; `playwright_url` and career-page scrapes → `"CONNECTOR"`; `jobspy*`, `indeed`, `levels_fyi`, `jobright`, anything else → `"AGGREGATOR"` |
| `provenance.sourceId` | `external_id` | `?? id` |
| `provenance.sourceUrl` | `url` | as is |
| `provenance.legalBasis` | `source` | `MANUAL`/`USER_SUBMITTED` → `"USER_SESSION"`; else `"PUBLIC_DOCUMENTED"` — **confirm with product** |
| `provenance.capturedByUserId` | — | `null` |
| `provenance.ingestedAt` | `discovered_at` | `toIso`; fall back to "now" only if missing, and log it |
| `isActive` | `status` | `status !== "skip"` |

## Tasks

- [ ] Samples: `/api/jobs?limit=20`, one `/api/jobs/{id}`, `/api/companies` → `__samples__/jobs.json`
- [ ] `dto/jobs.ts`: `BackendJobSchema`, `BackendJobListSchema` (`{total, jobs}`),
      `BackendCompanySchema`, `buildCompanyLookup`, `toCompany`, `toJob(job, lookup)`
- [ ] Tests: location parsing table (`"San Francisco, CA"`, `"Remote"`, `"New York, NY, USA"`,
      `null`), `remoteMode` truth table, source → provenance table, the unknown-company path; every
      sample row passes `JobSchema.parse`
- [ ] `jobsApi.list` pages through 200 at a time; `jobsApi.byId` fetches the job plus the companies
      lookup. Cache the lookup per call; don't add global state
- [ ] `companiesApi.list/byId` go live via `toCompany`
- [ ] With `NEXT_PUBLIC_LIVE_MODULES=jobs,companies`: jobs feed, job detail, BDE dashboard "queue",
      command palette search
- [ ] Delete mocks/JSON for both; remove `isLive` branches

## Gaps (write new ones here)

- **Candidate workspace scope:** `GET /api/jobs?candidate_id=...` now intersects `candidate_jobs` with the signed-in principal's visible candidate and the firm's `firm_jobs` set. Its response includes all favorite job IDs for that candidate; favorites still require the candidate Favorites/Application write flow.

- **No requirements or work-authorization rules.** Match scoring and the job-detail requirement
  matrix depend on `requirements` and `allowedWorkAuth`; with both empty, every candidate matches
  every job equally, and the work-auth hard filter never fires. The backend's `scoring_report` and
  `h1b_jd_flag` / `h1b_verdict` hold related signal, but turning them into structured requirements
  is a product decision. Ship with empty arrays and raise it.
- **Backend-native scores aren't surfaced.** `cv_scores`, `best_score` and `scoring_report` are
  LLM fit scores per resume. The frontend computes its own match score. Showing the backend's
  instead is a product call; don't wire it silently.
- **No hourly rates.** C2C rate fields stay null; the salary fields carry annual numbers.
- **Job capture** (`/jobs/capture`) still simulates extraction locally. Its backend is
  `POST /api/jobs/manual`. Do it as a follow-up PR once this module is live.
- **Mixed mode breaks joins:** with `jobs` live but `applications` / `resumes` mocked, mock
  applications point at mock job IDs that no longer exist, so application → job lookups show
  "not found". That's expected until Modules 03 and 04 land.

## Acceptance criteria

- [ ] Jobs feed shows backend jobs with correct company, location, remote mode and salary
- [ ] Job detail opens for a backend UUID; unknown id → not-found state
- [ ] A screen asking for 400 jobs gets up to 400 (several 200-row pages), not a 422
- [ ] Empty / error / skeleton states verified; no `SCHEMA_MISMATCH`; mocks deleted; checks green
