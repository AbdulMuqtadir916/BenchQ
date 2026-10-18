# Current state

Factual snapshot of the frontend. Read-only inventory; no code was changed to produce it.
Anything not confirmed is marked **(unverified)**.

| | |
|---|---|
| Date | 2026-10-13 |
| Branch / HEAD | `feat/routes` @ `a2dffee` ("Add routes and RBAC plan with recorded decisions") |
| Working tree | **Phase A is uncommitted**: 39 `git status` entries (17 modified tracked files, 22 untracked; includes `CLAUDE.md`, this file and `docs/ruflo-setup.md`). HEAD contains only the plan. |
| Read for this snapshot | `CLAUDE.md` (current on-disk version), `docs/07-ROUTES-AND-RBAC.md`, then the code |
| Not read | `.env.local` (access denied by the session; live-module setting is therefore unverified) |

> **Changed since this snapshot (Phase A2, branch `feat/routes-a2`):** `hrefFor(id | route, params, query)` and
> `useHref()` now exist and no path literals remain outside `src/lib/routes/` (section 2 item 6 and
> section 9 firm-routing blocker 4 are resolved); `FirmRole` has one declaration, the Zod enum
> (section 3, section 4); `useRouteAccess` fails closed for unregistered paths (section 2 item 8);
> the RoleSwitcher renders only when `NEXT_PUBLIC_SHOW_DEV_TOOLS=true` (section 4); `/design-system`
> is now `/dev/design-system` (section 2); the `iconsax-react` comment is fixed (section 8). The
> test suite is now 54 tests across 4 files. Everything else below is unchanged.

---

## 1. Stack

Versions are the ranges in `package.json`; resolved versions are in `pnpm-lock.yaml` (not inspected).

| Area | Package | Version |
|---|---|---|
| Framework | `next` | 16.3.5 (webpack: `next dev --webpack`, `next build --webpack`) |
| UI runtime | `react`, `react-dom` | 19.2.8 |
| Server state | `@tanstack/react-query` (+ `-devtools`) | ^5.103.1 |
| Client state | `zustand` | ^5.0.15 |
| Validation | `zod` | ^4.6.5 |
| Styling | `tailwindcss`, `@tailwindcss/postcss` | ^4 |
| Language | `typescript` | ^5 (`strict`, `allowJs`) |
| Tables / virtual | `@tanstack/react-table` ^8.21.3, `@tanstack/react-virtual` ^3.14.13 | |
| Motion / theme / icons | `motion` ^13.4.0, `next-themes` ^0.4.6, `lucide-react` ^1.47.0 | |
| Misc | `@dnd-kit/core`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `date-fns`, `date-fns-tz`, two `@fontsource-variable` fonts | |
| Lint | `eslint` ^9, `eslint-config-next` 16.3.5, `@tanstack/eslint-plugin-query` ^5.103.1 | |
| **Test tools** | **`vitest` ^3.2.7 only** | no Testing Library, jsdom, MSW, Playwright or axe in `package.json` |

| Runtime | Value |
|---|---|
| Node | `engines.node` ">=22"; `.nvmrc` = 22; this machine ran v24.21.0 (`arm64`) |
| pnpm | `packageManager` = `pnpm@12.5.1`; `pnpm` was not on PATH here, `corepack pnpm` (12.5.1) worked |
| Scripts | `dev`, `build`, `start`, `lint` (`eslint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`) |
| Source size | 246 `.ts`/`.tsx` files under `src/` |

---

## 2. Route tree

Source of truth for what exists: `src/app/**`. Route groups: `(app)`, `(studio)`. Parallel slot: `(app)/@modal`. Intercepting: `(app)/@modal/(.)candidates/new`, `(app)/@modal/(.)jobs/capture`.

