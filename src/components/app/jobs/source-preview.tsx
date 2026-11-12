"use client";

import { ArrowUpRight, Clock3 } from "lucide-react";
import type { Job } from "@/lib/schemas/job";
import { formatRelative } from "@/lib/format/timezone";
import { jobLocation } from "@/lib/format/job";
import { useJob } from "@/lib/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { PORTALS, PortalLogo, type PortalKey } from "@/components/app/jobs/portal-logo";
import { JobDescription } from "@/components/app/jobs/job-description";

/**
 * The selected job as its source shows it. The list leaves descriptions out (a list of up to 400 jobs stays small,
 * docs/02 §6.z), so the description comes from the one job's read, the same the job page makes (decided 2026-11-11).
 */
export function SourcePreview({ job, portal, onOpenSource = null }: { job: Job; portal: PortalKey; onOpenSource?: ((job: Job) => void) | null }) {
  const sourceUrl = job.provenance.sourceUrl ?? job.applyUrl;
  return (
    <div className="flex-1 bg-[var(--color-surface-2)] p-4">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <PortalLogo portal={portal} domain={job.company.domain} size={32} />
            <div className="min-w-0"><div className="text-body-strong text-[var(--color-text)]">Source preview · {PORTALS[portal].label}</div><div className="truncate text-caption text-[var(--color-text-3)]">{sourceUrl ?? job.company.websiteUrl ?? "Source URL unavailable"}</div></div>
          </div>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" onClick={() => onOpenSource?.(job)} className="inline-flex shrink-0 items-center gap-1 text-sm text-[var(--color-primary)] hover:underline">Open original<ArrowUpRight size={13} /></a> : null}
        </header>
        <div className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <PortalLogo portal="COMPANY" domain={job.company.domain} size={40} />
            <div><h3 className="text-h2 text-[var(--color-text)]">{job.title}</h3><p className="mt-0.5 text-sm text-[var(--color-text-2)]">{job.company.name} · {jobLocation(job)}</p><p className="mt-1 inline-flex items-center gap-1 text-caption text-[var(--color-text-3)]"><Clock3 size={12} />{job.postedAt ? `Posted ${formatRelative(job.postedAt)}` : "Posting date not given"}{job.applicantCount ? ` · ${job.applicantCount} applicants` : ""}</p></div>
          </div>
          <Description job={job} />
          {job.requirements.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-4">
              {job.requirements.slice(0, 8).map((requirement) => <Tag key={requirement.id} tone={requirement.kind === "MANDATORY" ? "blue" : "neutral"}>{requirement.value}</Tag>)}
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

/** The full description from the one job's read; a list item's own text when it has one. Loading and error states. */
function Description({ job }: { job: Job }) {
  const detail = useJob(job.id);
  const description = detail.data?.description || job.description;
  if (!description && detail.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading the job description">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }
  if (!description && detail.error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-2)]">
        <span>The description didn&apos;t load.</span>
        <Button variant="secondary" size="sm" onClick={() => void detail.refetch()}>Retry</Button>
      </div>
    );
  }
  if (!description) return <p className="text-sm text-[var(--color-text-3)]">This job has no description.</p>;
  return <JobDescription text={description} />;
}
