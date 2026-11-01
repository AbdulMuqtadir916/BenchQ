"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive, Mail } from "lucide-react";
import Link from "next/link";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { useFollowups } from "@/lib/hooks/use-applications";
import { useTeam } from "@/lib/hooks/use-team";
import { cn } from "@/lib/cn";
import { useHref } from "@/lib/routes/use-href";
import { needsBdeReview } from "@/components/app/inbox/signal-meta";
import { ApplicationCardFace } from "./application-card";
import { CLOSED, TRACKER_STATUSES, PIPELINE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL, hasIncompleteEvidence, visibleApplicationStatuses } from "./status-meta";

interface ApplicationBoardProps {
  apps: Application[];
  /** Applications awaiting a human email decision; their confirmed status stays unchanged. */
  reviewApplicationIds?: ReadonlySet<string>;
  /** Actionable mail awaiting an application link; never invent an application for it. */
  unmatchedReviewMessages?: InboxMessage[];
  onMove: (id: string, to: ApplicationStatus) => void;
  canAct: boolean;
  /** Show the candidate on each card (firm-wide board). Omit on a candidate's own page. */
  candidateName?: (candidateId: string) => string;
  /** Latest recruiter email per application, shown on the card. */
  signals?: Map<string, InboxMessage>;
  onOpen?: (applicationId: string) => void;
  /** Add a read-only "Closed" column for rejected / withdrawn / expired. */
  showClosed?: boolean;
  /** Disable stage changes when the current application adapter is read-only/live-saved-only. */
  canMove?: boolean;
}

