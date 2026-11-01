"use client";

import { ChevronRight, Mail } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/tag";
import { SIGNAL_META } from "@/components/app/inbox/signal-meta";
import { STATUS_LABEL, STATUS_TONE } from "@/components/app/applications/status-meta";

/** Categories are not a linear pipeline; display the current confirmed status. */
export function StageDots({ status }: { status: ApplicationStatus }) {
  return <span className="text-caption text-[var(--color-text-3)]">{STATUS_LABEL[status]}</span>;
}

/** Dense list of submissions with stage progress and the latest recruiter email. */
export function ApplicationList({ apps, signals, onOpen }: { apps: Application[]; signals: Map<string, InboxMessage>; onOpen: (id: string) => void }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <ul className="bq-card divide-y divide-[var(--color-border)] overflow-hidden p-0">
      {apps.map((app, i) => {
        const signal = signals.get(app.id);
        const meta = signal?.signal ? SIGNAL_META[signal.signal] : null;
        return (
          <motion.li key={app.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: Math.min(i, 10) * 0.03, ease: EASE_OUT }}>
            <button type="button" onClick={() => onOpen(app.id)} className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)] md:grid-cols-[2rem_minmax(0,1.6fr)_8rem_minmax(0,1fr)_6rem_1rem]">
              <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-body-strong text-[var(--color-text-2)]">{app.companyNameAtApply.charAt(0)}</span>
              <span className="min-w-0">
                <span className="block truncate text-body-strong text-[var(--color-text)]">{app.jobTitleAtApply}</span>
                <span className="block truncate text-sm text-[var(--color-text-3)]">{app.companyNameAtApply}</span>
              </span>
              <span className="flex flex-col items-end gap-1.5 md:items-start">
                <Tag tone={app.pendingReviews.length ? "amber" : STATUS_TONE[app.status]}>{app.pendingReviews.length ? "BDE review" : STATUS_LABEL[app.status]}</Tag>
                <span className="hidden md:inline-flex"><StageDots status={app.status} /></span>
              </span>
              <span className="hidden min-w-0 md:block">
                {meta && signal ? (
                  <span className={cn("flex min-w-0 items-center gap-1.5 text-sm", signal.isRead ? "text-[var(--color-text-2)]" : "font-[550] text-[var(--color-text)]")}>
                    <Mail size={13} aria-hidden className="shrink-0 text-[var(--color-text-3)]" />
                    <span className="truncate">{meta.label} · {formatRelative(signal.receivedAt)}</span>
                  </span>
                ) : (
                  <span className="text-sm text-[var(--color-text-3)]">No recruiter email yet</span>
                )}
              </span>
              <span className="tabular hidden text-sm text-[var(--color-text-3)] md:block">{app.appliedAt ? formatRelative(app.appliedAt) : "Not applied"}</span>
              <ChevronRight size={15} aria-hidden className="hidden text-[var(--color-text-3)] md:block" />
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
