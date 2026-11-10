"use client";

import Link from "next/link";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { RoleDemand, SourceRow } from "./activity-insights";
import { linkSurface, type ListLinks } from "./activity-links";
import { Hint } from "./activity-firm-cards";

/** Jobs load on their own: their loading and failure stay in the cards that read them, not the whole page. */
export interface JobsState {
  /** The list stopped at its limit, so older jobs are not counted. */
  isCapped: boolean;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const SOURCE_LABEL: Record<SourceRow["source"], string> = { CONNECTOR: "Job boards", AGGREGATOR: "Aggregators", USER_SUBMITTED: "Captured by the team", MANUAL: "Added by hand" };

/**
 * Open jobs by role on the left, bench candidates in that role on the right, so a thin bench next to a long bar stands
 * out. Each row opens those bench candidates.
 */
export function DemandCard({ rows, jobs, links }: { rows: RoleDemand[]; jobs: JobsState; links: ListLinks }) {
  if (jobs.isLoading) return <SkeletonCard />;
  const max = Math.max(1, ...rows.flatMap((row) => [row.jobs, row.onBench]));
  return (
    <Card>
      <CardHeader><div><CardTitle>Demand against the bench</CardTitle><Hint>{jobs.isCapped ? "Open jobs by role, beside bench candidates who fit. Counts the newest jobs only" : "Open jobs by role, beside bench candidates who fit"}</Hint></div></CardHeader>
      {jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.onRetry} /> : rows.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No open jobs yet.</p> : (
        <>
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,1fr)] gap-3 text-caption text-[var(--color-text-3)]" aria-hidden>
            <span className="flex items-center justify-end gap-1.5"><span className="size-2 rounded-full bg-[var(--color-chart-1)]" />Open jobs</span><span />
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--color-chart-2)]" />On the bench</span>
          </div>
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.key}>
                <Link href={links.candidates({ status: "ON_BENCH", role: row.key })} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm", linkSurface)}
                  aria-label={`${row.role}: ${row.jobs} open jobs, ${row.onBench} on the bench. Open those candidates`}>
                  <span className="flex items-center justify-end gap-2">
                    <span className="text-mono-sm tabular text-[var(--color-text-2)]">{row.jobs}</span>
                    <span className="h-4 rounded-l-[var(--radius-sm)] bg-[var(--color-chart-1)]" style={{ width: `${(row.jobs / max) * 100}%` }} />
                  </span>
                  <span className="truncate text-center text-[var(--color-text)]">{row.role}</span>
                  <span className="flex items-center gap-2">
                    {row.onBench ? <span className="h-4 rounded-r-[var(--radius-sm)] bg-[var(--color-chart-2)]" style={{ width: `${(row.onBench / max) * 100}%` }} /> : null}
                    <span className={cn("text-mono-sm tabular", row.onBench ? "text-[var(--color-text-2)]" : "text-[var(--color-warning-fg)]")}>{row.onBench || "none"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Where this period's applications came from, and how often each source got a reply (moved here from Analytics). */
export function SourceCard({ rows, jobs }: { rows: SourceRow[]; jobs: JobsState }) {
  if (jobs.isLoading) return <SkeletonCard />;
  const max = Math.max(1, ...rows.map((row) => row.applications));
  return (
    <Card>
      <CardHeader><div><CardTitle>Job sources</CardTitle><Hint>{jobs.isCapped ? "Applications this period by where the job came from, and the share that heard back. Counts applications to the newest jobs only" : "Applications this period by where the job came from, and the share that heard back"}</Hint></div></CardHeader>
      {jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.onRetry} /> : rows.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No applications this period.</p> : (
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.source} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
              <dt className="truncate text-[var(--color-text-2)]">{SOURCE_LABEL[row.source]}</dt>
              <span className="h-5 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-3)]" aria-hidden>
                <span className="block h-full rounded-[var(--radius-sm)] bg-[var(--color-chart-1)]" style={{ width: `${(row.applications / max) * 100}%` }} />
              </span>
              <dd className="whitespace-nowrap text-right text-mono-sm tabular text-[var(--color-text-2)]"><span className="text-[var(--color-text)]">{row.applications}</span> · {row.responsePct}% heard back</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
