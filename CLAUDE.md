# CLAUDE.md — BenchQ Frontend

Instructions for Claude Code working in this repository. **Read this before any task.**

Visual baseline: `design.md` v3 (Sept 23, 2026) supersedes earlier visual specs — compact frosted
shell, white workspace, monospace tags, subtly raised gradient primary buttons, as shown at
`/dev/design-system`.

---

## Scope — read this first

**Current focus: production-grade routes and access control, then the Super Admin flow.**

The UI prototype is built (all screens render on mocks) and was demoed to leads. BenchQ is now
moving to a production app. Before more backend work, the route tree, guards, layouts and
permissions must be final-shape for a **multi-tenant** product with two tiers:

- **Platform tier** — `PLATFORM_ADMIN` (UI label "Super Admin"; BenchQ staff): onboards client
  firms, manages plans/seats, suspends firms, supports firms through a read-only support view,
  watches system health and AI spend. Lives under `/admin/…`.
- **Firm tier** — `OWNER` / `MANAGER` / `BDE` / `VIEWER`, scoped to one client firm (a recruiting /
  staffing company). Lives under `/[firm]/…`, where `[firm]` is the firm's slug.

**UI-first:** new screens may run on mocks, but URLs, the route registry, guards and the
permission policy are production structure from day one. Routes, roles and permissions are owned
by `docs/07-ROUTES-AND-RBAC.md`.

**Backend integration is paused after Module 01 (ledger).** The backend is JobNavigator (FastAPI,
Python) in `backend/`. It has per-user cookie sessions and auth on every endpoint
(`backend/auth/access.py`, 07 Q37–Q38), but its data is not firm-scoped yet, and it has no candidates,
evidence or claims. Modules 02–05 wait until tenancy (decisions D1/D2 in
`docs/integration/06-open-decisions.md`) is designed, because every firm-owned record will need
`firmId` scoping. Integration rules, when you do integration work, start at
`docs/integration/README.md`.

Each data module is served either by its mock (`src/mocks/`) or by the backend, decided **only** in
its adapter (`src/lib/api/<module>.ts`). Swapping a module to the backend must never require
rewriting a screen: map the backend's response to frontend types in a DTO mapper
(`src/lib/api/dto/`). If a screen must change, that's a product decision — stop and ask.

**Do not build in the frontend:** database code · Next.js API route handlers (the backend is
FastAPI, reached through the `next.config.ts` proxy) · LLM calls (the backend owns AI) ·
background workers · payments/Stripe (plans and seats are UI-only for now).

**Backend changes** belong to the backend owner. Make one only when a doc says so, or after asking.

---

## What BenchQ is

A multi-tenant B2B SaaS for US-focused IT staffing firms (beachhead: Hyderabad bench-sales
consultancies). The daily user is a **bench-sales recruiter (BDE)** working **6:30 PM – 12:30 AM
IST** to overlap US business hours, managing 5–10 candidates and submitting 20–30 applications per
candidate per day — today, all by hand.

Two core features drive every design decision:

1. **Time compression.** Cut the BDE's manual work. Every extra click is a real cost at 11pm on
   application forty.
2. **Total transparency.** The owner and manager can see exactly how many BDEs are working on how
   many applications, for how many candidates, at what stage, at any moment.

**Truth Guard (the product thesis):** AI drafts, humans verify. No claim is `VERIFIED` without
evidence, and nothing unverified is exported.

`product.md` has the full picture — the user, his night, the vocabulary, the constraints, the
principles for judgment calls. **Read it once at the start of a session.** When a spec doesn't
cover a case, it decides.

### Tenancy model (target)

- A **firm** is the tenant. Every firm-owned record carries `firmId`; data never crosses firms.
  `Company` is global reference data.
- **The firm is in the URL** (`/[firm]/…`). Pages read it from the URL via firm context, never
  from a store. A user belongs to exactly **one** firm.
- The session holds a **principal**: a firm user (`firmId` + `FirmRole`) or a platform admin.
  `PLATFORM_ADMIN` is **not** a `FirmRole`.
- A platform admin enters a firm only through a **read-only support view**: banner on every page,
  every action hidden, audited in the firm's own ledger. No impersonation, no writes.
- TanStack Query keys for firm data start with `firmId`, so cached data can't bleed between firms.

Details and the full route map: `docs/07-ROUTES-AND-RBAC.md`.

---

## Before you start any task

