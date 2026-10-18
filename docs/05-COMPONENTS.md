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
`ShiftClock`, `PrincipalSwitcher` (dev only; replaced the RoleSwitcher in Phase T) and the toast viewport.

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
Firm switcher, command trigger, `ShiftClock`, dev principal switcher, user menu.

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

## 3. The claim-state family

This is the product's core concept. These five components carry it and they must be exactly right.

### `ClaimChip`
```ts
{
  state: ClaimState;              // VERIFIED | UNVERIFIED | CONTRADICTED
  label?: string;
  size?: 'sm' | 'md';
  showIcon?: boolean;             // default true
  onClick?: () => void;
}
```
Renders **label + icon + colour**. Never colour alone — colour-blind users and greyscale printing
both break a colour-only signal.

| State | Colour token | Icon | Treatment |
|---|---|---|---|
| `VERIFIED` | `--color-signal` | `CheckCircle2` | Solid |
| `UNVERIFIED` | `--color-unverified` | `CircleHelp` | Dashed border |
| `CONTRADICTED` | `--color-contradicted` | `Ban` | Line-through |

### `ClaimText`
```ts
{
  claim: Claim;
  editable?: boolean;
  onEdit?: (text: string) => void;
  onStateChange?: (state: ClaimState) => void;
}
```
Inline claim text with its state treatment. Click opens the evidence popover. Editable mode is a
contenteditable-free controlled input — do not use `contentEditable`.

### `EvidencePanel`
```ts
{
  evidence: RecordEvidence | null;
  onAttach?: () => void;
  onDetach?: () => void;
}
```
Source document, page, line, with a highlighted preview. Null renders the "no evidence attached"
state with the attach action — which is also the state that keeps a claim from being verified.

### `UnverifiedCounter`
```ts
{ count: number; onJumpToFirst?: () => void; variant?: 'inline' | 'banner' }
```
Zero renders nothing. Non-zero renders "N claims need review" with the jump action.

### `ExportGate`
```ts
{
  unverifiedCount: number;
  contradictedCount: number;
  onExport: () => void;
  onJumpToFirst: () => void;
}
```
Wraps the export button. Zero unverified claims → enabled. Otherwise disabled with the reason and the
jump link. The **only** sanctioned disabled control in the product.

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

### `FollowUpRow`
```ts
{ followUp: FollowUp; onComplete: () => void; onSnooze: (d: SnoozeDuration) => void; onCancel: () => void }
```

### `OutreachComposer`
```ts
{
  application: Application;
  templates: OutreachTemplate[];
  onSend: (draft: OutreachDraft) => void;
}
```
Template select, merge-field preview, and the unverified-claim check that blocks send when the body
pulls an unreviewed claim from the record.

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
Paginated. Excludes `CONTRADICTED` claims entirely. Must not block the editor's main thread.

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
`03-MOCK-DATA.md §5`, the output always arrives `UNVERIFIED` — the UI should set that expectation while
it runs, not surprise the user with it at the end.

### `ConfirmDialog`
```ts
{ title: string; description: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void }
```

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
