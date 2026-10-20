"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { useApplication, useUpdateApplicationStatus } from "@/lib/hooks/use-applications";
import { useCandidate } from "@/lib/hooks/use-candidates";
import { useJob } from "@/lib/hooks/use-jobs";
import { useResumes } from "@/lib/hooks/use-resumes";
import { useTeam } from "@/lib/hooks/use-team";
import { useCandidateInbox } from "@/lib/hooks/use-inbox";
import { can } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { deriveMatchScore } from "@/lib/derive";
import { formatRelative } from "@/lib/format/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { isNotFoundError } from "@/lib/api/client";
import { useRouteAccess } from "@/lib/routes/use-route-access";
import { isInScope } from "@/lib/routes/scope";
import { MatchScore } from "@/components/app/match-score";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { SIGNAL_META } from "@/components/app/inbox/signal-meta";
import { ResumeSent } from "@/components/app/applications/resume-sent";
import { StatusTimeline } from "@/components/app/applications/status-timeline";
import { NEXT_STATUS, STATUS_LABEL, STATUS_TONE } from "@/components/app/applications/status-meta";
import { useHref } from "@/lib/routes/use-href";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-label text-[var(--color-text-3)]">{label}</dt>
      <dd className="mt-0.5 text-body text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

/** One submission end to end: its status history, the resume the client received, and the recruiter's emails. */
export default function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const toHref = useHref();
  const { id } = use(params);
  const principal = useSignedInPrincipal();
  const appQuery = useApplication(id);
  const app = appQuery.data;
  const { access } = useRouteAccess();
  const candidateQuery = useCandidate(app?.candidateId ?? "");
  const jobQuery = useJob(app?.jobId ?? "");
  const resumesQuery = useResumes(app?.candidateId ?? "");
  const inboxQuery = useCandidateInbox(app?.candidateId ?? "");
  const teamQuery = useTeam();
  const updateStatus = useUpdateApplicationStatus();

  const actorName = useMemo(() => {
    const names = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return (userId: string | null) => (userId ? (names.get(userId) ?? null) : null);
  }, [teamQuery.data]);

  if (appQuery.isLoading) return <div className="bq-page space-y-4"><SkeletonCard /><SkeletonCard /></div>;
  // A missing record and a record outside the user's scope look the same: not-found (07 Q6).
  const notFoundState = <NotFoundState title="Application not found" description="This application doesn't exist or isn't available to you." backHref={toHref("applications")} backLabel="Back to applications" />;
  if (isNotFoundError(appQuery.error)) return notFoundState;
  if (appQuery.error || !app) {
    return (
      <div className="bq-page">
        <Link href={toHref("applications")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]"><ArrowLeft size={14} aria-hidden /> Applications</Link>
        <ErrorState variant="page" error={appQuery.error ?? new Error("Application not found.")} onRetry={() => void appQuery.refetch()} />
      </div>
    );
  }
  if (!isInScope(access, principal.userId, { ownerUserId: app.submittedByUserId })) return notFoundState;

  const candidate = candidateQuery.data;
  const job = jobQuery.data;
  const next = NEXT_STATUS[app.status];
  const emails = (inboxQuery.data?.messages ?? []).filter((m) => m.applicationId === app.id);

  return (
    <div className="bq-page">
      <Link href={candidate ? toHref("candidates.detail", { id: candidate.id }, { tab: "applications" }) : toHref("applications")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} aria-hidden /> {candidate ? candidate.fullName : "Applications"}
      </Link>
      <PageHeader
        title={app.jobTitleAtApply}
        subtitle={`${app.companyNameAtApply}${candidate ? ` · ${candidate.fullName}` : ""}`}
        actions={
          <>
            <Tag tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Tag>
            {can(principal, "application.move") && next ? (
              <Button size="sm" variant="secondary" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: app.id, status: next, note: null })}>
                Move to {STATUS_LABEL[next]} <ArrowRight size={13} aria-hidden />
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <h2 className="mb-4 text-h3 text-[var(--color-text)]">Status history</h2>
            <StatusTimeline application={app} actorName={actorName} />
          </Card>
          <Card className="p-0">
            <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-h3 text-[var(--color-text)]">Recruiter emails ({emails.length})</h2>
            {!inboxQuery.data?.connection ? (
              <p className="px-4 py-4 text-sm text-[var(--color-text-3)]">
                The candidate&apos;s inbox isn&apos;t connected.
                {/* Connecting is a write (candidate.edit): a VIEWER or a support view gets the fact, not the link. */}
                {candidate && can(principal, "candidate.edit") ? (
                  <>{" "}<Link href={toHref("candidates.detail", { id: candidate.id }, { tab: "inbox" })} className="text-[var(--color-primary-subtle-fg)] hover:underline">Connect it</Link> to see recruiter replies here.</>
                ) : null}
              </p>
            ) : emails.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--color-text-3)]">No recruiter emails matched to this application yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {emails.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <Mail size={14} aria-hidden className="mt-1 shrink-0 text-[var(--color-text-3)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-[550] text-[var(--color-text)]">{m.subject}</p>
                      <p className="line-clamp-2 text-sm text-[var(--color-text-2)]">{m.snippet}</p>
                      <p className="mt-0.5 text-caption text-[var(--color-text-3)]">{m.fromName} · {formatRelative(m.receivedAt)}</p>
                    </div>
                    <Tag tone={SIGNAL_META[m.signal].tone} className="shrink-0">{SIGNAL_META[m.signal].label}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-h3 text-[var(--color-text)]">Resume sent</h2>
            <ResumeSent application={app} resumes={resumesQuery.data ?? []} isLoading={resumesQuery.isLoading} />
          </Card>
          <Card>
            <h2 className="mb-3 text-h3 text-[var(--color-text)]">Details</h2>
            <dl className="space-y-3">
              <Detail label="Candidate">{candidate ? <Link href={toHref("candidates.detail", { id: candidate.id })} className="hover:underline">{candidate.fullName}</Link> : "—"}</Detail>
              <Detail label="Job">
                <Link href={toHref("jobs.detail", { id: app.jobId })} className="hover:underline">{app.jobTitleAtApply}</Link>
                <span className="block text-sm text-[var(--color-text-3)]">{app.companyNameAtApply}</span>
              </Detail>
              <Detail label="Match score">{candidate && job ? <MatchScore score={deriveMatchScore(candidate, job)} /> : "—"}</Detail>
              <Detail label="Applied">{app.appliedAt ? <DualTimestamp iso={app.appliedAt} format="absolute" /> : "Not yet"}</Detail>
              <Detail label="Submitted by">{actorName(app.submittedByUserId) ?? "—"}</Detail>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