/** The pipeline as columns. Drag an active card directly to any canonical status column. */
export function ApplicationBoard({ apps, onMove, canAct, candidateName, signals, onOpen, showClosed = false, canMove = true, reviewApplicationIds, unmatchedReviewMessages = [] }: ApplicationBoardProps) {
  const toHref = useHref();
  const teamQuery = useTeam();
  const followupsQuery = useFollowups();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Enter opens a card; Space picks it up to move with the arrow keys.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }));

  const ownerName = useMemo(() => {
    const map = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return (id: string | null) => id ? (map.get(id) ?? "Unassigned") : "Unassigned";
  }, [teamQuery.data]);

  const nextFollowup = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of followupsQuery.data ?? []) {
      if (task.state !== "PENDING" && task.state !== "SNOOZED") continue;
      const due = task.snoozedUntil ?? task.dueAt;
      const current = map.get(task.applicationId);
      if (!current || due < current) map.set(task.applicationId, due);
    }
    return map;
  }, [followupsQuery.data]);

  const face = (app: Application) => ({ app, candidateName: candidateName?.(app.candidateId), owner: ownerName(app.submittedByUserId), followUpDue: nextFollowup.get(app.id), signal: signals?.get(app.id) });
  const active = apps.find((a) => a.id === activeId) ?? null;
  const pendingIds = reviewApplicationIds ?? new Set(apps.filter((a) => a.pendingReviews.length > 0).map((a) => a.id));
  const unmatched = unmatchedReviewMessages.filter((message) => !message.applicationId && needsBdeReview(message));
  const emailHref = (candidateId: string, messageId: string) => toHref("candidates.detail", { id: candidateId }, { tab: "inbox", message: messageId });
  const boardStatuses = PIPELINE.filter((status) => (TRACKER_STATUSES.includes(status) || apps.some((a) => a.status === status))
    && (status !== "INCOMPLETE_APPLICATION" || apps.some((app) => hasIncompleteEvidence(app, signals ? [...signals.values()] : []))));
  const targetsFor = (app: Application) => visibleApplicationStatuses(app, signals ? [...signals.values()] : []).filter((target) => target !== app.status);
  const columns: Array<{ id: string; statuses: ApplicationStatus[] }> = boardStatuses.flatMap((status) => [
    { id: status, statuses: [status] },
    ...(status === "APPLIED" ? [{ id: "BDE_REVIEW", statuses: [] }] : []),
  ]);
  columns.push(
    ...(showClosed ? [{ id: "CLOSED", statuses: CLOSED.filter((status) => !PIPELINE.includes(status)) }] : []),
  );

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canAct || !canMove) return; // nothing is draggable then; and the backend refuses a VIEWER's write anyway
    const app = apps.find((a) => a.id === String(event.active.id));
    const to = String(event.over?.id ?? "");
    if (!app || pendingIds.has(app.id) || !TRACKER_STATUSES.includes(to as ApplicationStatus) || to === app.status) return;
    const targets = targetsFor(app);
    if (!targets.includes(to as ApplicationStatus)) {
      setRefusal(targets.length ? `${STATUS_LABEL[app.status]} can move to ${targets.map((status) => STATUS_LABEL[status]).join(" or ")} in this workflow.` : `A ${STATUS_LABEL[app.status].toLowerCase()} application can't move.`);
      return;
    }
    setRefusal(null);
    onMove(app.id, to as ApplicationStatus);
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => { setActiveId(String(e.active.id)); setRefusal(null); }} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {refusal ? <p role="status" className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] px-3 py-2 text-caption text-[var(--color-warning-fg)]">{refusal}</p> : null}
      <div className="bq-board" aria-label="Application pipeline">
        {columns.map((col) => {
          const items = apps.filter((a) => col.id === "BDE_REVIEW"
            ? pendingIds.has(a.id)
            : !pendingIds.has(a.id) && col.statuses.includes(a.status));
          return (
            <BoardColumn key={col.id} id={col.id} count={items.length + (col.id === "BDE_REVIEW" ? unmatched.length : 0)}>
              {items.map((app) => (
                <BoardCard key={app.id} app={app} targets={targetsFor(app)} canDrag={col.id !== "BDE_REVIEW" && canAct && canMove && targetsFor(app).length > 0} onOpen={onOpen}
                  reviewHref={col.id === "BDE_REVIEW" && app.pendingReviews[0] ? emailHref(app.candidateId, app.pendingReviews[0].messageId) : undefined}>
                  <ApplicationCardFace {...face(app)} />
                </BoardCard>
              ))}
              {col.id === "BDE_REVIEW" ? unmatched.map((message) => (
                <Link key={message.id} href={emailHref(message.candidateId, message.id)} className="bq-card block p-3.5 transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                  aria-label={`Review unmatched email: ${message.subject}`}>
                  <span className="bq-tag mb-2"><Mail size={12} aria-hidden />Unmatched email</span>
                  <p className="text-body-strong">{message.subject}</p>
                  <p className="mt-1 text-caption text-[var(--color-text-3)]">{message.fromName || message.fromEmail}</p>
                  {candidateName ? <p className="mt-1 text-caption text-[var(--color-text-3)]">{candidateName(message.candidateId)}</p> : null}
                  <p className="mt-2 text-caption text-[var(--color-text-2)]">Open email to link an application and confirm its status.</p>
                </Link>
              )) : null}
            </BoardColumn>
          );
        })}
      </div>
      <DragOverlay>{active ? <div className="bq-card bq-board-overlay p-3.5"><ApplicationCardFace {...face(active)} /></div> : null}</DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ id, count, children }: { id: string; count: number; children: ReactNode }) {
  const isClosedColumn = id === "CLOSED";
  const isReviewColumn = id === "BDE_REVIEW";
  const { setNodeRef } = useDroppable({ id, disabled: isClosedColumn || isReviewColumn });
  const { active, over } = useDndContext();
  const from = active?.data.current?.status as ApplicationStatus | undefined;
  const targets = (active?.data.current?.targets ?? []) as ApplicationStatus[];
  const drop = over?.id !== id || !from || from === id ? undefined : targets.includes(id as ApplicationStatus) ? "valid" : "invalid";
  const status = id as ApplicationStatus;
  const Icon = isReviewColumn ? Mail : isClosedColumn ? Archive : STATUS_ICON[status];
  const label = isReviewColumn ? "BDE review" : isClosedColumn ? "Closed" : STATUS_LABEL[status];

  return (
    <section ref={setNodeRef} className="bq-board-col" data-drop={drop} aria-label={`${label}, ${count}`}>
      <div className="bq-board-head">
        <Icon size={16} strokeWidth={1.9} aria-hidden className={cn("shrink-0", isClosedColumn || isReviewColumn ? "text-[var(--color-text-3)]" : STATUS_COLOR[status])} />
        <h2 className="text-body-strong">{label}</h2>
        <span className="bq-count">{count}</span>
      </div>
      {isReviewColumn ? <p className="px-3 text-caption text-[var(--color-text-3)]">Click a card to review its email in Inbox. Application cards show the last confirmed status.</p> : null}
      <div className="bq-board-list">
        {count === 0 ? <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-caption text-[var(--color-text-3)]">Nothing here</p> : children}
      </div>
    </section>
  );
}

function BoardCard({ app, targets, canDrag, onOpen, children, reviewHref }: { app: Application; targets: ApplicationStatus[]; canDrag: boolean; onOpen?: (id: string) => void; children: ReactNode; reviewHref?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id, disabled: !canDrag, data: { status: app.status, targets } });
  if (reviewHref) return (
    <Link href={reviewHref} className="bq-card block p-3.5 transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
      aria-label={`${app.jobTitleAtApply} at ${app.companyNameAtApply}, BDE review. Open email for review.`}>
      {children}
    </Link>
  );
  return (
    <article
      ref={setNodeRef}
      className={cn("bq-card p-3.5 transition-shadow hover:shadow-[var(--shadow-md)]", canDrag ? "bq-board-card" : "cursor-pointer")}
      data-dragging={isDragging || undefined}
      // Only a card that can move carries the drag handles and "draggable" semantics: for anyone who
      // can't act (a VIEWER) the card is just a button that opens the application.
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : { role: "button" })}
      tabIndex={0}
      aria-label={`${app.jobTitleAtApply} at ${app.companyNameAtApply}, ${STATUS_LABEL[app.status]}. Enter to open${canDrag ? ", Space to move" : ""}.`}
      onClick={() => onOpen?.(app.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen?.(app.id);
        if (canDrag) listeners?.onKeyDown?.(e);
      }}
    >
      {children}
    </article>
  );
}
