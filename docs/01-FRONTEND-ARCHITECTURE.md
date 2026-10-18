# 01 — Frontend Architecture

> **Data layer superseded (October 2026).** MSW is gone. Adapters in `src/lib/api/` now choose
> between `src/mocks/` (lazy-loaded JSON) and the real FastAPI backend via `http.ts`, per module.
> The current data flow, env vars and integration rules are in
> [`docs/integration/README.md`](./integration/README.md). Everything else in this file still
> applies.

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026

---

## 1. The one architectural rule

Every screen talks to a **typed data adapter**, never to a network directly.

```
Component → TanStack Query hook → Adapter interface → Mock implementation (today)
                                                    → HTTP implementation (later)
```

There is exactly one file per domain in `src/lib/api/` exporting a typed object. Today those
functions read from fixtures and resolve after a simulated delay. When the backend lands, each one
is rewritten to call the real endpoint — and **no screen, hook or component changes.**

If you find yourself importing a fixture directly into a component, that's a bug. Fixtures are only
ever read by the adapter layer.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15**, App Router, React 19 | Keeps the path to full-stack open; Server Components cut client JS on a data-dense app |
| Language | **TypeScript 5.6**, strict | Non-negotiable on a product with this much state |
| Styling | **Tailwind CSS v4** | Tokens from `design.md` map straight onto `@theme` |
| Components | **shadcn/ui** | Copied into the repo, so they're editable and readable by agents |
| Data fetching | **TanStack Query v5** | Caching, loading states, optimistic updates — all needed even against mocks |
| Mock transport | **MSW v2** | Intercepts real `fetch`, so the swap to a live API is a config change, not a refactor |
| Tables | **TanStack Table v8** | The tracker needs sorting, filtering, grouping, virtualisation |
| Forms | **React Hook Form + Zod** | One schema validates the form and types the data |
| Charts | **Recharts** | Funnel, trends, by-BDE bars |
| UI state | **Zustand** | Theme, sidebar, command palette, table density — small and local |
| Drag & drop | **dnd-kit** | Kanban columns, Record section reordering |
| Dates | **date-fns** + **date-fns-tz** | Dual IST / US timezone display is everywhere |
| Icons | **lucide-react** | Consistent, tree-shakeable |
| Animation | **Framer Motion** | Only for the unverified→verified transition and layout shifts |
| Testing | **Vitest** + **Playwright** + **@axe-core/playwright** | Unit, E2E, accessibility |
| Workshop | **Storybook 8** | Every domain component gets a story with all states |
| Package manager | **pnpm** | Fast, strict |

### 2.1 Versions to pin

```
node                 22.x LTS
next                 15.x
react                19.x
typescript           5.6+
tailwindcss          4.x
@tanstack/react-query 5.x
@tanstack/react-table 8.x
msw                  2.x
zod                  3.23+
zustand              5.x
@dnd-kit/core        6.x
recharts             2.x
framer-motion        11.x
```

---

## 3. Dependency policy

Before adding anything not listed above: check bundle size, check it's actively maintained, and
check there isn't already something in the list that does the job. Prefer writing 40 lines to
adding a dependency for one utility.

**Explicitly rejected:** moment.js (use date-fns) · axios (use fetch) · lodash (use native) ·
any component library other than shadcn/ui · any CSS-in-JS runtime · any state library beyond
Zustand and TanStack Query.

---

## 4. Folder structure

```
benchq-frontend/
├── CLAUDE.md
├── product.md                       ← why, who for, vocabulary, judgment calls
├── design.md                        ← tokens, type, motion. Source of truth.
├── docs/
│   ├── 01-FRONTEND-ARCHITECTURE.md
│   ├── 02-DATA-CONTRACTS.md
│   ├── 03-MOCK-DATA.md
│   ├── 04-SCREENS.md
│   ├── 05-COMPONENTS.md
│   └── 06-IMPLEMENTATION-PLAN.md
├── src/
│   ├── app/
│   │   ├── layout.tsx               root: providers, theme, fonts
│   │   ├── (auth)/
│   │   │   ├── sign-in/page.tsx
│   │   │   └── invite/[token]/page.tsx
│   │   ├── (onboarding)/
│   │   │   └── welcome/page.tsx     4-step wizard
│   │   ├── (app)/
│   │   │   ├── layout.tsx           AppShell: sidebar + topbar
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── candidates/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/
│   │   │   │       ├── layout.tsx   candidate header + tabs
│   │   │   │       ├── page.tsx     overview
│   │   │   │       ├── record/page.tsx
│   │   │   │       ├── resumes/page.tsx
│   │   │   │       ├── applications/page.tsx
│   │   │   │       └── timeline/page.tsx
│   │   │   ├── jobs/
│   │   │   │   ├── page.tsx         feed
│   │   │   │   ├── capture/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── resumes/[id]/page.tsx    three-pane builder
│   │   │   ├── applications/
│   │   │   │   ├── page.tsx         kanban | table | calendar
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── outreach/page.tsx
│   │   │   ├── followups/page.tsx
│   │   │   ├── analytics/page.tsx   MANAGER+
│   │   │   ├── ledger/page.tsx
│   │   │   └── settings/
│   │   │       ├── page.tsx         firm
│   │   │       ├── team/page.tsx
│   │   │       ├── templates/page.tsx
│   │   │       └── preferences/page.tsx
│   │   └── admin/                   PLATFORM_ADMIN
│   ├── components/
│   │   ├── ui/                      shadcn primitives
│   │   ├── app/                     domain components
│   │   ├── charts/
│   │   └── layout/                  AppShell, Sidebar, Topbar, DetailShell
│   ├── lib/
│   │   ├── api/                     ← THE ADAPTER LAYER
│   │   │   ├── client.ts            fetch wrapper, error normalisation
│   │   │   ├── candidates.ts
│   │   │   ├── records.ts
│   │   │   ├── resumes.ts
│   │   │   ├── jobs.ts
│   │   │   ├── matches.ts
│   │   │   ├── applications.ts
│   │   │   ├── outreach.ts
│   │   │   ├── followups.ts
│   │   │   ├── analytics.ts
│   │   │   └── ledger.ts
│   │   ├── hooks/                   TanStack Query hooks, one per adapter
│   │   ├── schemas/                 Zod — source of truth for all types
│   │   ├── stores/                  Zustand
│   │   ├── derive/                  counter + stat computation (pure, tested)
│   │   ├── format/                  dates, currency, dual-timezone, numbers
│   │   └── utils.ts                 cn(), misc
│   ├── mocks/
│   │   ├── browser.ts               MSW worker
│   │   ├── server.ts                MSW node (tests)
│   │   ├── handlers/                one per domain, mirrors lib/api
│   │   └── fixtures/                the seed data
│   └── types/
├── .storybook/
├── tests/
│   ├── unit/
│   └── e2e/
└── public/
    └── mockServiceWorker.js
```

