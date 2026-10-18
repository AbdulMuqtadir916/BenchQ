# 07 — Routes, tenancy and RBAC (production)

**Project:** BenchQ · **Version:** 2.0 (2026-10-13) — supersedes v1 (2026-10-06)
**Status:** Phase A done (uncommitted on `feat/routes`) · next: **Phase A2**
**Facts about the code** come from `docs/CURRENT_STATE.md` (2026-10-13). If the code has moved on,
trust the code and update this file.

This doc owns: every URL, who can open it, how the firm is resolved, how the platform tier
(Super Admin) works, and the order the work happens in. Screens are owned by `docs/04-SCREENS.md`;
shapes by `docs/02-DATA-CONTRACTS.md`.

---

## 0. Decisions

All decisions live here. Change a decision here first, then the sections below.

| # | Question | Decision | Date |
|---|---|---|---|
| Q1 | Settings URL structure | Split into `firm`, `team`, `templates`, `preferences`; the index redirects to the first section the role may open | 2026-10-06 |
| Q2 | Forbidden route | Forbidden screen in place, no redirect | 2026-10-06 |
| Q3 | Focus mode | OWNER, MANAGER, BDE; not VIEWER | 2026-10-06 |
| Q4 | `/welcome` onboarding | OWNER only, first run; everyone else → landing | 2026-10-06 |
| Q5 | Platform tier | **Reopened and in scope.** Built UI-first under `/admin` (supersedes "deferred") | 2026-10-13 |
| Q6 | Record outside a user's scope | Not-found state, never confirm existence | 2026-10-06 |
| Q7 | Platform role name | Code identifier **`PLATFORM_ADMIN`** (already in `docs/02` and `LedgerEntrySchema.actorType`). UI label **"Super Admin"** | 2026-10-13 |
| Q8 | Where the firm lives | **In the URL**: `/[firm]/…`, where `[firm]` is `Firm.slug` | 2026-10-13 |
| Q9 | Users in several firms | **No.** A firm user belongs to exactly one firm. No firm picker | 2026-10-13 |
| Q10 | Super Admin access to a firm's workspace | **Read-only support view**: opens the firm's real screens with every action hidden, a persistent banner, and audit entries the firm can see. No impersonation, no writes | 2026-10-13 |
| Q11 | Public sign-up | **Open — product owner.** Recommendation: invite-only for v1. Firms are created by Super Admin; owners and members join through `/invite/[token]`; `/sign-up` is removed | — |
| Q12 | Who sets a firm's slug | Super Admin, at firm creation; editable only by Super Admin. Reserved words (§2.4) are rejected | 2026-10-13 |
| Q13 | Company records | Global reference data (not firm-scoped). Every other business record is firm-scoped | 2026-10-13 |

---

## 1. Principles

1. **Two tiers, one app.** The platform tier (`PLATFORM_ADMIN`, under `/admin`) and the firm tier
   (`OWNER`/`MANAGER`/`BDE`/`VIEWER`, under `/[firm]`) share one Next.js app, one registry and one
   permission policy.
2. **The registry is the only route list** (`src/lib/routes/registry.ts`). Nav, palette,
   shortcuts, titles, breadcrumbs, landing and guards derive from it. Links are built with
   `hrefFor()`; no other file contains a path string.
3. **The URL carries the firm.** A firm page never reads "the current firm" from a store; it reads
   the `[firm]` segment, resolved once in the firm layout and provided through context.
4. **Never confirm existence.** Unknown firm, a firm you're not a member of, a record outside your
   scope, and `/admin` for a non-admin all render **not-found**.
5. **Forbidden is for known-but-not-allowed routes inside your own area** (e.g. a BDE opening
   `/acme/analytics`). It renders in place (Q2).
6. **Client guards are UX.** Real enforcement is Phase D (server session + backend). Until then
   every guard comment says so.
7. **Cache is firm-scoped.** Every firm-data query key starts with the firm id.

---

## 2. Route map

