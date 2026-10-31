"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, MailOpen } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { formatIst, formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { EmptyState } from "@/components/app/empty-state";
import { needsBdeReview, SIGNAL_META } from "@/components/app/inbox/signal-meta";
import { STATUS_LABEL, STATUS_TONE } from "@/components/app/applications/status-meta";
import { StageDots } from "../applications/application-list";
import { TRACKER_STATUSES, visibleApplicationStatuses } from "@/components/app/applications/status-meta";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { Suggestion } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";

interface ReaderProps {
  message: InboxMessage | null;
  application: Application | undefined;
  applications: Application[];
  suggestion: Suggestion | undefined;
  canAct: boolean;
  actions: CandidateActions;
}

/** One email, what it means, and the application it belongs to. */
export function InboxReader({ message, application, applications, suggestion, canAct, actions }: ReaderProps) {
  const reduce = useReducedMotion() ?? false;
  const [selection, setSelection] = useState<{ messageId: string; applicationId: string; status: ApplicationStatus } | null>(null);
  if (!message) return <EmptyState icon={MailOpen} title="Pick an email" description="Select an email on the left to read it here." />;
  const meta = message.signal ? SIGNAL_META[message.signal] : { label: "Unclassified email", Icon: MailOpen, tone: "neutral" as const };
  const applicationId = selection?.messageId === message.id ? selection.applicationId : message.applicationId ?? "";
  const status = selection?.messageId === message.id ? selection.status : suggestion?.to ?? message.impliedStatus ?? application?.status ?? "APPLIED";
  const setApplication = (next: string) => setSelection({ messageId: message.id, applicationId: next, status });
  const setConfirmedStatus = (next: ApplicationStatus) => setSelection({ messageId: message.id, applicationId, status: next });
  const selectedApplication = applications.find((item) => item.id === applicationId);
  const activeApplication = application ?? selectedApplication;
  const pendingReview = application?.pendingReviews.find((review) => review.messageId === message.id);
  const needsReview = needsBdeReview(message, !!pendingReview);
  const isReviewableUnmatched = needsReview && !message.applicationId;

  return (
    <motion.article key={message.id} initial={reduce ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="flex h-full flex-col">
      <header className="border-b border-[var(--color-border)] p-5">
        <Tag tone={meta.tone}><meta.Icon size={11} aria-hidden />{meta.label}</Tag>
        <h2 className="mt-2 text-h2 text-[var(--color-text)]">{message.subject}</h2>
        <p className="mt-1 text-sm text-[var(--color-text-2)]">
          <span className="font-[550]">{message.fromName}</span> <span className="text-[var(--color-text-3)]">&lt;{message.fromEmail}&gt;</span>
        </p>
        <DualTimestamp iso={message.receivedAt} className="mt-0.5 text-caption text-[var(--color-text-3)]" />
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {message.classificationState === "ERROR" && canAct ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-3">
            <p className="text-sm text-[var(--color-warning-fg)]">{message.classificationError ?? "Email classification failed after retries."}</p>
            <Button size="sm" variant="secondary" onClick={() => actions.retryInboxClassification(message.id)}>Retry classification</Button>
          </div>
        ) : null}
        {isReviewableUnmatched ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-3">
            <p className="text-sm font-[550] text-[var(--color-warning-fg)]">Needs BDE review · No unique application matched</p>
            <p className="mt-1 text-sm text-[var(--color-warning-fg)]">
              Decider confidence {message.classificationConfidence === null ? "unavailable" : `${(message.classificationConfidence * 100).toFixed(0)}%`}. Link this email to the correct application and confirm its status; the classification has not changed an application.
            </p>
          </div>
        ) : null}
        {message.scheduledFor ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2.5 text-sm text-[var(--color-warning-fg)]">
            <CalendarClock size={16} aria-hidden className="shrink-0" />
            <span><span className="font-[550]">{message.signal === "CALL_REQUEST" ? "Call proposed" : "Interview"}</span> · {formatIst(message.scheduledFor, "EEE, MMM d · h:mm a")} IST · {formatRelative(message.scheduledFor)}</span>
          </div>
        ) : null}

        {application ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-caption text-[var(--color-text-3)]">Matched application</p>
                <p className="truncate text-body-strong text-[var(--color-text)]">{application.jobTitleAtApply}</p>
                <p className="truncate text-sm text-[var(--color-text-3)]">{application.companyNameAtApply}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Tag tone={STATUS_TONE[application.status]}>{STATUS_LABEL[application.status]}</Tag>
                <StageDots status={application.status} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
              {needsReview ? <span className="flex-1 text-sm text-[var(--color-warning-fg)]">Needs BDE review · current status is retained until confirmed.</span>
                : message.classificationOutcome === "AUTO_APPLIED" || message.classificationOutcome === "NO_CHANGE" ? (
                  <span className="flex flex-1 items-center gap-1.5 text-sm text-[var(--color-success-fg)]"><CheckCircle2 size={14} aria-hidden />{message.classificationOutcome === "AUTO_APPLIED" ? "Status updated automatically." : "No status change was needed."}</span>
                ) : <span className="flex-1 text-sm text-[var(--color-text-3)]">{message.classificationOutcome === "REVIEW" ? "Review completed." : message.classificationState === "ERROR" ? "Classification needs retry." : "Matching and classifying…"}</span>}
              <Button size="sm" variant="ghost" onClick={() => actions.openApplication(application.id)}>Open <ArrowRight size={13} aria-hidden /></Button>
            </div>
          </div>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-3)]">Couldn&apos;t match this email to an application.</p>
        )}

        {canAct && needsReview ? (
          <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3" aria-label="Confirm application status from email">
            <div>
              <p className="text-sm font-[550] text-[var(--color-text)]">Review application status</p>
              <p className="mt-1 text-caption text-[var(--color-text-3)]">
                {pendingReview?.reason === "STATUS_REVIEW"
                  ? "This email is older than newer application activity. Review it before confirming a status."
                  : pendingReview?.reason === "AUTO_STATUS_DISABLED"
                    ? "Automatic status updates are disabled. Review this email and confirm the status."
                    : message.classificationOutcome === "REVIEW" && message.classificationConfidence !== null
                      ? `Decider confidence ${(message.classificationConfidence * 100).toFixed(0)}% — confirm the status yourself.`
                      : "Choose the status you want to record after reading this email."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!application ? (
                <label className="min-w-48 flex-1 text-caption text-[var(--color-text-3)]">
                  Application
                  <select value={applicationId} onChange={(event) => setApplication(event.target.value)} className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]">
                    <option value="">Select application…</option>
                    {applications.map((item) => <option key={item.id} value={item.id}>{item.jobTitleAtApply} · {item.companyNameAtApply}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="min-w-48 flex-1 text-caption text-[var(--color-text-3)]">
                Confirmed status
                <select value={status} onChange={(event) => setConfirmedStatus(event.target.value as ApplicationStatus)} className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]">
                  {(activeApplication ? TRACKER_STATUSES.filter((value) => visibleApplicationStatuses(activeApplication, [message]).includes(value) || (value === "INCOMPLETE_APPLICATION" && message.signal === "INCOMPLETE_APPLICATION")) : TRACKER_STATUSES.filter((value) => value !== "INCOMPLETE_APPLICATION" || message.signal === "INCOMPLETE_APPLICATION")).map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
                </select>
              </label>
              <Button size="sm" className="self-end" disabled={!selectedApplication} onClick={() => {
                if (!activeApplication) return;
                actions.reviewInboxMessage({
                  messageId: message.id, applicationId: activeApplication.id, status,
                  expectedRevision: activeApplication.statusRevision,
                  reviewId: pendingReview?.id,
                  expectedReviewRevision: pendingReview?.revision,
                });
              }}>Confirm status</Button>
            </div>
          </section>
        ) : null}

        <div className="whitespace-pre-line text-body leading-relaxed text-[var(--color-text)]">{message.body}</div>
      </div>
    </motion.article>
  );
}
