# 03 — Mock Data Layer

> **Partly superseded (October 2026).** The MSW sections (§2 and the `handlers/` / `fixtures/`
> paths) are historical. Mocks now live in `src/mocks/<module>.ts` with JSON in
> `src/mocks/data/`, and each module's mock is deleted as it goes live on the backend — see
> [`docs/integration/README.md`](./integration/README.md). The fixture volumes, derived-counter
> rules and AI-simulation timings below still describe the mock data.

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026

The UI must feel live. That means realistic volume, realistic names, realistic dates, realistic
failure — not three rows of `Lorem Ipsum Inc.`

---

## 1. Principles

1. **Volume like production.** 1 firm · 5 users · 24 candidates · 60 companies · 400 jobs ·
   ~320 applications. Enough that virtualisation, pagination and filtering are exercised for real.
2. **Deterministic.** Seeded RNG. The same fixture set every run, so screenshots, tests and
   demos are stable. Never `Math.random()` at module load.
3. **Derived numbers are derived.** No fixture contains `applicationsSubmitted: 42`. Stats come
   from `src/lib/derive/` operating on the application and event arrays. This catches drift and
   mirrors the real backend contract.
4. **Dates are relative to now.** Generated as offsets from `new Date()` so "posted 3 days ago"
   and "due today" stay true whenever someone opens it.
5. **Every state is represented.** If a status, verdict or claim state exists in the enums, at
   least one fixture has it. Empty states get their own fixture set.

---

## 2. MSW setup

