# 06 — Implementation Plan

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026
**Status:** complete. Every phase below is done; foundation and integration status is in `docs/integration/README.md`.

Nine phases. Each has a scope, a definition of done, and exit criteria you can actually check.
**Do not start a phase until the previous one's exit criteria pass.** The temptation on a UI build
is to jump to the interesting screens; the cost of that is a foundation you rebuild in week six.

Estimates assume one person building with Claude Code. Halve them for a team of two who split
cleanly along the phase boundaries.

---

## Phase map

| Phase | Name | Est. | Ships |
|---|---|---|---|
| 0 | Foundation | 3–4 days | Repo, tokens, shell, mock layer, role switcher |
| 1 | Primitives & navigation | 4–5 days | Component library, command palette, keyboard system |
| 2 | Candidates & the Record | 5–7 days | Candidate CRUD, Record editor, claim states, evidence |
| 3 | Jobs & matching | 5–6 days | Feed, capture, job detail, match panel |
| 4 | Resume builder | 6–8 days | Three-pane builder, preview, export gate |
| 5 | Applications & tracking | 5–7 days | Kanban, table, calendar, detail, focus mode |
| 6 | Outreach & follow-ups | 3–4 days | Composer, Q&A bank, follow-up queue |
| 7 | Analytics & ledger | 4–5 days | Dashboards per role, charts, audit view |
| 8 | Polish & handoff | 4–5 days | A11y, performance, responsive, backend-swap prep |

**Total: roughly 8–10 weeks** of focused solo work.

---

## Phase 0 — Foundation

*Everything downstream inherits this. Get it right.*

**Scope**

- `create-next-app` — Next 15, App Router, TypeScript strict, Tailwind v4, pnpm
- Tailwind `@theme` block built **entirely from `design.md`** — colours, type scale, spacing,
  radii, shadows, motion durations and easings
- Light/dark via `next-themes`, light as default, no flash of wrong theme
- Fonts loaded through `next/font`
- shadcn/ui initialised, primitives from `05-COMPONENTS.md §1` installed and re-tokenised
- Every Zod schema from `02-DATA-CONTRACTS.md` in `src/lib/schemas/`
- MSW v2 wired for browser and node, with the fixture generator from `03-MOCK-DATA.md`
- `src/lib/api/client.ts` — typed fetch wrapper with Zod response validation
- TanStack Query provider, sensible defaults, devtools in development
- Zustand stores: `useSession`, `useUiStore`
- `AppShell`, `Sidebar`, `Topbar` with role-filtered nav
- **`RoleSwitcher`** — build it now, use it every day after
- ESLint, Prettier, Vitest, Playwright, Storybook, `.env.example`

**Exit criteria**

- [ ] `pnpm dev` serves a shell with working sidebar and theme toggle
- [ ] Switching role in the topbar visibly changes sidebar items
- [ ] MSW intercepts a call from `candidatesApi.list()` and returns validated fixture data
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all clean
- [ ] No hardcoded colour or size anywhere in the repo — grep for `#` in `.tsx` files and confirm
- [ ] `NEXT_PUBLIC_MOCK_ERROR_RATE=1` makes the shell render an error state rather than crashing

---

## Phase 1 — Primitives & navigation

**Scope**

- `DataTable` — the one table for the whole product. Sorting, filtering, selection, density,
  virtualisation, column persistence, and skeleton/empty/error owned internally
- `EmptyState` with all three variants, `ErrorState`, shape-matched skeletons
- `StatStrip`, `CandidateStatCard`, `Sparkline`
- `DualTimestamp` and the `src/lib/format/` timezone helpers
- `ShiftClock`
- **`CommandPalette`** with all four groups and recent items
- The keyboard system: a `useKeyboardShortcuts` hook, `g`-prefix navigation, `J`/`K`/`Enter`/`x`,
  and `KeyboardHintSheet` on `?`
- Auth screens and the four-step onboarding wizard (mock, but every state real)
- Storybook stories for everything above

**Exit criteria**

- [ ] `⌘K` opens, searches fixtures, and navigates
- [ ] A `DataTable` of 1,000 fixture rows scrolls at 60fps and filters in under 100ms
- [ ] Every route reachable by keyboard alone, from sign-in to dashboard
- [ ] `?` sheet lists every shortcut that actually works — and nothing that doesn't
- [ ] Storybook covers dark, light and 390px for each primitive

---

## Phase 2 — Candidates & the Record

*The claim-state model lands here. It's the hardest conceptual work in the build; do it while
you're fresh.*

**Scope**

