# 05 — Components

Visual specification update: `../design.md` v3 is authoritative. Existing shared
components now use 13px body text, 32px controls, 36px default rows, fine neutral
borders, contact shadows, gradient actions, and colored monospace tags. The live
`/dev/design-system` route is the implemented specimen; the inventory below also
contains future components and is not a statement that all are implemented.

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026

The component inventory. `src/components/ui/` holds shadcn primitives, edited in place.
`src/components/app/` holds everything below. Every domain component gets a Storybook story
covering all of its states before it's considered done.

---

## 0. Rules

**Props are typed from Zod.** A component that renders a candidate takes
`candidate: Candidate` inferred from `CandidateSchema` — never a hand-written interface that
duplicates it and drifts.

**No component fetches.** Components receive data. Hooks fetch. A component that calls
`useQuery` directly is acceptable only at the page-section level (a panel that owns its own
data), never in a leaf.

**Every component over ~200 lines gets split.** If it needs a comment to explain its sections, it
needs to be two components.

**Icons:** `lucide-react` only. No emoji as iconography, anywhere, ever. An emoji in a UI label is
a bug.

**Variants:** use `cva` (class-variance-authority, ships with shadcn) for anything with more than
two visual variants. Don't build variant logic out of ternaries.

---

## 1. shadcn primitives to install

```
button   input    textarea  select     checkbox  radio-group  switch
label    form     dialog    sheet      popover   dropdown-menu  command
tabs     table    card      badge      avatar    separator    skeleton
tooltip  toast    alert     progress   scroll-area  resizable  calendar
accordion  collapsible  hover-card  context-menu  slider  toggle-group
```

Install with `pnpm dlx shadcn@latest add <name>`. Then apply `design.md` tokens to each — the
defaults will not match the BenchQ palette and must not be left as-is.

---

## 2. Layout

### `AppShell`
```ts
{ children: ReactNode }
```
Sidebar + topbar + content. Reads sidebar collapse from `useUiStore`. Renders `CommandPalette`,
`ShiftClock` and the toast viewport. `variant="admin"` is the platform tier's shell (admin nav, no firm notifications).

### `Sidebar`
```ts
{ collapsed: boolean; onToggle: () => void }
```
Nav items filtered by role. Badge counts passed in, derived upstream. Tooltip labels when
collapsed. Active route from `usePathname`.

### `Topbar`
```ts
{ }
```
`UserMenu` (who is signed in, role, firm, **Sign out**; docs/07 L3), command trigger, `ShiftClock`, notifications (firm shell only), theme toggle. There is no principal switcher (docs/07 Q25).

### `DetailShell`
```ts
{
  header: ReactNode;
  tabs: { href: string; label: string; badge?: number }[];
  children: ReactNode;
}
```
Sticky header block, tab rail, content. Used by candidate, job and application detail.

### `ThreePaneShell`
```ts
{
  left: ReactNode; center: ReactNode; right: ReactNode;
  storageKey: string;
  defaults?: [number, number, number];
}
```
Resizable, widths persisted to `localStorage` under `storageKey`, wrapped in try/catch with the
defaults as fallback. Collapses to two panes under 1280px.

### `PageHeader`
```ts
{ title: string; description?: string; actions?: ReactNode; breadcrumbs?: Crumb[] }
```

---

## 3. Résumé tree

### `ResumeTree`
```ts
{
  tree: TreeCandidate[];          // buildResumeTree(shelf) in src/lib/derive/resume-tree.ts
  labels: { job(jobId): { company; title } | null; candidate(id); userName(userId): string | null };   // useTreeLabels(candidates, shelf): a copy's job from the listing's targetJob, no jobs read
  candidateHeading?: (candidateId) => { name; role } | null;              // Resume Builder only
  showTailored?: boolean;         // default true
  canSeeHidden?: (candidateId) => boolean;   // canManageResume: the assigned BDE
  openActive?: boolean;           // a candidate's tab opens the active base
  actions?: TreeActions;          // useResumeActions(): pick, use as base, delete, show again, each by who may (Q55)
}
```
A collapsible tree used by Resume Builder and the candidate's Résumés tab (`src/components/app/resumes/`). A base
(`BaseFolder`) is a folder: its versions (newest first) and the tailored copies made from it, one per job. Each version
opens that exact version in the studio (Builder; *View* for Viewer). `J` / `K` move between rows. The active base starts open. A deleted item is never
listed; a hidden base shows in a "Hidden" row for the assigned BDE only. There are no claim states (dropped
2026-11-05), so no chips, counters or export gate.

### `UploadResume`
`{ candidateId }` — the assigned BDE's later résumé (resume-versioning §4.6): a new base, the one in use; a same-file
409 names the base, offers a hidden one back; a deleted one comes back (`restored`).