| Route | Files | Shell |
|---|---|---|
| `/` | `src/app/page.tsx` (redirects to `/dashboard`) | none |
| `/sign-in`, `/sign-up` | `sign-in/page.tsx`, `sign-up/page.tsx` | auth |
| `/welcome` | `welcome/page.tsx`, `welcome/layout.tsx` (wraps `RouteGuard`) | auth |
| `/dashboard` | `(app)/dashboard/page.tsx` | app |
| `/candidates`, `/candidates/new`, `/candidates/[id]` | `(app)/candidates/{page,new/page,[id]/page}.tsx` | app |
| `/jobs`, `/jobs/capture`, `/jobs/[id]` | `(app)/jobs/{page,capture/page,[id]/page}.tsx` | app |
| `/applications`, `/applications/[id]` | `(app)/applications/{page,[id]/page}.tsx` | app |
| `/resumes` | `(app)/resumes/page.tsx` | app |
| `/resumes/[id]` (incl. `new`) | `(studio)/resumes/[id]/page.tsx`; `id === "new"` handled at line 17 | studio |
| `/outreach`, `/followups`, `/analytics`, `/ledger` | `(app)/<name>/page.tsx` | app |
| `/focus` | `focus/page.tsx`, `focus/layout.tsx` (wraps `RouteGuard`) | focus |
| `/settings` (redirect index), `/settings/{firm,team,templates,preferences}` | `(app)/settings/{page,layout}.tsx`, `(app)/settings/<section>/page.tsx` | app |
| `/design-system` | `(app)/design-system/page.tsx` (`devRoutesEnabled()` else `notFound()` at line 53) | app |
| Modal intercepts | `(app)/@modal/(.)candidates/new/page.tsx`, `(app)/@modal/(.)jobs/capture/page.tsx`, `(app)/@modal/default.tsx` | modal over app |

Special files:

| File | Present |
|---|---|
| `layout.tsx` | `app/`, `(app)/`, `(studio)/`, `focus/`, `welcome/`, `(app)/settings/` |
| `template.tsx` | `(app)/template.tsx` (wraps `PageTransition`) |
| `loading.tsx` | `(app)/loading.tsx` only |
| `error.tsx` | `(app)/error.tsx`, `(studio)/error.tsx` |
| `not-found.tsx` | `app/not-found.tsx`, `(app)/not-found.tsx` |
| `global-error.tsx` | `app/global-error.tsx` |
| `forbidden.tsx` | absent (Phase D in 07) |
| `route.ts` (API handlers) | none (matches the "no API routes" rule) |
| `proxy.ts` / `middleware.ts` | none (see section 4) |

Guard wiring: `RouteGuard` (`src/components/routes/route-guard.tsx`) wraps children in `components/layout/app-shell.tsx:36`, `(studio)/layout.tsx`, `focus/layout.tsx`, `welcome/layout.tsx`. Client-side only.

### Differences from `docs/07` §2 and "What Phase A delivered"

| # | Finding |
|---|---|
| 1 | `/invite/[token]` is in 07 §2 and A6 but **does not exist** (no page, no registry entry). `CLAUDE.md` also records this as the open Phase A item. |
| 2 | `/admin` is in 07 §2 as "deferred (Q5)": absent, as designed. `CLAUDE.md` now says Q5 is to be reopened. |
| 3 | Every file in the "What Phase A delivered" table exists on disk (checked by path). Behaviour (role × route outcomes, themes, widths, axe) is **(unverified)**; I did not run the app. |
| 4 | All Phase A exit-criteria checkboxes in 07 (lines 208–213) are still unticked, although the status line says "Phase A done except `/invite/[token]`". |
| 5 | Files present but not named in 07: `(app)/template.tsx`, `(app)/@modal/default.tsx`. |
| 6 | 07 A2 and `CLAUDE.md:110` say to use `hrefFor()`. **`hrefFor` is not exported by `registry.ts` and exists nowhere in `src/`.** See section 9. |
| 7 | The 07 Phase B gap "Ledger: BDE sees only own actions" is still open (no role filter in `ledger/page.tsx`); the dangling `·` when `promptVersion` is null is still at `ledger/page.tsx:75`. |
| 8 | `useRouteAccess` (`src/lib/routes/use-route-access.ts`) treats unregistered paths as `"full"`; the real unknown-URL handling is Next's `not-found.tsx`. |

---

## 3. Registry

`src/lib/routes/registry.ts`

```ts
export type Access = "full" | "assigned" | "own" | "read" | "none";
export type RoleAccess = Record<FirmRole, Access>;

export interface RouteDef {
  id: string;
  path: string;                                  // app-folder syntax, route groups removed
  title: string;
  shell: "auth" | "app" | "studio" | "focus";
  access: RoleAccess | "public";
  onDenied?: "forbidden" | "landing";            // default: Forbidden screen in place
  nav?: { section: "workspace" | "preferences" | "settings"; order: number; icon?: LucideIcon };
  shortcut?: string;                             // second key of a `g` shortcut
  palette?: boolean;
  devOnly?: boolean;
}
```

`FirmRole` is declared at `src/lib/stores/session-store.ts:11`: `"OWNER" | "MANAGER" | "BDE" | "VIEWER"`. A **second** declaration exists as a Zod enum at `src/lib/schemas/enums.ts:8` (same four values).