Access levels: **full** · **assigned** (BDE's assigned candidates) · **own** (records the user
created or acted on) · **read** (view, no actions rendered) · **—** (Forbidden screen).
**Support** = a `PLATFORM_ADMIN` inside a read-only support view of that firm (§4).

### 2.1 Public (no firm, no sign-in required)

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing redirect | signed out → `/sign-in`; firm user → `/{slug}/dashboard` (OWNER first run → `/{slug}/welcome`); platform admin → `/admin` |
| `/sign-in` | Email + password | `?returnTo=` honoured only for same-origin paths |
| `/forgot-password` | Request a reset link | **new**; always shows "if the email exists, we sent a link" |
| `/reset-password/[token]` | Set a new password | **new**; invalid/expired token state |
| `/invite/[token]` | Accept an invite: shows firm name and offered role, set name + password | **new** (open in v1 Phase A); invalid, expired, already-accepted states |
| `/sign-up` | — | **Removed if Q11 = invite-only** |

### 2.2 Firm tier — `/[firm]/…`

| Route | Shell | OWNER | MANAGER | BDE | VIEWER | Support |
|---|---|---|---|---|---|---|
| `/[firm]/welcome` | auth | full (first run) | → landing | → landing | → landing | → landing |
| `/[firm]/dashboard` | app | full | full | full | read | read (OWNER composition) |
| `/[firm]/candidates` | app | full | full | assigned | read | read |
| `/[firm]/candidates/new` | app / modal | full | full | full | — | — |
| `/[firm]/candidates/[id]` | app | full | full | assigned | read | read |
| `/[firm]/jobs`, `/[firm]/jobs/[id]` | app | full | full | full | read | read |
| `/[firm]/jobs/capture` | app / modal | full | full | full | — | — |
| `/[firm]/applications`, `/[firm]/applications/[id]` | app | full | full | own | read | read |
| `/[firm]/resumes` | app | full | full | assigned | read | read |
| `/[firm]/resumes/[id]` | studio | full | full | assigned | read (view mode) | read (view mode) |
| `/[firm]/outreach` | app | full | full | own | read | read |
| `/[firm]/followups` | app | full | full | own | — | read |
| `/[firm]/focus` | focus | full | full | full | — | — |
| `/[firm]/analytics` | app | full | full | — | read | read |
| `/[firm]/ledger` | app | full | full | own | read | read |
| `/[firm]/settings` | app | → first allowed | → first allowed | → first allowed | → first allowed | → `firm` |
| `/[firm]/settings/firm` | app | full | — | — | — | read |
| `/[firm]/settings/team` | app | full | full | — | — | read |
| `/[firm]/settings/templates` | app | full | full | — | — | read |
| `/[firm]/settings/preferences` | app | full | full | full | full | — (personal) |
| `/[firm]/design-system` | — | moves to `/dev/design-system` (§2.4), dev builds only | | | | |

Modal intercepts follow the access of the route they intercept.
**Support** is derived, not hand-written per route: `read` wherever OWNER has access, except
routes whose only purpose is acting (`candidates/new`, `jobs/capture`, `focus`) and personal
routes (`settings/preferences`), which are `—`.

### 2.3 Platform tier — `/admin/…` (`PLATFORM_ADMIN` only; everyone else → not-found)

| Route | Purpose |
|---|---|
| `/admin` | Overview: firm count by status, seats used vs. sold, active users, AI spend (all derived) |
| `/admin/firms` | Firms list: name, slug, status, plan, seats used/limit, owner, created, last activity; search + status filter in the URL |
| `/admin/firms/new` | Create firm: name, slug (live reserved/taken check), plan, seat & candidate limits, timezones, owner name + email → creates the firm and the owner's invite |
| `/admin/firms/[firmId]` | Firm overview: profile, status, plan, usage, owner; actions: edit, suspend / reactivate, **View workspace** (starts support view) |
| `/admin/firms/[firmId]/users` | Firm members + pending invites; resend / revoke invite; deactivate user |
| `/admin/firms/[firmId]/plan` | Plan, seat and candidate limits, change history |
| `/admin/firms/[firmId]/activity` | That firm's audit trail, incl. every support view |
| `/admin/plans` | Plan catalogue (name, limits, features). UI only — no billing (CLAUDE.md) |
| `/admin/audit` | Platform audit log: firm created/suspended, plan changed, support views, admin sign-ins |
| `/admin/system` | Backend health, scraper runs, AI spend by firm/model |
| `/admin/team` | BenchQ staff with `PLATFORM_ADMIN`; invite / deactivate |

