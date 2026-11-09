"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Building2, CalendarDays, ChevronRight, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { deriveBdePerformance, deriveCandidateStats, deriveFunnel, maxDate } from "@/lib/derive";
import { useHref } from "@/lib/routes/use-href";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { isBde } from "@/lib/auth/roles";

const PIPELINE_LABELS: Record<string, string> = {
  APPLIED: "Applied", RESPONSE: "Responded", SCREENING: "Screening", INTERVIEW: "Interview",
  OFFER: "Offer", PLACED: "Placed",
};

export function periodStart(period: "7d" | "30d" | "90d", now: Date): Date {
  return new Date(now.getTime() - Number(period.slice(0, -1)) * 86_400_000);
}

export function withinPeriod(value: string | null, start: Date): boolean {
  return !!value && new Date(value) >= start;
}

function dateLabel(date: string | null): string {
  if (!date) return "No recorded activity";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
}

function StatusLabel({ status }: { status: Candidate["status"] }) {
  const tone = status === "PLACED" ? "green" : status === "OFFER" ? "violet" : status === "PAUSED" || status === "INACTIVE" ? "neutral" : "blue";
  return <Tag tone={tone}>{status.replaceAll("_", " ").toLowerCase()}</Tag>;
}

export function FirmView({ managers, users, candidates, applications, performance, period, onSelectManager }: {
  managers: User[]; users: User[]; candidates: Candidate[]; applications: Application[];
  performance: ReturnType<typeof deriveBdePerformance>; period: "7d" | "30d" | "90d";
  onSelectManager: (managerId: string) => void;
}) {
  const activeBdes = users.filter((user) => isBde(user) && user.isActive).length;
  return <>
    <section aria-label="Firm activity summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={Building2} label="Managers" value={`${managers.length}`} window="in this firm" />
      <StatCard icon={Users} label="Active BDEs" value={`${activeBdes}`} window="across all managers" />
      <StatCard icon={Users} label="Candidates" value={`${candidates.length}`} window="all assignments" />
      <StatCard icon={BriefcaseBusiness} label="Applications" value={`${applications.length}`} window={`submitted in ${period.slice(0, -1)} days`} />
    </section>
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <Card className="p-0"><CardHeader className="p-4"><div><CardTitle>Manager performance</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">Select a manager to see their team activity.</p></div></CardHeader>
        {managers.length === 0 ? <EmptyState icon={Users} title="No managers yet" description="Managers will appear here when they are added to the firm." /> : <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm">
          <thead><tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)] text-left text-caption text-[var(--color-text-3)]"><th className="px-4 py-2 font-medium">Manager</th><th className="px-4 py-2 font-medium">BDEs</th><th className="px-4 py-2 font-medium">Candidates</th><th className="px-4 py-2 font-medium">Applications</th><th className="px-4 py-2 font-medium">Interviews</th><th className="px-4 py-2" /></tr></thead>
          <tbody className="divide-y divide-[var(--color-border)]">{managers.map((manager) => {
            const teamBdes = users.filter((user) => isBde(user) && user.managerId === manager.id);
            const managerCandidates = candidates.filter((candidate) => candidate.managerId === manager.id);
            const ids = new Set(managerCandidates.map((candidate) => candidate.id));
            const apps = applications.filter((app) => ids.has(app.candidateId));
            return <tr key={manager.id}><td colSpan={6} className="p-0"><button type="button" onClick={() => onSelectManager(manager.id)} className="grid w-full grid-cols-[minmax(150px,1.4fr)_0.55fr_0.7fr_0.85fr_0.7fr_24px] items-center text-left hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]"><span className="px-4 py-3"><span className="block font-medium text-[var(--color-text)]">{manager.name}</span><span className="text-caption text-[var(--color-text-3)]">{manager.isActive ? "Active" : "Inactive"}</span></span><span className="px-3 py-3 tabular">{teamBdes.length}</span><span className="px-3 py-3 tabular">{managerCandidates.length}</span><span className="px-3 py-3 tabular">{apps.length}</span><span className="px-3 py-3 tabular">{apps.filter((app) => app.interviewAt).length}</span><ArrowRight size={15} aria-hidden className="text-[var(--color-text-3)]" /></button></td></tr>;
          })}</tbody>
        </table></div>}
      </Card>
      <div className="space-y-6"><TrendCard applications={applications} period={period} /><PipelineCard applications={applications} />
        <Card><CardHeader><CardTitle>Team coverage</CardTitle></CardHeader><div className="space-y-3 text-sm">{managers.slice(0, 4).map((manager) => {
          const bdes = users.filter((user) => isBde(user) && user.managerId === manager.id);
          const count = performance.filter((item) => bdes.some((bde) => bde.id === item.userId)).reduce((sum, item) => sum + item.candidatesAssigned, 0);
          return <div key={manager.id} className="flex items-center justify-between gap-3"><span className="truncate text-[var(--color-text-2)]">{manager.name}</span><span className="shrink-0 text-caption text-[var(--color-text-3)]">{bdes.length} BDEs · {count} candidates</span></div>;
        })}</div></Card>
      </div>
    </div>
  </>;
}