**Route ids (26):** `root`, `sign-in`, `sign-up`, `welcome`, `dashboard`, `candidates`, `candidates.new`, `candidates.detail`, `jobs`, `jobs.capture`, `jobs.detail`, `applications`, `applications.detail`, `resumes`, `resumes.studio`, `outreach`, `followups`, `analytics`, `ledger`, `focus`, `design-system`, `settings`, `settings.firm`, `settings.team`, `settings.templates`, `settings.preferences`.

**Exports:** `ROLES`, `ROUTES`, `routeById`, `devRoutesEnabled`, `matchRoute`, `accessFor`, `canOpen`, `navFor`, `paletteRoutesFor`, `shortcutsFor`, `landingFor`. Companion: `scope.ts` (`isInScope`, `ScopedRecord`), `use-route-access.ts` (`useRouteAccess`). Every helper is typed on `FirmRole`.

**Tests** (`src/lib/routes/registry.test.ts`, 7 tests):

| Test | What it asserts |
|---|---|
| has an entry for every page, and a page for every entry | `ROUTES` paths equal the `page.tsx` paths found on disk; skips `@slot` and `(.)` intercepting dirs |
| has unique ids and paths | no duplicates |
| gives every role a landing route it can open | `landingFor(role)` matches a route that `canOpen` |
| prefers static segments over dynamic ones | `matchRoute` cases such as `/candidates/new`, `/resumes/new`, `/nope` |
| matches the access table in docs/07 | 7 spot checks (e.g. BDE cannot open analytics; welcome `onDenied` is `landing`), **not** the full table |
| only shows nav items a role can open | `navFor` for BDE, VIEWER, MANAGER |
| record scope: applies assigned and own scopes | `isInScope` for `assigned`, `own`, `read`, `none` |

Note: "access defined for every role" (`CLAUDE.md:111`) is enforced by the TypeScript type `Record<FirmRole, Access>`, not by the test.

---

## 4. Session and roles

`src/lib/stores/session-store.ts` (Zustand, `"use client"`):

| Item | As written |
|---|---|
| `SessionUser` | `{ id, name, email, role: FirmRole, avatarUrl: string \| null }`, **no `firmId`**, no `isActive` |
| `SessionFirm` | `{ id, name, primaryTimezone, clientTimezone }` (separate from `FirmSchema`) |
| State | `{ user, firm, setRole(role) }` |
| Initial values | hard-coded `DEFAULT_USER` (`user_adnan`, role `BDE`) and `DEFAULT_FIRM` (`firm_hts`) inside the store file |
| `setRole` | replaces `user.role` on the same user; the user id does not change |

Where `firmId` lives: only on the **Zod** `UserSchema` (`src/lib/schemas/session.ts:18`) and fixtures. The runtime store's `SessionUser` has no `firmId`; it carries a separate `firm.id`.

Other session facts:

| Topic | Finding |
|---|---|
| Parallel types | `SessionUser` (store) vs `User` (`schemas/session.ts:16`, adds `firmId`, `isActive`, `lastActiveAt`): two shapes for one concept. `CLAUDE.md` says to infer types from Zod. |
| Session API | `src/lib/api/session.ts` exists; **no consumer** of `sessionApi` was found in `src/`. The store's header comment says a fixture session "is loaded on mount"; no such loader was found **(unverified)**. |
| `SessionSchema` | `{ user, firm, seatsUsed, seatLimit, activeCandidates, candidateLimit }` (`schemas/session.ts:28`); the mock fills `seatLimit` 10 and `candidateLimit` 100 as literals (`src/mocks/session.ts`) |
| RoleSwitcher | `src/components/dev/role-switcher.tsx`, rendered in `components/layout/topbar.tsx:14`. Dropdown of the four roles; calls `setRole`. Visible **unless `NEXT_PUBLIC_SHOW_ROLE_SWITCHER === "false"`**, so it is on by default, also in production builds. Not listed in `.env.example`; mentioned in `docs/01-FRONTEND-ARCHITECTURE.md:238,267`. |
| Role change | `RouteGuard` calls `queryClient.invalidateQueries()` when the role changes (`route-guard.tsx:29-33`) |
| `proxy.ts` / middleware | **none** (`src/proxy.ts`, `src/middleware.ts`, `middleware.ts`, `proxy.ts` all absent). `CLAUDE.md` says Next 16's middleware is `src/proxy.ts`; Phase D in 07. |
| Server-readable session | none; no cookie handling in the frontend |
| Fixtures | `src/mocks/data/firm.json`: one firm (`firm_hts`) and 5 users: 1 OWNER (`user_imran`), 1 MANAGER (`user_fatima`), 3 BDE (`user_adnan`, `user_sneha`, `user_vikram`). **No VIEWER user**; VIEWER is reachable only through the switcher. |

