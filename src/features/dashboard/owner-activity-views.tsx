"use client";

import type { ReactNode } from "react";
import { BriefcaseBusiness, CalendarDays, Trophy, UserRound } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { isBde } from "@/lib/auth/roles";
import { isWaitingForBde } from "@/lib/derive/assignment";
import { isWorkingCandidate } from "@/lib/derive/tenancy";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import type { User } from "@/lib/schemas/session";
import { CandidateProgressCard, PaceRing, StageCounts } from "./activity/activity-bde-cards";
import { AttentionChips, BenchAgingCard, FunnelCard, plural, RankedBars, SpeedStrip } from "./activity/activity-firm-cards";
import { averageDaysToPlace, benchHealth, type BenchHealth, candidateProgress, compareActivity, needsAttention, ratios, roleDemand, sourceEffectiveness, stageSpeeds } from "./activity/activity-insights";
import { useListLinks, type ListLinks } from "./activity/activity-links";
import { DemandCard, SourceCard, type JobsState } from "./activity/activity-market-cards";
import { bdeRows, countActivity, eventBins, managerRows, paceOf, periodLabel, stackedByBde, submittedIn, type Period, type Window } from "./activity/activity-numbers";
import { BdeTable } from "./activity/activity-tables";
import { BdeCards, QueueCard, StackedTrendCard } from "./activity/activity-team-cards";
import { KpiTile, MeterTile } from "./activity/activity-tiles";

interface ViewProps {
  candidates: Candidate[];
  applications: Application[];
  period: Period;
  window: Window;
  now: Date;
}

/** Open jobs feed demand and sources; they load on their own, so their state travels with them. */
export interface JobsData extends JobsState {
  jobs: Job[];
}

/** Applications, interviews and placements in the period, each against the period before, with its shape. */
function ActivityTiles({ applications, period, window, links, first }: Omit<ViewProps, "candidates" | "now"> & { links: ListLinks; first?: ReactNode }) {
  const counts = countActivity(applications, window);
  const change = compareActivity(applications, window);
  const versus = `vs the ${periodLabel(period)} before`;
  const since = `last ${periodLabel(period)}`;
  const heard = counts.applications ? ` · ${Math.round((100 * counts.responses) / counts.applications)}% heard back` : "";
  return (
    <section aria-label="Activity in this period" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {first}
      <KpiTile icon={BriefcaseBusiness} label="Applications" value={counts.applications} detail={`${since}${heard}`} change={change.applications} versus={versus}
        bins={eventBins(applications, window, "applied")} href={links.applications({ period, by: "applied" })} />
      <KpiTile icon={CalendarDays} label="Interviews" value={counts.interviews} detail={since} change={change.interviews} versus={versus}
        bins={eventBins(applications, window, "interview")} href={links.applications({ period, by: "interview" })} />
      <KpiTile icon={Trophy} label="Placements" value={counts.placements} detail={since} change={change.placements} versus={versus}
        bins={eventBins(applications, window, "placed")} href={links.applications({ period, by: "placed" })} />
    </section>
  );
}

function BenchTile({ health, links }: { health: BenchHealth; links: ListLinks }) {
  return <MeterTile label="Bench placed" percent={health.utilizationPct} href={links.candidates({ status: "PLACED" })}
    detail={`${plural(health.placed, "candidate")} placed of ${health.counted} being worked or placed`} />;
}

function PersonHeader({ user, detail }: { user: User; detail: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"><UserRound size={20} aria-hidden /></div>
      <div className="min-w-0 flex-1">
        <h2 className="text-h2 text-[var(--color-text)]">{user.name}</h2>
        <p className="text-caption text-[var(--color-text-3)]">{detail}</p>
      </div>
      <Tag tone={user.isActive ? "green" : "neutral"}>{user.isActive ? "Active" : "Inactive"}</Tag>
    </div>
  );
}

const busiestFirst = <T extends { name: string; counts: { applications: number } }>(rows: T[]) =>
  [...rows].sort((a, b) => b.counts.applications - a.counts.applications || a.name.localeCompare(b.name));