- `/candidates` list — table and card views, filters, bulk actions, both empty states
- `/candidates/new` — form, validation, simulated resume parse producing `UNVERIFIED` fields
- `/candidates/[id]` — `DetailShell`, header, derived stat strip, five tab routes
- Overview tab — activity feed, top matches, status donut, record-health card
- ~~**Record tab**~~ — superseded (Sept 2026): claims are verified in the master resume in the
  resume builder; the candidate page has a **Documents** tab instead (see docs/04 §4.3)
- Timeline tab — grouped, filterable
- `src/lib/derive/candidate-stats.ts` with unit tests

**Exit criteria**

- [ ] All three claim states render with label + icon + colour, verified in greyscale
- [ ] A claim **cannot** be set to `VERIFIED` without evidence attached — enforced in the UI, and a
      test proves it
- [ ] Every candidate stat is computed from event arrays; no fixture supplies a count
- [ ] ~~Record sections reorder by keyboard as well as by drag~~ — superseded, see above
- [ ] A BDE sees only assigned candidates — verified by flipping the role switcher
- [ ] `deriveCandidateStats` unit tests pass, including the empty-candidate case

---

## Phase 3 — Jobs & matching

**Scope**

- `/jobs` feed — filter rail, virtualised list, candidate-context selector, peek panel
- `JobRow`, `MatchScoreBar`, `VerificationBadge`, `SourceChip`, `H1bDataCard`
- `/jobs/capture` — paste, bulk paste with per-row progress, extension status panel
- Dedup on capture with the comparison card and merge/keep choice
- `/jobs/[id]` — description with highlighted requirements, `RequirementMatrix`, company card,
  action stack
- LIGHT → FULL scoring upgrade as an AI simulation with staged progress
- `T` / `A` / `O` wired on feed rows and detail, active only with a candidate context

**Exit criteria**

- [ ] 500 fixture jobs scroll at 60fps; filter response under 100ms
- [ ] Selecting a candidate re-scores the visible feed and enables the action keys
- [ ] A duplicate paste produces the comparison card, never a silent drop
- [ ] `RequirementMatrix` renders MANDATORY / PREFERRED / ADJACENT correctly, including a job with
      zero matched requirements
- [ ] Full-analysis upgrade shows staged progress and returns output marked `UNVERIFIED`

---

## Phase 4 — Resume builder

*The most complex screen. Budget more than you think.*

**Scope**

- `ThreePaneShell` with persisted widths and the sub-1280px collapse
- Left pane — sections with per-section unverified counts
- Middle pane — claim-by-claim editor, AI suggestion accept/reject/edit, evidence linking
- Right pane — `ResumePreview`, paginated, `CONTRADICTED` claims excluded
- Footer — target job, match, unverified count, `ExportGate`
- Tailoring history dropdown with a diff view
- Template selection with live preview
- `/candidates/[id]/resumes` version cards showing the export lock before you open

**Exit criteria**

- [ ] Keystroke to preview update measured under 120ms on a 2-page resume
- [ ] Export is blocked with **any** unverified claim, and the message names the count
- [ ] The jump-to-claim link focuses the correct claim in the correct section
- [ ] `CONTRADICTED` claims appear nowhere in the preview or the simulated export
- [ ] Pane widths survive a reload; storage cleared falls back to defaults without throwing
- [ ] The unverified→verified transition matches the motion spec in `design.md` and respects
      `prefers-reduced-motion`

---

## Phase 5 — Applications & tracking

*This is the transparency feature. Managers judge the product on this screen.*

**Scope**

- `/applications` with kanban, table and calendar, selection preserved across view switches
- Kanban — dnd-kit, optimistic status transitions, invalid moves snap back with a reason
- Table — grouping by candidate / BDE / company / status, CSV export of the current view
- Calendar — month and week, applications, interviews and follow-ups
- `/applications/[id]` — status timeline, resume version used (pinned, not latest), outreach
  thread, screening answers, notes
- The state machine in `src/lib/derive/transitions.ts`, unit tested
- **Focus mode** — full screen, one job at a time, single-keystroke decisions, session summary
- Filter state synced to the URL query string

**Exit criteria**

- [ ] Drag between columns updates optimistically and reverts with a toast on rejection
- [ ] An invalid transition is not offered in `StatusSelect` and is refused on the board
- [ ] Table handles 1,000 applications with grouping and filtering under 100ms
- [ ] Focus mode processes 20 jobs with **one keystroke each** and reports an accurate summary
- [ ] A filtered tracker view is shareable by URL and restores exactly
- [ ] Application detail links to the exact resume version used, not the current one

---

## Phase 6 — Outreach & follow-ups

**Scope**

- `/outreach` — contact list, `OutreachComposer`, template selection, merge-field preview
- The unverified-claim check that blocks send when a message body pulls an unreviewed claim
- `QaBankPanel` — search, insert, save new pairs
- `/followups` — overdue / today / this week / later, complete, snooze, cancel, bulk complete
- Auto-generation of day-3 LinkedIn and day-7 email follow-ups on transition to `APPLIED`
- Sidebar badges driven by derived overdue counts

