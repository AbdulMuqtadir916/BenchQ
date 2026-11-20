"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TriangleAlert, ArrowRight } from "lucide-react";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications } from "@/lib/hooks/use-applications";
import { useTeam } from "@/lib/hooks/use-team";
import { scopeApplications, scopeCandidates, scopeTeam } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { deriveBdePerformance, deriveFunnel, deriveCandidateStats, daysBetween } from "@/lib/derive";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelBars } from "@/components/app/charts/funnel-bars";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { ErrorState } from "@/components/app/error-state";
import { GroupBody, GroupRowError } from "@/components/app/card-group";
import { hasPageFailed, queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { DashboardTabs } from "./dashboard-tabs";
import { NeedsBdeCard } from "./needs-bde-card";

const EMPTY: never[] = [];

const TITLE: Record<"MANAGER" | "OWNER" | "VIEWER", string> = { OWNER: "The business", MANAGER: "The floor", VIEWER: "The floor" };

/**
 * A manager's and a viewer's dashboard: the floor, then the Activity tab. A manager's Activity is their own team; a
 * viewer's is the whole firm, read-only (07 Q47).
 */
export function ManagerDashboard({ role = "MANAGER" }: { role?: "MANAGER" | "OWNER" | "VIEWER" }) {
  return (
    <DashboardTabs activityOnly={role === "MANAGER"} overview={{ label: "The floor", title: TITLE[role], subtitle: "Who is working on what, at which stage, right now." }}
      activity={role === "MANAGER"
        ? { title: "Team activity", subtitle: "Follow your team from your BDEs to their candidates." }
        : { title: "Firm activity", subtitle: "Follow activity from the firm to managers, BDEs, and their candidates." }}>
      <FloorPanel />
    </DashboardTabs>
  );
}

/** docs/04 §13: everything failed → one page-level error, not one per card. */
function FloorPanel() {
  const queries = useFloorQueries();
  if (hasPageFailed(...queries)) {
    const page = queryGroup(...queries);
    return <ErrorState variant="page" error={page.error ?? new Error("The request failed.")} onRetry={page.retry} />;
  }
  return <FloorContent />;
}

/** The floor's queries (shared cache entries): candidates, applications, team. */
function useFloorQueries() {
  return [useCandidates(), useApplications(), useTeam()] as const;
}

export function FloorContent() {
  const toHref = useHref();
  const [candidatesQuery, applicationsQuery, teamQuery] = useFloorQueries();
  // docs/04 §13: one group per set of cards that read the same queries.
  const throughput = queryGroup(candidatesQuery, applicationsQuery, teamQuery);
  const performance = queryGroup(teamQuery, candidatesQuery, applicationsQuery);
  const pipeline = queryGroup(applicationsQuery);
  const risk = queryGroup(candidatesQuery, applicationsQuery);

  // A MANAGER's floor is their team's (07 Q47); the OWNER's (and a support view's) is the whole firm.
  const principal = useSignedInPrincipal();
  const firmCandidates = candidatesQuery.data ?? EMPTY;
  const firmTeam = teamQuery.data ?? EMPTY;
  const candidates = useMemo(() => scopeCandidates(principal, firmCandidates), [principal, firmCandidates]);
  const applications = useMemo(() => scopeApplications(principal, applicationsQuery.data ?? EMPTY, firmCandidates), [principal, applicationsQuery.data, firmCandidates]);
  const team = useMemo(() => scopeTeam(principal, firmTeam, firmCandidates), [principal, firmTeam, firmCandidates]);

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

  return (
    <>
      <section aria-label="Throughput" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {throughput.status === "error" ? (
          <GroupRowError group={throughput} />
        ) : throughput.status === "pending" ? (
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
          <GroupBody group={performance} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
                    <th className="px-4 py-2 font-medium">BDE</th>
                    <th className="px-4 py-2 font-medium tabular">Candidates</th>
                    <th className="px-4 py-2 font-medium tabular">Apps</th>
                    <th className="px-4 py-2 font-medium tabular">Responses</th>
                    <th className="px-4 py-2 font-medium tabular">Interviews</th>
                    <th className="px-4 py-2 font-medium tabular">Offers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {perBde.map((b) => {
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
                        <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.placements}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}</GroupBody>
        </Card>

        <div className="space-y-6">
          <NeedsBdeCard />
          <Card>
            <CardHeader><CardTitle>Pipeline funnel</CardTitle><span className="text-caption text-[var(--color-text-3)]">reached each stage</span></CardHeader>
            <GroupBody group={pipeline} skeleton={<SkeletonCard />}>{() => <FunnelBars stages={funnel} />}</GroupBody>
          </Card>

          <Card className="p-0">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert size={15} className="text-[var(--color-warning-fg)]" aria-hidden />
                At-risk candidates
              </CardTitle>
            </CardHeader>
            <GroupBody group={risk} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => atRisk.length === 0 ? (
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
            )}</GroupBody>
          </Card>
        </div>
      </div>
    </>
  );
}