1. Find the phase the task belongs to (see **Current phase** at the bottom).
2. Read the doc that owns the area:

   | Area | Doc |
   |---|---|
   | Why, who for, vocabulary, judgment calls | `product.md` |
   | **Routes, navigation, roles, permissions, Super Admin area** | `docs/07-ROUTES-AND-RBAC.md` |
   | Stack, folders, routing conventions | `docs/01-FRONTEND-ARCHITECTURE.md` |
   | Types and shapes | `docs/02-DATA-CONTRACTS.md` |
   | Fixtures | `docs/03-MOCK-DATA.md` |
   | Layouts, states, keyboard map | `docs/04-SCREENS.md` |
   | Components and props | `docs/05-COMPONENTS.md` |
   | Original UI build phases (complete) | `docs/06-IMPLEMENTATION-PLAN.md` |
   | Connecting a module to the backend | `docs/integration/` |
   | Current repo state (generated snapshot) | `docs/CURRENT_STATE.md` |
   | Colour, type, spacing, motion | `design.md` |

3. **Do not work ahead into a later phase.** If a task needs something from a later phase, say so
   and stop.
4. Versions come from `package.json`, not from docs (the app is on Next.js 16: middleware is
   `src/proxy.ts`).

---

## Non-negotiable rules

### Routes and access
- `src/lib/routes/registry.ts` is the **only** place a route is described. Sidebar, ⌘K palette,
  `g`-shortcuts, titles, breadcrumbs, landing redirects and guards all derive from it. Never add a
  hardcoded route list or `href` string elsewhere — use `hrefFor()`.
- Every new `page.tsx` gets a registry entry with its `area` (public / firm / platform / dev) and
  access for every principal; the registry table test must cover it.
- **No new inline role checks** (`role ===`, `role !==`, ad-hoc `assignedUserIds.includes`).
  Use the permission policy / scope helpers (`docs/07` Phase C). Existing inline checks are being
  removed, not copied.
- Forbidden route → Forbidden screen in place, no redirect. Unknown firm, a firm the user doesn't
  belong to, a record outside their scope, or `/admin` for a non-admin → not-found (never confirm
  existence).
- Client-side guards are UX, not security. Real enforcement is server/backend (`docs/07` Phase D).
  Never describe a client guard as protection.
- Filters, tabs and pagination live in the URL, parsed with Zod.

### Design tokens
`design.md` is the single source of truth for colour, type, spacing and motion.
**Never hardcode a hex value, a px font size, or a raw spacing number.** Everything comes from the
Tailwind theme tokens. If a token you need doesn't exist, propose adding it — don't inline a value.

### Light is the default
Light renders first; dark is the option. Both must work, always — the product is used at night for
six hours, so dark sees heavy use. Test every component in both before reporting done.

### The three claim states
`VERIFIED` / `UNVERIFIED` / `CONTRADICTED` are the product's core concept.

- Always render **label + icon + colour**, never colour alone.
- `VERIFIED` uses the brand colour — evidence-backed, cleared to send.
- `UNVERIFIED` is grey with a dashed border — drafted, no evidence yet, needs review.
- `CONTRADICTED` is red with a line-through — contradicts the evidence, never ships.
- A resume with any `UNVERIFIED` claim **cannot be exported.** The export button is blocked with a
  message naming the count and a jump-to-claim link.

### Every number is derived
Dashboard and stat counters are computed from event arrays, never stored as literals. A fixture
saying `applicationsSubmitted: 42` is a bug — it must be `applications.filter(...).length`. This
applies to the Super Admin area too (seat usage, firm counts, AI spend totals).

### No mouse required
Every primary action has a keyboard path. `⌘K` opens the command palette. `J`/`K` move through
lists, `Enter` opens, `Esc` goes back. Full map in `docs/04-SCREENS.md`.

### Three states, always
Every list, panel and data surface ships with **skeleton**, **empty** and **error** states; detail
routes also have **not-found**. A component that only handles the happy path is incomplete.

---

## Conventions

**TypeScript** — `strict: true`. No `any`. No `@ts-ignore`. Zod schemas in `src/lib/schemas/` are
the source of truth; infer types from them, don't write parallel interfaces. New entities (firm,
plan, invite, platform user) need a contract in `docs/02-DATA-CONTRACTS.md` **before** a schema —
that needs product sign-off.

**React** — Server Components by default; `'use client'` only for state, effects or browser APIs.
Data through TanStack Query hooks (`src/lib/hooks/`) against adapters in `src/lib/api/` — never
call an adapter, `fetch`, a mock or a JSON fixture from a component. The only `fetch` in the app is
in `src/lib/api/http.ts`.

