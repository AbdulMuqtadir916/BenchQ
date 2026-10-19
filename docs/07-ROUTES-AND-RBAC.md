# 07 — Routes, tenancy and RBAC (production)

**Project:** BenchQ · **Version:** 2.1 (2026-10-14) — supersedes v2.0 (2026-10-13) and v1 (2026-10-06)
**Status:** Phase A done and committed (`feat/routes`) · Phase A2 done (`feat/routes-a2`) · Phase T0 in progress (`feat/routes-t0`) · Q11, Q14, Q15 decided and **§7 contracts approved 2026-10-14 (Q16–Q21)** · next: **Phase T**, now unblocked
**Facts about the code** come from `docs/CURRENT_STATE.md` (2026-10-13). If the code has moved on,
trust the code and update this file.

This doc owns: every URL, who can open it, how the firm is resolved, how the platform tier
(Super Admin) works, and the order the work happens in. Screens are owned by `docs/04-SCREENS.md`;
shapes by `docs/02-DATA-CONTRACTS.md`.

---

## 0. Decisions

All decisions live here. Change a decision here first, then the sections below.

| #   | Question                                 | Decision                                                                                                                                                                                                                                                                                                                                                                                        | Date       |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Q1  | Settings URL structure                   | Split into `firm`, `team`, `templates`, `preferences`; the index redirects to the first section the role may open                                                                                                                                                                                                                                                                               | 2026-10-06 |
| Q2  | Forbidden route                          | Forbidden screen in place, no redirect                                                                                                                                                                                                                                                                                                                                                          | 2026-10-06 |
| Q3  | Focus mode                               | OWNER, MANAGER, BDE; not VIEWER                                                                                                                                                                                                                                                                                                                                                                 | 2026-10-06 |
| Q4  | `/welcome` onboarding                    | OWNER only, first run; everyone else → landing                                                                                                                                                                                                                                                                                                                                                  | 2026-10-06 |
| Q5  | Platform tier                            | **Reopened and in scope.** Built UI-first under `/admin` (supersedes "deferred")                                                                                                                                                                                                                                                                                                                | 2026-10-13 |
| Q6  | Record outside a user's scope            | Not-found state, never confirm existence                                                                                                                                                                                                                                                                                                                                                        | 2026-10-06 |
| Q7  | Platform role name                       | Code identifier **`PLATFORM_ADMIN`** (already in `docs/02` and `LedgerEntrySchema.actorType`). UI label **"Super Admin"**                                                                                                                                                                                                                                                                       | 2026-10-13 |
| Q8  | Where the firm lives                     | **In the URL**: `/[firm]/…`, where `[firm]` is `Firm.slug`                                                                                                                                                                                                                                                                                                                                      | 2026-10-13 |
| Q9  | Users in several firms                   | **No.** A firm user belongs to exactly one firm. No firm picker                                                                                                                                                                                                                                                                                                                                 | 2026-10-13 |
| Q10 | Super Admin access to a firm's workspace | **Read-only support view**: opens the firm's real screens with every action hidden, a persistent banner, and audit entries the firm can see. No impersonation, no writes                                                                                                                                                                                                                        | 2026-10-13 |
| Q11 | Public sign-up                           | **Invite-only.** Firms are created by Super Admin in `/admin/firms/new`; the owner and every member join through `/invite/[token]`; `/sign-up` is removed (done in T0, 2026-10-14)                                                                                                                                                                                                              | 2026-10-14 |
| Q12 | Who sets a firm's slug                   | Super Admin, at firm creation; editable only by Super Admin. Reserved words (§2.4) are rejected                                                                                                                                                                                                                                                                                                 | 2026-10-13 |
| Q13 | Company records                          | Global reference data (not firm-scoped). Every other business record is firm-scoped                                                                                                                                                                                                                                                                                                             | 2026-10-13 |
| Q14 | Role-specific routes                     | **No role in the URL.** A URL names the thing (`/acme/candidates`), the same for every role. Readability comes from (a) route groups by purpose — `(workspace)` for daily work, `(manage)` for oversight — which don't change URLs, (b) one view file per role where a screen really differs (`src/features/<area>/<role>-<view>.tsx`), and (c) one permission table (`permissions.ts`). See §6 | 2026-10-14 |
| Q15 | Who manages firm members                 | **OWNER only** invites, removes, deactivates members and changes roles. MANAGER sees the team read-only and **assigns candidates to BDEs**. BDE and VIEWER don't see the team page                                                                                                                                                                                                              | 2026-10-14 |
| Q16 | Tenancy contracts (§7) | **Approved** with the answers recorded in Q17–Q21. The shapes are in `docs/02` §3.1 (the source of truth; `docs/02` numbers the owner's answers A1–A17). Phase T implements them; nothing before it may | 2026-10-14 |
| Q17 | Seats and limits (A1–A4) | **Seat** = every active firm user (OWNER, MANAGER, BDE, VIEWER); pending invites reserve a seat; `seatsUsed` is derived. **Active candidate** = `ON_BENCH`, `INTERVIEWING` or `OFFER` (derived). A **Plan is a template**: its limits are *copied* onto `Firm` when the plan is assigned, `Firm.seatLimit` / `candidateLimit` are the effective limits, and editing a plan never changes existing firms. **Over a limit**: block new additions (invite, new candidate, reactivating a user or candidate) with a message naming the limit; never auto-remove or deactivate; existing users and candidates keep working after a downgrade; the admin firms list shows a derived "over limit" flag | 2026-10-14 |
| Q18 | Firm lifecycle and profile (A5–A8, A16) | No `TRIAL` until billing. `ONBOARDING` → `ACTIVE` automatically when the OWNER accepts their invite; only Super Admin suspends or reactivates. `planId` is required in every status. `Firm` gains only `contactPhone: string \| null` (the owner is the primary contact, derived; GST, billing email and address wait for billing). **Slug**: lowercase a–z, 0–9 and hyphens; 3–32 characters; starts with a letter; no leading, trailing or double hyphens; not reserved; unique; Super Admin may change it behind a confirm dialog that warns old links break; no alias or redirect table. Users of a suspended firm can still sign in and see the "Workspace suspended" screen | 2026-10-14 |
| Q19 | Invites (A9–A11) | Lifetime **7 days**. Resend keeps the same `Invite` row, issues a new token (the old one stops working) and resets `expiresAt` to +7 days; the frontend may treat `PENDING` past `expiresAt` as `EXPIRED`. **Exactly one OWNER per firm**; an OWNER invites MANAGER, BDE or VIEWER, not OWNER; transferring ownership is a Super Admin action, out of scope; no VIEWER cap beyond seats. Any `PLATFORM_ADMIN` can invite platform staff and it is the only platform role; schema refinement: `firmId` null ⇔ role `PLATFORM_ADMIN` | 2026-10-14 |
| Q20 | Support view and audit (A12–A14) | Support view is a **fixed 60 minutes, no extension**: to continue, start a new view (new reason, new ledger entry). The firm sees the admin's **name** and the **reason as written**, never the email. **Any event about a firm carries its `firmId`** and shows in that firm's `/[firm]/ledger`: `FIRM_CREATED`, `FIRM_SUSPENDED`, `FIRM_REACTIVATED`, `PLAN_CHANGED`, firm invites, `ADMIN_ACCESS`, `ADMIN_ACCESS_END`. `firmId` is null only for platform-only events (admin sign-ins, platform-team invites, plan catalogue edits); `/admin/audit` shows everything. **No `PlanChange` entity**: plan history is derived from `PLAN_CHANGED` entries whose summary states before and after (e.g. "Starter → Growth, seats 5 → 10") | 2026-10-14 |
| Q21 | Smaller points (A15, A17) | `Plan.features` is display labels only; no feature flags until something gates on them. Agent and tailoring runs are firm-scoped (`firmId`), because `/admin/system` needs AI spend by firm and joins are fragile | 2026-10-14 |
| Q22 | Slug-less URLs from before firm URLs (e.g. `/candidates`) | **Not-found, no redirect** (decided 2026-10-18): no such links exist outside the prototype demo. If old links ever appear, a redirect can prepend the signed-in user's slug and match the result against the same registry (`matchRoute`), so no second route list is needed |
| Q23 | Where the firm-side invite flow lives | **Phase M, after Phase S** (approved 2026-10-18): OWNER invites / resends / revokes on settings/team (Q15) and firm pages read pending invites. Depends on C (`member.*` through `can()`) and S (shared invite adapter, the suspended-firm invite answers that change seat counts); `/invite/[token]` itself arrives earlier, in P4 (Q26) |
| Q24 | How a resend is logged | **Another `INVITE_SENT`** in the firm's ledger, summary **"Invite resent to <email>"** (approved 2026-10-18). No new ledger action, no contract change |
| Q25 | How people sign in until real auth | **Through `/sign-in` only** (decided 2026-10-19): email + password against **seeded dummy accounts** in the mock layer, one per fixture user plus the Super Admin, one shared demo password (`docs/03` §3.2). The **dev principal switcher is removed** in development and production. Dummy data stays per firm (the existing fixtures). Still mock auth, not security; real enforcement stays Phase D. Implemented in **Phase L**, before P3 |
| Q26 | `/welcome` and `/invite/[token]` without the switcher | **Phase L covers `/welcome` with unit tests only; no mock invite page** (decided 2026-10-19). The real **`/invite/[token]` moves from Phase S to P4**, alongside the support view: it is how a new firm's OWNER joins, and the browser check of `/welcome` happens there (accept GSC's pending OWNER invite → `/welcome`) |
| Q27 | Where the mock session lives | **`localStorage`, shared across tabs** (decided 2026-10-19), like the production cookie session will be: one signed-in account per browser profile. Signing out (or in as someone else) in any tab applies to every open tab (`storage` event). Two accounts at once = a private window or a second browser profile |
| Q28 | Opening `/invite/[token]` for a `SUSPENDED` firm | **Blocked** with the "Workspace suspended" message (decided 2026-10-19): the invite is **not accepted and stays `PENDING`**. Answers Phase S open question 1, needed before P4 builds the page. Whether a suspended firm's pending invites hold seats (Phase S question 2) still waits for Phase S |
| Q29 | Super Admin area decisions (docs/04 §14.11) | Decided 2026-10-19: (1) **`/admin/system`** is a placeholder page for now; `HealthCheck`, `ScraperRun` and `AiUsage` contracts are drafted for sign-off separately; the **demo-data reset moves onto that placeholder**; **AI spend stays hidden** on the overview until its contract is approved. (2) **Custom limits per firm: yes**, logged as `PLAN_CHANGED`, the firm marked "custom limits". (3) **View workspace of an `ONBOARDING` firm with no users: allowed**; it shows empty states. (4) **Suspend: `ACTIVE` firms only.** (5) **Stalled onboarding alert after 7 days.** (7) **Over-limit block: yes**, as the second docs/04 §0 exception to "not rendered": the control stays visible, disabled, with the reason inline. (8) All PROPOSED defaults in docs/04 §14 accepted |
| Q30 | Two gaps in docs/04 §14 | Decided 2026-10-19: (1) **"Custom limits" is derived from the ledger**, no new field: Adjust limits logs `PLAN_CHANGED` with `entityType: "firm_limits"`, a plan change logs it with `entityType: "firm"` (as the fixtures already do); a firm shows "custom limits" while its latest `PLAN_CHANGED` is a limits adjustment, so a plan change clears it. (Comparing the firm's limits to its plan's would mark every firm on a plan after a catalogue edit, A3.) (2) **Deactivating or reactivating** a firm user or a staff member logs **`STATE_CHANGE`**, `entityType: "user"` (with the firm's `firmId`) or `"platform_user"` (`firmId` null). Entity types follow the ledger fixtures' lowercase convention (`firm`, `invite`, `platform_user`; plan catalogue edits `plan`) |

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

| Route                     | Purpose                                                                 | Notes                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/`                       | Landing redirect                                                        | signed out → `/sign-in`; firm user → `/{slug}/dashboard` (OWNER first run → `/{slug}/welcome`); platform admin → `/admin` |
| `/sign-in`                | Email + password                                                        | `?returnTo=` honoured only for same-origin paths, and only if the account signing in can open it (its own firm, an admin page for an admin); otherwise its landing (Phase L) |
| `/forgot-password`        | Request a reset link                                                    | **new**; always shows "if the email exists, we sent a link"                                                               |
| `/reset-password/[token]` | Set a new password                                                      | **new**; invalid/expired token state                                                                                      |
| `/invite/[token]`         | Accept an invite: shows firm name and offered role, set name + password | **new** (open in v1 Phase A); invalid, expired, already-accepted states                                                   |
| `/sign-up`                | —                                                                       | **Removed** (Q11 invite-only); the sign-in page's sign-up link goes too                                                   |

### 2.2 Firm tier — `/[firm]/…`

| Route                                               | Shell       | OWNER                                                 | MANAGER             | BDE             | VIEWER           | Support                  |
| --------------------------------------------------- | ----------- | ----------------------------------------------------- | ------------------- | --------------- | ---------------- | ------------------------ |
| `/[firm]/welcome`                                   | auth        | full (first run)                                      | → landing           | → landing       | → landing        | → landing                |
| `/[firm]/dashboard`                                 | app         | full                                                  | full                | full            | read             | read (OWNER composition) |
| `/[firm]/candidates`                                | app         | full                                                  | full                | assigned        | read             | read                     |
| `/[firm]/candidates/new`                            | app / modal | full                                                  | full                | full            | —                | —                        |
| `/[firm]/candidates/[id]`                           | app         | full                                                  | full                | assigned        | read             | read                     |
| `/[firm]/jobs`, `/[firm]/jobs/[id]`                 | app         | full                                                  | full                | full            | read             | read                     |
| `/[firm]/jobs/capture`                              | app / modal | full                                                  | full                | full            | —                | —                        |
| `/[firm]/applications`, `/[firm]/applications/[id]` | app         | full                                                  | full                | own             | read             | read                     |
| `/[firm]/resumes`                                   | app         | full                                                  | full                | assigned        | read             | read                     |
| `/[firm]/resumes/[id]`                              | studio      | full                                                  | full                | assigned        | read (view mode) | read (view mode)         |
| `/[firm]/outreach`                                  | app         | full                                                  | full                | own             | read             | read                     |
| `/[firm]/followups`                                 | app         | full                                                  | full                | own             | —                | read                     |
| `/[firm]/focus`                                     | focus       | full                                                  | full                | full            | —                | —                        |
| `/[firm]/analytics`                                 | app         | full                                                  | full                | —               | read             | read                     |
| `/[firm]/ledger`                                    | app         | full                                                  | full                | own             | read             | read                     |
| `/[firm]/settings`                                  | app         | → first allowed                                       | → first allowed     | → first allowed | → first allowed  | → `firm`                 |
| `/[firm]/settings/firm`                             | app         | full                                                  | —                   | —               | —                | read                     |
| `/[firm]/settings/team`                             | app         | full                                                  | read + assign (Q15) | —               | —                | read                     |
| `/[firm]/settings/templates`                        | app         | full                                                  | full                | —               | —                | read                     |
| `/[firm]/settings/preferences`                      | app         | full                                                  | full                | full            | full             | — (personal)             |

Modal intercepts follow the access of the route they intercept.
**Support** is derived, not hand-written per route: `read` wherever OWNER has access, except
routes whose only purpose is acting (`candidates/new`, `jobs/capture`, `focus`) and personal
routes (`settings/preferences`), which are `—`.

### 2.3 Platform tier — `/admin/…` (`PLATFORM_ADMIN` only; everyone else → not-found)

| Route                            | Purpose                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                         | Overview: firm count by status, seats used vs. sold, active users, AI spend (all derived)                                                                   |
| `/admin/firms`                   | Firms list: name, slug, status, plan, seats used/limit, **over-limit flag (derived)**, owner, created, last activity; search + status filter in the URL                                    |
| `/admin/firms/new`               | Create firm: name, slug (live reserved/taken check; rules in Q18), plan (its limits are copied onto the firm), timezones, contact phone (optional), owner name + email → creates the firm (`ONBOARDING`) and the OWNER's invite |
| `/admin/firms/[firmId]`          | Firm overview: profile, status, plan, usage, owner; actions: edit, suspend / reactivate, **View workspace** (starts support view)                           |
| `/admin/firms/[firmId]/users`    | Firm members + pending invites; resend (new token, +7 days) / revoke invite; deactivate user                                                                                     |
| `/admin/firms/[firmId]/plan`     | Plan, seat and candidate limits, change history (derived from `PLAN_CHANGED` ledger entries; no separate entity)                                                                                                             |
| `/admin/firms/[firmId]/activity` | That firm's audit trail, incl. every support view                                                                                                           |
| `/admin/plans`                   | Plan catalogue (name, limits, features). UI only — no billing (CLAUDE.md)                                                                                   |
| `/admin/audit`                   | Platform audit log: firm created/suspended, plan changed, support views, admin sign-ins                                                                     |
| `/admin/system`                  | Backend health, scraper runs, AI spend by firm/model                                                                                                        |
| `/admin/team`                    | BenchQ staff with `PLATFORM_ADMIN`; invite / deactivate                                                                                                     |

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

| Condition                                     | Result                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Signed out                                    | redirect `/sign-in?returnTo=<path>`                                                                                      |
| Slug unknown                                  | not-found                                                                                                                |
| Firm user, different firm                     | not-found                                                                                                                |
| Platform admin, no support view for this firm | **Support interstitial**: "Open a read-only support view of {firm}?" + required reason → starts the view. Not a redirect. Only for a firm that exists: an unknown slug is not-found for a platform admin too (the "Slug unknown" row comes first) |
| Firm status `SUSPENDED`, firm user            | "Workspace suspended — contact your BenchQ account manager" screen on every route                                        |
| Firm status `SUSPENDED`, support view         | renders normally (read-only)                                                                                             |
| Otherwise                                     | page, subject to the route's access level                                                                                |

---

## 3. Who is signed in — the principal

The session holds a **principal**, not a user + role. Contract (approved 2026-10-14; the Zod
shapes are in `docs/02-DATA-CONTRACTS.md` §3.1, see §7):

```ts
type Principal =
  | { kind: "firm"; userId: string; firmId: string; role: FirmRole }
  | {
      kind: "platform";
      userId: string;
      role: "PLATFORM_ADMIN";
      support: SupportView | null;
    };

type SupportView = {
  id: string;
  firmId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
};
```

- `FirmRole` has **one** declaration: the Zod enum in `src/lib/schemas/enums.ts`. The duplicate in
  `session-store.ts` is deleted.
- `SessionUser` / `SessionFirm` in the store are replaced by types inferred from Zod
  (`User`, `Firm`, `Principal`).
- The firm in context comes from the URL (§1.3). For a firm principal, `principal.firmId` must
  equal the URL firm's id, otherwise not-found.
- **Signing in (Q25):** everyone signs in on `/sign-in` with email + password against the seeded
  accounts in the mock layer (`docs/03` §3.2): every fixture firm user and the Super Admin, one
  shared demo password. There is **no principal switcher**, in development or production: to act as
  someone else, sign out (user menu) and sign in as them. Mock auth, not security (Phase D).

---

## 4. Read-only support view (Q10)

| Rule         | Detail                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry        | `/admin/firms/[firmId]` → **View workspace**, or the firm-layout interstitial. A reason is required (free text, min. 10 chars)                                   |
| Start        | creates a `SupportView` (60-minute expiry) and a ledger entry `ADMIN_ACCESS` (actor `PLATFORM_ADMIN`, `firmId` set) — visible in the firm's own `/[firm]/ledger` |
| While active | persistent banner on every firm page: "Support view of {firm} · read-only · started {time} by {admin} · Exit". Banner can't be dismissed                         |
| Permissions  | `can()` returns `false` for **every** action. Route access per §2.2 "Support" column. Data scope: whole firm                                                     |
| Exit         | Exit button, expiry, or sign-out → ends the view, writes `ADMIN_ACCESS_END`, returns to `/admin/firms/[firmId]`                                                  |
| Isolation    | one support view at a time; starting a view of firm B ends firm A's                                                                                              |
| Length       | **fixed 60 minutes, no extension.** To continue, start a new view: new reason, new `SupportView`, new `ADMIN_ACCESS` ledger entry (Q20) |
| What the firm sees | the admin's **name** and the **reason as written**, never the admin's email (Q20) |
| Never        | impersonating a user, writing firm data, exporting resumes, sending outreach                                                                                     |

---

## 5. Registry v2

`src/lib/routes/registry.ts` extends the Phase A registry.

```ts
type Area = "public" | "firm" | "platform" | "dev";

interface RouteDef {
  id: string; // "candidates.detail", "admin.firms.detail"
  path: string; // "/[firm]/candidates/[id]", "/admin/firms/[firmId]"
  title: string;
  area: Area;
  shell: "auth" | "app" | "studio" | "focus" | "admin";
  access: // by area
    | { kind: "public" }
    | { kind: "firm"; roles: Record<FirmRole, Access>; support?: Access } // support defaults per §2.2
    | { kind: "platform" }; // PLATFORM_ADMIN only
  onDenied?: "forbidden" | "landing";
  nav?: {
    section: "workspace" | "settings" | "preferences" | "admin";
    order: number;
    icon?: LucideIcon;
  };
  shortcut?: string;
  palette?: boolean;
  parent?: string; // breadcrumbs / back
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
    welcome/                       → OWNER first run
    (app)/                         → app shell (sidebar + topbar); groups below don't change URLs
      (workspace)/                 → daily work, every role
        dashboard · candidates · jobs · applications · resumes · outreach · followups
      (manage)/                    → oversight, OWNER + MANAGER (+ VIEWER read)
        analytics · ledger
      settings/                    → sections gated per §2.2
        firm (OWNER) · team (OWNER manages, MANAGER read + assign) · templates · preferences
      @modal/                      → intercepts for candidates/new, jobs/capture
    (studio)/resumes/[id]
    focus/
  dev/design-system/
  not-found.tsx · global-error.tsx

src/features/                      → screen logic, one folder per area
  dashboard/  owner-dashboard.tsx · manager-dashboard.tsx · bde-dashboard.tsx · viewer-dashboard.tsx
  team/       team-table.tsx · invite-member-dialog.tsx (OWNER) · assign-candidates-panel.tsx (OWNER, MANAGER)
  …           other areas get role files only when a screen really differs by role

src/lib/auth/permissions.ts        → the one role × action table (Phase C)
```

Rules (Q14):

- `page.tsx` stays thin: read params, pick the view, render. Role → view choice is the only
  branching allowed in a page, and it goes through `can()` / a principal helper, not `role ===`.
- A role file exists only when the screen's **layout** differs by role (today: dashboard).
  Differences in which buttons show are handled by `<Can>` inside one shared view, not by copies.
- Group placement is documentation for humans; access is still decided only by the registry.

Each area has its own `not-found.tsx`, `error.tsx`, `loading.tsx`.

---

## Phases

| Phase  | What                                                                                                                                                                                       | Depends on       | Status                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------- |
| **A**  | Route foundation — registry, guards, access/error screens, settings split                                                                                                                  | —                | Done (committed)                   |
| **A2** | Hardening — `hrefFor` everywhere, full table test, one `FirmRole`, dev switcher off in prod                                                                                                | A                | Done (A2.2–A2.9; see result below) |
| **T0** | Groundwork that needs no §7 contract — remove `/sign-up`, `(workspace)`/`(manage)` groups, role views into `src/features/`, active links by route id, team-access TODO, draft §7 contracts | A2               | Done                               |
| **T**  | Tenancy in the frontend — contracts, principal, `/[firm]` URLs, firm-scoped mocks and query keys                                                                                           | A2 + §7 sign-off | Done (PRs 1–4; exit check recorded below) |
| **P**  | Platform tier routes — `/admin/*` shell and pages (all states, mock data), support view                                                                                                    | T, L (from P3)   | In progress — P1–P2 done (#12, #13); P3 next (spec: docs/04 §14) |
| **C**  | Permission policy — `can()`, `useCan`, `<Can>`, scope helpers; delete inline checks                                                                                                        | T, P             | Planned                            |
| **B**  | UI completion audit — every route × principal against `docs/04`                                                                                                                            | C                | Planned                            |
| **S**  | Super Admin flow polish (UI-first) — create firm, invites, plans, suspend, audit, system                                                                                                   | P, B             | Planned                            |
| **L**  | Sign-in with seeded accounts (Q25–Q27) — `/sign-in` against the mock layer's seeded accounts; dev principal switcher removed; user-menu sign-out; mock session shared across tabs | T, P1–P2         | Built, in review — before P3       |
| **M**  | Firm members and invites (firm side) — OWNER invites / resends / revokes on settings/team (Q15); firm pages read pending invites; OWNER card becomes "Seats used"                             | C, S             | Planned (Q23)                      |
| **D**  | Real enforcement — server session, `src/proxy.ts`, `forbidden()`, backend checks                                                                                                           | backend D1/D2    | Later                              |

**Why C moves before B (change from v1):** the audit checks that controls a principal can't use
aren't rendered. Auditing before the policy exists means auditing twice.

---

## Phase A — Route foundation (done)

Delivered as recorded in v1: registry + helpers + tests (`src/lib/routes/`), `RouteGuard`,
`RouteTitle`, sidebar/palette/shortcuts/`?` sheet from the registry, forbidden / not-found /
error / loading screens, record scope → not-found, settings split, `/sign-up`, dev-only
`/design-system`.

**Exit criteria** (from v1; ticked 2026-10-13 only where checked, with how):

- [x] Registry tests pass; no hardcoded route lists remain in the sidebar, palette or shortcuts
      (registry tests; `no-path-literals.test.ts`; those files read `navFor`, `paletteRoutesFor`,
      `shortcutsFor`)
- [x] Every route × role **access value** matches the §2.2 table (22 routes × 4 roles in
      `registry.test.ts`, mutation-checked)
- [x] For every route × role, a direct URL **renders** the page, a read-only page, or the Forbidden
      screen as the table says. Checked in Chrome against `pnpm dev`, switching role with the real
      RoleSwitcher and navigating client-side (no reload): OWNER, MANAGER, VIEWER and BDE × the 22
      firm routes plus `/dev/design-system` and sample record ids — all as the table says
      (Forbidden on exactly the "—" cells; `/welcome` and `/settings` redirect to the landing /
      first allowed section; `/settings` → `firm` for OWNER, `team` for MANAGER, `preferences` for
      BDE and VIEWER). Read-only: for VIEWER the actions are absent where they are buttons or
      links (`New candidate`, `Capture job`, `Upload resume` / `New resume`, `Send email`, and on
      detail pages `Find jobs` / `Build resume` / `Edit`, `Tailor` / `Mark applied` / `Save`,
      `Move to …`). **Checked later (2026-10-19, with persistent demo data):** the application board's drag-and-drop for
      VIEWER: nothing is rendered draggable (`application-board.test.ts`; in Chrome as Rohan: 0 of 263 cards draggable, a mouse drag and Space/arrows move nothing); the mock backend refuses a VIEWER's status change (403) and a BDE's change to someone else's application (404, like a missing one), by the registry's access table (`application-authorization.test.ts`); in Chrome as Adnan: his board shows only his 97 applications, a keyboard drag of his own persists, Sneha's application is not-found
- [x] A BDE opening an unassigned candidate / someone else's application → not-found. Checked in
      Chrome as BDE (user `user_adnan`): `/candidates/cand_09`, `/applications/app_009` and
      `/resumes/resume_cand_09_master` show the not-found state, while `cand_01`, `app_001` and
      `resume_cand_01_master` render. OWNER, MANAGER and VIEWER open all of them
- [x] Unknown URL → not-found (HTTP 404 on `/nope`, `/candidates/cand_01/extra`, `/admin`,
      `/design-system`)
- [x] A thrown error → error card with retry. Checked 2026-10-18 (Phase T PR 4) in Chrome with the dev fault switch (`window.__BENCHQ_MOCK_FAIL__`, docs/03 §3.1): on each main list screen (candidates, jobs, applications, resumes, outreach, follow-ups, analytics, ledger, settings/team) the main call failed → card shown after the client's 2 retries (~3 s), Retry present, fault cleared → Retry recovered the screen; light and dark. Found and fixed on the way: `DataTable` and `jobs/[id]` had no Retry; applications, follow-ups, outreach and analytics had no error state at all (an error read as empty, "Nothing due" or zeros). The dashboards were covered afterwards (per-group errors, docs/04 §13; `dashboard-errors.test.ts`)
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` clean (at the A2 tip: 54 tests; `pnpm build` also
      passes)
- [x] Both themes; 1440 / 1024 / 390 px. Checked 2026-10-18 (Phase T PR 4) in Chrome on the nine main list screens and the suspended screen: the app in a same-origin iframe of exactly that width (the window can't be resized on this machine), page-level horizontal overflow measured at each width: 0 px on all 30 (390 measured at 386 px, stricter); screenshots in light and dark at each width for a sample (390: candidates, applications, suspended; 1024: ledger, outreach; 1440: follow-ups, analytics). Wide tables scroll inside their own container at 390, as intended. Cosmetic: the candidates search box is squeezed at 390 (Phase B)

---

## Phase A2 — Hardening (done)

| #    | Task                                                                                                                                                           | Why                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A2.1 | Commit Phase A on `feat/routes`; open PR                                                                                                                       | 39 uncommitted changes                                         |
| A2.2 | Add `hrefFor(id, params)` + `useHref()` to the registry. Replace all **39** `href="/…"`, **5** `router.push/replace("/…")` and **1** `redirect("/…")` literals | Phase T moves every URL; this makes the move a one-file change |
| A2.3 | Add the grep test from §5                                                                                                                                      | stops new literals                                             |
| A2.4 | Replace the 7 spot checks with the full §2.2 table test (firm roles only for now)                                                                              | the test is the spec                                           |
| A2.5 | One `FirmRole`: keep the Zod enum, delete the store's copy, re-type helpers                                                                                    | two declarations                                               |
| A2.6 | `useRouteAccess`: unregistered path → `none` (not `full`)                                                                                                      | fail closed                                                    |
| A2.7 | RoleSwitcher behind `NEXT_PUBLIC_SHOW_DEV_TOOLS=true`, off by default; add to `.env.example`                                                                   | it ships to production today *(Superseded by Q25: the switcher is removed in Phase L.)* |
| A2.8 | Move `/design-system` to `/dev/design-system`                                                                                                                  | frees the top level for firm slugs                             |
| A2.9 | Fix the stale `iconsax-react` comment in `next.config.ts`                                                                                                      | hygiene                                                        |

**Exit:** no path literals outside `src/lib/routes/`; table test covers every firm route × role;
switcher hidden in `pnpm build && pnpm start`; Phase A exit criteria ticked; checks green.

**Result (2026-10-13), one commit per task on `feat/routes-a2`:**

| Exit criterion                                | State                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No path literals outside `src/lib/routes/`    | Met. 60 literals replaced; `no-path-literals.test.ts` enforces it (mutation-checked). `[firm]` is not assumed anywhere                                    |
| Table test covers every firm route × role     | Met. 22 routes × 4 roles, plus `onDenied`, public and dev routes; fails if a route has no row                                                             |
| Switcher hidden in `pnpm build && pnpm start` | Met, with a positive control (absent from HTML and chunks when `NEXT_PUBLIC_SHOW_DEV_TOOLS` is unset; present when `true`) *(Moot after Phase L: the switcher is removed, Q25.)* |
| Phase A exit criteria ticked                  | Partly. Role × route renders, record scope, unknown URL and the checks are ticked; the error card, both themes and the three widths are not (see Phase A) |
| Checks green                                  | Met. typecheck, lint, test (54), build all exit 0                                                                                                         |

Notes for Phase T: the active-link checks in `sidebar.tsx` and `settings/layout.tsx` still compare
the pathname with `route.path`, which will not match once paths gain `[firm]`. `useHref()` is a plain
function today and is where the firm segment is added. Moving a route makes `tsc` fail until
`.next/types` is regenerated (`pnpm build` or delete `.next`).

---

## Phase T — Tenancy in the frontend

§7 contracts were **approved on 2026-10-14** (Q16–Q21); the approved shapes are in `docs/02` §3.1. Phase T implements them, and nothing earlier may.

| #   | Task                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | ~~Contracts in `docs/02`~~ — **done**: drafted in T0, approved 2026-10-14, now `docs/02` §3.1 (drop the "not yet implemented" note there when T2 lands) |
| T2  | Zod schemas from `docs/02` §3.1 (slug pattern, `Invite` refinement `firmId` null ⇔ `PLATFORM_ADMIN`). `SessionSchema` limits move to `Firm` (copied from the `Plan`) and usage becomes **derived**: `seatsUsed` = active users + pending unexpired invites; `activeCandidates` = `ON_BENCH` / `INTERVIEWING` / `OFFER`; over-limit flags; block new additions over a limit (Q17); also derive **`canAddSeat` / `canAddCandidate` = usage < limit**, which drive the block, separately from the `isOver*` flags (usage > limit). Define `InviteSchema`'s **base object separately** and apply the `superRefine` on top, so `.extend` / `.pick` still work on the base — **done in PR 1** (`feat/tenancy`) |
| T3  | Fixtures: add `firmId` to every firm-scoped fixture, **including agent and tailoring runs** (Q21); add a **second firm** (small: 3 users, 5 candidates), a platform admin, and a few invites (pending, expired, accepted) so isolation and limits are testable. Besides the second active firm, add **two tiny firms**: one `SUSPENDED` and one `ONBOARDING` (owner invite pending, no users). T8 and Phase P need both statuses — **done in PR 1** (`feat/tenancy`) |
| T4  | Session store → `Principal`; dev principal switcher lists every fixture principal — **done in PR 2** (`feat/tenancy-session`) *(Superseded by Q25: the switcher is removed in Phase L.)* |
| T5  | Query key factory `src/lib/query/keys.ts`; every firm key starts with `firmId`; hooks read `firmId` from firm context; adapters take `firmId` and mocks filter by it — **done in PR 2** (`feat/tenancy-session`) |
| T6  | Move firm routes under `src/app/[firm]/` with the `(workspace)` / `(manage)` groups (§6, Q14); move the four dashboards into `src/features/dashboard/`; firm layout implements §2.5; registry paths gain `[firm]`; fix the active-link checks in `sidebar.tsx` and `settings/layout.tsx` to match on route id, not raw path. **The firm comes from the URL:** `useFirmId()` reads the `[firm]` segment through the firm layout's context, the session store no longer holds a firm, and a firm principal whose `firmId` doesn't match the URL firm gets not-found (§2.5) — **done in PR 3** (`feat/tenancy-urls`): the firm gate (`src/components/routes/firm-gate.tsx`) runs `firmOutcome()` (`src/lib/tenancy/firm-outcome.ts`, tested for every fixture principal × every slug); `useHref()` fills the slug from the URL firm, or, off a firm page, from the signed-in user's own firm. **Slug-less URLs from before T6** (`/candidates`, …) are **not-found, not redirected** (Q22): there are no such links in the wild (the prototype was only demoed), a redirect would be a second route list, and principle 4 stays simple. The platform support interstitial (§2.5 row 4) waits for Phase P |
| T6b | ~~Remove `/sign-up` and its link from `/sign-in` (Q11)~~ — done early in T0                                                                                                                                                                                                                                                 |
| T7  | `/` landing per principal; `/[firm]/welcome` for OWNER first run — **done in PR 3**: `/` is `src/components/routes/landing.tsx`; **first run = the user has never been active** (`lastActiveAt` null, true right after an OWNER accepts the firm's invite; no new field). **Leaving `/welcome` sets it** (`useFinishFirstRun` → `sessionApi.finishFirstRun`; the page has one exit today, and any later skip or setup step must use the same hook). The dev switcher lists the **GSC owner's pending invite** ("Sunita Rao"): picking it accepts the invite in the mock (user created never-active, firm `ONBOARDING` → `ACTIVE`, `INVITE_ACCEPTED` in its ledger) and lands on `/welcome`. Sign-in honours `?returnTo=` for same-origin paths only (`safeReturnTo`); the platform admin → `/admin` arrives with Phase P |
| T8  | Tests: a firm-A principal can't read firm-B data through any hook (mock layer); slug → firm resolution; §2.5 table — **done in PR 4** (`feat/tenancy-tests`): the mock backend now checks membership on every firm-scoped call (`src/mocks/membership.ts`: another firm → 404 like a missing firm, signed out → 401); `src/mocks/membership.test.ts` calls every firm-scoped adapter method a hook can reach as a firm-A member with firm B's own valid ids (all 404; firm B's member gets through; writes leave B untouched; a new mock method without a row fails the test); slug → firm resolution in `firm-outcome.test.ts` (exact slug only); §2.5 table from PR 3 |

**Exit:** every firm URL carries the slug; switching principal between firm A and B never shows
the other firm's data (checked on every list screen); query keys all include `firmId`; checks green.

**Exit check (2026-10-18, PR 4):**

- [x] Every firm URL carries the slug: registry test (firm routes are exactly the `/[firm]/` paths), `no-path-literals.test.ts` (no app path in any string literal), and in Chrome every `href` on the 10 list screens of firm A and firm B as their OWNER: all carry the page's own slug (the only other link is the sidebar's `/dev/design-system`)
- [x] Switching principal between firm A and firm B never shows the other firm's data: in Chrome on all 10 list screens (dashboard, candidates, jobs, applications, resumes, outreach, follow-ups, analytics, ledger, settings/team), both directions (Imran Shaikh ↔ Lakshmi Iyer), the screen sampled every 50 ms from the switch until the target firm's same screen settled: 0 samples with the other firm's names or record ids out of 53–69 per run; every run ended on its own firm's data
- [x] Query keys all include `firmId`: `keys.test.ts` (every firm key starts with the firm id; no literal keys in hooks) and `firm-boundary.test.ts` (hooks get the firm only from `useFirmId()`)
- [x] Checks green: typecheck, lint, tests, build

---

## Phase P — Platform tier routes

| #   | Task                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Registry v2 (§5): `area`, `access` union, `admin` shell and nav section, helpers on `Principal` — **done in PR 12** (`feat/platform-shell`): `RouteAccess` union, `area: "platform"`, `admin` shell / nav section; every helper (`accessFor`, `accessForPath`, `canOpen`, `navFor`, `paletteRoutesFor`, `shortcutsFor`, `landingFor`) takes a `Principal`; the Support column is derived (`supportAccess`: read where OWNER has access, `none` on `welcome`, `candidates/new`, `jobs/capture`, `focus`, `settings/preferences`) and table-tested against §2.2. Platform sessions are real: the mock backend, the session store (`principal`, `user` or `platformUser`) and the dev switcher sign in as a Super Admin; the membership check refuses a platform admin on every firm call (404) until P4 |
| P2  | `src/app/admin/layout.tsx`: admin shell (same frosted shell, admin nav), platform guard → not-found for others — **done in PR 12**: `src/app/admin/layout.tsx` → `PlatformGate` (signed out → sign-in with returnTo; any non-admin → not-found, no shell) → `AppShell variant="admin"` (admin nav, no firm notifications). `/admin` is a placeholder page until P3. The tab title names a platform route only to a platform admin (principle 4). A platform admin on a firm URL gets `support-required` (§2.5 row 4) — a plain screen with "Back to admin" until P4 builds the interstitial; ⌘K for an admin already lists only platform routes (P5 adds firms search and "View workspace"). Follow-up PR: a platform admin on an **unknown** firm slug gets not-found (an existing one the interstitial); an unknown `/admin/…` URL renders not-found **inside the admin shell** (`admin/[...unknown]` catch-all + `admin/not-found.tsx`; catch-alls aren't registry routes) |
| P3  | Every route in §2.3 with real layout and skeleton / empty / error (and not-found for `[firmId]`), on mock adapters `platformApi` (`firms`, `plans`, `audit`, `system`, `team`) |
| P4  | Support view (§4): start / exit / expiry, interstitial, banner, ledger entries, support access column. **Plus `/invite/[token]` (Q26, moved from S):** shows the firm's name and the offered role, the person sets name + password, then is signed in; invalid / expired / revoked / already-accepted states (docs/04 §2.1); an OWNER accepting makes an `ONBOARDING` firm `ACTIVE` and logs `INVITE_ACCEPTED` (Q18), then lands on `/welcome` (T7). Browser check: accept GSC's pending OWNER invite → `/gachibowli-staffing/welcome` → finish → dashboard. The token is an opaque mock-only secret (docs/02), no contract change. A `SUSPENDED` firm's invite is blocked with the "Workspace suspended" message and stays `PENDING` (Q28) |
| P5  | ⌘K for admins: firms search, "View workspace", admin nav; firm-scoped commands hidden outside a firm                                                                           |
| P6  | Tests: platform table test rows, support view grants no actions, non-admin → `/admin` not-found; **the §2.5 platform-admin rows**: no support view for this firm → support interstitial (reason required, not a redirect), and a support view of a `SUSPENDED` firm renders normally (read-only), added to `src/lib/tenancy/firm-outcome.test.ts` |

**Demo data persists** in the browser (docs/03 §3.3); its **Reset demo data** is on the `/admin/system` placeholder (moved there in P3). **P3–P6 come after Phase L** (Q25): they are built and checked signed in as the seeded Super Admin. Screens are functional skeletons here; visual polish is Phase S. `docs/04-SCREENS.md` gets an
"Admin" section before P3 (UI-first: the screen spec comes first): **docs/04 §14**, approved 2026-10-19 with the Q29 decisions.

**Fixture dates (do in P3, before any admin screen shows invites next to the ledger):** invite dates
are relative to load time (`invitesAt(now)` in `src/mocks/tenancy.ts` shifts them from
`FIXTURE_NOW`), but ledger fixture dates are still fixed. Shift the ledger entries about invites
(`INVITE_SENT`, `INVITE_ACCEPTED`, `INVITE_REVOKED`) by the same offset, so each entry's date matches
its invite's `createdAt` (sent) or acceptance. Add a fixture test that ties every invite ledger entry
to its invite's date.

**Exit:** a platform admin can list firms, open one, start a support view, browse the firm
read-only with the banner, exit, and see the visit in both audit logs; a new firm's OWNER accepts
their invite on `/invite/[token]` and lands on `/welcome`.

---

## Phase C — Permission policy

As v1 Phase C, typed on `Principal`:

- `src/lib/auth/permissions.ts`: `can(principal, action, resource?)` with the role × action
  matrix as a table at the top. Platform actions added: `firm.create`, `firm.edit`,
  `firm.suspend`, `firm.viewWorkspace`, `plan.edit`, `invite.resend`, `invite.revoke`,
  `platformTeam.manage`. Support view → every firm action `false`.
- Firm team actions (Q15): `member.invite`, `member.remove`, `member.changeRole`,
  `member.deactivate` → **OWNER only**; `candidate.assign` (assign / unassign BDEs on a
  candidate) → OWNER and MANAGER; `team.view` → OWNER and MANAGER.
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
dangling `·` when `promptVersion` is null; full settings UIs. From Phase T: sign-out in the user menu moved to Phase L (L3: without the switcher it is the only way to change accounts); **"Not found" as the tab title on not-found pages** (the title comes from the path, so a gate not-found under `/[firm]/candidates` still reads "Candidates"). From PR 4: outreach has no skeleton or empty state for its thread list; the candidates search box is squeezed at 390 px. (The dashboards' missing error states were fixed before Phase P: docs/04 §13.) **Two scripted navigations didn't happen** (right after sign-in; job page → studio) during the #17 browser checks. Cause unconfirmed. Investigate, given the earlier sign-in redirect bug. The OWNER rollup is labelled "Active users" until firm pages read pending invites (Phase M).

---

## Phase S — Super Admin flow (UI-first)

Planned separately once P and B are done: screen specs in `docs/04`, then polish of create firm,
invites, plans, suspend/reactivate, audit, system. Out of scope until then.

**Open questions for Phase S** (product owner; decide before building the invite and suspend flows):

1. ~~**Opening an invite to a `SUSPENDED` firm.**~~ **Decided (Q28):** blocked with the "Workspace suspended" message; the invite stays `PENDING`. *(Original question:)* What does `/invite/[token]` do when the firm is
   suspended? Owner leans towards **blocking it** with the "Workspace suspended" message.
2. **Seats held by pending invites of a suspended firm.** Do pending invites to a `SUSPENDED` firm
   still reserve seats (Q17 says pending invites reserve a seat), or are they released while it is
   suspended?

---

## Phase L — Sign-in with seeded accounts (Q25–Q27) — built (PR on `feat/seeded-sign-in`, in review)

Everyone signs in through `/sign-in` (email + password) against seeded dummy accounts in the mock
layer; the dev principal switcher goes, in development and production. Accounts, password and
landings: `docs/03` §3.2. Mock auth, not security: real enforcement stays Phase D.

**Where it sits: after P1–P2, before P3.** P3's admin screens and P4's support view are built and
checked as a signed-in Super Admin; building them on the switcher would mean re-checking them once it
is gone, and P4's "exit support view → back to `/admin`" and P6's "non-admin → not-found" are exactly
the flows a real sign-in exercises. P1–P2 already made platform sessions real, so this step is small.

| #   | Task |
| --- | ---- |
| L1  | Mock sign-in: `sessionApi.signIn(email, password)` checks the seeded accounts (`docs/03` §3.2); a wrong password, an unknown email and an inactive account all get the same "Email or password is incorrect" (no account enumeration). Firm users' and the Super Admin's fixture emails move to the seed pattern, and so do invite emails (accepted OWNER invites must keep matching their user, `fixtures.test.ts`). Passwords live only in the mock layer, never on the `User` contract |
| L2  | `/sign-in` signs in for real (no pre-filled default user) and keeps `returnTo` (same-origin only); the app **starts signed out** (no default session) |
| L3  | User menu in the topbar (firm and admin shells, the suspended and support-required screens): name, role, firm, **Sign out**. Moved from the Phase B gaps: without the switcher it is the only way to change accounts |
| L4  | The mock session survives a reload in every build and is **shared across tabs** (Q27): the signed-in account id in `localStorage` (a stand-in for the session cookie until Phase D). A `storage` listener applies a change from another tab: signed out there → signed out here (to `/sign-in` with `returnTo`); signed in as someone else there → this tab follows (cache cleared, §T5). Replaces the dev-only `DevSessionRestore`; mock data still resets on reload |
| L5  | Remove the switcher and everything that exists only for it: see the inventory below. `NEXT_PUBLIC_SHOW_DEV_TOOLS` goes from `.env.example` and `docs/01` if nothing else reads it |
| L6  | Tests sign in through the same path (a test helper calling `sessionApi.signIn` with the seed email and demo password); a sign-in test per seeded account checks its landing (the §3.2 table); wrong password / unknown email / inactive → the same error; `returnTo` honoured; reload keeps the session; sign-out clears it; a sign-out in another tab (a `storage` event) signs this tab out. `/welcome` stays covered by the existing unit tests (Q26). Browser check: sign in as each seeded account; two tabs, sign out in one, the other follows |

**Exit:** no switcher anywhere (code, chunks, docs other than history); every seeded account signs in
on `/sign-in` and lands where `docs/03` §3.2 says; sign-out works from every shell and reaches every
open tab; checks green.

**Decided (2026-10-19):**

1. **`/welcome`** (Q26): unit tests only in Phase L, no mock invite page. The real `/invite/[token]`
   moves to P4, where `/welcome` gets its browser check.
2. **Session** (Q27): `localStorage`, shared across tabs; sign-out in any tab signs out every tab.
   Two accounts at once need a private window or a second browser profile (`docs/03` §3.2).

**As built:** sign-in is `sessionApi.signIn` (mock: `signInWithPassword` in `src/mocks/auth.ts`, one
generic 401 for any failure); the session is the account id in `localStorage` (`benchq.session`), read
only by the mock backend; `useSessionSync` (query provider) bootstraps it and follows other tabs
through `sessionApi.watch`, applying changes with `applySession` → `setSession` / `signOut`, so the
cache-clear-and-remount boundary is unchanged. After sign-in, `returnTo` is used only if the new account can open it (`signInTarget`): after a sign-out on a shared screen the next person may be from another firm. `UserMenu` sits in the firm and admin topbars and on the
support-required screen (the suspended screen has its own Sign out). Tests sign in with
`signInAs(accountId)` (`src/mocks/sign-in-as.ts`) through `sessionApi.signIn`.

**What depended on the switcher** (all changed or deleted in L5–L6):

| File | What it does with the switcher |
| ---- | ------------------------------ |
| `src/components/dev/principal-switcher.tsx` | The switcher itself (`NEXT_PUBLIC_SHOW_DEV_TOOLS`) — delete |
| `src/components/layout/topbar.tsx` | Renders it — becomes the user menu (L3) |
| `src/components/app/suspended-state.tsx` | Renders it above the message — remove (it already has Sign out) |
| `src/components/routes/support-required-state.tsx` | Renders it above the message — replace with the user menu's sign-out |
| `src/components/dev/dev-session-restore.tsx` | Remembers the switcher's principal across reloads — replaced by L4 |
| `src/app/providers.tsx` | Mounts `DevSessionRestore` — mounts L4's restore instead |
| `src/app/sign-in/page.tsx` | Signs in as the default user via `useDevSignInAs`; pre-filled fake email — real sign-in (L2) |
| `src/lib/hooks/use-session.ts` | `useDevPrincipals`, `useDevSignInAs` (with `navigateTo` / pending) — becomes `useSignIn`; `useCommitPendingSession` stays (sign-in → `returnTo`) |
| `src/lib/api/session.ts` | `devPrincipals`, `devSignInAs` — become `signIn(email, password)` |
| `src/mocks/session.ts` | `devPrincipals`, `devSignInAs`, `DEV_INVITE_ACCEPTANCES` (the GSC acceptance) — delete; `signIn` checks the seeds |
| `src/mocks/auth.ts` | `signInAs(userId)`, starts signed in as `DEFAULT_USER_ID` — starts signed out; sign-in by credentials |
| `src/lib/schemas/session.ts` | `DevPrincipalOptionSchema` (dev-only shape) — delete |
| `src/lib/query/keys.ts` | `session.devPrincipals()` key — delete |
| `src/lib/stores/session-store.ts` | `DEFAULT_SESSION` as the initial (signed-in) state; `restoring` for the dev restore — initial state signed out; `DEFAULT_SESSION` stays only as a test fixture if still needed |
| `.env.example`, `docs/01` §auth | `NEXT_PUBLIC_SHOW_DEV_TOOLS` — remove if unused |

| Test | Uses |
| ---- | ---- |
| `src/lib/stores/session-store.test.ts` | lists dev principals, `devSignInAs` (firm user, Super Admin), default session |
| `src/lib/query/principal-boundary.test.ts` | `devSignInAs` to switch OWNER → BDE and across firms; `DEFAULT_SESSION` |
| `src/lib/tenancy/firm-outcome.test.ts` | `devSignInAs` for every fixture principal × slug (§2.5) |
| `src/lib/routes/landing.test.ts` | `devSignInAs` for every firm user's landing |
| `src/mocks/membership.test.ts` | `devSignInAs` as firm A / firm B owners |
| `src/mocks/isolation.test.ts` | `devSignInAs` as a member of each firm |
| `src/mocks/invites.test.ts` | accepts the GSC invite through `devSignInAs("inv_gsc_owner")` — becomes a direct `acceptInvite` test |
| `src/lib/query/keys.test.ts` | the `session.devPrincipals` key |
| `src/features/dashboard/dashboard-errors.test.ts` | `DEFAULT_SESSION.firm` as the fixture firm (not the switcher; unaffected unless `DEFAULT_SESSION` goes) |

Docs that also mention the switcher, to update with L (not history files): `docs/01` (auth section,
env var), `docs/05` (topbar contents), `docs/04` §1 (topbar diagram: `[role] [me]`), `docs/03`
(§3.1 notes), `docs/integration/05-analytics.md` (its check says "via the role switcher").
History (`docs/06`, `docs/CURRENT_STATE.md`, `docs/archive/`, the A/A2/T rows above) stays as written.

---

## Phase M — Firm members and invites (firm side) — approved 2026-10-18 (Q23)

The firm half of the invite flow. Today only the Super Admin side is planned (S: the OWNER's invite
when a firm is created, resend / revoke on `/admin/firms/[firmId]/users`). `/invite/[token]`, which
both halves rely on, arrives in P4 (Q26); until then nothing in the UI accepts an invite.

| #   | Task |
| --- | ---- |
| M1  | Firm-scoped invites adapter: list a firm's invites (with `effectiveInviteStatus`), create, resend (same row, new token, +7 days, Q19), revoke; mock behind the membership check |
| M2  | `settings/team`: OWNER invites a member (email + role, never OWNER, A10), resends, revokes, sees pending / expired invites; blocked when `canAddSeat` is false (Q17). MANAGER sees the list read-only (Q15); BDE / VIEWER can't open the page |
| M3  | Firm pages read pending invites: the OWNER card becomes **"Seats used x / seatLimit"** from `deriveFirmUsage` (A1), the same function and data `/admin` uses, so the two can't disagree; a test renders both from one fixture state |
| M4  | Ledger, with the approved actions only (docs/02): `INVITE_SENT` on invite, `INVITE_REVOKED` on revoke, `INVITE_ACCEPTED` on acceptance, in the firm's own ledger (Q20). A resend logs another `INVITE_SENT` with the summary "Invite resent to <email>" (Q24) |
| M5  | Tests: the Q15 matrix through `can()` (OWNER only for `member.*`), the seat block at the limit, resend keeps the row and resets `expiresAt`, a firm can't see or touch another firm's invites |

**Why after S, depending on C and S:**

- **C** supplies the rules the screen must obey: `member.invite / remove / changeRole / deactivate`
  are OWNER only and MANAGER is read-only (Q15). Building the controls before `can()` would add the
  inline role checks Phase C deletes.
- **S** builds what both halves share: the invite adapter and its mock state (resend, revoke), and
  the answers to the open Phase S questions (whether a suspended firm's pending invites hold seats).
  Those answers change the seat count M3 shows, so M can't settle it first. The `/invite/[token]`
  acceptance page itself comes earlier, in P4 (Q26).
- **Not in P:** P is the platform tier on mock data; this is a firm screen with firm permissions.
  **Not folded into S:** S is the Super Admin's flow and is planned with its own screen specs;
  keeping the firm side separate keeps each phase reviewable, while M1 reuses S's adapter.
- **Until M:** the OWNER card says "Active users" (a count, no limit) and nothing on a firm page
  claims a seat count (asserted in `dashboard-errors.test.ts`), so firm and admin numbers can't
  disagree.

---

## Phase D — Real enforcement (after backend D1/D2)

1. Backend users, firms, roles, platform admins, invites and support views; every endpoint scopes
   by `firmId` and checks the principal.
2. Server-readable session cookie; the frontend reads the principal server-side.
3. `src/proxy.ts` for optimistic redirects only (signed out → `/sign-in`).
4. `forbidden()` + `forbidden.tsx`; firm and admin layouts check the principal on the server. Until then the gates run in the browser, so a not-found under `/[firm]/…` or `/admin/…` (unknown slug, another firm, a non-admin at `/admin`, an unknown admin URL) answers **HTTP 200** with the not-found screen; the 404 status arrives with this step.
5. Client `scope*` helpers deleted. The mock sign-in (seeded accounts, demo password, the session kept
   in `sessionStorage`) is replaced by the backend's users, passwords and session cookie. (The dev
   principal switcher was already removed in Phase L, Q25.)

---

## 7. Contract sign-off — approved 2026-10-14

These new contracts (CLAUDE.md: no new entity without product sign-off) were **approved on
2026-10-14** with the answers in §0 Q16–Q21. The shapes, one line per field, are in
`docs/02-DATA-CONTRACTS.md` §3.1. This table is only the index; if the two disagree, `docs/02` wins.

| Contract                   | Fields (approved)                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Principal`, `SupportView` | §3. `SupportView`: fixed 60 minutes, no extension (Q20)                                                                                                                                                            |
| `Firm` additions           | `status: "ONBOARDING" \| "ACTIVE" \| "SUSPENDED"`, `planId` (required), `seatLimit`, `candidateLimit` (effective, copied from the plan), `contactPhone: string \| null`, `createdAt`; slug rules in Q18               |
| `Plan`                     | `id, name, seatLimit, candidateLimit, features: string[] (display labels), isActive` (no prices — no billing). A template: limits are copied onto a firm when assigned                                             |
| `Invite`                   | `id, firmId \| null (null = platform team), email, role, invitedByUserId, status: "PENDING" \| "ACCEPTED" \| "REVOKED" \| "EXPIRED", expiresAt (+7 days), createdAt`; refinement `firmId` null ⇔ `PLATFORM_ADMIN` |
| `PlatformUser`             | `id, name, email, role: "PLATFORM_ADMIN", isActive, lastActiveAt`                                                                                                                                                  |
| `firmId` on records        | Job, Application, Resume, Record, Document, Inbox, Followup, **agent and tailoring runs**; LedgerEntry nullable (null only for platform-only events, Q20). Company stays global (Q13)                              |
| Ledger actions             | add `ADMIN_ACCESS_END`, `FIRM_CREATED`, `FIRM_SUSPENDED`, `FIRM_REACTIVATED`, `PLAN_CHANGED`, `INVITE_SENT`, `INVITE_ACCEPTED`, `INVITE_REVOKED`. No `PlanChange` entity                                           |
| Derived, never stored      | `seatsUsed`, `activeCandidates`, over-limit flags (Q17)                                                                                                                                                            |