export function FirmView({ managers, users, candidates, applications, period, window, now, jobs, capacity, onSelectManager, onSelectBde }: ViewProps & {
  managers: User[]; users: User[]; jobs: JobsData; capacity: number; onSelectManager: (managerId: string) => void; onSelectBde: (bdeId: string) => void;
}) {
  const links = useListLinks({});
  const health = benchHealth(candidates, applications, now);
  const managerBars = busiestFirst(managerRows(managers, users, candidates, applications, window))
    .map((row) => ({ id: row.id, name: row.name, value: row.counts.applications, detail: `${plural(row.bdes, "BDE")} · ${plural(row.candidates, "candidate")}` }));
  const bdes = busiestFirst(bdeRows(users.filter(isBde), candidates, applications, window));
  return <>
    <AttentionChips items={needsAttention(users, candidates, applications, window, health)} links={links} onOpenBde={onSelectBde} />
    <ActivityTiles applications={applications} period={period} window={window} links={links} first={<BenchTile health={health} links={links} />} />
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <FunnelCard applications={submittedIn(applications, window)} ratios={ratios(applications, window)} period={period} links={links} />
      <RankedBars title="Managers" hint="Applications their teams submitted this period. Open a manager to see their team." rows={managerBars} onSelect={onSelectManager} />
    </div>
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <BenchAgingCard health={health} links={links} />
      <DemandCard rows={roleDemand(jobs.jobs, candidates)} jobs={jobs} links={links} />
    </div>
    <SpeedStrip speeds={stageSpeeds(applications, window)} daysToPlace={averageDaysToPlace(applications, window)} />
    <SourceCard rows={sourceEffectiveness(applications, jobs.jobs, window)} jobs={jobs} />
    <TableCard title="Every BDE" hint={`Busiest first, across the firm. Workload is candidates being worked, against a capacity of ${capacity}. Open a BDE to see their candidates.`}>
      <BdeTable rows={bdes} capacity={capacity} onOpen={(row) => onSelectBde(row.id)} />
    </TableCard>
  </>;
}

function TableCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card className="p-0">
      <CardHeader className="p-4"><div><CardTitle>{title}</CardTitle><p className="mt-1 text-caption text-[var(--color-text-3)]">{hint}</p></div></CardHeader>
      {children}
    </Card>
  );
}

export function ManagerView({ user, bdes, candidates, applications, period, window, now, capacity, jobs, canAssign, onSelectBde }: ViewProps & {
  user: User; bdes: User[]; capacity: number; jobs: JobsData; canAssign: boolean; onSelectBde: (bdeId: string) => void;
}) {
  const links = useListLinks({ manager: user.id });
  const health = benchHealth(candidates, applications, now);
  const rows = busiestFirst(bdeRows(bdes, candidates, applications, window));
  const ordered = [...bdes].sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <PersonHeader user={user} detail={`Manager · ${plural(bdes.length, "BDE")} · ${plural(candidates.length, "candidate")}`} />
    <AttentionChips items={needsAttention([user, ...bdes], candidates, applications, window, health)} links={links} onOpenBde={onSelectBde} />
    <ActivityTiles applications={applications} period={period} window={window} links={links} first={<BenchTile health={health} links={links} />} />
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <StackedTrendCard bdes={ordered} bins={stackedByBde(ordered, candidates, applications, window)} onSelectBde={onSelectBde} />
      <QueueCard waiting={candidates.filter(isWaitingForBde)} now={now} links={links} canAssign={canAssign} />
    </div>
    <section aria-label="BDEs" className="space-y-3">
      <h2 className="text-h3 text-[var(--color-text)]">BDEs <span className="text-caption text-[var(--color-text-3)]">busiest first · workload against a capacity of {capacity}</span></h2>
      <BdeCards rows={rows} capacity={capacity} onSelectBde={onSelectBde} />
    </section>
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <FunnelCard applications={submittedIn(applications, window)} ratios={ratios(applications, window)} period={period} links={links} />
      <BenchAgingCard health={health} links={links} />
    </div>
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <SpeedStrip speeds={stageSpeeds(applications, window)} daysToPlace={averageDaysToPlace(applications, window)} />
      <DemandCard rows={roleDemand(jobs.jobs, candidates)} jobs={jobs} links={links} />
    </div>
  </>;
}

export function BdeView({ user, managerName, candidates, applications, period, window, now }: ViewProps & { user: User; managerName: string }) {
  const links = useListLinks({ bde: user.id });
  const working = candidates.filter(isWorkingCandidate).length;
  return <>
    <PersonHeader user={user} detail={`BDE · reports to ${managerName} · ${plural(candidates.length, "candidate")}, ${working} being worked`} />
    <ActivityTiles applications={applications} period={period} window={window} links={links} first={<PaceRing pace={paceOf(applications, now)} links={links} />} />
    <StageCounts applications={applications} links={links} />
    <CandidateProgressCard rows={candidateProgress(candidates, applications, now)} links={links} />
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <FunnelCard applications={submittedIn(applications, window)} ratios={ratios(applications, window)} period={period} links={links} />
      <BenchAgingCard health={benchHealth(candidates, applications, now)} links={links} />
    </div>
  </>;
}