---

## 5. Remaining inline role checks and BDE filters

Greps: `role ===`, `role !==`, `assignedUserIds.includes`, `submittedByUserId ===`. Line numbers are as of this snapshot.

**`user.role !== "VIEWER"`: 11 occurrences in 11 files** (07 says 11; matches)

| File:line | Use |
|---|---|
| `src/app/(app)/candidates/[id]/page.tsx:41` | `canAct` |
| `src/app/(app)/candidates/page.tsx:157` | `canCreate` |
| `src/app/(app)/resumes/page.tsx:21` | `canEdit` |
| `src/app/(app)/applications/page.tsx:63` | `canAct` prop |
| `src/app/(app)/applications/[id]/page.tsx:88` | gates the "next stage" control |
| `src/app/(app)/followups/page.tsx:49` | `canAct` |
| `src/app/(app)/jobs/page.tsx:52` | gates an action |
| `src/app/(app)/jobs/[id]/page.tsx:56` | `canAct` |
| `src/app/(app)/outreach/page.tsx:34` | `canAct` |
| `src/components/app/resume-studio/open-resume.tsx:96` | `canEdit` |
| `src/components/app/resume-studio/new-resume.tsx:65` | `canEdit` |

**BDE data filters: 8** (07 lists 8; matches)

| File:line | Filter |
|---|---|
| `src/app/(app)/candidates/page.tsx:85,92` | `isBde` → `assignedUserIds.includes(user.id)` |
| `src/app/(app)/jobs/page.tsx:32` | `assignedUserIds.includes` |
| `src/app/(app)/jobs/[id]/page.tsx:49` | `assignedUserIds.includes` |
| `src/app/focus/page.tsx:24` | `assignedUserIds.includes` |
| `src/components/app/resume-studio/new-resume.tsx:52` | `assignedUserIds.includes` |
| `src/app/(app)/applications/page.tsx:42` | `submittedByUserId === user.id` |
| `src/app/(app)/outreach/page.tsx:43` | `submittedByUserId === user.id` |
| `src/app/(app)/followups/page.tsx:47` | `useFollowups(user.role === "BDE" ? user.id : undefined)` |

**Other role comparisons**

| File:line | Use |
|---|---|
| `src/app/(app)/candidates/[id]/page.tsx:117` | `showOwner={role === MANAGER \|\| OWNER}` |
| `src/app/(app)/dashboard/page.tsx:15-17` | picks BDE / Owner / Manager dashboard |
| `src/app/(app)/analytics/page.tsx:67` | BDE empty-state branch (07 says delete it; now unreachable) |
| `src/components/app/dashboard/manager-dashboard.tsx:23` | title by role |
| `src/app/(app)/settings/team/page.tsx:39` | tag tone by role (presentational) |
| `src/lib/derive/bde-performance.ts:17` | `u.role === "BDE"` over the user list (data derivation) |

**`assignedUserIds.includes` that are not role-gated filters** (derivations and the scope helper): `components/app/dashboard/bde-dashboard.tsx:40`, `lib/derive/bde-performance.ts:19`, `lib/derive/dashboard.ts:27`, `lib/routes/scope.ts:15`.

**Record-scope helper in use** (`isInScope` → not-found): `candidates/[id]/page.tsx:106`, `applications/[id]/page.tsx:68`, `components/app/resume-studio/open-resume.tsx:39`.

No permission-policy module exists yet (`src/lib/auth/permissions.ts`, `useCan`, `<Can>` absent): Phase C not started.

---

## 6. Firm / tenant model

