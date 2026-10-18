# BenchQ — Frontend Documentation Set

## Current design system

Run `pnpm dev` and open `http://localhost:3000/design-system`.
The v3 system uses a frosted collapsible shell, rounded white workspace, compact
tables/forms, raised gradient primary buttons, and colored monospace tags.
Overview, Foundations, Patterns, and Interactive lab show the working components.
`design.md` is the visual specification; `src/app/globals.css` contains theme tokens.
Use `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` to verify.

Context pack for building the **BenchQ** frontend with Claude Code.

**Status: the UI is built and is being connected to the JobNavigator backend (FastAPI), one module
at a time.** Each module runs on mock data (`src/mocks/`) until its adapter in `src/lib/api/`
switches it to the backend. **Integrating a module? Start at
[`docs/integration/README.md`](docs/integration/README.md).**

---

## Files

| File | What it owns | Read it when |
|---|---|---|
| `CLAUDE.md` | The agent contract — scope, rules, conventions, definition of done | Every session, first |
| `product.md` | Why it exists — the user, his night, vocabulary, constraints, judgment principles | Once per session; whenever a spec doesn't cover a case |
| `design.md` | v3 visual language, colour, type, spacing, motion and component rules | Anything visual |
| `docs/01-FRONTEND-ARCHITECTURE.md` | Stack, versions, folder structure, the adapter rule, routing, env | Setting up, adding a dependency, wiring data |
| `docs/02-DATA-CONTRACTS.md` | Every Zod schema; JobNavigator alignment | Defining a type, shaping a fixture |
| `docs/03-MOCK-DATA.md` | Fixture volumes, MSW setup, AI simulation, derived counters | Building the mock layer, adding fixtures |
| `docs/04-SCREENS.md` | Every route: layout, states, permissions, keyboard map | Building any screen |
| `docs/05-COMPONENTS.md` | Component inventory with props and variants | Building any component |
| `docs/06-IMPLEMENTATION-PLAN.md` | Nine phases with exit criteria | Starting work, closing a phase |
| `docs/07-ROUTES-AND-RBAC.md` | Route registry, access per role, UI completion audit, then RBAC | Touching routes, navigation, permissions or role checks |
| `docs/integration/` | Backend integration: data flow, per-module plans, open product decisions | Connecting any module to the backend |
| `docs/archive/` | Backend endpoint reference (`BACKEND_API_FEATURES.md`) and the old JSON-migration notes | Looking up a backend endpoint |

---

## Setup

1. Scaffold the app, then drop this doc set at the repo root:

```
benchq-frontend/
├── CLAUDE.md
├── product.md
├── design.md          ← your existing file, copied here
└── docs/
    ├── 01-FRONTEND-ARCHITECTURE.md
    ├── 02-DATA-CONTRACTS.md
    ├── 03-MOCK-DATA.md
    ├── 04-SCREENS.md
    ├── 05-COMPONENTS.md
    └── 06-IMPLEMENTATION-PLAN.md
```

2. `product.md` and `design.md` both live at the **root**, not in `docs/` — `CLAUDE.md` references
   them there. `design.md` is the single source of truth for every token; `product.md` is the
   single source of truth for every judgment call a spec doesn't cover.

3. Start Claude Code in the repo and begin Phase 0. A good opening prompt:

> Read CLAUDE.md and docs/06-IMPLEMENTATION-PLAN.md. Execute Phase 0 — Foundation. Stop at the
> exit criteria and report against each one.

4. Update the **Current phase** line at the bottom of `CLAUDE.md` as you progress. It is the first
   thing every new session reads.

---

## The three ideas everything else follows from

**One architectural rule.** Components talk to hooks, hooks talk to typed adapters in
`src/lib/api/`, and only adapters decide between mock data and the real backend. Backend responses
are mapped to the frontend types in `src/lib/api/dto/`, so screens never change.

**Verified, unverified, contradicted.** `VERIFIED` is evidence-backed and shippable. `UNVERIFIED` is drafted and needs
review. `CONTRADICTED` conflicts with the evidence and never ships. A resume with any unverified claim cannot be
exported. This is the product, not a feature of it.

**Every number is derived.** Counters are computed from event arrays, never stored as a literal in
a fixture. It mirrors the real backend contract and it catches drift on day one instead of month
four.

---

## Two features drive every decision

1. **Time compression.** Cut the BDE's manual work. Every extra click is a real cost at 11pm on
   application forty.
2. **Total transparency.** The owner and manager can see how many BDEs are working on how many
   applications, for how many candidates, at what stage, at any moment.

If a design choice doesn't serve one of those, it needs a reason.

---

## Related

The full-stack spec set — BRD, PRD, TRD, data model, API spec, AI layer, OSS stack, full
implementation plan — lives in the BenchQ project under `specs/`. This frontend pack is
deliberately narrower and supersedes it wherever the two disagree **on frontend matters only**.
