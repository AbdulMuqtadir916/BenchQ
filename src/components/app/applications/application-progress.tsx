import { Check } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { formatIst } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { STATUS_LABEL, TRACKER_STATUSES, visibleApplicationStatuses } from "./status-meta";

/** Visual position follows the current decision; event dates remain historical facts. */
export function ApplicationProgress({ application, messages = [] }: { application: Application; messages?: InboxMessage[] }) {
  const statuses = visibleApplicationStatuses(application, messages);
  if (!TRACKER_STATUSES.includes(application.status)) statuses.push(application.status);
  const main = statuses.filter((status) => status !== "MOVE_ON" && status !== "OTHER" && TRACKER_STATUSES.includes(status));
  const events = [...application.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let preceding = application.appliedAt ? main.indexOf("APPLIED") : -1;
  for (const event of events) {
    if (event.fromStatus && main.includes(event.fromStatus)) preceding = main.indexOf(event.fromStatus);
    if (main.includes(event.toStatus)) preceding = main.indexOf(event.toStatus);
  }
  const current = main.indexOf(application.status);
  const through = current >= 0 ? current : preceding;
  return (
    <section aria-label="Application status progress" className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <h3 className="mb-3 text-label text-[var(--color-text-3)]">Progress</h3>
      <ol className="space-y-0.5">
        {statuses.map((status, index) => {
          const isCurrent = status === application.status;
          const position = main.indexOf(status);
          const filled = position >= 0 && position <= through;
          const state = isCurrent ? "current" : filled ? "completed" : "future";
          const reachedAt = [...events].reverse().find((event) => event.toStatus === status)?.createdAt;
          const nextPosition = main.indexOf(statuses[index + 1]!);
          const connected = filled && nextPosition >= 0 && nextPosition <= through;
          return (
            <li key={status} data-status={status} data-state={state} aria-current={isCurrent ? "step" : undefined} className="relative flex min-h-10 items-center gap-3">
              {index < statuses.length - 1 ? <span aria-hidden className={cn("absolute left-4 top-7 h-6 w-px", connected ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]")} /> : null}
              <span aria-hidden className={cn("relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-full)] border-2",
                isCurrent ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                  : filled ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-3)]")}>
                {isCurrent ? <span className="h-2 w-2 rounded-[var(--radius-full)] bg-current" /> : filled ? <Check size={14} /> : null}
              </span>
              <span className={cn("flex-1 text-sm", isCurrent ? "font-[550] text-[var(--color-text)]" : filled ? "text-[var(--color-text-2)]" : "text-[var(--color-text-3)]")}>{STATUS_LABEL[status]}<span className="sr-only">{isCurrent ? ", current stage" : filled ? ", completed" : ", upcoming"}</span></span>
              {reachedAt ? <time dateTime={reachedAt} className="text-caption text-[var(--color-text-3)]">{formatIst(reachedAt, "MMM d")}</time> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
