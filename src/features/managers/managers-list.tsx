"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Search, Table2, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { managerRows, periodLabel, windowOf, type ManagerRow } from "@/features/dashboard/activity/activity-numbers";
import { PeriodPicker } from "@/features/dashboard/owner-activity-dashboard";
import { ManagerTable } from "@/features/dashboard/activity/activity-tables";
import { scopeApplications, scopeCandidates, scopeTeam } from "@/lib/auth/permissions";
import { isManager } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useNow } from "@/lib/hooks/use-now";
import { useTeam } from "@/lib/hooks/use-team";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { useUrlState } from "@/lib/routes/use-url-state";
import { ManagersSearch } from "@/lib/schemas/list-search";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The owner's managers: who runs which team, how big it is, and its numbers for the period. Each opens that team's dashboard. */
export function ManagersList() {
  const principal = useSignedInPrincipal();
  const toHref = useHref();
  const router = useRouter();
  const now = useNow();
  const [{ view, q, period }, setQuery] = useUrlState(ManagersSearch);
  const teamQuery = useTeam();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const group = queryGroup(teamQuery, candidatesQuery, applicationsQuery);

  const rows = useMemo(() => {
    const allCandidates = candidatesQuery.data ?? [];
    const users = scopeTeam(principal, teamQuery.data ?? [], allCandidates);
    const candidates = scopeCandidates(principal, allCandidates);
    const applications = scopeApplications(principal, applicationsQuery.data ?? [], allCandidates);
    const needle = q.trim().toLowerCase();
    return managerRows(users.filter(isManager), users, candidates, applications, windowOf(period, now))
      .filter((row) => !needle || row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
  }, [principal, teamQuery.data, candidatesQuery.data, applicationsQuery.data, q, period, now]);

  const dashboardOf = (row: ManagerRow) => toHref("dashboard", {}, { view: "activity", manager: row.id, period });
  const empty = q
    ? <EmptyState variant="filtered" icon={Search} title="No manager matches" description={`Nobody's name contains "${q}".`} />
    : <EmptyState icon={Users} title="No managers yet" description="Invite a manager from Settings, Team. They show up here with their team." />;

  return (
    <div className="bq-page">
      <PageHeader title="Managers" subtitle="Each manager's team and its numbers for the period. Open one to see their team on the dashboard." actions={<PeriodPicker value={period} onChange={(next) => setQuery({ period: next })} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-48 flex-1 sm:max-w-72">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input value={q} onChange={(event) => setQuery({ q: event.target.value })} placeholder="Search managers…" aria-label="Search managers" className="pl-9" />
        </div>
        <div role="tablist" aria-label="View" className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5">
          {([["table", "Table", Table2], ["cards", "Cards", LayoutGrid]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setQuery({ view: id })}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-sm", view === id ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
              <Icon size={14} aria-hidden />{label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{group.status === "success" ? plural(rows.length, "manager") : null}</span>
      </div>

      {group.status === "error" ? <ErrorState error={group.error} onRetry={group.retry} />
        : group.status === "pending" ? <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          : view === "table" ? (
            <div className="bq-card p-0"><ManagerTable rows={rows} onOpen={(row) => router.push(dashboardOf(row))} emptyState={empty} /></div>
          ) : rows.length === 0 ? empty : (
            <ul aria-label="Managers" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={dashboardOf(row)} className="bq-card block p-4 transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-body-strong text-[var(--color-text)]">{row.name}</span>
                      <Tag tone={row.isActive ? "green" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</Tag>
                    </span>
                    <span className="mt-1 block text-caption text-[var(--color-text-3)]">
                      {plural(row.bdes, "BDE")} · {plural(row.candidates, "candidate")}
                      {row.withoutBde ? <span className="text-[var(--color-warning-fg)]"> · {row.withoutBde} waiting for a BDE</span> : null}
                    </span>
                    <span className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3 text-caption text-[var(--color-text-3)]">
                      <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.applications}</span>applied</span>
                      <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.interviews}</span>interviews</span>
                      <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.placements}</span>placed</span>
                    </span>
                    <span className="mt-2 block text-caption text-[var(--color-text-3)]">Last {periodLabel(period)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
