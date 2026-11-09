"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { isBde, isManager } from "@/lib/auth/roles";
import { scopeApplications, scopeCandidates, scopeTeam } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { deriveBdePerformance } from "@/lib/derive";
import { queryGroup } from "@/lib/query/query-group";
import { useUrlState } from "@/lib/routes/use-url-state";
import { DashboardSearch } from "@/lib/schemas/dashboard-search";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { BdeView, FirmView, ManagerView, periodStart, withinPeriod } from "./owner-activity-views";

const EMPTY_CANDIDATES: Candidate[] = [];
const EMPTY_APPLICATIONS: Application[] = [];
const EMPTY_USERS: User[] = [];
const PERIODS = ["7d", "30d", "90d"] as const;
function ActivityPeriod({ value, onChange }: { value: "7d" | "30d" | "90d"; onChange: (period: "7d" | "30d" | "90d") => void }) {
  return (
    <div role="group" aria-label="Activity date range" className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
      {PERIODS.map((period) => (
        <button key={period} type="button" aria-pressed={value === period} onClick={() => onChange(period)}
          className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] ${value === period ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]"}`}>
          {period.slice(0, -1)} days
        </button>
      ))}
    </div>
  );
}

export function OwnerActivityDashboard() {
  const [query, setQuery] = useUrlState(DashboardSearch);
  const principal = useSignedInPrincipal();
  const teamQuery = useTeam();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const group = queryGroup(teamQuery, candidatesQuery, applicationsQuery);
  const allUsers = teamQuery.data ?? EMPTY_USERS;
  const allCandidates = candidatesQuery.data ?? EMPTY_CANDIDATES;
  const allApplications = applicationsQuery.data ?? EMPTY_APPLICATIONS;

  const users = useMemo(() => scopeTeam(principal, allUsers, allCandidates), [principal, allUsers, allCandidates]);
  const candidates = useMemo(() => scopeCandidates(principal, allCandidates), [principal, allCandidates]);
  const applications = useMemo(() => scopeApplications(principal, allApplications, allCandidates), [principal, allApplications, allCandidates]);
  const managers = useMemo(() => users.filter(isManager), [users]);
  const selectedManager = managers.find((user) => user.id === query.manager);
  const selectedBde = users.find((user) => isBde(user) && user.id === query.bde && user.managerId === selectedManager?.id);
  const now = new Date();
  const start = periodStart(query.period, now);
  const recentApplications = useMemo(() => applications.filter((app) => withinPeriod(app.appliedAt, start)), [applications, start]);
  const allPerformance = useMemo(() => deriveBdePerformance(users, candidates, recentApplications), [users, candidates, recentApplications]);
  const managerCandidates = useMemo(() => selectedManager ? candidates.filter((candidate) => candidate.managerId === selectedManager.id) : candidates, [candidates, selectedManager]);
  const managerBdes = useMemo(() => selectedManager ? users.filter((user) => isBde(user) && user.managerId === selectedManager.id) : [], [users, selectedManager]);
  const managerCandidateIds = useMemo(() => new Set(managerCandidates.map((candidate) => candidate.id)), [managerCandidates]);
  const managerApplications = useMemo(() => recentApplications.filter((app) => managerCandidateIds.has(app.candidateId)), [recentApplications, managerCandidateIds]);
  const managerPerformance = useMemo(() => deriveBdePerformance(managerBdes, managerCandidates, managerApplications), [managerBdes, managerCandidates, managerApplications]);
  const bdeCandidates = useMemo(() => selectedBde ? managerCandidates.filter((candidate) => candidate.bdeId === selectedBde.id) : [], [managerCandidates, selectedBde]);
  const bdeCandidateIds = useMemo(() => new Set(bdeCandidates.map((candidate) => candidate.id)), [bdeCandidates]);
  const bdeApplications = useMemo(() => recentApplications.filter((app) => bdeCandidateIds.has(app.candidateId)), [recentApplications, bdeCandidateIds]);

  if (group.status === "error") {
    return <ErrorState variant="page" error={group.error ?? new Error("The request failed.")} onRetry={group.retry} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-text-3)]" aria-label="Dashboard level">
          <button type="button" onClick={() => setQuery({ manager: "", bde: "" })} className="font-medium text-[var(--color-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
            Firm activity
          </button>
          {selectedManager ? <><ChevronRight size={14} aria-hidden /><button type="button" onClick={() => setQuery({ bde: "" })} className={`truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] ${selectedBde ? "" : "font-medium text-[var(--color-text)]"}`}>{selectedManager.name}</button></> : null}
          {selectedBde ? <><ChevronRight size={14} aria-hidden /><span className="truncate font-medium text-[var(--color-text)]">{selectedBde.name}</span></> : null}
        </div>
        <ActivityPeriod value={query.period} onChange={(period) => setQuery({ period })} />
      </div>

      {group.status === "pending" ? <ActivitySkeleton /> : selectedBde ? (
        <BdeView user={selectedBde} candidates={bdeCandidates} applications={bdeApplications} period={query.period} />
      ) : selectedManager ? (
        <ManagerView user={selectedManager} bdes={managerBdes} candidates={managerCandidates} applications={managerApplications} performance={managerPerformance} period={query.period}
          onSelectBde={(bdeId) => setQuery({ bde: bdeId })} />
      ) : (
        <FirmView managers={managers} users={users} candidates={candidates} applications={recentApplications} performance={allPerformance}
          period={query.period} onSelectManager={(managerId) => setQuery({ manager: managerId, bde: "" })} />
      )}
    </div>
  );
}

function ActivitySkeleton() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
}
