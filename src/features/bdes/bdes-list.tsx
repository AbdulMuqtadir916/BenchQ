"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Input } from "@/components/ui/input";
import { bdeRows, windowOf, type BdeRow } from "@/features/dashboard/activity/activity-numbers";
import { BdeTable } from "@/features/dashboard/activity/activity-tables";
import { PeriodPicker } from "@/features/dashboard/owner-activity-dashboard";
import { scopeApplications, scopeCandidates, scopeTeam } from "@/lib/auth/permissions";
import { isBde } from "@/lib/auth/roles";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useNow } from "@/lib/hooks/use-now";
import { useTeam } from "@/lib/hooks/use-team";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { useUrlState } from "@/lib/routes/use-url-state";
import { BdesSearch } from "@/lib/schemas/list-search";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A manager's BDEs: who is on the team, their workload and their numbers for the period. Each opens that BDE's dashboard. */
export function BdesList() {
  const principal = useSignedInPrincipal();
  const toHref = useHref();
  const router = useRouter();
  const now = useNow();
  const firm = useFirm();
  const [{ q, period }, setQuery] = useUrlState(BdesSearch);
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
    return bdeRows(users.filter(isBde), candidates, applications, windowOf(period, now))
      .filter((row) => !needle || row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
  }, [principal, teamQuery.data, candidatesQuery.data, applicationsQuery.data, q, period, now]);

  const open = (row: BdeRow) => router.push(toHref("dashboard", {}, { view: "activity", bde: row.id, period }));
  return (
    <div className="bq-page">
      <PageHeader title="BDEs" subtitle="Your team, and its numbers for the period. Open one to see their dashboard." actions={<PeriodPicker value={period} onChange={(next) => setQuery({ period: next })} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-48 flex-1 sm:max-w-72">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input value={q} onChange={(event) => setQuery({ q: event.target.value })} placeholder="Search BDEs…" aria-label="Search BDEs" className="pl-9" />
        </div>
        <span className="ml-auto text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{group.status === "success" ? plural(rows.length, "BDE") : null}</span>
      </div>
      {group.status === "error" ? <ErrorState error={group.error} onRetry={group.retry} />
        : group.status === "pending" ? <div aria-busy="true" className="grid gap-3"><SkeletonCard /><SkeletonCard /></div>
          : (
            <div className="bq-card p-0">
              <BdeTable rows={rows} capacity={firm.bdeCapacity} onOpen={open}
                emptyState={q
                  ? <EmptyState variant="filtered" icon={Search} title="No BDE matches" description={`Nobody's name contains "${q}".`} />
                  : <EmptyState icon={Users} title="No BDEs on your team yet" description="BDEs show up here once they report to you." />} />
            </div>
          )}
    </div>
  );
}
