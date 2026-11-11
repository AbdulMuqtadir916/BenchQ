"use client";

import { Suspense, useMemo } from "react";
import { Columns3, Calendar, SearchX, Table2, type LucideIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { useApplications, useUpdateApplicationStatus } from "@/lib/hooks/use-applications";
import { can, scopeApplications, scopeTeam } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { ApplicationBoard } from "@/components/app/applications/application-board";
import { STATUS_LABEL, STATUS_TONE } from "@/components/app/applications/status-meta";
import { ErrorState } from "@/components/app/error-state";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { FilterChips, type FilterChip } from "@/components/app/filter-chips";
import { filterApplications } from "@/lib/derive/list-filters";
import { useNow } from "@/lib/hooks/use-now";
import { useTeam } from "@/lib/hooks/use-team";
import { useUrlState } from "@/lib/routes/use-url-state";
import { ApplicationsSearch, type ApplicationDate, type ApplicationsSearchState } from "@/lib/schemas/list-search";

const VIEWS: Array<{ id: View; label: string; Icon: LucideIcon }> = [
  { id: "kanban", label: "Board", Icon: Columns3 },
  { id: "calendar", label: "Calendar", Icon: Calendar },
  { id: "table", label: "Table", Icon: Table2 },
];

type View = ApplicationsSearchState["view"];

const DONE: Record<ApplicationDate, string> = { applied: "Submitted", response: "Heard back", interview: "Interviewed", offer: "Offer made", placed: "Placed" };
const periodText = (period: string) => (period === "1d" ? "the last 24 hours" : `the last ${period.slice(0, -1)} days`);

/** useSearchParams (the view and filters) needs a Suspense boundary for the static build. */
export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationsList />
    </Suspense>
  );
}