---

## 5. The adapter layer in practice

```ts
// src/lib/api/candidates.ts
import { z } from 'zod';
import { CandidateSchema, CandidateStatsSchema } from '@/lib/schemas/candidate';
import { http } from './client';

export const candidatesApi = {
  list: (params: ListCandidatesParams) =>
    http.get('/api/candidates', { params, schema: z.array(CandidateSchema) }),

  byId: (id: string) =>
    http.get(`/api/candidates/${id}`, { schema: CandidateSchema }),

  stats: (id: string) =>
    http.get(`/api/candidates/${id}/stats`, { schema: CandidateStatsSchema }),

  create: (input: CreateCandidateInput) =>
    http.post('/api/candidates', { body: input, schema: CandidateSchema }),
};
```

`http` is a thin `fetch` wrapper that validates every response against its Zod schema. **MSW
intercepts these calls in development and test.** The component never knows whether the data came
from a fixture or a server — which is exactly the point.

```ts
// src/lib/hooks/use-candidates.ts
export function useCandidate(id: string) {
  return useQuery({
    queryKey: ['candidate', id],
    queryFn: () => candidatesApi.byId(id),
  });
}
```

---

## 6. Routing and layout shells

Four shells, defined in `src/components/layout/`:

| Shell | Used by | Structure |
|---|---|---|
| `AuthShell` | sign-in, invite | Centred card, no chrome |
| `AppShell` | everything under `(app)` | Collapsible sidebar + topbar + content |
| `DetailShell` | candidate, job, application detail | Sticky header block + tabs + content |
| `ThreePaneShell` | resume builder | Resizable panes, widths persisted |

Sidebar collapse state, pane widths and table density persist to `localStorage` — wrapped in
try/catch, with a working default when storage is unavailable.

---

## 7. Role simulation

There is no auth. A **dev principal switcher in the topbar** (development only, behind
`NEXT_PUBLIC_SHOW_DEV_TOOLS=true`, off by default) signs in as any fixture principal: every role in firm A
(`OWNER`, `MANAGER`, `BDE`, `VIEWER`), the users of the other fixture firms, and the platform admin
(listed, selectable from Phase P). It signs the mock backend in too (`src/mocks/auth.ts`), so mutations
are attributed to the right person. Every permission-dependent surface reads from the Zustand
`useSession` store (principal, user, firm); firm data reads `useFirmId()`.

This matters more than it sounds: it's how you verify that a BDE never sees `/analytics`, that a
VIEWER has no mutating controls in the DOM at all, and that a BDE sees only their assigned
candidates. Build the switcher in Phase 0 and use it constantly.

---

## 8. Performance targets

| Surface | Target |
|---|---|
| Route transition | < 200ms perceived |
| Job feed, 500 rows | 60fps scroll — virtualise past 100 rows |
| Application tracker, 1,000 rows | Virtualised, < 100ms filter |
| Resume builder keystroke → preview | < 120ms |
| Initial JS bundle | < 250KB gzipped |
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 95 |

Virtualise with `@tanstack/react-virtual` on the job feed, the tracker table and the ledger.

---

## 9. Environment

```bash
NEXT_PUBLIC_API_MOCKING=enabled        # MSW on. 'disabled' points at a real API later.
NEXT_PUBLIC_SHOW_DEV_TOOLS=true        # dev-only role simulation (off unless 'true')
NEXT_PUBLIC_MOCK_LATENCY_MS=300        # simulated network delay
NEXT_PUBLIC_MOCK_AI_LATENCY_MS=2500    # simulated agent delay — see 03-MOCK-DATA.md §5
NEXT_PUBLIC_MOCK_ERROR_RATE=0          # 0–1, injects failures to exercise error states
```

`NEXT_PUBLIC_MOCK_ERROR_RATE` is the one people skip. Set it to `0.1` for a session and fix every
error state it exposes — that's cheaper than discovering them in a demo.
