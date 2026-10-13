"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TriangleAlert, ArrowRight } from "lucide-react";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications, useFollowups } from "@/lib/hooks/use-applications";
import { useTeam } from "@/lib/hooks/use-team";
import { deriveBdePerformance, deriveFunnel, deriveCandidateStats, daysBetween } from "@/lib/derive";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { FunnelBars } from "@/components/app/charts/funnel-bars";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { PageHeader } from "@/components/app/page-header";
import { useHref } from "@/lib/routes/use-href";

const EMPTY: never[] = [];

export function ManagerDashboard({ role = "MANAGER" }: { role?: "MANAGER" | "OWNER" | "VIEWER" }) {
  return (
    <div className="bq-page">
      <PageHeader
        title={role === "OWNER" ? "The business" : "The floor"}
        subtitle="Who is working on what, at which stage, right now."
      />
      <FloorContent />
    </div>
  );
}

export function FloorContent() {
  const toHref = useHref();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const followupsQuery = useFollowups();
  const teamQuery = useTeam();

  const candidates = candidatesQuery.data ?? EMPTY;
  const applications = applicationsQuery.data ?? EMPTY;
  const followups = followupsQuery.data ?? EMPTY;
  const team = teamQuery.data ?? EMPTY;

  const isLoading = candidatesQuery.isLoading || applicationsQuery.isLoading || teamQuery.isLoading;

  const perBde = useMemo(
    () => deriveBdePerformance(team, candidates, applications),
    [team, candidates, applications],
  );
  const funnel = useMemo(() => deriveFunnel(applications), [applications]);

  const appliedToday = useMemo(
    () => applications.filter((a) => a.appliedAt && daysBetween(a.appliedAt, new Date()) === 0).length,
    [applications],
  );
  const appliedTrailingAvg = useMemo(() => {
    const last7 = applications.filter((a) => a.appliedAt && daysBetween(a.appliedAt, new Date()) <= 7).length;
    return Math.round(last7 / 7);
  }, [applications]);

  const atRisk = useMemo(() => {
    return candidates
      .filter((c) => c.status === "ON_BENCH")
      .map((c) => ({
        candidate: c,
        stats: deriveCandidateStats(c, applications.filter((a) => a.candidateId === c.id)),
      }))
      .filter((x) => x.stats.isAtRisk);
  }, [candidates, applications]);

  const overdueByUser = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of followups) {
      if (f.state === "PENDING" && new Date(f.dueAt) < new Date()) {
        map.set(f.assignedToUserId, (map.get(f.assignedToUserId) ?? 0) + 1);
      }
    }
    return map;
  }, [followups]);

  return (
    <>
      <section aria-label="Throughput" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCard label="Applied today" value={`${appliedToday}`} delta={`${appliedTrailingAvg}/day avg`} trend={appliedToday >= appliedTrailingAvg ? "up" : "down"} window="vs 7-day" />
            <StatCard label="Active BDEs" value={`${perBde.length}`} window="on the floor" />
            <StatCard label="Candidates on bench" value={`${candidates.filter((c) => c.status === "ON_BENCH").length}`} window="live" />
            <StatCard label="At risk" value={`${atRisk.length}`} delta={atRisk.length ? "no activity 7d+" : "clear"} trend={atRisk.length ? "down" : "up"} window="needs a nudge" />
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card className="p-0">
          <CardHeader className="p-4">
            <CardTitle>Per-BDE performance</CardTitle>
            <span className="text-caption text-[var(--color-text-3)]">click a row to filter the tracker</span>
          </CardHeader>
          {isLoading ? (
            <div className="p-4"><SkeletonCard /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
                    <th className="px-4 py-2 font-medium">BDE</th>
                    <th className="px-4 py-2 font-medium tabular">Candidates</th>
                    <th className="px-4 py-2 font-medium tabular">Apps</th>
                    <th className="px-4 py-2 font-medium tabular">Responses</th>
                    <th className="px-4 py-2 font-medium tabular">Interviews</th>
                    <th className="px-4 py-2 font-medium tabular">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {perBde.map((b) => {
                    const overdue = overdueByUser.get(b.userId) ?? 0;
                    return (
                      <tr key={b.userId} className="hover:bg-[var(--color-surface-2)]">
                        <td className="px-4 py-3">
                          <Link href={toHref("applications", {}, { bde: b.userId })} className="text-body-strong hover:underline">
                            {b.userName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.candidatesAssigned}</td>
                        <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.applicationsSubmitted}</td>
                        <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.responses} <span className="text-[var(--color-text-3)]">({b.responseRatePct}%)</span></td>
                        <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.interviews}</td>
                        <td className="px-4 py-3">
                          {overdue > 0 ? <Tag tone="amber">{overdue}</Tag> : <span className="text-[var(--color-text-3)]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Pipeline funnel</CardTitle><span className="text-caption text-[var(--color-text-3)]">reached each stage</span></CardHeader>
            {isLoading ? <SkeletonCard /> : <FunnelBars stages={funnel} />}
          </Card>

          <Card className="p-0">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert size={15} className="text-[var(--color-warning-fg)]" aria-hidden />
                At-risk candidates
              </CardTitle>
            </CardHeader>
            {isLoading ? (
              <div className="p-4"><SkeletonCard /></div>
            ) : atRisk.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-[var(--color-text-3)]">No candidates are stalled. Nice.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {atRisk.slice(0, 6).map(({ candidate, stats }) => (
                  <li key={candidate.id}>
                    <Link href={toHref("candidates.detail", { id: candidate.id })} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[var(--color-surface-2)]">
                      <span className="text-sm text-[var(--color-text)] truncate">{candidate.fullName}</span>
                      <span className="flex items-center gap-2 text-caption text-[var(--color-text-3)]">
                        {stats.applicationsSubmitted} apps
                        <ArrowRight size={13} aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