| Entity | Schema / contract | Status |
|---|---|---|
| Firm | `FirmSchema` (`schemas/session.ts:4`): `id, name, slug, logoUrl, primaryTimezone, clientTimezone, truthGuardMode, applicationExpiryDays` | exists; **no** status/suspended, plan, or created date |
| User | `UserSchema` (`schemas/session.ts:16`): `id, firmId, name, email, role, avatarUrl, isActive, lastActiveAt` | exists |
| TeamMember | none; the team list is `User[]` (`src/mocks/team.ts`, `use-team.ts`) | no separate entity |
| Invite | none | **absent** |
| Plan | none | **absent** |
| Seat | only counters inside `SessionSchema`: `seatsUsed`, `seatLimit`, `activeCandidates`, `candidateLimit` | no Seat entity |
| Platform user / SUPER_ADMIN | none. Related: `LedgerEntrySchema.actorType` includes `"PLATFORM_ADMIN"` (`schemas/analytics.ts:66`) and the action `ADMIN_ACCESS` (`:81`) | no platform role on the session |

**`firmId` on records** (grep over all of `src/lib/schemas`):

| Record | `firmId`? |
|---|---|
| Candidate | **yes**: `schemas/candidate.ts:41`; all 24 fixtures carry `firm_hts` |
| User | yes (`schemas/session.ts:18`) |
| Job | no (400 fixtures) |
| Application | no (320) |
| Resume | no (36) |
| LedgerEntry | no (100) |
| Record (candidate record), Document, Company, Inbox, Agent | no |

(A naive `grep firmId` also matches `confirmId` in `components/app/candidate/documents/document-list.tsx`; those are unrelated.)

`src/mocks/data/firm.json` shape: `{ firm: { id, name, slug, logoUrl, primaryTimezone, clientTimezone, truthGuardMode, applicationExpiryDays }, users: [ {…} ×5 ] }`. One firm only.

Naming: `docs/07` and `docs/02` and the schemas say `PLATFORM_ADMIN`; `CLAUDE.md` says `SUPER_ADMIN`.

---

## 7. Data layer

| Layer | Finding |
|---|---|
| Only `fetch` | `src/lib/api/http.ts:62` (the other `fetch(` greps are `refetch(`). Compliant with the rule. |
| Adapters | 12 files in `src/lib/api/`: `agents, analytics (ledger), applications, candidates, companies, documents, inbox, jobs, records, resumes, session, team`. **All 12 dynamically import `@/mocks/…`.** |
| Live switch | `src/lib/api/config.ts`: `isLive(module)` reads `NEXT_PUBLIC_LIVE_MODULES`; `ApiModule` has 13 names (`session, team, candidates, companies, jobs, records, resumes, applications, followups, documents, inbox, ledger, agents`). **No adapter calls `isLive` yet.** |
| Live modules | **None, by code.** The env value in `.env.local` was not read **(unverified)**, but it has no effect while no adapter checks it. Matches `docs/integration/README.md:215-216`: Module 00 "In progress, Part A done", Module 01 "Not started". |
| Backend proxy | `next.config.ts` rewrites `/api/:path*` and `/health` to `BACKEND_URL` when set |
| DTO mappers | `src/lib/api/dto/shared.ts` (+ `shared.test.ts`) only |
| Mocks | `src/mocks/*.ts` plus JSON in `src/mocks/data/`: applications, candidates, companies, documents, firm, followups, inbox, jobs, ledger, records, resumes |
| Hooks | `src/lib/hooks/`: `use-agents, use-applications, use-candidates, use-companies, use-documents, use-inbox, use-jobs, use-ledger, use-records, use-resumes, use-team` (+ `use-keyboard-shortcuts`). There is no session hook. |
| Env | `.env.example`: `BACKEND_URL`, `NEXT_PUBLIC_LIVE_MODULES`, `NEXT_PUBLIC_MOCK_DELAY_MS`, `NEXT_PUBLIC_SHOW_DEV_ROUTES`, `NEXT_PUBLIC_DEFAULT_CANDIDATE_ID` |

**Query keys** (literal arrays inside each hook; no key factory, **none include `firmId`**):

| Hook file | Keys |
|---|---|
| `use-candidates.ts` | `["candidates"]`, `["candidate", id]` |
| `use-jobs.ts` | `["jobs", params]`, `["job", id]` |
| `use-applications.ts` | `["applications", { candidateId }]`, `["application", id]`, `["followups", { userId }]`, invalidations `["applications"]` |
| `use-resumes.ts` | `["resumes"]`, `["resumes", candidateId]`, `["resume", id]` |
| `use-records.ts` | `["record", candidateId]` |
| `use-companies.ts` | `["companies"]`, `["company", id]` |
| `use-team.ts` | `["team"]` |
| `use-ledger.ts` | `["ledger", params]` |

---

## 8. Quality

Run on the current working tree on 2026-10-13.