Admin URLs use `firmId` (stable), firm URLs use `slug` (readable).

### 2.4 Reserved and dev routes

- **Reserved slugs** (rejected at firm creation; checked by a registry test against every
  top-level segment): `admin, api, health, sign-in, sign-up, forgot-password, reset-password,
  invite, dev, _next, static, assets, favicon.ico, robots.txt, sitemap.xml, www, app, support,
  help, status, settings, new`.
- **Dev routes** live under `/dev/…` (`/dev/design-system`), `devOnly: true`, not-found unless
  `devRoutesEnabled()`.

### 2.5 Firm-layout outcomes (in order)

`src/app/[firm]/layout.tsx` resolves the slug and decides, before any page renders:

| Condition | Result |
|---|---|
| Signed out | redirect `/sign-in?returnTo=<path>` |
| Slug unknown | not-found |
| Firm user, different firm | not-found |
| Platform admin, no support view for this firm | **Support interstitial**: "Open a read-only support view of {firm}?" + required reason → starts the view. Not a redirect |
| Firm status `SUSPENDED`, firm user | "Workspace suspended — contact your BenchQ account manager" screen on every route |
| Firm status `SUSPENDED`, support view | renders normally (read-only) |
| Otherwise | page, subject to the route's access level |

---

## 3. Who is signed in — the principal

The session holds a **principal**, not a user + role. Proposed contract (goes into
`docs/02-DATA-CONTRACTS.md` — **needs sign-off**, see §7):

```ts
type Principal =
  | { kind: "firm";     userId: string; firmId: string; role: FirmRole }
  | { kind: "platform"; userId: string; role: "PLATFORM_ADMIN"; support: SupportView | null };

type SupportView = { id: string; firmId: string; reason: string; startedAt: string; expiresAt: string };
```

- `FirmRole` has **one** declaration: the Zod enum in `src/lib/schemas/enums.ts`. The duplicate in
  `session-store.ts` is deleted.
- `SessionUser` / `SessionFirm` in the store are replaced by types inferred from Zod
  (`User`, `Firm`, `Principal`).
- The firm in context comes from the URL (§1.3). For a firm principal, `principal.firmId` must
  equal the URL firm's id, otherwise not-found.
- **Dev principal switcher** replaces the RoleSwitcher: pick any fixture principal (each role in
  firm A, a user in firm B, a platform admin). Rendered only when
  `NEXT_PUBLIC_SHOW_DEV_TOOLS=true`; **off by default and in production builds** (today it is on
  by default — fix in Phase A2).

---

## 4. Read-only support view (Q10)

| Rule | Detail |
|---|---|
| Entry | `/admin/firms/[firmId]` → **View workspace**, or the firm-layout interstitial. A reason is required (free text, min. 10 chars) |
| Start | creates a `SupportView` (60-minute expiry) and a ledger entry `ADMIN_ACCESS` (actor `PLATFORM_ADMIN`, `firmId` set) — visible in the firm's own `/[firm]/ledger` |
| While active | persistent banner on every firm page: "Support view of {firm} · read-only · started {time} by {admin} · Exit". Banner can't be dismissed |
| Permissions | `can()` returns `false` for **every** action. Route access per §2.2 "Support" column. Data scope: whole firm |
| Exit | Exit button, expiry, or sign-out → ends the view, writes `ADMIN_ACCESS_END`, returns to `/admin/firms/[firmId]` |
| Isolation | one support view at a time; starting a view of firm B ends firm A's |
| Never | impersonating a user, writing firm data, exporting resumes, sending outreach |