```ts
// src/mocks/browser.ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

```ts
// src/app/providers.tsx  (client component)
if (
  process.env.NEXT_PUBLIC_API_MOCKING === 'enabled' &&
  typeof window !== 'undefined'
) {
  const { worker } = await import('@/mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

Handler files mirror the adapter files one-to-one: `mocks/handlers/candidates.ts` serves what
`lib/api/candidates.ts` calls.

### 2.1 Simulated latency and failure

```ts
// src/mocks/handlers/_util.ts
const LATENCY = Number(process.env.NEXT_PUBLIC_MOCK_LATENCY_MS ?? 300);
const ERROR_RATE = Number(process.env.NEXT_PUBLIC_MOCK_ERROR_RATE ?? 0);

export async function respond<T>(data: T, opts?: { latency?: number }) {
  await delay(opts?.latency ?? LATENCY);
  if (ERROR_RATE > 0 && seededRandom() < ERROR_RATE) {
    return HttpResponse.json(
      { error: 'MOCK_FAILURE', message: 'Simulated failure — this is the error state.' },
      { status: 500 },
    );
  }
  return HttpResponse.json(data);
}
```

**Run a session with `NEXT_PUBLIC_MOCK_ERROR_RATE=0.1` before every phase exit.** Ten percent
failure surfaces every missing error state in about five minutes. It is the cheapest QA in the
project.

---

## 3. Fixture files

```
src/mocks/fixtures/
├── _seed.ts           seeded RNG + date helpers
├── firm.ts            1 firm, 5 users (one per role + 2 BDEs)
├── candidates.ts      24 candidates
├── records.ts         Records + evidence for all 24
├── companies.ts       60 companies with verification + H-1B data
├── jobs.ts            400 jobs across all 4 source types
├── matches.ts         computed per candidate
├── resumes.ts         ~40 resumes, ~90 versions
├── applications.ts    ~320 applications with full event history
├── outreach.ts        contacts + touches
├── followups.ts       derived from applications
├── ledger.ts          generated from all mutations above
└── empty.ts           the empty-state variant of every collection
```

### 3.1 Tenancy fixtures (Phase T, actual layout)

The fixtures live as JSON in `src/mocks/data/` (the tree above is the original plan). Since Phase T
PR 1 every firm-scoped row carries `firmId`, and there are four firms, one per status:

| Firm | Status | Plan (seats / candidates) | Users | Candidates (active) | Notes |
|---|---|---|---|---|---|
| `firm_hts` Hyderabad Tech Staffing LLC | ACTIVE | Growth (10 / 100) | 6 (every role; the VIEWER, Rohan Kapoor, was added in Phase T PR 2) | 24 (21) | the original firm and the default session's. Seats 7/10 |
| `firm_stl` Secunderabad Talent Labs | ACTIVE | Starter (4 / 25) | 3 (OWNER, BDE, VIEWER) | 5 (3) | exactly **at** its seat limit, 4/4 (3 users + 1 pending invite): can't add a seat, not over |
| `firm_cbw` Cyberabad Bench Works | SUSPENDED | Starter (4 / 25), downgraded from Growth | 5 (OWNER, 3 BDE, VIEWER) | 1 (1) | **over** its seat limit, 6/4 (5 users + 1 pending invite), and over on users alone (5/4), so it stays over whatever Phase S decides about a suspended firm's pending invites: the `isOverLimit` fixture. Ledger: created, owner accepted, plan changed, suspended |
| `firm_gsc` Gachibowli Staffing Co | ONBOARDING | Starter (4 / 25) | 0 | 0 | the owner's invite is pending, sent by the Super Admin |

Firm A's users, one per role at least, so the dev principal switcher can sign in as every firm role:
`user_imran` Imran Shaikh (OWNER), `user_fatima` Fatima Reddy (MANAGER), `user_adnan` Adnan Khan
(BDE, the default session), `user_sneha` Sneha Rao (BDE), `user_vikram` Vikram Desai (BDE) and
**`user_rohan` Rohan Kapoor (VIEWER)**, who was added in Phase T PR 2 because firm A had no VIEWER.
He is active, counts as a seat (that is why firm A's seats are 7/10) and is assigned no candidates:
a VIEWER reads the firm's data but works no bench.

Plus `plans.json` (Starter, Growth, Scale), `invites.json` (pending, expired, accepted, revoked, the
accepted OWNER invites of STL and CBW, the onboarding owner's pending invite and one platform-team
invite) and `platform-users.json` (one Super Admin). **Invite dates are relative to load time**: they
are written against `FIXTURE_NOW` and `invitesAt(now)` in `src/mocks/tenancy.ts` shifts them, so a
pending invite stays pending (now + 5 days) and an expired one stays expired (now − 2 days) in the
live UI. Tests call `invitesAt(FIXTURE_NOW)` for a fixed clock.
Firm B and the suspended firm were cloned from a slice of firm A with every id, person and user
re-pointed; `src/mocks/fixtures.test.ts` checks that nothing references another firm. Usage counts
(seats, active candidates) are derived, never stored.

---

## 4. What the fixtures must contain

### 4.1 Firm and users

One firm, `Hyderabad Tech Staffing LLC`, IST primary / America/New_York client, Truth Guard
`BALANCED`.

| Name | Role | Notes |
|---|---|---|
| Imran Shaikh | OWNER | Founder |
| Fatima Reddy | MANAGER | Head of bench sales |
| Adnan Khan | BDE | 8 candidates — the primary demo user |
| Sneha Rao | BDE | 9 candidates |
| Vikram Desai | BDE | 7 candidates, one at risk |

### 4.2 Candidates — 24, spread deliberately

| Dimension | Spread |
|---|---|
| `workAuth` | 8 H1B · 5 OPT · 3 CPT · 4 GC · 3 USC · 1 H4_EAD |
| `status` | 14 ON_BENCH · 5 INTERVIEWING · 2 OFFER · 1 PLACED · 1 PAUSED · 1 INACTIVE |
| Visa expiry | **2 candidates expiring within 90 days** — drives the amber chip |
| Record completeness | 6 at 100% · 10 at 60–90% · 5 at 30–60% · 3 under 30% |
| Days on bench | 3 to 180 |
| At-risk | **3 with no activity in 7+ days** |
| `persona` | present on 18, null on 6 |
| `qaBank` | 4–12 entries on the 18 with personas |

Roles: Senior DevOps, Java Full Stack, Data Engineer, React Frontend, .NET Developer, QA
Automation, Salesforce Developer, Cloud Architect, Python/Django, SAP ABAP, ServiceNow, Business
Analyst. Real US metros — Dallas, Charlotte, Phoenix, Columbus, Jersey City, Plano, Atlanta.

### 4.3 Companies — 60

| Field | Spread |
|---|---|
| `verification.verdict` | 42 VERIFIED · 12 CAUTION · 6 REJECTED |
| `firedRule` on non-VERIFIED | Must be populated — the UI names the rule, never a bare verdict |
| `clientType` | 20 DIRECT_CLIENT · 22 PRIME_VENDOR · 10 IMPLEMENTATION_PARTNER · 8 UNKNOWN |
| `h1b.sponsorsH1b` | 31 true · 18 false · 11 null (unknown) |
| `h1b.lcaCount` | 0–450 on sponsors, with `lcaYear: 2025` and a median wage |

Rejection reasons must be real and varied: `NO_FUNCTIONING_WEBSITE`,
`EMPLOYEE_COUNT_UNDER_10`, `NO_US_PRESENCE`, `THIRD_PARTY_NO_END_CLIENT`.

### 4.4 Jobs — 400

| Field | Spread |
|---|---|
| `provenance.sourceType` | 180 CONNECTOR · 90 AGGREGATOR · 95 USER_SUBMITTED · 35 MANUAL |
| `provenance.legalBasis` | matched correctly to each source type |
| `postedAt` | 240 within 7 days · 100 within 30 · 60 older |
| `applicantCount` | null on 120 (source doesn't expose it) · 5–400 on the rest |
| `allowedWorkAuth` | ~90 restricted to `['USC','GC']` — these must be filtered out for H1B candidates |
| `excludesC2C` | true on ~70 |
| `remoteMode` | 140 REMOTE · 160 HYBRID · 100 ONSITE |
| `dedupe.duplicateOfJobId` | ~25 jobs are marked duplicates of another |

Descriptions must be realistic length — 1,500–4,000 characters of actual JD prose with
requirements, not filler. Write 12 real templates and vary them; a 200-character description makes
the JD panel look broken.

### 4.5 Applications — ~320 with full event history

| Status | Count |
|---|---|
| SAVED | 45 |
| APPLIED | 95 |
| RESPONSE | 48 |
| SCREENING | 32 |
| INTERVIEW | 28 |
| OFFER | 9 |
| PLACED | 6 |
| REJECTED | 41 |
| WITHDRAWN | 8 |
| EXPIRED | 8 |

Every application carries the `ApplicationEvent[]` chain that produced its status, with plausible
gaps — 2–5 days to response, 3–10 more to screening. **The funnel chart and every stat block are
computed from these events**, so the numbers must be internally consistent.

### 4.6 Resumes and claims — the important one

Roughly 40 resumes, ~90 versions. Claim state distribution across all versions:

- **~78% VERIFIED** — each with a real `evidenceId` pointing at an actual `RecordEvidence` row
- **~18% UNVERIFIED** — each with a plain-English `reason`: *"No evidence on record for team size —
  needs candidate confirmation"*
- **~4% CONTRADICTED** — each with a contradiction reason: *"No certificate on file; candidate confirmed
  not held"*

**At least 6 resume versions must have unverified claims blocking export.** That gate is a core
interaction and it needs fixtures that exercise it.

ATS scores: 12 versions below 75 (failing), the rest 75–96. `atsIssues` populated with real
checks — semantic headings, tables detected, font count, image text, contact block.

Two versions should carry a `tracer` with non-zero `openCount`, so the "recruiter opened your
submission" signal has something to render.

### 4.7 Follow-ups

Derived from applications in `APPLIED` or later:

- **7 overdue** — drives the red section on the dashboard
- **11 due today**
- **26 upcoming**
- 4 snoozed, 3 cancelled

Split across the three BDEs so the role switcher shows different queues.

---

## 5. Simulating AI without calling an LLM

**No LLM calls in this repository.** Agent-driven features are simulated from fixtures with
realistic timing, so the loading, streaming, review and failure states all get built properly.

```ts
// src/mocks/handlers/agents.ts
http.post('/api/agents/tailor-resume', async ({ request }) => {
  const { resumeVersionId, jobId } = await request.json();

  // Long, variable, and occasionally failing — like the real thing
  await delay(Number(process.env.NEXT_PUBLIC_MOCK_AI_LATENCY_MS ?? 2500) + jitter(1200));

  if (seededRandom() < 0.05) {
    return HttpResponse.json(
      { error: 'AGENT_UNAVAILABLE', message: 'AI tailoring unavailable — edit manually.' },
      { status: 503 },
    );
  }

  return HttpResponse.json(tailoredDraftFor(resumeVersionId, jobId));
});
```

Rules for every simulated agent surface:

1. **Latency is 2–5 seconds, variable.** A 200ms response teaches you nothing about the waiting
   state, and the waiting state is most of the UX.
2. **5% failure.** Every agent surface must degrade to its manual path with an inline note — never
   a blank screen, never a 500 page. This is a hard product requirement, not a nicety.
3. **Output always lands in `UNVERIFIED`.** No simulated agent ever returns an `VERIFIED` claim. A human
   verifies it with evidence attached.
4. **Progress is real.** Multi-step agents (record extraction) emit staged progress:
   *Reading document → Extracting experience → Matching skills → Building draft.* Fake it on a
   timer, but show it — the real one will do the same.

Pre-written agent outputs live in `fixtures/agent-outputs.ts`, keyed by input, so the same job
always produces the same draft.

---

## 6. Deterministic seeding

```ts
// src/mocks/fixtures/_seed.ts
let state = 42;
export function seededRandom() {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state / 0x7fffffff;
}
export function resetSeed(s = 42) { state = s; }

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

/** Dates relative to now, so fixtures never go stale. */
export const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();
export const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString();
```

Call `resetSeed()` at the top of every fixture module so import order can't change the output.

---

## 7. Empty-state fixtures

A parallel set in `fixtures/empty.ts`, reachable via `?state=empty` on any route in development.
Empty states are half the screens in a new firm's first week and they are routinely shipped broken.

Cover: no candidates · no jobs · no applications · candidate with no Record · candidate with no
resumes · no follow-ups due · analytics with no data in the period · ledger with no entries.

---

## 8. Derived computation — worked example

```ts
// src/lib/derive/candidate-stats.ts
export function deriveCandidateStats(
  candidate: Candidate,
  applications: Application[],
): CandidateStats {
  const submitted = applications.filter(a => a.status !== 'SAVED');

  return {
    candidateId: candidate.id,
    status: candidate.status,
    applicationsSubmitted: submitted.length,
    distinctCompanies: new Set(submitted.map(a => a.companyNameAtApply)).size,
    distinctRoles: new Set(submitted.map(a => a.jobTitleAtApply)).size,
    responsesReceived: submitted.filter(a => a.firstResponseAt).length,
    interviewsScheduled: submitted.filter(a => a.interviewAt).length,
    offersReceived: submitted.filter(a => a.offerAt).length,
    applicationsOpen: submitted.filter(a =>
      ['APPLIED','RESPONSE','SCREENING','INTERVIEW','OFFER'].includes(a.status)).length,
    responseRatePct: submitted.length
      ? round1(100 * submitted.filter(a => a.firstResponseAt).length / submitted.length)
      : 0,
    daysOnBench: candidate.benchStartDate ? daysBetween(candidate.benchStartDate, new Date()) : 0,
    firstApplicationAt: minDate(submitted.map(a => a.appliedAt)),
    lastActivityAt: maxDate([...submitted.map(a => a.appliedAt), candidate.updatedAt]),
    isAtRisk: daysSinceLastActivity(candidate, applications) > 7,
    workAuthExpiringSoon: candidate.workAuthExpiry
      ? daysBetween(new Date(), candidate.workAuthExpiry) < 90
      : false,
  };
}
```

**Unit test every function in `src/lib/derive/`.** These produce the numbers a firm owner makes
decisions on — they are the least acceptable place for a silent bug, and they're pure functions, so
testing them is cheap.
