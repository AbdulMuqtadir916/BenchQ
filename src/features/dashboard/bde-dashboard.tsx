"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Play, Sparkles, Send, Mail, ArrowRight, BellRing, MailCheck, CircleHelp } from "lucide-react";
import { useSignedInUser } from "@/lib/stores/session-store";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications, useFollowups } from "@/lib/hooks/use-applications";
import { useJobs } from "@/lib/hooks/use-jobs";
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
import { useHref } from "@/lib/routes/use-href";

const EMPTY: never[] = [];

const NIGHTLY_TARGET = 40;

export function BdeDashboard() {
  const toHref = useHref();
  const user = useSignedInUser();
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const followupsQuery = useFollowups(user.id);
  const jobsQuery = useJobs({ limit: 300 });
  // docs/04 §13: one group per set of cards that read the same queries.
  const numbers = queryGroup(candidatesQuery, applicationsQuery, followupsQuery);
  const mine = queryGroup(candidatesQuery, applicationsQuery);
  const queueGroup = queryGroup(candidatesQuery, applicationsQuery, jobsQuery);
  const page = queryGroup(candidatesQuery, applicationsQuery, followupsQuery, jobsQuery);

  const candidates = candidatesQuery.data ?? EMPTY;
  const applications = applicationsQuery.data ?? EMPTY;
  const followups = followupsQuery.data ?? EMPTY;
  const jobs = jobsQuery.data ?? EMPTY;

  const myCandidates = useMemo(
    () => candidates.filter((c) => c.assignedUserIds.includes(user.id)),
    [candidates, user.id],
  );

  const dash = useMemo(
    () => deriveBdeDashboard(user.id, candidates, applications, followups),
    [user.id, candidates, applications, followups],
  );

  const unverifiedToReview = useMemo(
    () =>
      myCandidates.reduce(
        (sum, c) => sum + c.qaBank.filter((q) => q.state === "UNVERIFIED").length,
        0,
      ),
    [myCandidates],
  );

  const topCandidate = useMemo(
    () => myCandidates.find((c) => c.status === "ON_BENCH") ?? myCandidates[0],
    [myCandidates],
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
      subtitle="Your queue, your candidates, what needs a nudge before the shift ends."
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

  if (hasPageFailed(candidatesQuery, applicationsQuery, followupsQuery, jobsQuery)) {
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
            <StatCard icon={BellRing} iconTone={dash.followUpsOverdue ? "danger" : "success"} label="Follow-ups" value={`${dash.followUpsDueToday + dash.followUpsOverdue}`} delta={dash.followUpsOverdue ? `${dash.followUpsOverdue} overdue` : "on track"} trend={dash.followUpsOverdue ? "down" : "up"} window="due" />
            <StatCard icon={MailCheck} iconTone="success" label="Responses" value={`${dash.responsesThisWeek}`} trend="up" window="this week" />
            <StatCard icon={CircleHelp} iconTone="warning" label="Unverified claims" value={`${unverifiedToReview}`} delta="to review" trend="neutral" window="needs evidence" />
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
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
                <li key={job.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)]">
                  <div className="min-w-0 flex-1">
                    <Link href={toHref("jobs.detail", { id: job.id })} className="text-body-strong truncate hover:underline block">
                      {job.title}
                    </Link>
                    <div className="flex items-center gap-2 text-caption text-[var(--color-text-3)]">
                      <span className="truncate">{job.company.name}</span>
                      <Tag tone="neutral">{job.remoteMode}</Tag>
                    </div>
                  </div>
                  <MatchScore score={score} className="hidden sm:flex" />
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label="Tailor resume">
                      <Link href={toHref("jobs.detail", { id: job.id })}><Sparkles size={15} aria-hidden /></Link>
                    </Button>
                    <Button asChild variant="ghost" size="icon" aria-label="Mark applied">
                      <Link href={toHref("jobs.detail", { id: job.id })}><Send size={15} aria-hidden /></Link>
                    </Button>
                    <Button asChild variant="ghost" size="icon" aria-label="Open outreach">
                      <Link href={toHref("outreach")}><Mail size={15} aria-hidden /></Link>
                    </Button>
                  </div>
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
