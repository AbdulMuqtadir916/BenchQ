# plan.md — BenchQ Demo Prototype

> **Archived.** The plan for the September demo prototype, kept for history. Its decisions (the role switcher,
> heavy AI theater, no tests) no longer apply: `CLAUDE.md` and `docs/07-ROUTES-AND-RBAC.md` are current.

**Goal:** a clickable, frontend-only prototype to pitch a bench-sales CEO. Every page built and
walkable so the founder can explain the pipeline, process flow, and automation at the UI level.
No backend — idea validation only. Depth of *feel* over depth of engineering.

**Not in scope:** real backend, real auth, real LLM calls, test infrastructure, production hardening.

---

## Demo decisions (locked)

- **Team scale:** keep the small 5-user / 3-BDE seed. Founder narrates "14 in production" verbally.
  Transparency views look real with the data we have; we don't rebuild fixtures to 14.
- **Demo lens:** BDE daily flow **and** owner/manager transparency built to **equal** polish.
- **AI theater: HEAVY.** Multi-step streaming, typewriter output, unverified→verified animation, 2–5s
  simulated delays, occasional "fell back to manual." This is the wow factor — invest here.

## The walkthrough story (the order the founder will demo)

1. **Sign in → the floor (owner view)** — "14 BDEs, live activity, funnel." Transparency hook.
2. **Dashboard (BDE view) — "tonight"** — the recruiter's queue, follow-ups due, at-risk candidates.
3. **Candidate detail** — what needs attention tonight, the application board, the recruiter inbox, documents and screening answers; claims are verified in the master resume.
4. **Jobs feed → job detail** — match scoring, work-auth hard filter, verification verdicts.
5. **Resume builder** — the centerpiece. AI tailoring streams in as UNVERIFIED → human verifies with
   evidence → export gate blocks until clean. This is the automation + trust story in one screen.
6. **Applications (kanban/table/calendar)** — pipeline at a glance, drag to advance stage.
7. **Outreach + follow-ups** — automated cadences, templates with merge fields.
8. **Analytics + ledger** — funnel, per-BDE performance, the audit trail of every AI action.
9. **Focus mode** — the "application forty at 11pm" fast path; keyboard-only submission.

---

## Current state (done)

- ✅ **Phase 0 foundation:** design tokens, app shell (sidebar + topbar + shift clock), theme
  toggle, command-palette skeleton, keyboard system, role switcher.
- ✅ **Mock layer:** full fixtures (firm, 5 users, 24 candidates, 60 companies, 400 jobs,
  320 applications, follow-ups, records, ~35 resumes with claims), all behind typed adapters +
  MSW handlers + TanStack Query hooks. 9 domains live and verified in-browser.
- ✅ **Primitives:** EmptyState, ErrorState, skeletons, DualTimestamp, ClaimChip, StatCard,
  SectionCard, MergeField, Button/Card.

---

## Build sequence

### Stage 1 — Shared building blocks (unblocks every screen)
- [x] `src/lib/derive/` — derive stats from event arrays (candidate-stats, record-completeness,
  export-gate, funnel, bde-performance). CLAUDE.md hard rule: numbers are computed, never literals.
- [x] `shadcn/ui` init + install the docs/05 §1 primitives, rethemed to our tokens
      (dialog, sheet, popover, dropdown, tabs, select, checkbox, tooltip, table, badge, avatar…).
- [x] **DataTable** — the one table for the whole product: sort, filter, column show/hide,
      row selection, skeleton/empty/error. Used by candidates, jobs, applications, ledger.
- [x] **AI-theater kit** (`src/components/app/ai/`) — the reusable heavy-AI layer:
  - `AgentRunPanel` — multi-step streaming progress (Reading → Extracting → Matching → Drafting)
  - `TypewriterText` — streamed token effect for generated copy
  - `UnverifiedToVerified` — the signature claim transition (already partly in ClaimChip)
  - simulated agent handlers in `src/lib/local-data/agents.ts` + `delay.ts` (2–5s delay,
    5% fallback-to-manual) — moved here from the original MSW `mocks/handlers/agents.ts` when the
    MSW backend was replaced with local JSON data

### Stage 2 — The two lenses (equal polish)
**Owner/manager transparency**
- [x] `/dashboard` MANAGER "the floor" + OWNER "the business" compositions
- [x] `/analytics` — funnel chart, per-BDE performance, source ROI
- [x] `/ledger` — audit trail with AI-action rows, filters

**BDE daily flow**
- [x] `/dashboard` BDE "tonight" composition
- [x] `/candidates` list + `/candidates/[id]` detail (overview, applications, inbox, jobs, resumes, documents, activity)
- [x] `/candidates/new` intake
- [x] `/jobs` feed + `/jobs/[id]` detail (match score, requirement matrix, verification)
- [x] `/jobs/capture` — paste-a-JD capture with simulated AI extraction

### Stage 3 — The centerpiece + pipeline
- [x] `/resumes/[id]` — resume builder: section list, AI tailoring (drafts land UNVERIFIED),
      verify-with-evidence flow, live preview, **export gate** unlocks when all verified
- [x] `/applications` — kanban + table + calendar views, advance-stage with animation
- [x] `/applications/[id]` — application detail + event timeline

### Stage 4 — Automation surfaces + finish
- [x] `/outreach` — templates, merge fields, simulated send cadence
- [x] `/followups` — overdue / due-today / upcoming queues
- [x] `/focus` — focus mode, keyboard-only fast submission path
- [x] `/settings` — firm, team, truth-guard mode (mostly static, for completeness)
- [x] Auth screens `/sign-in` + `/welcome` onboarding wizard (mock, for the demo open)
- [x] Command palette wired to search real fixtures
- [x] Polish pass: every screen in light + dark, keyboard reachable, empty/error states present,
      `prefers-reduced-motion` respected, 1440/1024/390 widths

---

## Guardrails (don't drift)

- One DataTable, one AgentRunPanel — reuse, don't fork per screen.
- Every claim renders label + icon + colour. Export gate always enforced on unverified.
- No hardcoded colours/sizes/spacing — tokens only. Light default, dark must work.
- Data only through adapters/hooks — no raw fetch in components, no fixtures imported into screens.
- Build in walkthrough order so there's always a demoable slice; don't half-finish three screens.
