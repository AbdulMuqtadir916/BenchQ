"use client";

import { useMemo, useState } from "react";
import { Columns3, Calendar, Table2, type LucideIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { useApplications, useUpdateApplicationStatus } from "@/lib/hooks/use-applications";
import { can, scopeApplications } from "@/lib/auth/permissions";
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

const VIEWS: Array<{ id: View; label: string; Icon: LucideIcon }> = [
  { id: "kanban", label: "Board", Icon: Columns3 },
  { id: "calendar", label: "Calendar", Icon: Calendar },
  { id: "table", label: "Table", Icon: Table2 },
];

type View = "kanban" | "table" | "calendar";

export default function ApplicationsPage() {
  const principal = useSignedInPrincipal();
  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  // An error must never read as an empty board (CLAUDE.md: three states, always).
  const loadError = (applicationsQuery.error ?? candidatesQuery.error) as Error | null;
  const retry = () => {
    void applicationsQuery.refetch();
    void candidatesQuery.refetch();
  };
  const [view, setView] = useState<View>("kanban");
  // A move on the board is a real status change (it persists, docs/03 §3.3), shown at once (optimistic).
  const updateStatus = useUpdateApplicationStatus();

  const candidateName = useMemo(() => {
    const map = new Map((candidatesQuery.data ?? []).map((c) => [c.id, c.fullName]));
    return (id: string) => map.get(id) ?? "—";
  }, [candidatesQuery.data]);

  const apps = useMemo(() => {
    let list = applicationsQuery.data ?? [];
    list = scopeApplications(principal, list);
    return list;
  }, [applicationsQuery.data, principal]);

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

      {loadError ? <ErrorState error={loadError} onRetry={retry} /> : applicationsQuery.isLoading ? <SkeletonCard /> : view === "kanban" ? (
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