---

## 4. Domain components

### `CandidateCard`
```ts
{ candidate: Candidate; stats: CandidateStats; variant?: 'grid' | 'row'; onClick?: () => void }
```
Avatar, name, title, work-auth chip, status, derived stats, assigned BDE.

### `CandidateStatCard`
```ts
{ label: string; value: number | string; delta?: number; trend?: number[]; icon?: LucideIcon; href?: string }
```
One derived number with optional sparkline and period delta. Clickable variant routes to the
filtered list behind the number — every stat should be traceable to its rows.

### `WorkAuthChip`
```ts
{ auth: WorkAuth; expiresAt?: string; size?: 'sm' | 'md' }
```
Within 90 days of expiry, renders amber with the date. This matters in bench sales and shouldn't
be buried in a detail view.

### `StatusSelect`
```ts
{ value: ApplicationStatus; onChange: (s: ApplicationStatus) => void; allowed?: ApplicationStatus[]; disabled?: boolean }
```
Only valid transitions are selectable. The state machine lives in `src/lib/derive/transitions.ts`,
not in the component.

### `MatchScoreBar`
```ts
{ score: number; depth: ScoringDepth; breakdown?: ScoreBreakdown; compact?: boolean }
```
0–100 with a colour ramp. `LIGHT` depth renders a subtle marker distinguishing it from `FULL`, and
hovering shows the breakdown. The depth distinction is real information — a light score is a
cheaper estimate and the BDE should know that.

### `RequirementMatrix`
```ts
{ requirements: Requirement[]; grouped?: boolean }
```
HAVE / MISSING / ADJACENT per requirement, grouped by MANDATORY / PREFERRED / ADJACENT. The most
useful thing on a job detail screen — build it well.

### `JobRow`
```ts
{
  job: Job;
  match?: Match;
  candidateContext?: Candidate;
  actions?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}
```
Virtualisation-friendly: fixed height, no layout thrash. Actions render only when
`candidateContext` is present, because `T`/`A`/`O` are meaningless without a candidate.

### `VerificationBadge`
```ts
{ verdict: VerificationVerdict; reasons?: string[]; size?: 'sm' | 'md' }
```
VERIFIED / CAUTION / REJECTED / UNKNOWN with the reason list on hover.

### `SourceChip`
```ts
{ sourceType: JobSourceType; legalBasis: LegalBasis; capturedAt: string }
```
Where a job came from and under what basis. Visible provenance is a compliance feature, not
decoration — keep it on the row, not hidden in a menu.

### `H1bDataCard`
```ts
{ data: H1bData | null; companyName: string }
```
Sponsorship history, LCA count, median wage, most recent filing. Null renders "no filing data" —
which is itself information, not an error.

### `ApplicationCard`
```ts
{ application: Application; showCandidate?: boolean; showBde?: boolean; draggable?: boolean }
```
Kanban card. `days in stage` is derived and turns amber past the stage's expected duration.

### `TimelineEvent`
```ts
{ event: TimelineEvent; showActor?: boolean; expandable?: boolean }
```
Icon by type, dual timestamp, actor, expandable diff.

### `DualTimestamp`
```ts
{ iso: string; primary?: 'local' | 'ist'; format?: 'relative' | 'absolute' | 'both' }
```
Never render a bare UTC string anywhere in this product.

### `ShiftClock`
```ts
{ }
```
US Eastern and IST side by side, remaining shift time, amber inside the last 45 minutes.

### `OutreachComposer`
```ts
{
  application: Application;
  templates: OutreachTemplate[];
  onSend: (draft: OutreachDraft) => void;
}
```
Template select and merge-field preview.

### `QaBankPanel`
```ts
{ candidateId: string; question?: string; onInsert: (answer: string) => void }
```
JobNavigator-aligned. Search prior answers, insert, save a new pair. This is a pure time-saving
component and it should feel instant — no loading spinner on a local search.

### `RecordSection`
```ts
{ section: RecordSection; editable: boolean; onReorder: (ids: string[]) => void }
```
dnd-kit sortable, with keyboard reordering (`Space` to lift, arrows to move, `Space` to drop).
Drag-only reordering is an accessibility failure.

### `ResumePreview`
```ts
{ resume: ResumeVersion; template: TemplateId; page?: number; scale?: number }
```
Paginated. Must not block the editor's main thread.

---

## 5. Data-display primitives