| Check | Result |
|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | **exit 0**, no diagnostics |
| `pnpm lint` (`eslint`) | **exit 0**, no diagnostics |
| `pnpm test` (`vitest run`) | **exit 0**: 3 files, 19 tests passed (`api/dto/shared.test.ts` 7, `routes/registry.test.ts` 7, `derive/derive.test.ts` 5), about 0.4 s |
| `pnpm build` | exit 0 earlier today on the same Phase A tree (not re-run for this snapshot). One CSS warning: `::highlight(bq-ai-pending)` is not recognised by the CSS optimiser (app code, unrelated to routes). |

Not covered by any automated check: component rendering, role × route outcomes, themes, responsive widths, axe. There is no component, e2e or accessibility test tooling in `package.json`. No CI configuration exists (`.github/workflows` absent).

Stale comment: `next.config.ts` mentions `iconsax-react`; the project uses `lucide-react`.

---

## 9. Blockers

### Adding a platform tier (`/admin`)

| # | Blocker |
|---|---|
| 1 | **No platform role.** `CLAUDE.md` says `SUPER_ADMIN` must not be a `FirmRole`, but every helper (`accessFor`, `canOpen`, `navFor`, `paletteRoutesFor`, `shortcutsFor`, `landingFor`, `useRouteAccess`, `RouteGuard`) and `RouteDef.access` (`RoleAccess = Record<FirmRole, Access>`) are typed on `FirmRole`. Adding a second role axis changes the registry types and all of those callers. |
| 2 | **Session has no platform identity.** `SessionUser` has one `role: FirmRole`; the store has one fixed firm. Needs a separate platform-role field and a way to represent "no firm". |
| 3 | **Naming conflict:** `PLATFORM_ADMIN` (07, 02, schemas) vs `SUPER_ADMIN` (`CLAUDE.md`). Needs a decision before any schema or registry change. |
| 4 | **No contracts or schemas** for Plan, Seat/entitlements, Invite, platform user, or firm status (suspended). `CLAUDE.md` requires a contract in `docs/02-DATA-CONTRACTS.md` and product sign-off first. |
| 5 | **Registry/shell gaps:** `shell` has no admin value; nav `section` is only `workspace \| preferences \| settings`; `landingFor` knows only `/dashboard` and `/settings/preferences`. |
| 6 | **Open product decisions** (listed in `CLAUDE.md`): support access by impersonation vs read-only view; firm in URL vs session; multi-firm membership. No banner or audit path exists, though the ledger schema already has `PLATFORM_ADMIN` and `ADMIN_ACCESS`. |
| 7 | **Guards are client-only.** No server session, no `proxy.ts`, no `forbidden.tsx`. An `/admin` area protected only by a client store is UX, not security (07 Phase D, backend D1/D2). |
| 8 | Registry test parity (page ↔ entry) will fail until entries exist, which is the intended safety net; the spot-check table test must also be extended. |

### Firm-scoped routing and data

| # | Blocker |
|---|---|
| 1 | **`firmId` exists only on Candidate and User.** Job, Application, Resume, LedgerEntry, Record, Document, Company, Inbox and Agent have none, so no firm filtering is possible in mocks or types. The mocks hold a single firm. |
| 2 | **Query keys carry no `firmId`** (section 7), against `CLAUDE.md`'s tenancy rule; cached data could cross firms on a firm switch. |
| 3 | **Session shape:** the runtime `SessionUser` lacks `firmId`; `SessionFirm` duplicates `FirmSchema`; the store is hard-coded to one firm. `sessionApi` has no consumer. |
| 4 | **If the firm goes in the URL** (`/[firm]/…`): no firm segment exists anywhere in `src/app`, and `hrefFor()` (the planned single place to build links) does not exist. There are **39** `href="/…"` literals, **5** `router.push/replace("/…")` and **1** `redirect("/…")` outside the registry, all of which would need to change. `FirmSchema.slug` already exists as a candidate URL segment. |
| 5 | **Scope helpers don't know firms:** `isInScope(access, userId, record)` and the 8 inline filters compare only user ids; there is no `scopeCandidates` / `scopeApplications` / `scopeLedger` yet (Phase C). |
| 6 | **Backend has no tenancy.** Per `CLAUDE.md`, `backend/` is single-user with one shared key; Modules 02–05 wait on decisions D1/D2 (`docs/integration/06-open-decisions.md`). |
| 7 | **Unsettled order of work:** Phase B (route × role audit) and Phase C (permission policy) are not started; `CLAUDE.md` puts the Super Admin flow after Phase C. |
