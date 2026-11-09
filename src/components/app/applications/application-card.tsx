import { Clock3 } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import { daysBetween } from "@/lib/derive/dates";
import { formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { AvatarStack } from "@/components/app/avatar-stack";
import { NeedsReviewBadge } from "@/components/app/inbox/needs-review-badge";
import { STATUS_ICON, STATUS_COLOR, stageEnteredAt } from "./status-meta";

export interface CardFaceProps {
  app: Application;
  /** Candidate name — shown on the firm-wide board, omitted on a candidate's own page. */
  candidateName?: string;
  owner: string;
  followUpDue?: string;
  /** A move for this card is in flight: shown as "Saving…" until the server confirms it. */
  isSaving?: boolean;
  /** Off inside the BDE review column, where every card is waiting for review anyway. */
  showReviewBadge?: boolean;
}

/** The content of one application card. Shared by the draggable card and its drag overlay. */
export function ApplicationCardFace({ app, candidateName, owner, followUpDue, isSaving = false, showReviewBadge = true }: CardFaceProps) {
  const days = daysBetween(stageEnteredAt(app), new Date());
  const Icon = STATUS_ICON[app.status];
  const ageTone = days >= 7 ? "text-[var(--color-danger-fg)]" : days >= 3 ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text-3)]";

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-body-strong text-[var(--color-text-2)]">
          {app.companyNameAtApply.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-body-strong text-[var(--color-text)]">{app.jobTitleAtApply}</h3>
          <p className="truncate text-caption text-[var(--color-text-3)]">{app.companyNameAtApply}</p>
        </div>
        <Icon size={14} aria-hidden className={cn("mt-0.5 shrink-0", STATUS_COLOR[app.status])} />
      </div>
      {isSaving ? <p role="status" className="mt-2 text-caption text-[var(--color-text-3)]">Saving…</p> : null}
      {showReviewBadge && app.pendingReviewCount > 0 ? <NeedsReviewBadge className="mt-2.5" title="An email about this application is waiting for review: decide it in the Inbox before moving." /> : null}
      {candidateName ? <p className="mt-2 truncate text-sm text-[var(--color-text-2)]">{candidateName}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2.5">
        <span className={cn("inline-flex items-center gap-1 text-caption", ageTone)} title="Days in this stage">
          <Clock3 size={12} aria-hidden />
          {days === 0 ? "Today" : `${days}d in stage`}
        </span>
        {followUpDue ? (
          <span className="truncate text-caption text-[var(--color-text-3)]">Follow-up {formatRelative(followUpDue)}</span>
        ) : (
          <AvatarStack people={[{ name: owner }]} />
        )}
      </div>
    </>
  );
}
