"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Play, Send, Mail, ArrowRight, CalendarDays, MailCheck } from "lucide-react";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { scopeApplications, scopeCandidates } from "@/lib/auth/permissions";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications } from "@/lib/hooks/use-applications";
import { useJobs } from "@/lib/hooks/use-jobs";
import { TailorButton } from "@/components/app/tailoring/tailor-button";
import { deriveCandidateStats, deriveBdeDashboard, rankJobsForCandidate } from "@/lib/derive";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { WorkAuthChip } from "@/components/app/work-auth-chip";
import { ResponseDots } from "@/components/app/response-dots";
import { MatchScore } from "@/components/app/match-score";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { ErrorState } from "@/components/app/error-state";
import { GroupBody, GroupRowError } from "@/components/app/card-group";
import { hasPageFailed, queryGroup } from "@/lib/query/query-group";
import { PageHeader } from "@/components/app/page-header";
import { Users } from "lucide-react";
import { NewAssignmentsCard } from "./new-assignments-card";
import { useHref } from "@/lib/routes/use-href";

const EMPTY: never[] = [];

const NIGHTLY_TARGET = 40;

export function BdeDashboard() {
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const userId = principal.userId;
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const candidates = candidatesQuery.data ?? EMPTY;
  const applications = applicationsQuery.data ?? EMPTY;

  const myCandidates = useMemo(
    () => scopeCandidates(principal, candidates),
    [principal, candidates],
  );
  const topCandidate = useMemo(
    () => myCandidates.find((c) => c.status === "ON_BENCH") ?? myCandidates[0],
    [myCandidates],
  );
  // The queue is one candidate's: only their jobs are read (Zuhair 2026-11-12), once the candidate is known.
  const jobsQuery = useJobs({ limit: 300, candidateId: topCandidate?.id }, { isEnabled: Boolean(topCandidate) });
  // With no candidate there is no jobs read to wait for (a disabled query stays pending).
  const jobReads = topCandidate ? [jobsQuery] : [];
  // docs/04 §13: one group per set of cards that read the same queries.
  const numbers = queryGroup(candidatesQuery, applicationsQuery);
  const mine = queryGroup(candidatesQuery, applicationsQuery);
  const queueGroup = queryGroup(candidatesQuery, applicationsQuery, ...jobReads);
  const page = queryGroup(candidatesQuery, applicationsQuery, ...jobReads);
  const jobs = jobsQuery.data ?? EMPTY;

  const dash = useMemo(
    () => deriveBdeDashboard(userId, candidates, scopeApplications(principal, applications, candidates)),
    [userId, principal, candidates, applications],
  );

  const queue = useMemo(() => {
    if (!topCandidate || jobs.length === 0) return [];
    const appliedJobIds = new Set(
      applications.filter((a) => a.candidateId === topCandidate.id).map((a) => a.jobId),
    );
    return rankJobsForCandidate(topCandidate, jobs, appliedJobIds, 6);
  }, [topCandidate, jobs, applications]);

  const header = (
    <PageHeader
      title="Tonight"
      subtitle="Your queue, your candidates, and what to work on before the shift ends."
      actions={
        <Button asChild>
          <Link href={toHref("focus")}>
            <Play size={14} aria-hidden />
            Start a run
          </Link>
        </Button>
      }
    />
  );

  if (hasPageFailed(candidatesQuery, applicationsQuery, ...jobReads)) {
    return (
      <div className="bq-page">
        {header}
        <ErrorState variant="page" error={page.error ?? new Error("The request failed.")} onRetry={page.retry} />
      </div>
    );
  }

  return (
    <div className="bq-page">
      {header}

      <section aria-label="Tonight's numbers" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {numbers.status === "error" ? (
          <GroupRowError group={numbers} />
        ) : numbers.status === "pending" ? (
          <>
            <SkeletonCard /> <SkeletonCard /> <SkeletonCard /> <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard icon={Send} label="Applications" value={`${dash.applicationsThisWeek}`} delta={`of ${NIGHTLY_TARGET} target`} trend="neutral" window="this week" />
            <StatCard icon={CalendarDays} label="Interviews" value={`${dash.interviewsScheduled}`} trend="neutral" window="at the interview stage now" />
            <StatCard icon={MailCheck} iconTone="success" label="Responses" value={`${dash.responsesThisWeek}`} trend="up" window="this week" />
            <StatCard icon={Users} label="Candidates" value={`${myCandidates.length}`} trend="neutral" window="assigned to you" />
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0 space-y-6">
          <NewAssignmentsCard userId={userId} />
          <Card className="p-0">
            <CardHeader className="p-4">
              <CardTitle>My candidates{mine.status === "success" ? ` (${myCandidates.length})` : ""}</CardTitle>
              <Link href={toHref("candidates")} className="text-sm text-[var(--color-primary)] hover:underline">
                View all
              </Link>
            </CardHeader>
            <GroupBody group={mine} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => myCandidates.length === 0 ? (
              <EmptyState icon={Users} title="No candidates assigned" description="Your manager assigns candidates to your bench." variant="first-run" />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {myCandidates.slice(0, 6).map((c) => {
                  const stats = deriveCandidateStats(c, applications.filter((a) => a.candidateId === c.id));
                  const momentum = Math.min(5, Math.round(stats.responseRatePct / 20) + (stats.interviewsScheduled > 0 ? 1 : 0));
                  return (
                    <li key={c.id}>
                      <Link href={toHref("candidates.detail", { id: c.id })} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)]">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-body-strong truncate">{c.fullName}</span>
                            <WorkAuthChip workAuth={c.workAuth} expiry={c.workAuthExpiry} />
                          </div>
                          <div className="text-caption text-[var(--color-text-3)] truncate">{c.primaryRole}</div>
                        </div>
                        <div className="hidden shrink-0 items-center gap-4 text-mono-sm text-[var(--color-text-2)] sm:flex">
                          <span className="tabular">{stats.applicationsSubmitted} apps</span>
                          <span className="tabular">{stats.interviewsScheduled} int</span>
                          <ResponseDots filled={momentum} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}</GroupBody>
          </Card>
        </div>

        <Card className="p-0">
          <CardHeader className="p-4">
            <CardTitle>Queue — top matches{queueGroup.status === "success" && topCandidate ? ` · ${topCandidate.fullName}` : ""}</CardTitle>
            <Link href={toHref("jobs")} className="text-sm text-[var(--color-primary)] hover:underline">
              All jobs
            </Link>
          </CardHeader>
          <GroupBody group={queueGroup} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => queue.length === 0 ? (
            <EmptyState icon={Users} title="Queue is clear" description="No unapplied matches for this candidate right now." variant="filtered" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {queue.map(({ job, score }) => (
                // Wraps so the Tailor note (an item of this row, docs: TailorButton "icon") takes its own line below
                // it. gap-x-1 between the actions, me-2 after the title and the score keep the old gap-3 spacing.
                <li key={job.id} className="flex flex-wrap items-center gap-x-1 gap-y-1 px-4 py-3 hover:bg-[var(--color-surface-2)]">
                  <div className="me-2 min-w-0 flex-1">
                    <Link href={toHref("jobs.detail", { id: job.id }, { candidate: topCandidate?.id })} className="text-body-strong truncate hover:underline block">
                      {job.title}
                    </Link>
                    <div className="flex items-center gap-2 text-caption text-[var(--color-text-3)]">
                      <span className="truncate">{job.company.name}</span>
                      <Tag tone="neutral">{job.remoteMode}</Tag>
                    </div>
                  </div>
                  <MatchScore score={score} className="me-2 hidden sm:flex" />
                  {/* Mark applied and Outreach go in Tailor's group, before its note in the DOM: focus runs Tailor,
                      picker, Mark applied, Outreach, then the note's Copy and links, as the eye reads it (WCAG 2.4.3). */}
                  {topCandidate ? (
                    <TailorButton candidate={topCandidate} job={job} variant="icon" trailing={<RowActions jobId={job.id} candidateId={topCandidate.id} />} />
                  ) : (
                    <div className="flex shrink-0 items-center gap-1"><RowActions jobId={job.id} candidateId={undefined} /></div>
                  )}
                </li>
              ))}
            </ul>
          )}</GroupBody>
          <div className="border-t border-[var(--color-border)] p-3">
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link href={toHref("focus")}>
                Work the queue in focus mode
                <ArrowRight size={14} aria-hidden />
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A queue row's actions after Tailor: Mark applied (the job's page for this candidate) and Outreach. */
function RowActions({ jobId, candidateId }: { jobId: string; candidateId: string | undefined }) {
  const toHref = useHref();
  return (
    <>
      <Button asChild variant="ghost" size="icon" aria-label="Mark applied">
        <Link href={toHref("jobs.detail", { id: jobId }, { candidate: candidateId })}><Send size={15} aria-hidden /></Link>
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label="Open outreach">
        <Link href={toHref("outreach")}><Mail size={15} aria-hidden /></Link>
      </Button>
    </>
  );
}