---

## 5. Registry v2

`src/lib/routes/registry.ts` extends the Phase A registry.

```ts
type Area = "public" | "firm" | "platform" | "dev";

interface RouteDef {
  id: string;                              // "candidates.detail", "admin.firms.detail"
  path: string;                            // "/[firm]/candidates/[id]", "/admin/firms/[firmId]"
  title: string;
  area: Area;
  shell: "auth" | "app" | "studio" | "focus" | "admin";
  access:                                  // by area
    | { kind: "public" }
    | { kind: "firm"; roles: Record<FirmRole, Access>; support?: Access }  // support defaults per §2.2
    | { kind: "platform" };                // PLATFORM_ADMIN only
  onDenied?: "forbidden" | "landing";
  nav?: { section: "workspace" | "settings" | "preferences" | "admin"; order: number; icon?: LucideIcon };
  shortcut?: string;
  palette?: boolean;
  parent?: string;                         // breadcrumbs / back
  devOnly?: boolean;
}
```

Helpers, all typed on `Principal` (not `FirmRole`): `matchRoute`, `accessFor(route, principal)`,
`canOpen`, `navFor`, `paletteRoutesFor`, `shortcutsFor`, `landingFor`, and
**`hrefFor(id, params)`** — fills `[firm]` from params; `useHref()` fills it from the current URL.

Registry tests (extend `registry.test.ts`):
- page ↔ entry parity (already exists; must understand `[firm]` and `admin`);
- **the full access table in §2 as a table test**, every route × every principal kind — replaces
  the 7 spot checks;
- every `landingFor(principal)` is openable by that principal;
- no reserved slug (§2.4) collides with a top-level route, and every top-level static segment is
  reserved;
- a lint/grep test: no `href="/`, `router.push("/`, `router.replace("/`, `redirect("/` outside
  `src/lib/routes/`.

---

## 6. Folder structure (target)

```
src/app/
  page.tsx                         → landing redirect (§2.1)
  (public)/sign-in · forgot-password · reset-password/[token] · invite/[token]
  admin/
    layout.tsx                     → admin shell + platform guard
    page.tsx · firms/… · plans · audit · system · team
  [firm]/
    layout.tsx                     → resolve slug, membership, status, support banner (§2.5)
    welcome/
    (app)/  dashboard · candidates · jobs · applications · resumes · outreach · followups
            analytics · ledger · settings/… · @modal/…
    (studio)/resumes/[id]
    focus/
  dev/design-system/
  not-found.tsx · global-error.tsx
```

Each area has its own `not-found.tsx`, `error.tsx`, `loading.tsx`.

---

## Phases

| Phase | What | Depends on | Status |
|---|---|---|---|
| **A** | Route foundation — registry, guards, access/error screens, settings split | — | Done (commit it) |
| **A2** | Hardening — `hrefFor` everywhere, full table test, one `FirmRole`, dev switcher off in prod | A | **Next** |
| **T** | Tenancy in the frontend — contracts, principal, `/[firm]` URLs, firm-scoped mocks and query keys | A2 + §7 sign-off | Planned |
| **P** | Platform tier routes — `/admin/*` shell and pages (all states, mock data), support view | T | Planned |
| **C** | Permission policy — `can()`, `useCan`, `<Can>`, scope helpers; delete inline checks | T, P | Planned |
| **B** | UI completion audit — every route × principal against `docs/04` | C | Planned |
| **S** | Super Admin flow polish (UI-first) — create firm, invites, plans, suspend, audit, system | P, B | Planned |
| **D** | Real enforcement — server session, `src/proxy.ts`, `forbidden()`, backend checks | backend D1/D2 | Later |

**Why C moves before B (change from v1):** the audit checks that controls a principal can't use
aren't rendered. Auditing before the policy exists means auditing twice.

