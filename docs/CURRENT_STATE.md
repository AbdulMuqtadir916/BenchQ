# Current state

Factual snapshot of the frontend, regenerated at the end of Phase P. Read-only inventory: it
describes the code as it is; decisions and plans live in `docs/07` and the other docs. Anything not
confirmed is marked **(unverified)**.

| | |
|---|---|
| Date | 2026-10-19 |
| Base | `codex/json-data-migration` @ `b055330` (merge of #21, Phase P done) |
| Phases done | 07 A, A2, T0, T, L, P (P1–P6); docs/04 §13 dashboard errors; demo-data persistence (docs/03 §3.3) |
| Next | the rest of 07 Phase C ("still to do"), then B, S, M (07 phase table) |
| Not read | `.env.local` (denied to the session), so `NEXT_PUBLIC_LIVE_MODULES` is unverified — but no adapter reads it (§7) |

---

## 1. Stack

Versions are the ranges in `package.json`.

| Area | Package | Version |
|---|---|---|
| Framework | `next` | 16.3.5 (webpack: `next dev --webpack`, `next build --webpack`; middleware is `src/proxy.ts`) |
| UI runtime | `react`, `react-dom` | 19.2.8 |
| Server state | `@tanstack/react-query` (+ `-devtools`) | ^5.103.1 |
| Client state | `zustand` | ^5.0.15 |
| Validation | `zod` | ^4.6.5 |
| Styling | `tailwindcss`, `@tailwindcss/postcss` | ^4 |
| Language | `typescript` | ^5 (`strict`) |
| Tables / virtual | `@tanstack/react-table` ^8.21.3, `@tanstack/react-virtual` ^3.14.13 | |
| Motion / theme / icons | `motion` ^13.4.0, `next-themes` ^0.4.6, `lucide-react` ^1.47.0 | |
| Misc | `@dnd-kit/core`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `date-fns`, `date-fns-tz`, two `@fontsource-variable` fonts | |
| Lint | `eslint` ^9, `eslint-config-next` 16.3.5, `@tanstack/eslint-plugin-query` | |
| Test tools | `vitest` ^3.2.7 only | no Testing Library, jsdom, MSW, Playwright or axe |

| Runtime | Value |
|---|---|
| Node | `engines.node` ">=22", `.nvmrc` 22; this machine runs v24.21.0 (`arm64`) |
| pnpm | `pnpm@12.5.1`; not on PATH here, `corepack pnpm` works |
| Env vars read by `src/` | `NEXT_PUBLIC_LIVE_MODULES`, `NEXT_PUBLIC_MOCK_DELAY_MS`, `NEXT_PUBLIC_SHOW_DEV_ROUTES` |
| Source size | 367 `.ts`/`.tsx` files under `src/` |

---

## 2. Route tree

37 registered routes (`src/lib/routes/registry.ts`): 3 public, 24 firm, 11 platform, 1 dev.

| Area | URLs |
|---|---|
| Public | `/` (landing per principal), `/sign-in`, `/invite/[token]` |
| Firm (`/[firm]/…`, slug in the URL) | `welcome`, `dashboard`, `candidates`, `candidates/new`, `candidates/[id]`, `jobs`, `jobs/capture`, `jobs/[id]`, `applications`, `applications/[id]`, `resumes`, `resumes/[id]` (studio shell), `outreach`, `followups`, `analytics`, `ledger`, `focus` (focus shell), `settings` (index redirect), `settings/firm`, `settings/team`, `settings/templates`, `settings/preferences` |
| Platform (`/admin/…`) | `/admin` (overview), `firms`, `firms/new`, `firms/[firmId]` (+ `users`, `plan`, `activity` tabs), `plans`, `audit`, `system` (placeholder), `team` |
| Dev | `/dev/design-system` (dev builds or `NEXT_PUBLIC_SHOW_DEV_ROUTES`) |

Route groups: `(app)`, `(workspace)`, `(manage)`, `(studio)` under `[firm]`; `@modal` with intercepting
`(.)candidates/new` and `(.)jobs/capture`. Catch-all `admin/[...unknown]` renders not-found inside the
admin shell (not a registry route). Slug-less firm URLs (`/candidates`) are not-found (Q22).

---

## 3. Registry and navigation

- One `ROUTE_DEFS` list: `id`, `path`, `title`, `area`, `shell`, `access`, optional `nav`, `shortcut`, `palette`, `devOnly`.
- `RouteAccess` = public | firm (per-role `full` / `assigned` / `own` / `read` / `none`, optional `support`) | platform.
- Helpers on `Principal`: `accessFor`, `accessForPath` (fails closed), `canOpen`, `navFor`, `paletteRoutesFor(principal, area)`, `shortcutsFor(principal, area)`, `landingFor`, `supportAccess`, `activeNavId`, `isRouteActive`, `matchRoute`, `hrefFor` / `useHref()`.
- `g` shortcuts and ⌘K navigation are per area: the firm map in the firm shell, the admin map (`g o/f/p/a/s/t`) in the admin shell.
- Table tests: `registry.test.ts` (firm table per role, Support column, platform rows, ⌘K by area), `no-path-literals.test.ts`.

---

## 4. Session, sign-in and the support view

| Piece | State |
|---|---|
| Sign-in | `/sign-in`, email + password against the seeded accounts in the mock layer (docs/03 §3.2; one demo password); one generic error. No principal switcher (Q25) |
| Session | mock auth keeps the account id in `localStorage` `benchq.session`, shared by tabs (Q27); `useSessionSync` / `applySession`; the app starts signed out and bootstrapping |
| Principal change | clears the whole query cache and remounts the app (`principal-boundary.ts`); sign-in / support start / exit navigate first, then commit (`setPending`) |
| Landing | firm user → `/{slug}/dashboard` (OWNER first run → `/welcome`); Super Admin → `/admin`; `returnTo` only if the account can open it (`signInTarget`) |
| Invites | `/invite/[token]`: tokens in `src/mocks/invite-tokens.ts` (never on the Invite; resend replaces them); accepting creates the account, stores its chosen password (`credentials`, mock only) and signs it in |
| Support view | platform principal's `support`; started from "View workspace", the firm-URL interstitial or ⌘K; 60 minutes, one at a time, ended by exit / expiry / sign-out; banner on every firm page; `ADMIN_ACCESS` / `ADMIN_ACCESS_END` on `support_view` in the firm's ledger |
| Gates | `FirmGate` → `firmOutcome` (07 §2.5 order); `PlatformGate` → `platformOutcome`; both pure and table-tested |

Mock auth, not security: real enforcement is Phase D.

---

## 5. Permissions

- **Policy** `src/lib/auth/policy.ts` (pure; `permissions.ts` re-exports it with `useCan`): `can(principal, action)` over a role × action table — `candidate.create`, `candidate.edit`, `job.capture`, `job.apply`, `application.move`, `resume.edit`, `outreach.act`, `followup.act`, visibility `team.view`. A support view: every action false. Scope helpers `scopeCandidates`, `scopeApplications`, `scopeFollowupsUserId`, `scopeLedger`, `hasOwnScope`, `dashboardFor`.
- **Firm pages** read the principal and use `can()` / the scope helpers; no `role !== "VIEWER"` checks or BDE filters remain there.
- **Mock backend** enforces the same table: every firm-scoped write declares its action (`firmScoped(…, writes)`) and is refused (403) for a VIEWER or a support view; `src/mocks/write-authorization.test.ts` walks every write.
- **Remaining `role ===` hits** (record roles, not the viewer's access): `settings/team` role tag tones, the admin users tab's OWNER-can't-be-deactivated rule and invite role label, the manager dashboard's title, `derive/bde-performance.ts`, `derive/platform.ts` (owner lookup). `applications.updateStatus` in the mock still also checks `accessFor` + `isInScope` itself.
- What Phase C still has to do: 07 "Phase C — Permission policy", *Still to do*.

---

## 6. Tenancy

- Contracts approved (docs/02 §3.1, 07 Q16–Q21, Q31): `Firm` (status, plan, copied limits, `contactPhone`), `Plan`, `Invite` (+ `inviteeName`), `PlatformUser`, `SupportView`, `Principal`; `firmId` on every firm-owned record; ledger `firmId` nullable for platform-only events.
- The firm comes from the URL (`useFirm()` / `useFirmId()`); query keys start with `firmId`; platform keys start with `"platform"`.
- Every number is derived (`src/lib/derive/tenancy.ts`, `platform.ts`): seats, active candidates, over-limit, owner status, last activity, plan history, custom-limits mark, needs attention.
- Fixture firms: Hyderabad Tech Staffing (ACTIVE, Growth), Secunderabad Talent Labs (ACTIVE, Starter, at its seat limit), Cyberabad Bench Works (SUSPENDED, over its seat limit), Gachibowli Staffing (ONBOARDING, owner invite pending).

---

## 7. Data layer

| Piece | State |
|---|---|
| Adapters | `src/lib/api/*.ts`, one per module, plus `platform.ts`, `invites.ts`, `session.ts`, `demo-data.ts`. **Every adapter is served by its mock**: `isLive()` in `config.ts` exists but no adapter calls it, so `NEXT_PUBLIC_LIVE_MODULES` has no effect today |
| HTTP | `src/lib/api/http.ts` exists; nothing imports it yet |
| DTO | `src/lib/api/dto/shared.ts` (+ test); no module mapper yet |
| Mocks | 26 modules in `src/mocks/`; firm-scoped calls go through `firmScoped` (membership, support-view reads, declared writes) |
| Persistence | demo data in `localStorage` `benchq.demo-data` (`{version, seededAt, tables}`), changed tables only; `FIXTURE_VERSION` fingerprints the fixtures; Super Admin "Reset demo data" on `/admin/system`. Persisted tables: firms, users, invites, inviteTokens, credentials, supportViews, plans, platformUsers, candidates, applications, documents, inboxMessages, inboxConnections, ledger |
| Backend | JobNavigator (FastAPI) in `backend/`; integration paused after Module 01 (CLAUDE.md, `docs/integration/`) |
| System contracts | `HealthCheck`, `ScraperRun`, `AiUsage` in docs/02 §3.2: partly approved (07 Q33), **not built** |

---

## 8. Quality

| Check | State (2026-10-19) |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm test` | 421 tests in 31 files, passing |
| `pnpm build` | clean |
| Both themes | checked by eye in Chrome for the screens built in Phases L and P |
| Widths 1440 / 1024 / 390 | **(unverified)** for the admin screens and the invite page: not walked at 1024 or 390 |
| `axe` | **not run** — no axe tooling in the repo |
| Known UI gaps | 07 "Phase B — UI completion audit" (ledger filters and diff expander, `·` with a null `promptVersion`, full settings UIs, "Not found" tab title, outreach thread-list states, the candidates search box at 390 px) |

---

## 9. Open work

| Item | Where it is tracked |
|---|---|
| Rest of the permission policy (platform actions, team actions, `<Can>`, route access via `can`, full table test, exit grep, `updateStatus` fold-in) | 07 Phase C, *Still to do* |
| Per-route × per-principal UI audit, both themes, widths, axe | 07 Phase B |
| Super Admin flow polish | 07 Phase S |
| Firm-side invite flow (OWNER invites members) | 07 Phase M |
| System contracts S2, S4, S8–S12 | docs/02 §3.2 |
| Backend tenancy and real auth, then Modules 02–05 | 07 Phase D, `docs/integration/` |
