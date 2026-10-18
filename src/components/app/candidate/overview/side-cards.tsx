"use client";

import Link from "next/link";
import { ArrowRight, FileUser, Sparkles } from "lucide-react";
import type { Job } from "@/lib/schemas/job";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MatchScore } from "@/components/app/match-score";
import { PortalLogo } from "@/components/app/jobs/portal-logo";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import { useHref } from "@/lib/routes/use-href";

/**
 * How ready the master resume is to send. It's the verified source every
 * tailored copy reuses, so verifying a claim here clears it everywhere.
 */
export function ResumeReadiness({ master, reviewHref }: { master: CandidateWorkspace["master"]; reviewHref: string | null }) {
  const toHref = useHref();
  if (!master) {
    return (
      <Card>
        <h2 className="mb-1 text-h3 text-[var(--color-text)]">Resume readiness</h2>
        <p className="text-sm text-[var(--color-text-2)]">No master resume yet. Build one — tailored copies reuse its verified claims.</p>
        <Button asChild size="sm" className="mt-3"><Link href={toHref("resumes.studio", { id: "new" })}>Build master resume</Link></Button>
      </Card>
    );
  }
  const percent = master.total ? Math.round((master.verified / master.total) * 100) : 100;
  const blocked = master.gate.unverifiedCount;
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-h3 text-[var(--color-text)]"><FileUser size={15} aria-hidden className="text-[var(--color-text-3)]" />Resume readiness</h2>
        <span className="tabular text-body-strong text-[var(--color-text)]">{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-3)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Master resume claims verified">
        <div className={`h-full rounded-[var(--radius-full)] transition-[width] duration-[var(--duration-slow)] ${blocked ? "bg-[var(--color-warning-fg)]" : "bg-[var(--color-success-fg)]"}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2.5 text-sm text-[var(--color-text-2)]">
        <span className="tabular">{master.verified} of {master.total}</span> claims in the master resume verified.{" "}
        {blocked ? `${blocked} still ${blocked === 1 ? "needs" : "need"} evidence before any copy can be exported.` : "Every copy can be exported."}
      </p>
      {reviewHref && blocked ? (
        <Link href={reviewHref} className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
          Review unverified claims <ArrowRight size={13} aria-hidden />
        </Link>
      ) : null}
    </Card>
  );
}

export function TopMatches({ matches, onFindJobs }: { matches: Array<{ job: Job; score: number }>; onFindJobs: () => void }) {
  const toHref = useHref();
  return (
    <Card className="p-0">
      <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-h3 text-[var(--color-text)]">Best new matches</h2>
      <ul className="divide-y divide-[var(--color-border)]">
        {matches.map(({ job, score }) => (
          <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Link href={toHref("jobs.detail", { id: job.id })} className="flex min-w-0 items-center gap-2.5 hover:underline">
              <PortalLogo portal="COMPANY" domain={job.company.domain} size={28} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-[var(--color-text)]">{job.title}</span>
                <span className="block truncate text-caption text-[var(--color-text-3)]">{job.company.name}</span>
              </span>
            </Link>
            <MatchScore score={score} />
          </li>
        ))}
        {matches.length === 0 ? <li className="px-4 py-4 text-sm text-[var(--color-text-3)]">No unapplied matches right now.</li> : null}
      </ul>
      <button type="button" onClick={onFindJobs} className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--color-border)] py-2.5 text-sm font-[550] text-[var(--color-primary-subtle-fg)] hover:bg-[var(--color-primary-subtle)]">
        <Sparkles size={14} aria-hidden /> Find more jobs
      </button>
    </Card>
  );
}