---

## Phase A — Route foundation (done)

Delivered as recorded in v1: registry + helpers + tests (`src/lib/routes/`), `RouteGuard`,
`RouteTitle`, sidebar/palette/shortcuts/`?` sheet from the registry, forbidden / not-found /
error / loading screens, record scope → not-found, settings split, `/sign-up`, dev-only
`/design-system`.

**Open:** the work is uncommitted on `feat/routes` (39 changes). Commit it before A2. The exit
criteria were never ticked — tick them during A2's verification.

---

## Phase A2 — Hardening (next)

| # | Task | Why |
|---|---|---|
| A2.1 | Commit Phase A on `feat/routes`; open PR | 39 uncommitted changes |
| A2.2 | Add `hrefFor(id, params)` + `useHref()` to the registry. Replace all **39** `href="/…"`, **5** `router.push/replace("/…")` and **1** `redirect("/…")` literals | Phase T moves every URL; this makes the move a one-file change |
| A2.3 | Add the grep test from §5 | stops new literals |
| A2.4 | Replace the 7 spot checks with the full §2.2 table test (firm roles only for now) | the test is the spec |
| A2.5 | One `FirmRole`: keep the Zod enum, delete the store's copy, re-type helpers | two declarations |
| A2.6 | `useRouteAccess`: unregistered path → `none` (not `full`) | fail closed |
| A2.7 | RoleSwitcher behind `NEXT_PUBLIC_SHOW_DEV_TOOLS=true`, off by default; add to `.env.example` | it ships to production today |
| A2.8 | Move `/design-system` to `/dev/design-system` | frees the top level for firm slugs |
| A2.9 | Fix the stale `iconsax-react` comment in `next.config.ts` | hygiene |

**Exit:** no path literals outside `src/lib/routes/`; table test covers every firm route × role;
switcher hidden in `pnpm build && pnpm start`; Phase A exit criteria ticked; checks green.

---

## Phase T — Tenancy in the frontend

Needs §7 contracts signed off first.

| # | Task |
|---|---|
| T1 | Contracts in `docs/02`: `Principal`, `SupportView`, `Firm` (+ `status`, `planId`, `seatLimit`, `candidateLimit`, `createdAt`), `Plan`, `Invite`, `PlatformUser`; `firmId` on Job, Application, Resume, Record, Document, Inbox, Followup, LedgerEntry (`firmId: string \| null` — null = platform event) |
| T2 | Zod schemas from T1; `SessionSchema` limits move to `Firm` and become derived usage (`seatsUsed` = active users count) |
| T3 | Fixtures: add `firmId` to every firm-scoped fixture; add a **second firm** (small: 3 users, 5 candidates) and one platform admin, so isolation is testable |
| T4 | Session store → `Principal`; dev principal switcher lists every fixture principal |
| T5 | Query key factory `src/lib/query/keys.ts`; every firm key starts with `firmId`; hooks read `firmId` from firm context; adapters take `firmId` and mocks filter by it |
| T6 | Move firm routes under `src/app/[firm]/` (§6); firm layout implements §2.5; registry paths gain `[firm]` |
| T7 | `/` landing per principal; `/[firm]/welcome` for OWNER first run |
| T8 | Tests: a firm-A principal can't read firm-B data through any hook (mock layer); slug → firm resolution; §2.5 table |

**Exit:** every firm URL carries the slug; switching principal between firm A and B never shows
the other firm's data (checked on every list screen); query keys all include `firmId`; checks green.

---

## Phase P — Platform tier routes

| # | Task |
|---|---|
| P1 | Registry v2 (§5): `area`, `access` union, `admin` shell and nav section, helpers on `Principal` |
| P2 | `src/app/admin/layout.tsx`: admin shell (same frosted shell, admin nav), platform guard → not-found for others |
| P3 | Every route in §2.3 with real layout and skeleton / empty / error (and not-found for `[firmId]`), on mock adapters `platformApi` (`firms`, `plans`, `audit`, `system`, `team`) |
| P4 | Support view (§4): start / exit / expiry, interstitial, banner, ledger entries, support access column |
| P5 | ⌘K for admins: firms search, "View workspace", admin nav; firm-scoped commands hidden outside a firm |
| P6 | Tests: platform table test rows, support view grants no actions, non-admin → `/admin` not-found |

