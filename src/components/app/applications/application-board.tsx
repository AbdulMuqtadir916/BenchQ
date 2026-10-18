"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDndContext, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { useFollowups } from "@/lib/hooks/use-applications";
import { useTeam } from "@/lib/hooks/use-team";
import { cn } from "@/lib/cn";
import { ApplicationCardFace } from "./application-card";
import { CLOSED, NEXT_STATUS, PIPELINE, STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "./status-meta";

interface ApplicationBoardProps {
  apps: Application[];
  onMove: (id: string, to: ApplicationStatus) => void;
  canAct: boolean;
  /** Show the candidate on each card (firm-wide board). Omit on a candidate's own page. */
  candidateName?: (candidateId: string) => string;
  /** Latest recruiter email per application, shown on the card. */
  signals?: Map<string, InboxMessage>;
  onOpen?: (applicationId: string) => void;
  /** Add a read-only "Closed" column for rejected / withdrawn / expired. */
  showClosed?: boolean;
}

/** The pipeline as columns. Drag a card one stage forward; anything else snaps back with the reason. */
export function ApplicationBoard({ apps, onMove, canAct, candidateName, signals, onOpen, showClosed = false }: ApplicationBoardProps) {
  const teamQuery = useTeam();
  const followupsQuery = useFollowups();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Enter opens a card; Space picks it up to move with the arrow keys.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }));

  const ownerName = useMemo(() => {
    const map = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return (id: string) => map.get(id) ?? "Unassigned";
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
  const columns: Array<{ id: string; statuses: ApplicationStatus[] }> = [
    ...PIPELINE.map((s) => ({ id: s, statuses: [s] })),
    ...(showClosed ? [{ id: "CLOSED", statuses: CLOSED }] : []),
  ];

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canAct) return; // nothing is draggable then; and the backend refuses a VIEWER's write anyway
    const app = apps.find((a) => a.id === String(event.active.id));
    const to = String(event.over?.id ?? "");
    if (!app || !PIPELINE.includes(to as ApplicationStatus) || to === app.status) return;
    const next = NEXT_STATUS[app.status];
    if (next !== to) {
      setRefusal(next ? `${STATUS_LABEL[app.status]} can only move to ${STATUS_LABEL[next]}.` : `A ${STATUS_LABEL[app.status].toLowerCase()} application can't move.`);
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
          const items = apps.filter((a) => col.statuses.includes(a.status));
          return (
            <BoardColumn key={col.id} id={col.id} count={items.length}>
              {items.map((app) => (
                <BoardCard key={app.id} app={app} canDrag={canAct && !!NEXT_STATUS[app.status]} onOpen={onOpen}>
                  <ApplicationCardFace {...face(app)} />
                </BoardCard>
              ))}
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
  const { setNodeRef } = useDroppable({ id, disabled: isClosedColumn });
  const { active, over } = useDndContext();
  const from = active?.data.current?.status as ApplicationStatus | undefined;
  const drop = over?.id !== id || !from || from === id ? undefined : NEXT_STATUS[from] === id ? "valid" : "invalid";
  const status = id as ApplicationStatus;
  const Icon = isClosedColumn ? Archive : STATUS_ICON[status];
  const label = isClosedColumn ? "Closed" : STATUS_LABEL[status];

  return (
    <section ref={setNodeRef} className="bq-board-col" data-drop={drop} aria-label={`${label}, ${count}`}>
      <div className="bq-board-head">
        <Icon size={16} strokeWidth={1.9} aria-hidden className={cn("shrink-0", isClosedColumn ? "text-[var(--color-text-3)]" : STATUS_COLOR[status])} />
        <h2 className="text-body-strong">{label}</h2>
        <span className="bq-count">{count}</span>
      </div>
      <div className="bq-board-list">
        {count === 0 ? <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-caption text-[var(--color-text-3)]">Nothing here</p> : children}
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
