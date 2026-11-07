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

/** The base résumé the workflow uses: its name, newest version and how many tailored copies hang off it. */
export function BaseResumeCard({ base, onOpenResumes }: { base: CandidateWorkspace["base"]; onOpenResumes: () => void }) {
  const toHref = useHref();
  if (!base) {
    return (
      <Card>
        <h2 className="mb-1 text-h3 text-[var(--color-text)]">Base résumé</h2>
        <p className="text-sm text-[var(--color-text-2)]">No base résumé yet. The candidate&apos;s BDE uploads one on the Résumés tab.</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={onOpenResumes}>Open Résumés</Button>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 text-h3 text-[var(--color-text)]"><FileUser size={15} aria-hidden className="text-[var(--color-text-3)]" />Base résumé</h2>
      <p className="truncate text-body-strong text-[var(--color-text)]">{base.resume.name}</p>
      <p className="mt-0.5 text-sm text-[var(--color-text-2)]">
        <span className="tabular">v{base.version.versionNumber}</span> · {base.tailoredCount} tailored {base.tailoredCount === 1 ? "copy" : "copies"}
      </p>
      <Link href={toHref("resumes.studio", { id: base.version.id })} className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
        Open <ArrowRight size={13} aria-hidden />
      </Link>
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
