"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { benchDays } from "@/lib/derive/list-filters";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { Hint, plural } from "./activity-firm-cards";
import { linkSurface, type ListLinks } from "./activity-links";
import type { BdeRow, BdeStageRow, StackedBin } from "./activity-numbers";

/**
 * Fixed order, never cycled: past six BDEs, the rest share one grey "Others" (colour follows the person, not the rank),
 * with the team's candidates who have no BDE or one from another team, so the columns add up to every submission.
 */
const SERIES = ["bg-[var(--color-chart-1)]", "bg-[var(--color-chart-2)]", "bg-[var(--color-chart-3)]", "bg-[var(--color-chart-4)]", "bg-[var(--color-chart-5)]", "bg-[var(--color-chart-6)]"];
const OTHERS = "bg-[var(--color-text-3)]";
const shortDay = (at: number) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(at));

/** Submissions across the period, each column split by BDE: who carried the team, and when. */
export function StackedTrendCard({ bdes, bins, onSelectBde }: { bdes: User[]; bins: StackedBin[]; onSelectBde: (bdeId: string) => void }) {
  const named = bdes.slice(0, SERIES.length);
  const folded = bins.map((bin) => ({ start: bin.start, parts: [...bin.counts.slice(0, SERIES.length), bin.counts.slice(SERIES.length).reduce((sum, count) => sum + count, bin.rest)] }));
  const hasOthers = folded.some((bin) => bin.parts[named.length] > 0);
  const max = Math.max(1, ...folded.map((bin) => bin.parts.reduce((sum, count) => sum + count, 0)));
  const total = folded.reduce((sum, bin) => sum + bin.parts.reduce((a, b) => a + b, 0), 0);
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>Submissions by BDE</CardTitle><Hint>Each column is a part of the period, split by the BDE holding the candidate</Hint></div>
        <Tag tone="blue">{total} submitted</Tag>
      </CardHeader>
      <div role="img" aria-label={`${total} applications submitted, by BDE, from ${shortDay(bins[0]?.start ?? 0)}`} className="flex h-36 items-end gap-2">
        {folded.map((bin) => {
          const sum = bin.parts.reduce((a, b) => a + b, 0);
          return (
            <div key={bin.start} className="flex h-full flex-1 flex-col justify-end gap-0.5" title={`${shortDay(bin.start)}: ${sum} submitted`}>
              <span className="text-center text-mono-sm tabular text-[var(--color-text-3)]">{sum || ""}</span>
              {bin.parts.map((count, index) => (count ? (
                <span key={index} className={cn("w-full first:rounded-t-[var(--radius-sm)]", index < named.length ? SERIES[index] : OTHERS)} style={{ height: `${(count / max) * 100}%` }} />
              ) : null)).reverse()}
              {sum ? null : <span className="h-0.5 w-full rounded-full bg-[var(--color-surface-3)]" />}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 text-caption text-[var(--color-text-3)]" aria-hidden>
        {bins.map((bin) => <span key={bin.start} className="flex-1 truncate text-center">{shortDay(bin.start)}</span>)}
      </div>
      <ul aria-label="BDEs" className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-caption">
        {named.map((bde, index) => (
          <li key={bde.id}>
            <button type="button" onClick={() => onSelectBde(bde.id)} className={cn("flex items-center gap-1.5 px-1 text-[var(--color-text-2)]", linkSurface)}>
              <span aria-hidden className={cn("size-2 rounded-full", SERIES[index])} />{bde.name}
            </button>
          </li>
        ))}
        {hasOthers ? <li className="flex items-center gap-1.5 px-1 text-[var(--color-text-2)]"><span aria-hidden className={cn("size-2 rounded-full", OTHERS)} />{bdes.length > named.length ? `${bdes.length - named.length} more BDEs, other BDEs or none` : "Other BDEs or none"}</li> : null}
      </ul>
    </Card>
  );
}

/** One card per BDE: their load against the firm's capacity and their period, opening their level. */
export function BdeCards({ rows, capacity, onSelectBde, columns = "sm:grid-cols-2 xl:grid-cols-3" }: { rows: BdeRow[]; capacity: number; onSelectBde: (bdeId: string) => void; columns?: string }) {
  if (rows.length === 0) return <Card><p className="text-sm text-[var(--color-text-3)]">No BDEs on this team yet. They show up here once they report to this manager.</p></Card>;
  return (
    <ul aria-label="BDEs" className={cn("grid gap-3", columns)}>
      {rows.map((row) => {
        const full = row.working >= capacity;
        return (
          <li key={row.id}>
            <button type="button" onClick={() => onSelectBde(row.id)} className={cn("bq-card block w-full p-4 text-left", linkSurface)}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-[var(--color-text)]">{row.name}</span>
                {row.isActive ? null : <Tag tone="neutral">Inactive</Tag>}
              </span>
              <span className="mt-3 flex items-center justify-between text-caption text-[var(--color-text-3)]">
                <span>Workload</span><span className={cn("tabular", full ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text-2)]")}>{row.working} / {capacity}</span>
              </span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]" aria-hidden>
                <span className={cn("block h-full rounded-full", full ? "bg-[var(--color-warning-fg)]" : "bg-[var(--color-chart-2)]")} style={{ width: `${Math.min(100, (row.working / Math.max(1, capacity)) * 100)}%` }} />
              </span>
              <span className="mt-3 grid grid-cols-3 gap-2 text-caption text-[var(--color-text-3)]">
                <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.applications}</span>applied</span>
                <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.interviews}</span>interviews</span>
                <span><span className="block text-h3 tabular text-[var(--color-text)]">{row.counts.placements}</span>placed</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Candidates the manager holds with no BDE yet, longest waiting first. Assigning happens on the candidate's profile. */
export function QueueCard({ waiting, now, links, canAssign }: { waiting: Candidate[]; now: Date; links: ListLinks; canAssign: boolean }) {
  const rows = waiting.map((candidate) => ({ candidate, days: benchDays(candidate, now) })).sort((a, b) => b.days - a.days);
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>Waiting for a BDE</CardTitle><Hint>{canAssign ? "Open a candidate to assign a BDE" : "Longest on the bench first"}</Hint></div>
        {rows.length ? <Link href={links.candidates({ assignment: "needs-bde" })} className={cn("px-1 text-sm text-[var(--color-primary)] hover:underline", linkSurface)}>See all {rows.length}</Link> : null}
      </CardHeader>
      {rows.length === 0 ? <p className="text-sm text-[var(--color-success-fg)]">Every candidate has a BDE.</p> : (
        <ul className="space-y-0.5">
          {rows.slice(0, 6).map(({ candidate, days }) => (
            <li key={candidate.id}>
              <Link href={links.candidate(candidate.id)} className={cn("flex items-center justify-between gap-3 px-2 py-1.5 text-sm", linkSurface)}>
                <span className="min-w-0 truncate text-[var(--color-text)]">{candidate.fullName}<span className="text-[var(--color-text-3)]"> · {plural(days, "day")} on the bench</span></span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[var(--color-primary)]">{canAssign ? <><UserPlus size={14} aria-hidden />Assign</> : "Open"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STAGES = [
  { key: "applied", label: "Applied", fill: "bg-[var(--color-chart-1)]" },
  { key: "shortlisted", label: "Shortlisted", fill: "bg-[var(--color-chart-2)]" },
  { key: "interview", label: "Interview", fill: "bg-[var(--color-chart-3)]" },
  { key: "placed", label: "Placed", fill: "bg-[var(--color-chart-4)]" },
] as const;

/** Each BDE's applications of the period and how many reached shortlisted, interview and placed. Each BDE opens their dashboard. */
export function BdeStageBars({ rows, onSelectBde }: { rows: BdeStageRow[]; onSelectBde: (bdeId: string) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.applied));
  return (
    <Card>
      <CardHeader><div><CardTitle>How far each BDE&apos;s applications got</CardTitle><Hint>Applications submitted this period, and how many reached each stage</Hint></div></CardHeader>
      <ul aria-label="Stages" className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-caption text-[var(--color-text-3)]">
        {STAGES.map((stage) => <li key={stage.key} className="flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", stage.fill)} />{stage.label}</li>)}
      </ul>
      {rows.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No BDEs on this team yet.</p> : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onSelectBde(row.id)} className={cn("block w-full px-2 py-1.5 text-left", linkSurface)}
                aria-label={`${row.name}: ${row.applied} applied, ${row.shortlisted} shortlisted, ${row.interview} interview, ${row.placed} placed. Open their dashboard`}>
                <span className="block truncate text-sm text-[var(--color-text)]">{row.name}</span>
                {STAGES.map((stage) => (
                  <span key={stage.key} className="mt-0.5 grid grid-cols-[1fr_2rem] items-center gap-2" aria-hidden>
                    <span className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                      <span className={cn("block h-full rounded-full", stage.fill)} style={{ width: `${Math.max(row[stage.key] ? 2 : 0, (row[stage.key] / max) * 100)}%` }} />
                    </span>
                    <span className="text-right text-mono-sm tabular text-[var(--color-text-2)]">{row[stage.key]}</span>
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
