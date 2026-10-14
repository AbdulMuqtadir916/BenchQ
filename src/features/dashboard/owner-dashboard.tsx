"use client";

import { useMemo } from "react";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { daysBetween } from "@/lib/derive";
import { StatCard } from "@/components/app/stat-card";
import { PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { FloorContent } from "./manager-dashboard";

const EMPTY: never[] = [];

export function OwnerDashboard() {
  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  const teamQuery = useTeam();

  const applications = applicationsQuery.data ?? EMPTY;
  const candidates = candidatesQuery.data ?? EMPTY;
  const team = teamQuery.data ?? EMPTY;
  const isLoading = applicationsQuery.isLoading || candidatesQuery.isLoading;

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

  const seatUsage = `${team.filter((u) => u.isActive).length} / 10`;
  const candidateUsage = `${candidates.filter((c) => c.status !== "INACTIVE").length} / 50`;

  return (
    <div className="bq-page">
      <PageHeader title="The business" subtitle="Placements, throughput, and plan usage at a glance." />

      <section aria-label="Business rollups" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCard label="Placements" value={`${placedThisQuarter}`} delta="this quarter" trend="up" window="closed won" />
            <StatCard label="Time to place" value={`${avgTimeToPlace}d`} trend="neutral" window="apply → placed avg" />
            <StatCard label="Seats used" value={seatUsage} window="of plan" />
            <StatCard label="Active candidates" value={candidateUsage} window="of plan" />
          </>
        )}
      </section>

      <FloorContent />
    </div>
  );
}
