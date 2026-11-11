"use client";

import Link from "next/link";
import { Moon } from "lucide-react";
import { PIPELINE, STATUS_LABEL } from "@/components/app/applications/status-meta";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { REACHED_STAGES } from "@/lib/schemas/list-search";
import { Hint, plural } from "./activity-firm-cards";
import type { CandidateProgress } from "./activity-insights";
import { linkSurface, type ListLinks } from "./activity-links";
import type { Pace } from "./activity-numbers";

const STEPS = REACHED_STAGES.length;

/** Today's submissions against an ordinary day, as a ring that fills toward the usual. Opens today's applications. */
export function PaceRing({ pace, links }: { pace: Pace; links: ListLinks }) {
  const target = Math.max(1, Math.ceil(pace.usual));
  const share = Math.min(1, pace.today / target);
  const radius = 42;
  const length = 2 * Math.PI * radius;
  const ahead = pace.today >= target;
  return (
    <Link href={links.applications({ period: "1d" })} className={cn("bq-card flex items-center gap-4 p-4", linkSurface)}
      aria-label={`${plural(pace.today, "application")} in the last 24 hours, against ${pace.usual} on an ordinary day. Open them`}>
      <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" className="stroke-[var(--color-surface-3)]" />
        {share > 0 ? <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${share * length} ${length}`}
          className={ahead ? "stroke-[var(--color-success-fg)]" : "stroke-[var(--color-chart-1)]"} /> : null}
      </svg>
      <span className="min-w-0">
        <span className="block text-label text-[var(--color-text-3)]">Last 24 hours</span>
        <span className="block text-h1 tabular text-[var(--color-text)]">{pace.today}</span>
        <span className="block text-caption text-[var(--color-text-3)]">{ahead ? "At or above" : "Below"} an ordinary day ({pace.usual} a day over the last 2 weeks)</span>
      </span>
    </Link>
  );
}

/** Where the BDE's applications sit now, one number per stage, each opening those applications. */
export function StageCounts({ applications, links }: { applications: readonly Application[]; links: ListLinks }) {
  const stages: ApplicationStatus[] = PIPELINE.filter((status) => status !== "SAVED");
  return (
    <Card>
      <CardHeader><div><CardTitle>Where their applications are now</CardTitle><Hint>Every application, by its stage today</Hint></div></CardHeader>
      <ul className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {stages.map((status) => {
          const count = applications.filter((app) => app.status === status).length;
          return (
            <li key={status}>
              <Link href={links.applications({ status })} className={cn("block p-2", linkSurface)} aria-label={`${count} now at ${STATUS_LABEL[status]}. Open them`}>
                <span className="block truncate text-caption text-[var(--color-text-3)]">{STATUS_LABEL[status]}</span>
                <span className="block text-h2 tabular text-[var(--color-text)]">{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The BDE's candidates: how far each got, today's count, and who has gone quiet. Each opens the candidate. */
export function CandidateProgressCard({ rows, links }: { rows: CandidateProgress[]; links: ListLinks }) {
  return (
    <Card>
      <CardHeader><div><CardTitle>Candidates</CardTitle><Hint>How far each one&apos;s best application got. Quiet: nothing submitted in 7 days</Hint></div></CardHeader>
      {rows.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No candidates assigned yet.</p> : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.candidate.id}>
              <Link href={links.candidate(row.candidate.id)} className={cn("grid grid-cols-[minmax(0,1fr)_5rem_8.5rem] items-center gap-3 px-2 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_8.5rem]", linkSurface)}>
                <span className="min-w-0">
                  <span className="block truncate text-[var(--color-text)]">{row.candidate.fullName}</span>
                  <span className="block truncate text-caption text-[var(--color-text-3)]">{row.candidate.primaryRole ?? "Role not set"}</span>
                </span>
                <span className="flex gap-0.5" role="img" aria-label={row.stage ? `Reached ${STATUS_LABEL[REACHED_STAGES[row.stage - 1]]}` : "Nothing submitted yet"}>
                  {Array.from({ length: STEPS }, (_, index) => (
                    <span key={index} className={cn("h-2 flex-1 rounded-full", index < row.stage ? "bg-[var(--color-chart-1)]" : "bg-[var(--color-surface-3)]")} />
                  ))}
                </span>
                <span className="flex items-center justify-end gap-2 whitespace-nowrap">
                  {row.isQuiet ? <Tag tone="amber"><Moon size={11} aria-hidden />Quiet</Tag> : null}
                  <span className="text-mono-sm tabular text-[var(--color-text-2)]">{row.today} today</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
