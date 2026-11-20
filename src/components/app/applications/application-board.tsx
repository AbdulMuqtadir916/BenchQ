"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive, Inbox } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus, StoredApplicationStatus } from "@/lib/schemas/enums";
import { useTeam } from "@/lib/hooks/use-team";
import { cn } from "@/lib/cn";
import { ApplicationCardFace } from "./application-card";
import { INCOMPLETE, PIPELINE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL, isLegacy, isSelectable } from "./status-meta";

interface ApplicationBoardProps {
  apps: Application[];
  /** Candidate email review queue, rendered in its own read-only board column. */
  reviewColumn?: ReactNode;
  reviewCount?: number;
  /** False where BDE review has its own tab (the candidate's Applications tab): the board then has no review column. */
  showReviewColumn?: boolean;
  /** Returns false when the move is refused (another move for this card is still saving). */
  onMove: (id: string, to: ApplicationStatus) => boolean | void;
  /** Cards whose move is in flight. */
  saving?: Set<string>;
  canAct: boolean;
  /** Show the candidate on each card (firm-wide board). Omit on a candidate's own page. */
  candidateName?: (candidateId: string) => string;
  onOpen?: (applicationId: string) => void;
  /** Always show the read-only "Older statuses" column (it also appears whenever a legacy value exists). */
  showClosed?: boolean;
}

/** The stages as columns. Drag a card to any stage (D1); legacy values sit in a read-only column, never hidden. */
const LEGACY_COLUMN = "LEGACY";
const REVIEW_COLUMN = "BDE_REVIEW";
const noSubscription = () => () => {};

export function ApplicationBoard({ apps, onMove, canAct, candidateName, onOpen, showClosed = false, saving, reviewColumn, reviewCount, showReviewColumn = true }: ApplicationBoardProps) {
  const teamQuery = useTeam();
  const [activeId, setActiveId] = useState<string | null>(null);
  // True only in the browser (false while server-rendering and hydrating), so the portal never mismatches.
  const isClient = useSyncExternalStore(noSubscription, () => true, () => false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Enter opens a card; Space picks it up to move with the arrow keys.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }));

  const ownerName = useMemo(() => {
    const map = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return (id: string) => map.get(id) ?? "Unassigned";
  }, [teamQuery.data]);

  const face = (app: Application) => ({ app, candidateName: candidateName?.(app.candidateId), owner: ownerName(app.submittedByUserId), isSaving: saving?.has(app.id) });
  const active = apps.find((a) => a.id === activeId) ?? null;
  const hasLegacy = apps.some((a) => isLegacy(a.status));
  const columns: Array<{ id: string; statuses: StoredApplicationStatus[] }> = [
    ...PIPELINE.flatMap((s) => [
      { id: s, statuses: [s] },
      ...(s === "APPLIED" ? [
        ...(apps.some((a) => a.status === INCOMPLETE) ? [{ id: INCOMPLETE, statuses: [INCOMPLETE] }] : []),
        ...(showReviewColumn ? [{ id: REVIEW_COLUMN, statuses: [] as StoredApplicationStatus[] }] : []),
      ] : []),
    ]),
    { id: "MOVE_ON", statuses: ["MOVE_ON"] },
    ...(showClosed || hasLegacy ? [{ id: LEGACY_COLUMN, statuses: apps.filter((a) => isLegacy(a.status)).map((a) => a.status) }] : []),
  ];

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canAct) return; // nothing is draggable then; and the backend refuses a VIEWER's write anyway
    const app = apps.find((a) => a.id === String(event.active.id));
    const to = String(event.over?.id ?? "");
    if (!app || !event.over || to === app.status) return; // dropped outside every column: nothing to do
    if (!isSelectable(to as StoredApplicationStatus)) {
      setRefusal("Older statuses are read-only. Choose a current stage instead.");
      return;
    }
    setRefusal(null);
    if (onMove(app.id, to as ApplicationStatus) === false) setRefusal("Saving… wait for the current move of this application to finish.");
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => { setActiveId(String(e.active.id)); setRefusal(null); }} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {refusal ? <p role="status" className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] px-3 py-2 text-caption text-[var(--color-warning-fg)]">{refusal}</p> : null}
      <div className="bq-board" aria-label="Application pipeline">
        {columns.map((col) => {
          if (col.id === REVIEW_COLUMN && reviewColumn) return (
            <BoardColumn key={col.id} id={col.id} count={reviewCount ?? 0} hasCustomContent>
              {reviewColumn}
            </BoardColumn>
          );
          const items = apps.filter((a) => col.id === REVIEW_COLUMN ? a.pendingReviewCount > 0 : col.statuses.includes(a.status));
          return (
            <BoardColumn key={col.id} id={col.id} count={items.length}>
              {items.map((app) => col.id === REVIEW_COLUMN ? (
                <button key={app.id} type="button" onClick={() => onOpen?.(app.id)} className="bq-card w-full p-3.5 text-left">
                  <p className="mb-2 text-caption text-[var(--color-text-3)]">Last confirmed: {STATUS_LABEL[app.status]}</p>
                  <ApplicationCardFace {...face(app)} showReviewBadge={false} />
                </button>
              ) : (
                <BoardCard key={app.id} app={app} canDrag={canAct && app.pendingReviewCount === 0} onOpen={onOpen}>
                  <ApplicationCardFace {...face(app)} />
                </BoardCard>
              ))}
            </BoardColumn>
          );
        })}
      </div>
      {/* In <body>: the app shell's backdrop-filter (.bq-frame) would otherwise anchor this fixed overlay to the shell,
          not the viewport, and the dragged card would float away from the pointer. */}
      {isClient ? createPortal(
        <DragOverlay>{active ? <div className="bq-card bq-board-overlay p-3.5"><ApplicationCardFace {...face(active)} /></div> : null}</DragOverlay>,
        document.body,
      ) : null}
    </DndContext>
  );
}