Screens are functional skeletons here; visual polish is Phase S. `docs/04-SCREENS.md` gets an
"Admin" section before P3 (UI-first: the screen spec comes first).

**Exit:** a platform admin can list firms, open one, start a support view, browse the firm
read-only with the banner, exit, and see the visit in both audit logs.

---

## Phase C — Permission policy

As v1 Phase C, typed on `Principal`:

- `src/lib/auth/permissions.ts`: `can(principal, action, resource?)` with the role × action
  matrix as a table at the top. Platform actions added: `firm.create`, `firm.edit`,
  `firm.suspend`, `firm.viewWorkspace`, `plan.edit`, `invite.resend`, `invite.revoke`,
  `platformTeam.manage`. Support view → every firm action `false`.
- `useCan`, `<Can>`; scope helpers `scopeCandidates`, `scopeApplications`, `scopeLedger`,
  `scopeFollowups`.
- Replace the **11** `role !== "VIEWER"` checks and **8** BDE filters (file:line list in
  `CURRENT_STATE.md` §5); delete the unreachable analytics BDE branch.
- Route access becomes `can(principal, "route.view", route)`.
- Exit: `grep -rE "role (===|!==)"` returns nothing outside `src/lib/auth/` and the registry;
  table test covers every principal × action.

---

## Phase B — UI completion audit

As v1 Phase B (per-route checklist), with the audit board extended to the platform tier and the
Support column. Known gaps carried over: ledger BDE "own" filter + filters + diff expander; the
dangling `·` when `promptVersion` is null; full settings UIs.

---

## Phase S — Super Admin flow (UI-first)

Planned separately once P and B are done: screen specs in `docs/04`, then polish of create firm,
invites, plans, suspend/reactivate, audit, system. Out of scope until then.

---

## Phase D — Real enforcement (after backend D1/D2)

1. Backend users, firms, roles, platform admins, invites and support views; every endpoint scopes
   by `firmId` and checks the principal.
2. Server-readable session cookie; the frontend reads the principal server-side.
3. `src/proxy.ts` for optimistic redirects only (signed out → `/sign-in`).
4. `forbidden()` + `forbidden.tsx`; firm and admin layouts check the principal on the server.
5. Client `scope*` helpers deleted; the dev principal switcher deleted.

---

## 7. Sign-off needed before Phase T

These are new contracts (CLAUDE.md: no new entity without product sign-off). Approve, change or
reject each, then record the date in §0.

| Contract | Fields (proposed) |
|---|---|
| `Principal`, `SupportView` | §3 |
| `Firm` additions | `status: "ONBOARDING" \| "ACTIVE" \| "SUSPENDED"`, `planId`, `seatLimit`, `candidateLimit`, `createdAt` |
| `Plan` | `id, name, seatLimit, candidateLimit, features: string[], isActive` (no prices — no billing) |
| `Invite` | `id, firmId \| null (null = platform team), email, role, invitedByUserId, status: "PENDING" \| "ACCEPTED" \| "REVOKED" \| "EXPIRED", expiresAt, createdAt` |
| `PlatformUser` | `id, name, email, role: "PLATFORM_ADMIN", isActive, lastActiveAt` |
| `firmId` on records | Job, Application, Resume, Record, Document, Inbox, Followup; LedgerEntry nullable. Company stays global (Q13) |
| Ledger actions | add `ADMIN_ACCESS_END`, `FIRM_CREATED`, `FIRM_SUSPENDED`, `FIRM_REACTIVATED`, `PLAN_CHANGED`, `INVITE_SENT`, `INVITE_ACCEPTED`, `INVITE_REVOKED` |
