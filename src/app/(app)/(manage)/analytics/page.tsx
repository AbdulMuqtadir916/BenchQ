"use client";

import { useMemo, useState } from "react";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useTeam } from "@/lib/hooks/use-team";
import { useSession } from "@/lib/stores/session-store";
import { deriveFunnel, deriveBdePerformance, daysBetween } from "@/lib/derive";
import type { JobSourceType } from "@/lib/schemas/enums";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelBars } from "@/components/app/charts/funnel-bars";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { EmptyState } from "@/components/app/empty-state";
import { BarChart2 } from "lucide-react";

const PERIODS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
] as const;

export default function AnalyticsPage() {
  const { user } = useSession();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30d");

  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  const jobsQuery = useJobs({ limit: 400 });
  const teamQuery = useTeam();

  const days = PERIODS.find((p) => p.key === period)!.days;

  const applications = useMemo(
    () => (applicationsQuery.data ?? []).filter((a) => !a.appliedAt || daysBetween(a.appliedAt, new Date()) <= days),
    [applicationsQuery.data, days],
  );

  const funnel = useMemo(() => deriveFunnel(applications), [applications]);
  const perBde = useMemo(
    () => deriveBdePerformance(teamQuery.data ?? [], candidatesQuery.data ?? [], applications),
    [teamQuery.data, candidatesQuery.data, applications],
  );

  const sourceRoi = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const jobSource = new Map(jobs.map((j) => [j.id, j.provenance.sourceType]));
    const stats = new Map<JobSourceType, { apps: number; responses: number }>();
    for (const a of applications) {
      const src = jobSource.get(a.jobId);
      if (!src) continue;
      const s = stats.get(src) ?? { apps: 0, responses: 0 };
      s.apps++;
      if (a.firstResponseAt) s.responses++;
      stats.set(src, s);
    }
    return [...stats.entries()]
      .map(([source, s]) => ({ source, apps: s.apps, rate: s.apps ? Math.round((100 * s.responses) / s.apps) : 0 }))
      .sort((a, b) => b.apps - a.apps);
  }, [jobsQuery.data, applications]);

  const isLoading = applicationsQuery.isLoading || teamQuery.isLoading;
  const maxApps = Math.max(1, ...perBde.map((b) => b.applicationsSubmitted));
  const maxSource = Math.max(1, ...sourceRoi.map((s) => s.apps));

  if (user.role === "BDE") {
    return (
      <div className="bq-page">
        <EmptyState icon={BarChart2} title="Analytics is a manager view" description="Ask your manager for the floor and business rollups." variant="filtered" />
      </div>
    );
  }

  return (
    <div className="bq-page">
      <PageHeader
        title="Analytics"
        subtitle="Funnel, throughput, and source effectiveness."
        actions={
          <div className="bq-tabs" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pipeline funnel</CardTitle><span className="text-caption text-[var(--color-text-3)]">{applications.length} applications</span></CardHeader>
          {isLoading ? <SkeletonCard /> : <FunnelBars stages={funnel} />}
        </Card>

        <Card>
          <CardHeader><CardTitle>Applications by BDE</CardTitle></CardHeader>
          {isLoading ? <SkeletonCard /> : (
            <div className="space-y-3">
              {perBde.map((b) => (
                <div key={b.userId} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 truncate text-sm text-[var(--color-text-2)]">{b.userName}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-2)]">
                    <div className="flex h-full items-center rounded-[var(--radius-sm)] px-2" style={{ width: `${Math.max(8, (b.applicationsSubmitted / maxApps) * 100)}%`, background: "var(--gradient-primary)" }}>
                      <span className="tabular text-mono-sm font-medium text-[var(--color-primary-fg)]">{b.applicationsSubmitted}</span>
                    </div>
                  </div>
                  <div className="w-14 shrink-0 text-right text-mono-sm text-[var(--color-text-3)]">{b.responseRatePct}%</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-0 lg:col-span-2">
          <CardHeader className="p-4"><CardTitle>Per-BDE performance</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
                  <th className="px-4 py-2 font-medium">BDE</th>
                  <th className="px-4 py-2 font-medium">Candidates</th>
                  <th className="px-4 py-2 font-medium">Applications</th>
                  <th className="px-4 py-2 font-medium">Responses</th>
                  <th className="px-4 py-2 font-medium">Response rate</th>
                  <th className="px-4 py-2 font-medium">Interviews</th>
                  <th className="px-4 py-2 font-medium">Placements</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {perBde.map((b) => (
                  <tr key={b.userId} className="hover:bg-[var(--color-surface-2)]">
                    <td className="px-4 py-3 text-body-strong">{b.userName}</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.candidatesAssigned}</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.applicationsSubmitted}</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.responses}</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.responseRatePct}%</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.interviews}</td>
                    <td className="px-4 py-3 tabular text-[var(--color-text-2)]">{b.placements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Source effectiveness</CardTitle><span className="text-caption text-[var(--color-text-3)]">applications and response rate by job source</span></CardHeader>
          <div className="space-y-3">
            {sourceRoi.map((s) => (
              <div key={s.source} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-sm capitalize text-[var(--color-text-2)]">{s.source.replaceAll("_", " ").toLowerCase()}</div>
                <div className="h-6 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-2)]">
                  <div className="flex h-full items-center rounded-[var(--radius-sm)] px-2" style={{ width: `${Math.max(8, (s.apps / maxSource) * 100)}%`, background: "var(--gradient-primary)" }}>
                    <span className="tabular text-mono-sm font-medium text-[var(--color-primary-fg)]">{s.apps}</span>
                  </div>
                </div>
                <div className="w-16 shrink-0 text-right text-mono-sm text-[var(--color-text-3)]">{s.rate}% resp</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