**Exit criteria**

- [ ] Sending outreach advances the mock thread and writes a ledger event
- [ ] A message containing a unverified claim cannot be sent, and the reason is specific
- [ ] Q&A bank search is instant — no spinner, no debounce artefact
- [ ] Marking an application `APPLIED` creates both follow-ups at the right dates
- [ ] Snooze options all work and the badge count updates without a refetch flash

---

## Phase 7 — Analytics & ledger

**Scope**

- `/dashboard` — all four role compositions (BDE, MANAGER, OWNER, VIEWER)
- `/analytics` — funnel, throughput by BDE, per-BDE table, per-candidate performance, company
  response rates, source effectiveness
- All six chart components, each with a table toggle and an empty state
- `/ledger` — virtualised, filtered, diff expanders, immutable
- Date range and comparison-period controls

**Exit criteria**

- [ ] Every dashboard number traces back to fixture events — spot-check five by hand
- [ ] Every chart is legible in both themes, axes and grid included
- [ ] Every chart has a table equivalent and an empty state for a zero-data range
- [ ] The BDE dashboard answers "what do I do next" without scrolling at 1440px
- [ ] The manager dashboard surfaces a behind-schedule BDE within five seconds of looking
- [ ] The ledger offers no edit or delete path anywhere in the DOM

---

## Phase 8 — Polish & handoff

**Scope**

- Accessibility sweep — `axe` clean on every route, focus order, ARIA labels, live regions for
  async results, keyboard traps eliminated
- Performance — bundle analysis, code splitting, virtualisation verified, Lighthouse ≥ 90 / ≥ 95
- Responsive — all four breakpoints from `04-SCREENS.md §11`
- Error handling — walk the app at `NEXT_PUBLIC_MOCK_ERROR_RATE=0.1` and fix everything it exposes
- Loading — no layout shift on any skeleton→content transition
- Playwright E2E for the five critical paths
- Storybook complete
- **Backend-swap preparation:** confirm every adapter in `src/lib/api/` is a thin, single-purpose
  function and that no component imports a fixture. Write `docs/07-BACKEND-HANDOFF.md` listing each
  endpoint the adapters expect, with its request and response shape taken from the Zod schemas.

**Exit criteria**

- [ ] `axe` zero violations on all routes, both themes
- [ ] Lighthouse Performance ≥ 90, Accessibility ≥ 95
- [ ] Initial JS under 250KB gzipped
- [ ] Every route usable at 390px or honestly marked as desktop-only
- [ ] E2E suite green
- [ ] `grep -r "fixtures" src/components src/app` returns nothing
- [ ] `07-BACKEND-HANDOFF.md` written and complete

---

## The five critical E2E paths

Written in Phase 8, but keep them in mind from Phase 2 — they're the flows the product is judged
on.

1. **Onboard** — sign up → create firm → add candidate → upload resume → review unverified claims →
   verify them
2. **Source** — capture a job → see the match → tailor a resume → clear the export gate → export
3. **Apply** — mark applied → follow-ups generate → send outreach → log a response → advance status
4. **Run** — enter focus mode → process 10 jobs → exit → verify the session summary against the
   ledger
5. **Oversee** — switch to MANAGER → open analytics → drill into a BDE → open their tracker → open
   one application's ledger trail

---

## Working rules

**One phase at a time.** If a task needs something from a later phase, stop and say so. Building
ahead is how the adapter boundary gets violated.

**Update `CLAUDE.md`.** The "Current phase" line at the bottom is the first thing the next session
reads. Keep it true.

**Storybook before integration.** Build the component with all its states in the workshop, then
wire it into a screen. Reversing that order is how empty states get forgotten.

**Run the error rate weekly.** Set `NEXT_PUBLIC_MOCK_ERROR_RATE=0.1`, work normally for an hour,
fix what breaks. Every error found this way is one not found in a demo.

**Both themes, every time.** Not at the end. Light is the default you build in, so dark is the one
that quietly rots — check it on every component as you go. The rework always costs more than the
check would have.

---

## What this plan deliberately excludes

No backend, no database, no auth server, no LLM calls, no background jobs, no payments, no email
sending, no browser extension. Those belong to the full-stack spec set — `specs/07-IMPLEMENTATION-PLAN.md`
in the BenchQ project — and picking them up here would break the one architectural rule this repo
is built around.

When the backend lands, the swap is: point `NEXT_PUBLIC_API_MOCKING=disabled` at a real base URL,
and rewrite the eleven files in `src/lib/api/`. If anything else has to change, something went
wrong earlier — and this plan's exit criteria are designed to catch it before it does.
