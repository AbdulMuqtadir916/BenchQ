"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CandidateCardGrid } from "@/components/app/candidate/candidate-card-grid";
import type { ColumnDef } from "@tanstack/react-table";
import type { Candidate } from "@/lib/schemas/candidate";
import type { CandidateStatus } from "@/lib/schemas/enums";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications } from "@/lib/hooks/use-applications";
import { useTeam } from "@/lib/hooks/use-team";
import { useSession } from "@/lib/stores/session-store";
import { deriveCandidateStats } from "@/lib/derive";
import { DataTable } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { WorkAuthChip } from "@/components/app/work-auth-chip";
import { Tag, type TagTone } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format/timezone";
import { CandidateStatusSelect, type CandidateStatusFilter } from "@/components/app/candidate-status-select";
import { useHref } from "@/lib/routes/use-href";

const STATUS_TONE: Record<CandidateStatus, TagTone> = {
  ON_BENCH: "blue",
  INTERVIEWING: "violet",
  OFFER: "green",
  PLACED: "teal",
  PAUSED: "amber",
  INACTIVE: "neutral",
};

const STATUS_LABEL: Record<CandidateStatus, string> = {
  ON_BENCH: "On bench",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  PLACED: "Placed",
  PAUSED: "Paused",
  INACTIVE: "Inactive",
};

type View = "table" | "cards";
const VIEW_KEY = "benchq:candidates:view";
const viewListeners = new Set<() => void>();
let chosenView: View | null = null;

// The last view is remembered per browser. Storage can be unavailable, so reads and writes never throw.
function readView(): View {
  if (chosenView) return chosenView;
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}
function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}
function chooseView(next: View) {
  chosenView = next;
  try { localStorage.setItem(VIEW_KEY, next); } catch {}
  viewListeners.forEach((l) => l());
}

type Row = {
  candidate: Candidate;
  bde: string;
  apps: number;
  active: number;
  interviews: number;
  lastActivity: string | null;
};

export default function CandidatesPage() {
  const toHref = useHref();
  const router = useRouter();
  const { user } = useSession();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const teamQuery = useTeam();
  const [statusFilter, setStatusFilter] = useState<CandidateStatusFilter>("ALL");
  const view = useSyncExternalStore(subscribeView, readView, () => "table" as View);

  const isBde = user.role === "BDE";

  const rows = useMemo<Row[]>(() => {
    const candidates = candidatesQuery.data ?? [];
    const applications = applicationsQuery.data ?? [];
    const team = teamQuery.data ?? [];
    const visible = isBde
      ? candidates.filter((c) => c.assignedUserIds.includes(user.id))
      : candidates;
    return visible
      .filter((c) => statusFilter === "ALL" || c.status === statusFilter)
      .map((c) => {
        const stats = deriveCandidateStats(c, applications.filter((a) => a.candidateId === c.id));
        const bde = team.find((u) => u.id === c.primaryUserId)?.name ?? "Unassigned";
        return {
          candidate: c,
          bde,
          apps: stats.applicationsSubmitted,
          active: stats.applicationsOpen,
          interviews: stats.interviewsScheduled,
          lastActivity: stats.lastActivityAt,
        };
      });
  }, [candidatesQuery.data, applicationsQuery.data, teamQuery.data, isBde, user.id, statusFilter]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const cols: ColumnDef<Row, unknown>[] = [
      {
        id: "name",
        accessorFn: (r) => r.candidate.fullName,
        header: "Candidate",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="text-body-strong truncate">{row.original.candidate.fullName}</div>
            <div className="text-caption text-[var(--color-text-3)] truncate">{row.original.candidate.primaryRole}</div>
          </div>
        ),
      },
      {
        id: "workAuth",
        accessorFn: (r) => r.candidate.workAuth,
        header: "Work auth",
        enableSorting: false,
        cell: ({ row }) => <WorkAuthChip workAuth={row.original.candidate.workAuth} expiry={row.original.candidate.workAuthExpiry} />,
      },
      {
        id: "status",
        accessorFn: (r) => r.candidate.status,
        header: "Status",
        cell: ({ row }) => <Tag tone={STATUS_TONE[row.original.candidate.status]}>{STATUS_LABEL[row.original.candidate.status]}</Tag>,
      },
      { id: "apps", accessorFn: (r) => r.apps, header: "Apps", cell: ({ row }) => <span className="tabular">{row.original.apps}</span> },
      { id: "active", accessorFn: (r) => r.active, header: "Active", cell: ({ row }) => <span className="tabular">{row.original.active}</span> },
      { id: "interviews", accessorFn: (r) => r.interviews, header: "Interviews", cell: ({ row }) => <span className="tabular">{row.original.interviews}</span> },
      {
        id: "lastActivity",
        accessorFn: (r) => r.lastActivity ?? "",
        header: "Last activity",
        cell: ({ row }) => <span className="whitespace-nowrap text-[var(--color-text-3)]">{row.original.lastActivity ? formatRelative(row.original.lastActivity) : "—"}</span>,
      },
    ];
    if (!isBde) {
      cols.splice(3, 0, {
        id: "bde",
        accessorFn: (r) => r.bde,
        header: "Assigned BDE",
        cell: ({ row }) => <span className="text-[var(--color-text-2)]">{row.original.bde}</span>,
      });
    }
    return cols;
  }, [isBde]);

  const canCreate = user.role !== "VIEWER";

  const toolbar = (
    <div className="flex items-center gap-2">
      <CandidateStatusSelect className="w-40" value={statusFilter} onValueChange={setStatusFilter} />
      <div role="group" aria-label="View" className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5">
        {([["table", "Table", Table2], ["cards", "Cards", LayoutGrid]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={view === id} onClick={() => chooseView(id)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-sm", view === id ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
            <Icon size={14} aria-hidden />{label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bq-page">
      <PageHeader
        title="Candidates"
        subtitle={isBde ? "Your assigned bench." : "Every candidate on the firm's bench."}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href={toHref("candidates.new")}><Plus size={14} aria-hidden />New candidate</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="mt-4">
        {view === "cards" ? (
          <CandidateCardGrid
            rows={rows}
            isLoading={candidatesQuery.isLoading || applicationsQuery.isLoading}
            error={candidatesQuery.error}
            onRetry={() => void candidatesQuery.refetch()}
            showBde={!isBde}
            status={{ tone: (c) => STATUS_TONE[c.status], label: (c) => STATUS_LABEL[c.status] }}
            toolbar={toolbar}
          />
        ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.candidate.id}
          isLoading={candidatesQuery.isLoading}
          error={candidatesQuery.error as Error | null}
          onRowClick={(r) => router.push(toHref("candidates.detail", { id: r.candidate.id }))}
          searchPlaceholder="Search candidates…"
          storageKey="candidates-list"
          pagination
          pageSize={15}
          toolbarActions={toolbar}
          toolbarPlacement="outside"
        />
        )}
      </div>
    </div>
  );
}
