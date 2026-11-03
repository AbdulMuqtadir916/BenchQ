"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, CalendarClock, CheckCircle2, MailOpen } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { formatIst, formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { EmptyState } from "@/components/app/empty-state";
import { mailSignalMeta } from "@/components/app/inbox/signal-meta";
import { STATUS_LABEL, STATUS_TONE } from "@/components/app/applications/status-meta";
import { StageDots } from "../applications/application-list";
import type { Suggestion } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";

interface ReaderProps {
  message: InboxMessage | null;
  application: Application | undefined;
  suggestion: Suggestion | undefined;
  canAct: boolean;
  actions: CandidateActions;
}

/** One email, what it means, and the application it belongs to. */
export function InboxReader({ message, application, suggestion, canAct, actions }: ReaderProps) {
  const reduce = useReducedMotion() ?? false;
  if (!message) return <EmptyState icon={MailOpen} title="Pick an email" description="Select an email on the left to read it here." />;
  const meta = mailSignalMeta(message.signal);

  return (
    <motion.article key={message.id} initial={reduce ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="flex h-full flex-col">
      <header className="border-b border-[var(--color-border)] p-5">
        <Tag tone={meta.tone}><meta.Icon size={11} aria-hidden />{meta.label}</Tag>
        <h2 className="mt-2 text-h2 text-[var(--color-text)]">{message.subject}</h2>
        <p className="mt-1 text-sm text-[var(--color-text-2)]">
          <span className="font-[550]">{message.fromName}</span> <span className="text-[var(--color-text-3)]">&lt;{message.fromEmail}&gt;</span>
        </p>
        {message.sourceAddress ? <p className="mt-1 break-words text-caption text-[var(--color-text-3)]">Mailbox: {message.sourceAddress}</p> : null}
        <DualTimestamp iso={message.receivedAt} className="mt-0.5 text-caption text-[var(--color-text-3)]" />
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
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
              {suggestion && canAct ? (
                <>
                  <span className="flex-1 text-sm text-[var(--color-violet-fg)]">This email means <span className="font-[550]">{STATUS_LABEL[suggestion.to].toLowerCase()}</span> — the pipeline still says {STATUS_LABEL[application.status].toLowerCase()}.</span>
                  <Button size="sm" onClick={() => actions.applySuggestion(suggestion)}>Move to {STATUS_LABEL[suggestion.to]}</Button>
                </>
              ) : (
                <span className="flex flex-1 items-center gap-1.5 text-sm text-[var(--color-success-fg)]"><CheckCircle2 size={14} aria-hidden />Pipeline is up to date with this email.</span>
              )}
              <Button size="sm" variant="ghost" onClick={() => actions.openApplication(application.id)}>Open <ArrowRight size={13} aria-hidden /></Button>
            </div>
          </div>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-3)]">This email is not linked to an application yet.</p>
        )}

        <div className="whitespace-pre-line text-body leading-relaxed text-[var(--color-text)]">{message.body}</div>
      </div>
    </motion.article>
  );
}