### `DataTable`
```ts
{
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  error?: Error | null;
  emptyState?: ReactNode;
  virtualise?: boolean;
  density?: 'compact' | 'default' | 'comfortable';
  onRowClick?: (row: T) => void;
  storageKey?: string;          // persists column visibility + order
}
```
One table component for the whole product. It owns skeleton, empty and error internally, so no
caller can forget them. Keyboard: `J`/`K`/`Enter`/`x`/`/`.

### `KanbanBoard`
```ts
{ columns: KanbanColumn[]; onMove: (id: string, to: string) => void; renderCard: (item) => ReactNode }
```

### `FilterRail`
```ts
{ filters: FilterDef[]; value: FilterState; onChange: (v: FilterState) => void; onClear: () => void }
```
Active filter count visible, clear-all always reachable. Filter state syncs to the URL query
string so a filtered view is shareable — a manager should be able to paste a link, not describe a
filter.

### `StatStrip`
```ts
{ stats: { label: string; value: number | string; href?: string }[] }
```

### `EmptyState`
```ts
{ icon: LucideIcon; title: string; description: string; action?: ReactNode; variant?: 'first-run' | 'filtered' | 'error' }
```
The variant matters. First-run teaches; filtered offers a clear action; error offers retry. Using
one for all three is the single most common way an app feels unfinished.

### `ErrorState`
```ts
{ error: Error; onRetry?: () => void; variant?: 'inline' | 'page' }
```

### `SkeletonList` / `SkeletonCard` / `SkeletonTable`
Shape-matched to the real content. A generic grey box is worse than nothing — it causes layout
shift on load.

---

## 6. Charts (`src/components/charts/`)

All Recharts, all with a table-equivalent toggle, all with an empty state, all readable in both
themes.

| Component | Props | Used on |
|---|---|---|
| `FunnelChart` | `{ stages: FunnelStage[] }` | Analytics, dashboard |
| `ThroughputChart` | `{ series: Series[]; range: DateRange; groupBy: 'bde' \| 'candidate' }` | Analytics |
| `StatusDonut` | `{ data: StatusCount[]; onSegmentClick? }` | Candidate overview, dashboard |
| `TrendLine` | `{ points: Point[]; compareTo?: Point[] }` | Analytics |
| `BdeBarChart` | `{ rows: BdeRow[]; metric: Metric }` | Manager dashboard |
| `Sparkline` | `{ values: number[]; trend?: 'up' \| 'down' }` | Stat cards |

---

## 7. Feedback

### `AiProgress`
```ts
{ stage: string; progress: number; onCancel?: () => void; elapsedMs: number }
```
Staged progress for simulated AI work. Shows the cancel action after 8 seconds. Per
`03-MOCK-DATA.md §5`, the output is a draft to read over — the UI should say so while it runs.

### `TailorButton` (`src/components/app/tailoring/`)
```ts
{ candidate: Candidate; job: { id: string; title: string }; variant?: "button" | "icon"; className?: string }
```
Tailor the candidate's résumé for this job (docs/02 §8.3): renders nothing unless `canManageResume` (07 Q55). The
source picker (`tailorSources(shelf, candidateId)`) lists the visible bases' own versions; "Tailor again" and **Open
tailored** once a copy exists; dimmed while that source and job run; a refusal in one line (`startRefusal`).

### `TailoringPanel`
No props; mounted once in `app/[firm]/layout.tsx`. The signed-in firm user's tailorings (`useMyTailorings`, read every
3 s while one runs): the open run as `AgentRunPanel` with the real step, the rest as rows; Hide (a pill) and ×
(dismissed rows) are kept in this browser (`stored.ts`). Nothing in a support view or with no tailorings.

### `ConfirmDialog`
```ts
{ open: boolean; title: string; children?: ReactNode; confirmLabel: string; cancelLabel?: string;
  tone?: 'danger' | 'primary'; isBusy?: boolean; onConfirm: () => void; onCancel: () => void }
```
`src/components/app/confirm-dialog.tsx` (built in résumé versioning PR 7): a native modal `<dialog>`; focus starts on
the safe choice, Esc cancels. Used by the studio (discard, "Use this as the base?") and the résumé tree's deletes.

### `Toast`
Success, error, info, and an undo variant with a 5s window for reversible actions (status change,
snooze, bulk edits).

### `KeyboardHintSheet`
```ts
{ context: string }
```
Opened with `?`. Lists global shortcuts plus the current context's. Keep it accurate as you add
shortcuts — an out-of-date shortcut sheet is worse than none.

---

## 8. Storybook requirements

Every component in §3 and §4 ships with stories for:

- default
- loading / skeleton (where applicable)
- empty
- error (where applicable)
- every variant and size
- light **and** dark
- 390px viewport

Run `pnpm storybook` and walk the whole set before closing a phase. It's the fastest way to find
the state you forgot.