**Naming** — files `kebab-case.tsx`, components `PascalCase`, hooks `use-thing.ts`. Booleans read
as assertions: `isActive`, `hasEvidence`, `canExport`.

**Styling** — Tailwind v4 utilities. `cn()` from `src/lib/utils.ts` for conditional classes. No CSS
modules, no styled-components, no inline `style` except computed dimensions.

**Components** — shadcn/ui primitives in `src/components/ui/`, edited in place. Domain components
in `src/components/app/`; route infrastructure in `src/components/routes/`. Split components over
~200 lines.

**Accessibility** — WCAG 2.1 AA. Visible focus ring on everything interactive. `axe` clean.
Respect `prefers-reduced-motion`.

**Work size** — small PRs, one concern each. Report against the doc's exit criteria when done.

---

## Commands

Node 22+ (`.nvmrc`); Vitest won't start on older Node. On Apple silicon, `node -p process.arch`
must print `arm64`.

```bash
pnpm dev          # dev server (reads .env.local)
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest
docker compose up -d db backend   # backend + Postgres (only for integration work)
```

---

## Definition of done

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` clean
- [ ] Renders correctly in **both** themes
- [ ] Fully keyboard operable
- [ ] Skeleton, empty, error (and not-found for detail routes) states present
- [ ] New routes registered in the registry and covered by the table test; guard checked for each
      principal, signed in as each seeded account (firm roles, second firm, platform admin, support view)
- [ ] No inline role checks added; no hardcoded hrefs
- [ ] No hardcoded colours, sizes or spacing; no `any`, no `@ts-ignore`
- [ ] Works at 1440px, 1024px and 390px
- [ ] `axe` reports no violations

---

## Things you must not do

- Make a network call outside `src/lib/api/http.ts`, or let a backend (snake_case) shape escape
  `src/lib/api/dto/`.
- Edit `src/lib/schemas/` to fit the backend — map to it, or stop and ask.
- Add a new entity, field or contract without product sign-off.
- Call an LLM from the frontend, or hardcode AI-generated text in a component.
- Hardcode a colour, font size, spacing value, route list or href.
- Produce a `VERIFIED` claim — in mock data or a mapper — without an `evidenceId`.
- Bypass the export gate on resumes with unverified claims.
- Store a derived counter as a literal.
- Treat the mock sign-in, the seeded accounts, the demo password or the client session store as
  security (they are mock auth until Phase D), or bring back a principal switcher (Q25: everyone signs
  in on `/sign-in`).
- Give a platform admin any write path into a firm, or read the current firm from anywhere but the
  URL.
- Add a dependency without checking `docs/01-FRONTEND-ARCHITECTURE.md §3`.
- Use emoji as UI iconography — use the icon set in `docs/05-COMPONENTS.md`.

---

## When you're unsure

Stop and ask. Especially for: the claim-state model, data contracts, tenancy (firms, users, roles),
anything in `docs/integration/06-open-decisions.md` or the open questions in
`docs/07-ROUTES-AND-RBAC.md`, a backend change, or a contradiction between two docs.

A stopped task with a clear question beats a confident wrong implementation.

---

## Current phase

> **Update this section as you progress.** It's the first thing the next session reads.

**Phase: Backend auth + tenancy, onboarding first** (`docs/integration/07-auth-and-tenancy.md` §3, reordered by
07 Q38 on 2026-10-21). F1 (Alembic, tests on Postgres) and 0002 are merged; CI runs on every PR into
`codex/json-data-migration`. **Next:** the onboarding flow on the real backend, in seven PRs: tables · sign-in and
auth on every endpoint · policy table · Super Admin firms + invites · OWNER member invites · first-admin command
and demo seed · frontend cut-over. Phase B fixes stay **paused after fix PR 2 (#27)**. Repo snapshot:
`docs/CURRENT_STATE.md` (2026-10-19, predates Phase B).

| Step | Status |
|---|---|
| UI build phases 0–8 (`docs/06`) — all screens on mocks | Done |
| Integration Module 00 Part A — backend in repo, proxy verified | Done |
| 07 Phases A, A2, T0 — registry, guards, access/error screens, `hrefFor`, route groups, no `/sign-up` | Done |
| 07 Phase T — tenancy in the frontend: approved contracts, `Principal` session, `/[firm]` URLs, firm-scoped mocks and query keys | Done (exit check in 07) |
| Dashboard error states (docs/04 §13) | Done (#10) |
| 07 Phase L — sign-in with seeded accounts, no principal switcher, session shared across tabs | Done (#16) |
| Demo data persists in the browser; "Reset demo data" on `/admin/system` (docs/03 §3.3) | Done (#17) |
| 07 Phase P — `/admin/*` screens, invites and `/invite/[token]`, read-only support view, ⌘K for admins, platform tests | Done (#12, #13, #18, #20, #21; exit check in 07) |
| `docs/CURRENT_STATE.md` regenerated | Done (2026-10-19) |
| 07 Phase C — the permission policy (firm, team and platform actions, `<Can>`, route access via `can`, full principal × action table test, exit grep) | Done (#23) |
| 07 Phase B — UI completion audit (`docs/AUDIT-PHASE-B.md`) | Audit done (#24, #25). Fix PRs 1–2 done (#26 real create, #27 read-only leaks + `JobMark`); **PRs 3–14 paused** (2026-10-21), list unchanged |
| **Backend auth + tenancy** (`docs/integration/07-auth-and-tenancy.md`): decisions D1–D4, D2, sessions, jobs pool (Q37); onboarding first (Q38) | F1 + 0002 done (#29, #30), CI (#31); **onboarding PRs 1–7 next** |
| 07 Phase S — Super Admin flow polish (UI-first), including building `/admin/system` and AI spend from docs/02 §3.2 | Planned, after B resumes |
| 07 Phase M — firm-side invite flow (OWNER invites members) | Backend side in the onboarding PRs (Q38); UI with the frontend cut-over |
| System contracts (`HealthCheck`, `ScraperRun`, `AiUsage`, docs/02 §3.2) | Approved (Q33, Q34), not built — built in Phase S |
| Module tracks (01 Ledger, 02 Jobs, Candidates, Admin API, then 03 Applications, 04 Resumes + claims, 05 Analytics) and 07 Phase D | After foundation F7 (`docs/integration/README.md` board) |

**Decided (07 §0):** firm in the URL (Q8); one firm per user (Q9); read-only support view, no
impersonation (Q10); role name `PLATFORM_ADMIN`, label "Super Admin" (Q7); invite-only, no public
sign-up (Q11); no role in URLs — route groups `(workspace)` / `(manage)` plus per-role view files
(Q14); only OWNER manages members, MANAGER reads the team and assigns candidates (Q15).
**Contracts approved 2026-10-14 (07 §0 Q16–Q21; shapes in `docs/02` §3.1):** seat = every active user
plus pending invites; active candidate = `ON_BENCH` / `INTERVIEWING` / `OFFER`; a plan is a template whose
limits are *copied* onto the firm; over a limit, block new additions and never auto-remove; slug rules
and `contactPhone` only on `Firm`; invites last 7 days, exactly one OWNER per firm, `firmId` null ⇔
`PLATFORM_ADMIN`; support view is 60 minutes with no extension; firm events carry `firmId`; no
`PlanChange` entity; agent and tailoring runs are firm-scoped.
**Since then:** slug-less URLs are not-found (Q22); Phase M comes after S (Q23); a resend logs another
`INVITE_SENT` "Invite resent to …" (Q24); everyone signs in on `/sign-in` with seeded accounts, no
principal switcher (Q25); `/invite/[token]` belongs to P4 (Q26); the session is shared across tabs (Q27);
an invite to a SUSPENDED firm is blocked and stays PENDING (Q28); the Super Admin decisions of docs/04
§14.11 — `/admin/system` placeholder, custom limits, view an empty ONBOARDING firm, suspend ACTIVE only,
stalled onboarding at 7 days, over-limit block visible-disabled-with-reason (§0's second exception) (Q29);
"custom limits" derived from the ledger, (de)activation logs `STATE_CHANGE`, lowercase entity types (Q30);
`Invite.inviteeName` (Q31); a Phase C slice came into P4 (Q32); system contracts' first answers — USD
micro-dollars, reportable health checks only, firm attachment, retention (Q33); the rest — health history
with 7/30-day uptime, backend pricing, the AI purpose list, spend Super Admin only, no budgets yet, IST
periods, billed failed calls count (Q34).
**Since then (2026-10-21):** backend auth decisions (Q37); onboarding on the real backend first, auth on every
endpoint, the shared key removed in PR 2, invite links shown once, seat rule for suspended firms, table conventions (Q38).
**Still open:** nothing. docs/02 §3.2 is approved, not built.
