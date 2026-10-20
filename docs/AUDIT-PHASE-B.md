# Phase B — UI completion audit

Step 1 of 07 Phase B: the audit only. Nothing here is fixed yet. Each finding has an ID, and the fix PRs
at the end refer to those IDs.

| | |
|---|---|
| Date | 2026-10-19 |
| Base | `codex/json-data-migration` @ `b8cce4a` (merge of #23, Phase C done) |
| Specs checked against | docs/04 (screens, §1.3 keyboard map, §2.1 sign-in, §2.2 welcome, §11 responsive, §13 dashboards, §14 admin), docs/07 §2.2 (access table), §2.5 (gate order), Phase B known gaps |
| Build | production (`pnpm build && pnpm start -p 3100`), Chrome |
| Accounts | signed in through `/sign-in` as the seeded accounts (docs/03 §3.2): Imran (OWNER), Fatima (MANAGER), Adnan (BDE), Rohan (VIEWER) at Hyderabad Tech Staffing; Lakshmi (OWNER, Secunderabad Talent Labs) for the other-firm checks; Sana (Super Admin) on `/admin` and in a support view of Hyderabad Tech Staffing; and signed out |

## Severity

| Severity | Meaning | Count |
|---|---|---|
| **Blocks use** | the screen claims to do something it doesn't; work is lost | 2 |
| **Wrong behaviour** | differs from the spec or a CLAUDE.md rule; the user can work around it | 28 |
| **Cosmetic** | looks or reads wrong; behaviour is correct | 6 |

## Method

1. **Route × principal sweep.** For each account, every registry route was loaded in a same-origin iframe
   of the production build (the browser window can't be resized on this machine). On each load the
   sweep recorded the final URL, tab title, gate outcome (page / Forbidden / not-found / interstitial /
   redirect), heading, the action controls shown, busy indicators, and any visible error. The
   outcomes were compared with 07 §2.2 and §2.5. Detail routes were also loaded with an unknown id, and
   firm routes with the other firm's slug.
2. **Widths.** Every route was loaded at 1440, 1024 and 390 px as OWNER (firm tier) and as Super Admin
   (platform tier). The sweep measured page-level horizontal overflow and content clipped by its parent.
   Containers that scroll on purpose (`overflow: auto/scroll`) were excluded. A sample was also
   screenshotted at 390.
3. **Themes.** Every route in light and dark, as OWNER and as Super Admin. A heuristic WCAG AA text
   contrast check (computed colour against the first opaque background behind it) ran over all
   visible text. These numbers are **heuristic**: they stand in for axe until it is installed (§6),
   and axe is the judge.
4. **Keyboard.** Spot checks in the top window as OWNER: J/K and Enter on the candidates table, Esc on
   candidate detail, `g a`, ⌘K, `?`. A static read of the key handlers covered the rest of the
   docs/04 §1.3 map.
5. **States.** Each page and the features it imports were read for skeleton / empty / error /
   not-found branches. Doubtful cases were confirmed in the browser.

Widths and themes were walked as OWNER and Super Admin only. The other roles see the same layouts with
less on them, so their cells in §2 record access, scope and the controls offered.

---

## 1. Findings

| ID | Severity | Route | Principal | Finding | One-line fix |
|---|---|---|---|---|---|
| B1 | Blocks use | `candidates/new` (page and `@modal`) | OWNER, MANAGER, BDE | The form "submits" with `setTimeout(() => router.push(...), 1500)` and saves nothing; the candidate never appears | Add `candidatesMock.create` with its declared write action, a `useCreateCandidate` mutation, and navigate to the new record |
| B2 | Blocks use | `jobs/capture` (page and `@modal`) | OWNER, MANAGER, BDE | Same: `job-capture-form.tsx` simulates the save with a timeout | Add `jobsMock.create` (declared write) and a `useCaptureJob` mutation; open the new job |
| W1 | Wrong behaviour | `candidates/[id]` (inbox preview) | VIEWER, support view | "Connect" is shown (`inbox-preview.tsx:33`); the mock refuses it with 403 | Wrap it in `<Can action=…>` for the inbox connect action |
| W2 | Wrong behaviour | `applications/[id]` | VIEWER, support view | The "Connect it" link (`applications/[id]/page.tsx:113`) is shown to read-only principals | Same `<Can>` gate |
| W3 | Wrong behaviour | `jobs` (job explorer) | VIEWER, support view (and everyone) | Save / Hide are offered to read-only principals, and for everyone they only set local `useState`, lost on reload | Gate them with `<Can>`; keep saved/hidden in the mock (or the URL) so the state survives a reload |
| W4 | Wrong behaviour | `focus` | OWNER, MANAGER, BDE | No loading or error state: while the query loads the page says "Assign a candidate…" (the empty state) | Add skeleton and error branches before the empty one |
| W5 | Wrong behaviour | `outreach` | all with access | Thread list has no skeleton and no empty state (known, 07 Phase B) | Add the list skeleton and an empty state ("No threads yet") |
| W6 | Wrong behaviour | `analytics` | OWNER, MANAGER, VIEWER, support view | No empty state: a period with no events shows empty charts | Add an empty state per chart group (docs/04 §13 pattern) |
| W7 | Wrong behaviour | `settings/firm` | OWNER, support view | "Shift window" and "Default follow-up cadence" are hardcoded strings, not from the firm | Show "Not set" now (never an invented value); read the fields once the docs/02 §3.3 draft is approved |
| W8 | Wrong behaviour | `settings/templates` | OWNER, MANAGER, support view | Static placeholder; no templates are listed or editable (known: full settings UIs) | Build after its docs/04 spec; until then label it "Coming soon" instead of fake rows |
| W9 | Wrong behaviour | `welcome` | OWNER (first run) | One card, not the 4-step wizard in docs/04 §2.2 | Build steps 1, 3 and 4 now; step 2 (invite the team) waits for Phase M |
| W10 | Wrong behaviour | `sign-in` | signed out | "Forgot password?" is `href="#"`; the forgot-password confirmation state in §2.1 is missing | Add the confirmation state (mock: always "If the email exists, we've sent a link") |
| W11 | Wrong behaviour | `candidates`, `applications`, `ledger`, `analytics`, `jobs`, every `DataTable` | all | Filters, tabs and search live in `useState`, not the URL: candidates status + Table/Cards, applications Board/Calendar/Table, ledger actor, analytics period, job explorer filters, table search | Move each to `useUrlState` with a Zod parser (as admin audit already does) |
| W12 | Wrong behaviour | `candidates/[id]`, `jobs/[id]`, `applications/[id]` | all | Esc doesn't go back (checked on candidate detail; there is no handler on the other two) | One `useEscBack()` hook in the detail layouts that respects open dialogs |
| W13 | Wrong behaviour | `jobs/[id]`, `applications/[id]` | acting roles | T / A / O (tailor, apply, open posting; docs/04 §1.3) not bound | Bind them through the shortcut layer, gated by the same `can()` as the buttons |
| W14 | Wrong behaviour | `followups`, `outreach` threads, `resumes`, `jobs` explorer list, candidates Cards view, applications board | all | J/K/Enter don't move through these lists (only `DataTable` has them) | Extract the `DataTable` list-navigation hook and use it on each list |
| W15 | Wrong behaviour | `candidates`, `jobs` | OWNER, MANAGER, BDE | N (new) not bound | Bind N to `candidates.new` / `jobs.capture` with `hrefFor`, gated by `useCanView` |
| W16 | Wrong behaviour | every firm and admin page | all | The `?` sheet lists only ⌘K, the `g` keys, `?` and Esc; J/K, Enter, Space, x, `/`, N, T, A, O are missing | Generate the sheet from one shortcut table that the handlers also read |
| W17 | Wrong behaviour | `dashboard`, `analytics`, `settings/*`, `outreach` | OWNER (seen); all at 390 | At 390 px content is clipped: an OWNER dashboard card is 630 px wide, analytics cards 670 px, the settings section nav 463 px, the outreach thread card runs off the right edge | Let grids drop to one column below `md`; the settings nav becomes a select or a horizontal scroller |
| W18 | Wrong behaviour | every firm and admin page | all | At 1024 px the sidebar stays expanded (208 px); docs/04 §11 says it auto-collapses from 1024 to 1439 | Collapse the sidebar by default below the `xl` breakpoint, keeping the user's toggle |
| W19 | Wrong behaviour | every firm page | all | 768–1023 px: no navigation drawer (docs/04 §11) | Sidebar becomes a drawer opened from the topbar below `lg` |
| W20 | Wrong behaviour | `applications` | all | Below 768 px the board stays a kanban; docs/04 §11 says it becomes a status-filtered list | Render the list (status select + rows) below `md` |
| W21 | Wrong behaviour | every table (firm and admin) | all | Table header text (`text-3` on `surface-3`): 4.02 light / 3.93 dark, under AA 4.5 | Darken `text-3` or use `text-2` for headers (design.md token change) |
| W22 | Wrong behaviour | `candidates/[id]` tabs, admin firm tabs, candidates Table/Cards toggle, studio "Viewer" | all | Inactive tab text 4.2 in light | Inactive tabs use `text-2` |
| W23 | Wrong behaviour | every firm page | all | Dark theme: the notification count badge is 3.59 | Adjust the badge foreground/background tokens in dark |
| W24 | Wrong behaviour | `jobs` explorer, `outreach`, `focus` | all | Job explorer meta line 4.4 light / 4.15 dark; outreach company line 4.15; focus timer 3.88 | Same token fix as W21 where they use `text-3`; check the timer's colour |
| W25 | Wrong behaviour | `ledger` | OWNER, MANAGER, BDE, VIEWER, support view | Ledger filters and the diff expander are missing (known, 07 Phase B) | Filters (actor, entity, action, date) in the URL; expander row showing before/after |
| C1 | Cosmetic | detail routes, other-firm slug, admin firm | all | Not-found pages keep the page's tab title: candidate, job, application, resume, admin firm (`firm_nope` reads "Firm"); another firm's slug reads "Dashboard" (known) | Not-found sets the title "Not found · BenchQ" (registry title helper takes the outcome) |
| C2 | Cosmetic | `/dev/design-system` in production | all | Not-found (correct) but titled "Design system" | Same fix as C1 |
| C3 | Cosmetic | firm routes | Super Admin (no support view) | The "start a support view" interstitial keeps the page's tab title | Title it "Support view required · BenchQ" |
| C4 | Cosmetic | `ledger` | all with access | A dangling `·` when `promptVersion` is null (known) | Join the parts that exist with the separator |
| C5 | Cosmetic | `candidates` | all, 390 px | Search box squeezed to a few characters (known) | Search on its own row below `md` |
| W26 | Wrong behaviour | `sign-in` | every signed-in principal | The form renders for someone already signed in (decided 07 Q35: redirect) | Redirect to `signInTarget` (the landing, or `returnTo` when the account can open it) |
| W27 | Wrong behaviour | `candidates/new` (page and dialog) | OWNER, MANAGER, BDE | No resume upload or parse at intake, and only name, role, contact, work auth and assignment are asked; docs/04 §4.2 has identity / professional / sourcing sections and a resume drop zone whose parse drafts fields as `UNVERIFIED` with a review strip (added 2026-10-20, after fix PR 1) | Resume drop zone with a simulated parse (docs/03 §5 staging); parsed fields land `UNVERIFIED` with "N fields drafted from the resume — review before saving", typed fields `VERIFIED`; the rest of §4.2's fields |
| W28 | Wrong behaviour | `jobs/capture` (page and dialogs) | OWNER, MANAGER, BDE | One manual form; docs/04 §5.2's Paste (URL or raw description → 2–4 s simulated parse → review with every field `UNVERIFIED` beside the source), Bulk paste (per-row queued → parsing → parsed / duplicate / failed) and Extension (install / connected states from a store flag) tabs are missing, and a duplicate is refused rather than offering "merge or keep separate" (added 2026-10-20) | The three tabs on the simulated parse; the duplicate comparison card with merge / keep separate |
| C6 | Cosmetic | many lists (meta lines) | all | The `·` separators measure 1.28 light / 1.6 dark | Separators are decorative: mark them `aria-hidden` and give them `text-3` with the W21 fix |

### Not confirmed

- **Busy indicators after 1.8 s** on `applications`, `applications/[id]` and `candidates/[id]` in the iframe
  sweep. They may be the mock delay plus cold iframes rather than stuck queries; it wasn't reproduced
  in the top window. Re-check with axe/Playwright timing (§6) before treating it as a finding.

---

## 2. Route × principal

Cells record access, scope and the controls offered, against 07 §2.2 and §2.5. Findings that hit
every principal on a route (states, keyboard, widths, contrast) are in §3, so they aren't repeated
here.

**Legend:** ✓ renders as the spec says · **F** Forbidden screen in place (spec) · **L** redirected to the
landing (spec) · **S** redirected to `/sign-in` with `returnTo` (spec) · **I** Super Admin
interstitial to start a support view (spec) · **NF** not-found (spec) · an **ID** is a gap (§1).

### Public

| Route | OWNER | MANAGER | BDE | VIEWER | Support view | Super Admin | Signed out |
|---|---|---|---|---|---|---|---|
| `/` | L | L | L | L | L | L (`/admin`) | S |
| `/sign-in` | W26 | W26 | W26 | W26 | W26 | W26 | ✓ · W10 |
| `/invite/[token]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (all link states: P4 tests) |

### Firm tier (`/hyderabad-tech-staffing/…`)

| Route | OWNER | MANAGER | BDE | VIEWER | Support view | Super Admin | Signed out |
|---|---|---|---|---|---|---|---|
| `welcome` | W9 | L | L | L | F | I | S |
| `dashboard` | ✓ (OWNER rollup) | ✓ | ✓ (own) | ✓ (read) | ✓ (read, banner) | I | S |
| `candidates` | ✓ | ✓ | ✓ (assigned) | ✓ (read, no New) | ✓ (read) | I | S |
| `candidates/new` | B1 | B1 | B1 | F | F | I | S |
| `candidates/[id]` | ✓ | ✓ | ✓ (assigned; others NF) | W1 | W1 | I | S |
| `jobs` | W3 (local only) | W3 (local only) | W3 (local only) | W3 | W3 | I | S |
| `jobs/capture` | B2 | B2 | B2 | F | F | I | S |
| `jobs/[id]` | ✓ | ✓ | ✓ | ✓ (read) | ✓ (read) | I | S |
| `applications` | ✓ | ✓ | ✓ (own) | ✓ (read) | ✓ (read) | I | S |
| `applications/[id]` | ✓ | ✓ | ✓ (own; others NF) | W2 | W2 | I | S |
| `resumes` | ✓ | ✓ | ✓ (assigned) | ✓ (read) | ✓ (read) | I | S |
| `resumes/[id]` (studio) | ✓ | ✓ | ✓ (assigned) | ✓ (read) | ✓ (read) | I | S |
| `outreach` | ✓ | ✓ | ✓ (own) | ✓ (read) | ✓ (read) | I | S |
| `followups` | ✓ | ✓ | ✓ (own) | F | ✓ (read) | I | S |
| `analytics` | ✓ | ✓ | F | ✓ (read) | ✓ (read) | I | S |
| `ledger` | ✓ | ✓ | ✓ (own entries) | ✓ (read) | ✓ (read) | I | S |
| `focus` | ✓ (W4) | ✓ (W4) | ✓ (W4) | F | F | I | S |
| `settings` (index) | ✓ → `firm` | ✓ → `team` | ✓ → `preferences` | ✓ → `preferences` | ✓ → `firm` | I | S |
| `settings/firm` | W7 | F | F | F | W7 (read) | I | S |
| `settings/team` | ✓ (invite controls wait Phase M) | ✓ (read, assigns) | F | F | ✓ (read) | I | S |
| `settings/templates` | W8 | W8 | F | F | W8 | I | S |
| `settings/preferences` | ✓ | ✓ | ✓ | ✓ | F | I | S |

Also checked on every firm route: another firm's slug (Lakshmi on `hyderabad-tech-staffing`, Imran on
`secunderabad-talent`) → NF (title: C1). An unknown slug → NF. A slug-less URL (`/candidates`) → NF.
An unknown id on each detail route → NF (title: C1).

### Platform tier (`/admin/…`)

| Route | OWNER | MANAGER | BDE | VIEWER | Support view | Super Admin | Signed out |
|---|---|---|---|---|---|---|---|
| `/admin` | NF | NF | NF | NF | ✓ | ✓ | S |
| `firms`, `firms/new` | NF | NF | NF | NF | ✓ | ✓ | S |
| `firms/[firmId]` (+ `users`, `plan`, `activity`) | NF | NF | NF | NF | ✓ | ✓ (unknown id → NF, C1) | S |
| `plans`, `audit`, `team` | NF | NF | NF | NF | ✓ | ✓ | S |
| `system` | NF | NF | NF | NF | ✓ | ✓ (placeholder + Reset demo data; built in Phase S) | S |
| unknown `/admin/x` | NF | NF | NF | NF | NF in the admin shell | NF in the admin shell | S |

### Dev

| Route | everyone |
|---|---|
| `/dev/design-system` | NF in the production build (spec: dev only), title C2 |

---

## 3. Per route: states, keyboard, themes, widths

✓ = present and checked · an ID = gap · n/a = doesn't apply. "Keyboard" lists only what's missing
beyond the shell keys. ⌘K and the `g` shortcuts work on every page of their area (firm map in the
firm shell, admin map in the admin shell).

Gaps on **every page** of a tier, not repeated below: W16 (`?` sheet), W18 (no sidebar collapse at
1024), W19 (no drawer at 768–1023, firm), W23 (dark badge, firm), W21 (table headers, wherever a
table is).

| Route | Skeleton | Empty | Error | Not-found | Keyboard | Light / dark | 1440 | 1024 | 390 |
|---|---|---|---|---|---|---|---|---|---|
| `sign-in` | ✓ | n/a | ✓ (one generic error) | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `invite/[token]` | ✓ | n/a | ✓ (every link state) | ✓ (INVALID) | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `welcome` | ✓ | n/a | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ (W9 is content) |
| `dashboard` | ✓ | ✓ | ✓ (per group + page, §13) | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | W17 |
| `candidates` | ✓ | ✓ | ✓ | n/a | W14 (Cards), W15; W11 | W22 / W22 | ✓ | ✓ | C5 |
| `candidates/new` | n/a | n/a | B1 (no real submit) | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `candidates/[id]` | ✓ | ✓ | ✓ | ✓ (C1) | W12 | W22 / W22 | ✓ | ✓ | ✓ |
| `jobs` | ✓ | ✓ | ✓ | n/a | W14, W15; W11 | W24 / W24 | ✓ | ✓ | ✓ |
| `jobs/capture` | n/a | n/a | B2 | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `jobs/[id]` | ✓ | ✓ | ✓ | ✓ (C1) | W12, W13 | ✓ / ✓ | ✓ | ✓ | ✓ |
| `applications` | ✓ | ✓ | ✓ | n/a | W14 (board); W11 | ✓ / ✓ | ✓ | ✓ | W20 |
| `applications/[id]` | ✓ | ✓ | ✓ | ✓ (C1) | W12, W13 | ✓ / ✓ | ✓ | ✓ | ✓ |
| `resumes` | ✓ | ✓ | ✓ | n/a | W14 | ✓ / ✓ | ✓ | ✓ | ✓ |
| `resumes/[id]` | ✓ | ✓ | ✓ | ✓ (C1) | ✓ | W22 / W22 | ✓ | ✓ | ✓ |
| `outreach` | W5 | W5 | ✓ | n/a | W14 | W24 / W24 | ✓ | ✓ | W17 |
| `followups` | ✓ | ✓ | ✓ | n/a | W14 | ✓ / ✓ | ✓ | ✓ | ✓ |
| `analytics` | ✓ | W6 | ✓ | n/a | W11 | ✓ / ✓ | ✓ | ✓ | W17 |
| `ledger` | ✓ | ✓ | ✓ | n/a | W11 | C4, C6 | ✓ | ✓ | ✓ |
| `focus` | W4 | ✓ | W4 | n/a | ✓ | W24 / W24 | ✓ | ✓ | ✓ |
| `settings/firm` | n/a (firm from the gate) | n/a | n/a | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | W17 |
| `settings/team` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | W17 |
| `settings/templates` | W8 | W8 | W8 | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | W17 |
| `settings/preferences` | n/a (local) | n/a | n/a | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | W17 |
| `/admin` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `/admin/firms` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ (table scrolls in place) |
| `/admin/firms/new` | ✓ | n/a | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `/admin/firms/[firmId]` + tabs | ✓ | ✓ | ✓ (firm shell) | ✓ (C1) | ✓ | W22 / ✓ | ✓ | ✓ | ✓ |
| `/admin/plans` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `/admin/audit` | ✓ | ✓ | ✓ | n/a | ✓ (filters in the URL) | ✓ / ✓ | ✓ | ✓ | ✓ |
| `/admin/system` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |
| `/admin/team` | ✓ | ✓ | ✓ | n/a | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ |

Admin screens at 1024 and 390 (a known 07 gap): checked. Nothing is clipped at either width, wide
tables scroll inside their own container, and only W18 (sidebar) applies. Admin dark-theme contrast
passed the heuristic check except table headers (W21).

---

## 4. Known gaps from 07, where they landed

| Known gap (07 Phase B) | Finding |
|---|---|
| Outreach thread list: no skeleton or empty state | W5 |
| Candidates search squeezed at 390 px | C5 |
| "Not found" as the tab title | C1 (and C2, C3 for the same cause) |
| Admin screens at 1024 and 390 | checked: no clipping; W18 only |
| Ledger filters and diff expander | W25 |
| Dangling `·` when `promptVersion` is null | C4 |
| Full settings UIs | W7, W8 (and the invite controls on `settings/team`, Phase M) |

---

## 5. Keyboard (docs/04 §1.3)

| Key | Where it works | Gap |
|---|---|---|
| ⌘K | every page, per area | — |
| `g` + key | firm map in the firm shell, admin map in the admin shell (`g a` checked) | — |
| J / K / Enter | `DataTable` (candidates table, admin tables) | W14 on the other lists |
| Esc | closes dialogs, sheets, the palette | W12: doesn't go back on detail pages |
| N | — | W15 |
| T / A / O | — | W13 |
| Space / x / `/` | `DataTable` selection and search | the `/` focus-search key isn't in the `?` sheet (W16) |
| `?` | opens the sheet | W16: the sheet is incomplete |

---

## 6. Accessibility: adding axe (proposal, not installed)

There is no axe tooling in the repo (CURRENT_STATE §8). docs/01 §2 already names the testing stack as
"Vitest + Playwright + @axe-core/playwright", so these are the planned dependencies. The §3 checks
apply all the same:

| Package | Why this one | §3 check |
|---|---|---|
| `@playwright/test` (dev) | real browser, real widths and colour schemes, can drive the seeded sign-in | Named in §2; maintained by Microsoft; dev-only, nothing in the bundle |
| `@axe-core/playwright` (dev) | Deque's official axe binding for Playwright (`AxeBuilder`) | Named in §2; maintained by Deque; dev-only |

Not proposed: `jest-axe` / `vitest-axe` (jsdom can't compute colours or layout, so they miss contrast,
the main issue found), and `@axe-core/react` (dev-time console only, not a gate).

**Shape of the suite** (`e2e/a11y.spec.ts`, `pnpm e2e`):

1. Run against the production build (`pnpm build && pnpm start`) via Playwright `webServer`.
2. For each seeded account (OWNER, MANAGER, BDE, VIEWER, Super Admin, Super Admin in a support view, and
   signed out), sign in through `/sign-in`, then visit every registry route that account can open.
   Build the list from `registry.ts` with `canOpen`, so a new route is covered by default.
3. Each page at 1440, 1024 and 390, with `colorScheme: "light"` and `"dark"`.
4. `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()`. Fail on
   any violation, and print rule id, route, principal, width and theme.
5. Wait for the skeletons to clear before scanning (no `aria-busy` left), so loading states don't
   hide content. The same harness can then settle the "busy indicator" question in §1.

That's 7 principals × ~30 routes × 3 widths × 2 themes, about 1,000 scans. Run it locally and before
merging UI PRs; it doesn't go in `pnpm test` (Vitest stays fast). Adding it is its own PR (PR 7 below), just before the contrast fix (PR 8), so the fix is measured by axe, not estimated.

---

## 7. Fix PRs, in order

> **Paused after fix PR 2 (2026-10-21).** PR 1 (#26) and PR 2 (#27) are done. The work moves to backend
> auth + tenancy (`docs/integration/07-auth-and-tenancy.md`) so teammates can integrate modules in
> parallel. PRs 3–14 below stay as they are, in this order, for when Phase B resumes.

Small PRs, one concern each, in the order I'd do them. Each closes the IDs listed.

| # | PR | Closes | Why this order |
|---|---|---|---|
| 1 | **Create candidate / capture job for real**: mock `create` with declared write actions (Phase C table and `write-authorization.test` pick them up), mutations, navigate to the new record, page and `@modal` | B1, B2 | Only findings that lose work |
| 2 | **Read-only leaks**: `<Can>` on inbox "Connect", "Connect it", job explorer Save/Hide; Save/Hide persisted | W1, W2, W3 | Breaks the Q32 rule that read-only principals are offered no writes; small |
| 3 | **Missing states**: focus skeleton/error, outreach skeleton/empty, analytics empty | W4, W5, W6 | CLAUDE.md "three states, always" |
| 4 | **Tab titles**: not-found, design-system in prod, support interstitial | C1, C2, C3 | One helper; cheap |
| 5 | **URL state**: filters, tabs, search to `useUrlState` + Zod | W11 | CLAUDE.md rule; touches many screens, so it goes before keyboard work on the same lists |
| 6 | **Keyboard**: one shortcut table, `?` sheet from it, Esc back, J/K hook on every list, N, T/A/O | W12–W16 | Builds on 5 (lists settle) |
| 7 | **axe tooling** (§6): `@playwright/test` + `@axe-core/playwright`, a separate `pnpm e2e` suite; lands reporting the current violations as its baseline | — (measures W21–W24, C6) | Decided: before the contrast fix, so that fix is measured, not estimated |
| 8 | **Contrast tokens**: propose the `text-3` change in `design.md` (and `text-2` for inactive tabs where needed), dark badge, timer, separators; axe from PR 7 confirms | W21–W24, C6 | Decided: propose the token change in this PR |
| 9 | **Responsive**: sidebar collapse at 1024, drawer at 768–1023, 390 grid/nav fixes, kanban → list, candidates search row | W17–W20, C5 | Shell-level change; after 6 so the drawer gets keyboard paths from the shared table |
| 10 | **Ledger**: filters (URL), diff expander, `·` join | W25, C4 | Self-contained; known gap |
| 11 | **Sign-in**: redirect when signed in (Q35), forgot-password confirmation state | W26, W10 | Small; spec exists (§2.1) |
| 12 | **Settings and welcome**: settings/firm shows "Not set" for shift window and cadence (fields once docs/02 §3.3 is approved), templates, welcome wizard steps 1/3/4 | W7, W8, W9 | Spec-heavy; may need docs/04 detail first. Step 2 and the team invite controls wait for Phase M |
| 13 | **Intake from a resume**: drop zone, simulated parse, `UNVERIFIED` drafted fields with the review strip, the rest of §4.2's fields | W27 | Builds on PR 1's create; spec exists (docs/04 §4.2); the claim-state rules apply to drafted fields, so it gets its own review |
| 14 | **Capture tabs**: Paste with parse and side-by-side review, Bulk paste with per-row status, Extension states; duplicate comparison with merge / keep separate | W28 | Builds on PR 1's capture and dedup; merge needs a rule for which fields win (ask before building) |

Answers (2026-10-19, product owner):

- **Contrast:** propose the `text-3` token change in `design.md` (PR 8), with the axe tooling in the PR just before it (PR 7).
- **`/sign-in` while signed in:** redirect to the landing page, `returnTo` still honoured if the account can open it. Switching
  accounts = Sign out from the user menu first. Recorded as 07 Q35; finding W26, PR 11.
- **Shift window and follow-up cadence:** drafted as `Firm` fields in docs/02 §3.3 for sign-off (defaults 18:30–00:30 in the
  firm's primary timezone; day-3 LinkedIn / day-7 email). Until approved, `settings/firm` shows "Not set", never invented values.