export function ManagerView({ user, bdes, candidates, applications, performance, period, onSelectBde }: {
  user: User; bdes: User[]; candidates: Candidate[]; applications: Application[];
  performance: ReturnType<typeof deriveBdePerformance>; period: "7d" | "30d" | "90d"; onSelectBde: (id: string) => void;
}) {
  return <>
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><div className="flex size-12 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"><Users size={22} aria-hidden /></div><div className="min-w-0 flex-1"><h2 className="text-h2 text-[var(--color-text)]">{user.name}</h2><p className="text-caption text-[var(--color-text-3)]">Manager · {bdes.length} BDEs · {candidates.length} candidates</p></div><Tag tone={user.isActive ? "green" : "neutral"}>{user.isActive ? "Active" : "Inactive"}</Tag></div>
    <section aria-label="Manager activity summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={Users} label="BDEs" value={`${bdes.length}`} window="on this team" /><StatCard icon={Users} label="Candidates" value={`${candidates.length}`} window="assigned to this team" /><StatCard icon={BriefcaseBusiness} label="Applications" value={`${applications.length}`} window="in selected period" /><StatCard icon={CalendarDays} label="Interviews" value={`${applications.filter((app) => withinPeriod(app.interviewAt, periodStart(period, new Date()))).length}`} window={`scheduled in ${period.slice(0, -1)} days`} /></section>
    <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]"><Card className="p-0"><CardHeader className="p-4"><div><CardTitle>BDE performance</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">Select a BDE to review assigned candidates.</p></div></CardHeader>
      {bdes.length === 0 ? <EmptyState icon={Users} title="No BDEs assigned" description="This manager does not have any BDEs on the team yet." /> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)] text-left text-caption text-[var(--color-text-3)]"><th className="px-4 py-2 font-medium">BDE</th><th className="px-4 py-2 font-medium">Candidates</th><th className="px-4 py-2 font-medium">Applications</th><th className="px-4 py-2 font-medium">Responses</th><th className="px-4 py-2 font-medium">Interviews</th><th className="px-4 py-2" /></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{performance.map((item) => <tr key={item.userId}><td colSpan={6} className="p-0"><button type="button" onClick={() => onSelectBde(item.userId)} className="grid w-full grid-cols-[minmax(140px,1.4fr)_0.75fr_0.85fr_0.7fr_0.75fr_24px] items-center text-left hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]"><span className="px-4 py-3 font-medium text-[var(--color-text)]">{item.userName}</span><span className="px-3 py-3 tabular">{item.candidatesAssigned}</span><span className="px-3 py-3 tabular">{item.applicationsSubmitted}</span><span className="px-3 py-3 tabular">{item.responseRatePct}%</span><span className="px-3 py-3 tabular">{item.interviews}</span><ArrowRight size={15} aria-hidden className="text-[var(--color-text-3)]" /></button></td></tr>)}</tbody></table></div>}
      </Card><div className="space-y-6"><TrendCard applications={applications} period={period} /><PipelineCard applications={applications} /></div></div>
  </>;
}

