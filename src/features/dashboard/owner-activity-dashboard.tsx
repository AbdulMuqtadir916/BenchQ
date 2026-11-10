"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { useEscapeBack } from "@/features/activity/activity-table";
import { isBde, isManager } from "@/lib/auth/roles";
import { can, scopeApplications, scopeCandidates, scopeOf, scopeTeam } from "@/lib/auth/permissions";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useNow } from "@/lib/hooks/use-now";
import { useTeam } from "@/lib/hooks/use-team";
import { queryGroup } from "@/lib/query/query-group";
import { useUrlState } from "@/lib/routes/use-url-state";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import { DashboardSearch } from "@/lib/schemas/dashboard-search";
import type { User } from "@/lib/schemas/session";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";
import { cn } from "@/lib/cn";
import { PERIODS, periodLabel, windowOf, type Period } from "./activity/activity-numbers";
import { BdeView, FirmView, ManagerView, type JobsData } from "./owner-activity-views";
import type { Job } from "@/lib/schemas/job";

const EMPTY_CANDIDATES: Candidate[] = [];
const EMPTY_APPLICATIONS: Application[] = [];
const EMPTY_USERS: User[] = [];
const EMPTY_JOBS: Job[] = [];

/** The period buttons, shared with the Managers page. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div role="group" aria-label="Period" className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
      {PERIODS.map((period) => (
        <button key={period} type="button" aria-pressed={value === period} onClick={() => onChange(period)}
          className={cn("rounded-[var(--radius-sm)] px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
            value === period ? "bg-[var(--color-surface)] font-medium text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
          {periodLabel(period)}
        </button>
      ))}
    </div>
  );
}

/**
 * The Activity tab: the firm, then a manager's team, then one BDE's candidates. Esc goes up a level. The owner and a
 * viewer start at the firm; a manager starts, and stays, at their own team (07 Q47).
 */
export function OwnerActivityDashboard() {
  const [query, setQuery] = useUrlState(DashboardSearch);
  const principal = useSignedInPrincipal();
  const now = useNow();
  const teamQuery = useTeam();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  // Jobs only feed demand and sources: their failure stays in those cards, not the whole page.
  const jobsQuery = useJobs({ limit: 400 });
  const firm = useFirm();
  const group = queryGroup(teamQuery, candidatesQuery, applicationsQuery);
  const allUsers = teamQuery.data ?? EMPTY_USERS;
  const allCandidates = candidatesQuery.data ?? EMPTY_CANDIDATES;
  const allApplications = applicationsQuery.data ?? EMPTY_APPLICATIONS;

  const users = useMemo(() => scopeTeam(principal, allUsers, allCandidates), [principal, allUsers, allCandidates]);
  const candidates = useMemo(() => scopeCandidates(principal, allCandidates), [principal, allCandidates]);
  const applications = useMemo(() => scopeApplications(principal, allApplications, allCandidates), [principal, allApplications, allCandidates]);
  const window = useMemo(() => windowOf(query.period, now), [query.period, now]);

  const scope = scopeOf(principal);
  const ownTeam = scope.kind === "team" ? scope.managerId : null;
  const managers = useMemo(() => users.filter(isManager), [users]);
  const manager = managers.find((user) => user.id === (ownTeam ?? query.manager));
  const bde = users.find((user) => isBde(user) && user.id === query.bde && user.managerId === manager?.id);

  const teamCandidates = useMemo(() => (manager ? candidates.filter((candidate) => candidate.managerId === manager.id) : candidates), [candidates, manager]);
  const teamBdes = useMemo(() => (manager ? users.filter((user) => isBde(user) && user.managerId === manager.id) : []), [users, manager]);
  const bdeCandidates = useMemo(() => (bde ? teamCandidates.filter((candidate) => candidate.bdeId === bde.id) : []), [teamCandidates, bde]);
  const applicationsOf = (shown: Candidate[]) => {
    const ids = new Set(shown.map((candidate) => candidate.id));
    return applications.filter((app) => ids.has(app.candidateId));
  };

  const jobs: JobsData = { jobs: jobsQuery.data ?? EMPTY_JOBS, isLoading: jobsQuery.isLoading, error: jobsQuery.error, onRetry: () => void jobsQuery.refetch() };
  const openBde = (bdeId: string) => setQuery({ manager: users.find((user) => user.id === bdeId)?.managerId ?? "", bde: bdeId });

  useEscapeBack(bde ? () => setQuery({ bde: "" }) : manager && !ownTeam ? () => setQuery({ manager: "", bde: "" }) : null);

  if (group.status === "error") {
    return <ErrorState variant="page" error={group.error ?? new Error("The request failed.")} onRetry={group.retry} />;
  }

  // Only the levels above this one are buttons; where you are is plain text.
  const crumb = "rounded-[var(--radius-sm)] text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
  const current = "font-medium text-[var(--color-text)]";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Dashboard level" className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-text-3)]">
          {ownTeam ? null : manager
            ? <button type="button" onClick={() => setQuery({ manager: "", bde: "" })} className={crumb}>Whole firm</button>
            : <span aria-current="page" className={current}>Whole firm</span>}
          {manager ? <>{ownTeam ? null : <ChevronRight size={14} aria-hidden />}{bde
            ? <button type="button" onClick={() => setQuery({ bde: "" })} className={cn(crumb, "truncate")}>{manager.name}</button>
            : <span aria-current="page" className={cn(current, "truncate")}>{manager.name}</span>}</> : null}
          {bde ? <><ChevronRight size={14} aria-hidden /><span aria-current="page" className={cn(current, "truncate")}>{bde.name}</span></> : null}
        </nav>
        <PeriodPicker value={query.period} onChange={(period) => setQuery({ period })} />
      </div>

      {group.status === "pending" ? (
        <div aria-busy="true" className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div><div className="grid gap-6 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div></div>
      ) : bde && manager ? (
        <BdeView user={bde} managerName={manager.name} candidates={bdeCandidates} applications={applicationsOf(bdeCandidates)} period={query.period} window={window} now={now} />
      ) : manager ? (
        <ManagerView user={manager} bdes={teamBdes} candidates={teamCandidates} applications={applicationsOf(teamCandidates)} period={query.period} window={window}
          now={now} capacity={firm.bdeCapacity} jobs={jobs} canAssign={can(principal, "candidate.assign")} onSelectBde={(bdeId) => setQuery({ bde: bdeId })} />
      ) : (
        <FirmView managers={managers} users={users} candidates={candidates} applications={applications} period={query.period} window={window}
          now={now} jobs={jobs} capacity={firm.bdeCapacity} onSelectManager={(managerId) => setQuery({ manager: managerId, bde: "" })} onSelectBde={openBde} />
      )}
    </div>
  );
}