function BoardColumn({ id, count, children, hasCustomContent = false }: { id: string; count: number; children: ReactNode; hasCustomContent?: boolean }) {
  const isLegacyColumn = id === LEGACY_COLUMN;
  const isReviewColumn = id === REVIEW_COLUMN;
  const isReadOnly = isLegacyColumn || isReviewColumn;
  const { setNodeRef } = useDroppable({ id, disabled: isReadOnly });
  const { active, over } = useDndContext();
  const from = active?.data.current?.status as StoredApplicationStatus | undefined;
  const drop = over?.id !== id || !from || from === id ? undefined : isReadOnly ? "invalid" : "valid";
  const status = id as ApplicationStatus;
  const Icon = isReviewColumn ? Inbox : isLegacyColumn ? Archive : STATUS_ICON[status];
  const label = isReviewColumn ? "BDE Review" : isLegacyColumn ? "Older statuses" : STATUS_LABEL[status];

  return (
    <section ref={setNodeRef} className="bq-board-col" data-drop={drop} aria-label={`${label}, ${count}`}>
      <div className="bq-board-head">
        <Icon size={16} strokeWidth={1.9} aria-hidden className={cn("shrink-0", isReviewColumn ? "text-[var(--color-violet-fg)]" : isLegacyColumn ? "text-[var(--color-text-3)]" : STATUS_COLOR[status])} />
        <h2 className="text-body-strong">{label}</h2>
        <span className="bq-count">{count}</span>
      </div>
      {isReviewColumn ? <p className="px-3 text-caption text-[var(--color-text-3)]">Applications keep their last confirmed status until review.</p> : null}
      <div className="bq-board-list">
        {count === 0 && !hasCustomContent ? <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-caption text-[var(--color-text-3)]">Nothing here</p> : children}
      </div>
    </section>
  );
}

function BoardCard({ app, canDrag, onOpen, children }: { app: Application; canDrag: boolean; onOpen?: (id: string) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id, disabled: !canDrag, data: { status: app.status } });
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
