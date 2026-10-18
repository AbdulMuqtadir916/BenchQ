# Module 05 — Analytics

**Difficulty:** Easy · **Depends on:** 03 live · **Module name:** none (no adapter of its own)

## Why it's mostly free

`src/app/(app)/analytics/page.tsx` and the dashboards don't fetch statistics. They derive them
from raw lists (`useApplications`, `useCandidates`, `useJobs`, `useTeam`) through
`src/lib/derive/` (`deriveFunnel`, `deriveBdePerformance`, …). That's a deliberate product rule:
every number is derived, never stored. Once Modules 02 and 03 are live, these screens show backend
numbers without any analytics-specific code.

This module is a **verification pass** plus small fixes.

## Tasks

- [ ] With `jobs,companies,applications` live, open `/analytics` and every dashboard role
      (BDE / MANAGER / OWNER: sign in as each seeded account, docs/03 §3.2). Every number must match a manual count from
      `GET /api/applications` and `GET /api/stats`
- [ ] Funnel with four backend statuses: confirm `deriveFunnel` copes with empty `RESPONSE` /
      `SCREENING` / `PLACED` stages (empty bars, not crashes or NaN percentages). Fix in
      `src/lib/derive/funnel.ts` with a test if needed
- [ ] Time-based metrics (`daysBetween`, response time) use `appliedAt` / `firstResponseAt` from
      Module 03's derivation. Spot-check a few by hand
- [ ] Write what can't be real yet into the Gaps section below

## Optional backend sources (only if a product owner asks)

These exist, but switching a derived number to a backend aggregate breaks the "derive everything"
rule, so it needs a decision:

| Endpoint | Gives |
|---|---|
| `GET /api/stats` | totals: jobs, new, saved, applications, per-status counts |
| `GET /api/stats/timeline?days=n` | activity over time |
| `GET /api/stats/sankey` | pipeline flow between statuses |
| `GET /api/stats/score-distribution` | fit-score histogram |
| `GET /api/stats/llm-costs?days=n` | AI spend — likely wanted on the owner dashboard |

## Gaps (write new ones here)

- **Per-BDE performance** groups by `submittedByUserId`, which is the same interim user for every
  live application (D2). It shows one BDE with everything until users exist.
- **Source ROI** uses `job.provenance.sourceType`, which Module 02 derives from the backend
  `source` string. Check the buckets look sensible with real data.

## Acceptance criteria

- [ ] All analytics and dashboard numbers reconcile with the backend for a known dataset
- [ ] No NaN / Infinity / negative durations with real data; empty backend → empty states
