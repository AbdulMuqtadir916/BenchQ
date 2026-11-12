"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { CLOSED, PIPELINE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "@/components/app/applications/status-meta";

/** Applied → Offer, plus Incomplete, from the one pipeline in status-meta (PR 4). */
const STAGES: ApplicationStatus[] = [...PIPELINE.slice(1), "INCOMPLETE_APPLICATION"];
const BAR: Record<string, string> = {
  APPLIED: "bg-[var(--color-info-fg)]",
  SCREENING_CALL: "bg-[var(--color-violet-fg)]",
  SHORTLISTED: "bg-[var(--color-violet-fg)]",
  INTERVIEW_SCHEDULE_REQUEST: "bg-[var(--color-warning-fg)]",
  INTERVIEW_SCHEDULED: "bg-[var(--color-warning-fg)]",
  ASSESSMENT: "bg-[var(--color-warning-fg)]",
  OFFER: "bg-[var(--color-success-fg)]",
  INCOMPLETE_APPLICATION: "bg-[var(--color-warning-fg)]",
};

/** Where every submission stands right now. Each row opens the board. */
export function PipelineCard({ applications, onOpen }: { applications: Application[]; onOpen: () => void }) {
  const reduce = useReducedMotion() ?? false;
  const counts = STAGES.map((s) => ({ status: s, count: applications.filter((a) => a.status === s).length }));
  const max = Math.max(1, ...counts.map((c) => c.count));
  const saved = applications.filter((a) => a.status === "SAVED").length;
  const closed = applications.filter((a) => CLOSED.includes(a.status)).length;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-h3 text-[var(--color-text)]">Pipeline</h2>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
          Open board <ArrowRight size={13} aria-hidden />
        </button>
      </div>
      <ul className="space-y-1 p-2">
        {counts.map(({ status, count }, i) => {
          const Icon = STATUS_ICON[status];
          return (
            <li key={status}>
              <button type="button" onClick={onOpen} className="grid w-full grid-cols-[9rem_1fr_2rem] items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)]">
                <span className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
                  <Icon size={14} aria-hidden className={STATUS_COLOR[status]} />
                  {STATUS_LABEL[status]}
                </span>
                <span className="h-2 overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-3)]">
                  <motion.span
                    className={cn("block h-full rounded-[var(--radius-full)]", BAR[status])}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${(count / max) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.05, ease: EASE_OUT }}
                  />
                </span>
                <span className="tabular text-right text-body-strong text-[var(--color-text)]">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-caption text-[var(--color-text-3)]">
        {saved} saved to apply · {closed} closed (rejected, withdrawn or expired)
      </p>
    </Card>
  );
}