function ApplicationsList() {
  const principal = useSignedInPrincipal();
  const now = useNow();
  const teamQuery = useTeam();
  const [search, setSearch] = useUrlState(ApplicationsSearch);
  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  // An error must never read as an empty board (CLAUDE.md: three states, always).
  const loadError = (applicationsQuery.error ?? candidatesQuery.error) as Error | null;
  const retry = () => {
    void applicationsQuery.refetch();
    void candidatesQuery.refetch();
  };
  const view = search.view;
  const setView = (next: View) => setSearch({ view: next });
  // A move on the board is a real status change (it persists, docs/03 §3.3), shown at once (optimistic).
  const updateStatus = useUpdateApplicationStatus();

  const candidateName = useMemo(() => {
    const map = new Map((candidatesQuery.data ?? []).map((c) => [c.id, c.fullName]));
    return (id: string) => map.get(id) ?? "—";
  }, [candidatesQuery.data]);

  const apps = useMemo(() => {
    const candidates = candidatesQuery.data ?? [];
    const scoped = scopeApplications(principal, applicationsQuery.data ?? [], candidates);
    return filterApplications(scoped, search, candidates, now);
  }, [applicationsQuery.data, candidatesQuery.data, principal, search, now]);

  // Until the team arrives there is no name to show, so the chip says nothing rather than "no longer on the team".
  const scopedTeam = teamQuery.data && scopeTeam(principal, teamQuery.data, candidatesQuery.data ?? []);
  const personName = (id: string) => scopedTeam?.find((user) => user.id === id)?.name
    ?? (teamQuery.isLoading || candidatesQuery.isLoading ? "…" : "Unknown team member");
  const chips: FilterChip[] = [
    search.status ? { key: "status", label: `Now: ${STATUS_LABEL[search.status]}`, onRemove: () => setSearch({ status: "" }) } : null,
    search.reached ? { key: "reached", label: `Reached ${STATUS_LABEL[search.reached]}`, onRemove: () => setSearch({ reached: "" }) } : null,
    search.period ? { key: "period", label: `${DONE[search.by]} in ${periodText(search.period)}`, onRemove: () => setSearch({ period: "", by: "applied" }) } : null,
    search.manager ? { key: "manager", label: `Team: ${personName(search.manager)}`, onRemove: () => setSearch({ manager: "" }) } : null,
    search.bde ? { key: "bde", label: `BDE: ${personName(search.bde)}`, onRemove: () => setSearch({ bde: "" }) } : null,
    search.candidate ? { key: "candidate", label: `Candidate: ${candidateName(search.candidate)}`, onRemove: () => setSearch({ candidate: "" }) } : null,
  ].filter((chip): chip is FilterChip => chip !== null);
  const clearFilters = () => setSearch({ status: "", reached: "", by: "applied", period: "", manager: "", bde: "", candidate: "" });

  function moveTo(id: string, to: ApplicationStatus) {
    updateStatus.mutate({ id, status: to, note: null });
  }

  return (
    <div className="bq-page bq-page-wide">
      <PageHeader title="Applications" subtitle={can(principal, "application.move") ? "Drag a card into the next stage." : "Every application, by stage."} />
      <div className="mb-4 flex flex-wrap items-center gap-1" role="tablist" aria-label="View">
        {VIEWS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="bq-view-tab" onClick={() => setView(id)}>
            <Icon size={15} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <FilterChips chips={chips} onClear={clearFilters} />

      {loadError ? <ErrorState error={loadError} onRetry={retry} /> : applicationsQuery.isLoading || candidatesQuery.isLoading ? <SkeletonCard /> : chips.length && apps.length === 0 ? (
        <EmptyState variant="filtered" icon={SearchX} title="No applications match these filters" description="Remove a filter above, or clear them all to see every application."
          action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
      ) : view === "kanban" ? (
        <ApplicationBoard apps={apps} candidateName={candidateName} onMove={moveTo} canAct={can(principal, "application.move")} />
      ) : view === "table" ? (
        <TableView apps={apps} candidateName={candidateName} />
      ) : (
        <CalendarView apps={apps} candidateName={candidateName} />
      )}
    </div>
  );
}

function TableView({ apps, candidateName }: { apps: Application[]; candidateName: (id: string) => string }) {
  const columns: ColumnDef<Application, unknown>[] = [
    { id: "candidate", accessorFn: (a) => candidateName(a.candidateId), header: "Candidate", cell: ({ row }) => <span className="text-body-strong">{candidateName(row.original.candidateId)}</span> },
    { id: "job", accessorFn: (a) => a.jobTitleAtApply, header: "Role", cell: ({ row }) => <span className="text-[var(--color-text-2)]">{row.original.jobTitleAtApply}</span> },
    { id: "company", accessorFn: (a) => a.companyNameAtApply, header: "Company" },
    { id: "status", accessorFn: (a) => a.status, header: "Status", cell: ({ row }) => <Tag tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Tag> },
    { id: "applied", accessorFn: (a) => a.appliedAt ?? "", header: "Applied", cell: ({ row }) => row.original.appliedAt ? <DualTimestamp iso={row.original.appliedAt} format="relative" className="text-[var(--color-text-3)]" /> : <span className="text-[var(--color-text-3)]">—</span> },
  ];
  return <DataTable columns={columns} data={apps} getRowId={(a) => a.id} isRowSelectable={false} searchPlaceholder="Search applications…" storageKey="applications-table" pagination pageSize={15} />;
}

function CalendarView({ apps, candidateName }: { apps: Application[]; candidateName: (id: string) => string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = first.getDay();

  // Cheap to recompute; memoising on a render-time date trips the React compiler.
  const byDay = (() => {
    const map = new Map<number, Application[]>();
    for (const a of apps) {
      const d = a.interviewAt ?? a.offerAt;
      if (!d) continue;
      const dt = new Date(d);
      if (dt.getFullYear() === year && dt.getMonth() === month) {
        const day = dt.getDate();
        map.set(day, [...(map.get(day) ?? []), a]);
      }
    }
    return map;
  })();

  const cells: (number | null)[] = [...Array(startDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <Card>
      <div className="mb-3 text-body-strong">{first.toLocaleString("en-US", { month: "long", year: "numeric" })} · interviews & offers</div>
      <div className="grid grid-cols-7 gap-1 text-center text-caption text-[var(--color-text-3)]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
        {cells.map((day, i) => (
          <div key={i} className="min-h-16 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1 text-left">
            {day ? (
              <>
                <div className={`text-caption ${day === now.getDate() ? "font-bold text-[var(--color-primary)]" : "text-[var(--color-text-3)]"}`}>{day}</div>
                {(byDay.get(day) ?? []).slice(0, 2).map((a) => (
                  <div key={a.id} className="mt-0.5 truncate rounded bg-[var(--color-primary-subtle)] px-1 text-[10px] text-[var(--color-primary-subtle-fg)]">{candidateName(a.candidateId)}</div>
                ))}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