export function BdeView({ user, candidates, applications, period }: { user: User; candidates: Candidate[]; applications: Application[]; period: "7d" | "30d" | "90d" }) {
  const toHref = useHref();
  const byCandidate = useMemo(() => new Map<string, Application[]>(candidates.map((candidate) => [candidate.id, applications.filter((app) => app.candidateId === candidate.id)])), [candidates, applications]);
  const interviews = applications.filter((app) => app.interviewAt).length;
  return <>
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><div className="flex size-12 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"><Users size={22} aria-hidden /></div><div className="min-w-0 flex-1"><h2 className="text-h2 text-[var(--color-text)]">{user.name}</h2><p className="text-caption text-[var(--color-text-3)]">BDE · assigned candidate activity</p></div><Tag tone={user.isActive ? "green" : "neutral"}>{user.isActive ? "Active" : "Inactive"}</Tag></div>
    <section aria-label="BDE activity summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={Users} label="Candidates" value={`${candidates.length}`} window="assigned to this BDE" /><StatCard icon={BriefcaseBusiness} label="Applications" value={`${applications.length}`} window={`in ${period.slice(0, -1)} days`} /><StatCard icon={CalendarDays} label="Interviews" value={`${interviews}`} window="from selected applications" /><StatCard icon={BriefcaseBusiness} label="Placements" value={`${applications.filter((app) => app.status === "PLACED").length}`} window="from assigned candidates" /></section>
    <Card className="p-0"><CardHeader className="p-4"><div><CardTitle>Assigned candidates</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">Open a candidate to view their profile and full work history.</p></div><span className="text-caption tabular text-[var(--color-text-3)]">{candidates.length} total</span></CardHeader>
      {candidates.length === 0 ? <EmptyState icon={Users} title="No assigned candidates" description="Candidates assigned to this BDE will appear here." /> : <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)] text-left text-caption text-[var(--color-text-3)]"><th className="px-4 py-2 font-medium">Candidate</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Applications</th><th className="px-4 py-2 font-medium">Interviews</th><th className="px-4 py-2 font-medium">Last activity</th><th className="px-4 py-2" /></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{candidates.map((candidate) => {
        const candidateApps = byCandidate.get(candidate.id) ?? [];
        const lastActivity = maxDate([candidate.updatedAt, ...candidateApps.flatMap((app) => [app.appliedAt, app.firstResponseAt, app.interviewAt, app.offerAt])]);
        const stats = deriveCandidateStats(candidate, candidateApps);
        return <tr key={candidate.id}><td colSpan={6} className="p-0"><Link href={toHref("candidates.detail", { id: candidate.id })} className="grid w-full grid-cols-[minmax(170px,1.5fr)_0.8fr_0.8fr_0.7fr_1fr_24px] items-center text-left hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]"><span className="px-4 py-3"><span className="block truncate font-medium text-[var(--color-text)]">{candidate.fullName}</span><span className="text-caption text-[var(--color-text-3)]">{candidate.primaryRole ?? "Role not set"}</span></span><span className="px-3 py-3"><StatusLabel status={candidate.status} /></span><span className="px-3 py-3 tabular">{stats.applicationsSubmitted}</span><span className="px-3 py-3 tabular">{stats.interviewsScheduled}</span><span className="px-3 py-3 text-caption text-[var(--color-text-2)]">{dateLabel(lastActivity)}</span><ChevronRight size={15} aria-hidden className="text-[var(--color-text-3)]" /></Link></td></tr>;
      })}</tbody></table></div>}
    </Card>
  </>;
}

function TrendCard({ applications, period }: { applications: Application[]; period: "7d" | "30d" | "90d" }) {
  const bins = useMemo(() => {
    const start = periodStart(period, new Date());
    const width = Number(period.slice(0, -1)) * 86_400_000 / 7;
    return Array.from({ length: 7 }, (_, index) => {
      const from = start.getTime() + index * width;
      return applications.filter((app) => app.appliedAt && new Date(app.appliedAt).getTime() >= from && new Date(app.appliedAt).getTime() < from + width).length;
    });
  }, [applications, period]);
  const max = Math.max(1, ...bins);
  const points = bins.map((count, index) => `${18 + index * 84},${138 - (count / max) * 112}`).join(" ");
  return <Card><CardHeader><div><CardTitle>Application trend</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">Submissions across the selected range</p></div><Tag tone="blue">{applications.length} apps</Tag></CardHeader><svg viewBox="0 0 540 164" role="img" aria-label={`Application activity over the last ${period.slice(0, -1)} days`} className="w-full overflow-visible"><title>Application activity trend</title><path d="M18 138 H522 M18 82 H522 M18 26 H522" stroke="var(--color-border)" strokeDasharray="4 5" fill="none" /><polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{bins.map((count, index) => <circle key={index} cx={18 + index * 84} cy={138 - (count / max) * 112} r="4" fill="var(--color-primary)" />)}</svg><div className="flex justify-between text-caption text-[var(--color-text-3)]"><span>Start</span><span>End</span></div></Card>;
}

function PipelineCard({ applications }: { applications: Application[] }) {
  const funnel = deriveFunnel(applications);
  const max = Math.max(1, ...funnel.map((stage) => stage.count));
  return <Card><CardHeader><div><CardTitle>Application pipeline</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">Applications that reached each stage</p></div></CardHeader><div className="space-y-3">{funnel.map((stage) => <div key={stage.status} className="grid grid-cols-[78px_1fr_38px] items-center gap-3 text-sm"><span className="text-[var(--color-text-2)]">{PIPELINE_LABELS[stage.status] ?? stage.label}</span><div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]"><div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${(stage.count / max) * 100}%` }} /></div><span className="text-right text-mono-sm tabular text-[var(--color-text-2)]">{stage.count}</span></div>)}</div></Card>;
}
