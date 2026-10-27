# CLAUDE.md — BenchQ Frontend

Instructions for Claude Code working in this repository. **Read this before any task.**

Visual baseline: `design.md` v3 (Sept 23, 2026) supersedes earlier visual specs — compact frosted
shell, white workspace, monospace tags, subtly raised gradient primary buttons, as shown at
`/dev/design-system`.

---

## Scope — read this first

**Current focus: connecting the modules to the backend, one track at a time.**

The UI is built (every screen renders) and the route tree, guards, layouts and permissions are final-shape for a
**multi-tenant** product with two tiers:

- **Platform tier** — `PLATFORM_ADMIN` (UI label "Super Admin"; BenchQ staff): onboards client
  firms, manages plans/seats, suspends firms, supports firms through a read-only support view,
  watches system health and AI spend. Lives under `/admin/…`.
- **Firm tier** — `OWNER` / `MANAGER` / `BDE` / `VIEWER`, scoped to one client firm (a recruiting /
  staffing company). Lives under `/[firm]/…`, where `[firm]` is the firm's slug.

**UI-first:** new screens may run on mocks, but URLs, the route registry, guards and the
permission policy are production structure from day one. Routes, roles and permissions are owned
by `docs/07-ROUTES-AND-RBAC.md`.

**Backend integration.** The backend is JobNavigator (FastAPI, Python) in `backend/`: per-user cookie sessions, auth on
every endpoint (`backend/auth/access.py`, 07 Q37–Q38), and `firm_id` on every firm-owned record. The foundation
(F1–F7 in `docs/integration/07-auth-and-tenancy.md` §3) is done. The module tracks (Ledger, Jobs, Candidates, then
Applications, Resumes, Analytics) are next; the backend has no candidates, evidence or claims yet. Start integration
work at `docs/integration/README.md`. How the team works (branches, reviews, migrations) is in `CONTRIBUTING.md`.

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
   | Candidate onboarding and the firm hierarchy (07 Q40–Q50) | `docs/candidate-onboarding/` |
   | Setup, and what to do when it fails | `README.md` Quick start, `docs/troubleshooting.md` |
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

Scripts are in `package.json`. Node 22+ (`.nvmrc`). The app signs in against the backend, so run
`docker compose up -d db backend` alongside `pnpm dev`. Setup and failures: `README.md` Quick start,
`docs/troubleshooting.md`.

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
- Bring back a mock sign-in, a client-side session store or a principal switcher (Q25: everyone signs in on
  `/sign-in`, and the session is the backend's cookie). The seeded demo accounts and the demo password are
  local data, not secrets to build on; the browser never decides who someone is.
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

> Update this section when a phase ends. Status lives in the board, decisions in the 07 docs.

**Foundation done (F1–F7, 2026-10-26).** The session, the team, invites, `/admin` and the ledger run on the
backend. Every other module runs on mock data under the real signed-in user. Phase B fix PRs 3–14 and Phase S
stay paused.

**Next:** the module tracks. Owners, order and dependencies: the board in `docs/integration/README.md`.

**Planned 2026-10-26: candidate onboarding and the firm hierarchy** (Q40–Q50: OWNER → MANAGER → BDE, BDE-only seats,
a five-step new-candidate flow). Modules 01–07 in `docs/candidate-onboarding/`; frontend 01–05 run on mocks, 06 is the
backend Candidates track (Zuhair).

**Decisions** (Q1–Q51: firm in the URL, one firm per user, read-only support view, seat and plan rules, invite
rules, the firm hierarchy) are in `docs/07-ROUTES-AND-RBAC.md` §0 and `docs/integration/07-auth-and-tenancy.md` §0 and §2. Open: nothing.
The system contracts in `docs/02` §3.2 are approved and not built.
