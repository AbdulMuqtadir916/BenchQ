"use client";

import { isBde } from "@/lib/auth/roles";
import { useMemo } from "react";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useMemberInvites, useTeam } from "@/lib/hooks/use-team";
import { daysBetween, deriveFirmUsage } from "@/lib/derive";
import { StatCard } from "@/components/app/stat-card";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { ErrorState } from "@/components/app/error-state";
import { GroupRowError } from "@/components/app/card-group";
import { hasPageFailed, queryGroup } from "@/lib/query/query-group";
import { useFirm } from "@/lib/tenancy/firm-context";
import { FloorContent } from "./manager-dashboard";
import { DashboardTabs } from "./dashboard-tabs";

const EMPTY: never[] = [];

export function OwnerDashboard() {
  return (
    <DashboardTabs overview={{ label: "Finance dashboard", title: "The business", subtitle: "Placements, throughput, and plan usage at a glance." }}
      activity={{ title: "Firm activity", subtitle: "Follow activity from the firm to managers, BDEs, and their candidates." }}>
      <FinanceDashboardContent />
    </DashboardTabs>
  );
}

function FinanceDashboardContent() {
  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  const teamQuery = useTeam();
  const invitesQuery = useMemberInvites();
  const firm = useFirm();
  const rollups = queryGroup(applicationsQuery, candidatesQuery, teamQuery, invitesQuery);
  const page = queryGroup(applicationsQuery, candidatesQuery, teamQuery, invitesQuery);

  const applications = applicationsQuery.data ?? EMPTY;
  const candidates = candidatesQuery.data ?? EMPTY;
  const team = teamQuery.data ?? EMPTY;
  const invites = invitesQuery.data ?? EMPTY;

  const placements = useMemo(
    () => applications.filter((a) => a.status === "PLACED"),
    [applications],
  );

  const placedThisQuarter = useMemo(
    () => placements.filter((a) => a.closedAt && daysBetween(a.closedAt, new Date()) <= 90).length,
    [placements],
  );

  const avgTimeToPlace = useMemo(() => {
    const spans = placements
      .filter((a) => a.appliedAt && a.closedAt)
      .map((a) => daysBetween(a.appliedAt!, a.closedAt!));
    if (spans.length === 0) return 0;
    return Math.round(spans.reduce((s, d) => s + d, 0) / spans.length);
  }, [placements]);

  // Limits come from the firm (copied from its plan, A3). A seat is an active user or a pending invite (A1);
  // active candidates are ON_BENCH / INTERVIEWING / OFFER (A2). deriveFirmUsage is the function /admin
  // uses on the same data, so the two pages show the same numbers (docs/07 M3).
  const usage = deriveFirmUsage(firm, { users: team, invites, candidates }, new Date());
  const activeBdes = team.filter((u) => u.firmId === firm.id && u.isActive && isBde(u)).length;
  const pendingInvites = usage.seatsUsed - activeBdes;
  const seatDetail = `${activeBdes} BDE${activeBdes === 1 ? "" : "s"} + ${pendingInvites} pending`;

  if (hasPageFailed(applicationsQuery, candidatesQuery, teamQuery, invitesQuery)) {
    return <ErrorState variant="page" error={page.error ?? new Error("The request failed.")} onRetry={page.retry} />;
  }

  return (
    <>
      <section aria-label="Business rollups" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rollups.status === "error" ? (
          <GroupRowError group={rollups} />
        ) : rollups.status === "pending" ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCard label="Placements" value={`${placedThisQuarter}`} delta="this quarter" trend="up" window="closed won" />
            <StatCard label="Time to place" value={`${avgTimeToPlace}d`} trend="neutral" window="apply → placed avg" />
            <StatCard label="BDE seats used" value={`${usage.seatsUsed} / ${usage.seatLimit}`} window={seatDetail} />
            <StatCard label="Assigned candidates" value={`${usage.assignedCandidates} / ${usage.candidateLimit}`} window="of plan" />
          </>
        )}
      </section>

      <FloorContent />
    </>
  );
}
