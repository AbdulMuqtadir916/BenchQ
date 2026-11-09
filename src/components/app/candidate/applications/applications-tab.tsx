"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Columns3, List, Send } from "lucide-react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { ReviewQueue } from "./review-queue";
import { ApplicationBoard } from "@/components/app/applications/application-board";
import { STATUS_LABEL, isClosed } from "@/components/app/applications/status-meta";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { ApplicationList } from "./application-list";
import { IrrelevantEmails, irrelevantEmails } from "./irrelevant-emails";

type View = "board" | "list";
type Scope = "active" | "review" | "irrelevant";

/** Every submission for this candidate: a board to move stages, a list to scan fast. */
export function ApplicationsTab({ ws, actions, canAct, onMove }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; onMove: (id: string, to: ApplicationStatus) => void }) {
  const [view, setView] = useState<View>("board");
  const [scope, setScope] = useState<Scope>("active");
  // Switching tabs changes the page height; keep the switch row where it was on screen instead of letting the
  // browser clamp the scroll position (which made the page jump up when a shorter tab opened).
  const switchRef = useRef<HTMLDivElement>(null);
  const switchTopBefore = useRef<number | null>(null);
  const chooseScope = (next: Scope) => {
    switchTopBefore.current = switchRef.current?.getBoundingClientRect().top ?? null;
    setScope(next);
  };
  const spacerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const before = switchTopBefore.current;
    switchTopBefore.current = null;
    const row = switchRef.current;
    const spacer = spacerRef.current;
    if (before === null || !row || !spacer) return;
    spacer.style.height = "0px";
    const scroller = scrollParent(row);
    const shift = row.getBoundingClientRect().top - before;
    if (Math.abs(shift) >= 1) scroller.scrollBy({ top: shift, behavior: "instant" });
    // A shorter tab may leave too little page below to scroll back: add only the missing height, until the next switch.
    const missing = row.getBoundingClientRect().top - before;
    if (missing >= 1) {
      spacer.style.height = `${Math.ceil(missing)}px`;
      scroller.scrollBy({ top: missing, behavior: "instant" });
    }
  }, [scope]);
  const all = ws.applications;
  // Move On is a current stage with its own board column, so a confirmed Move On card is always shown;
  // the board hides only the older closed values (Placed, Rejected, Withdrawn, Expired).
  const visible = all.filter((a) => a.status === "MOVE_ON" || !isClosed(a.status));
  const moveOnCount = all.filter((a) => a.status === "MOVE_ON").length;
  const closedCount = all.filter((a) => isClosed(a.status) && a.status !== "MOVE_ON").length;
  const irrelevantCount = irrelevantEmails(ws.messages).length;

  if (ws.applicationsQuery.error) return <ErrorState error={ws.applicationsQuery.error} onRetry={() => void ws.applicationsQuery.refetch()} />;
  if (ws.applicationsQuery.isLoading) return <SkeletonList rows={6} />;
  if (all.length === 0) {
    return <EmptyState icon={Send} title="No applications yet" description="Find matching jobs and submit — every application shows up here with its status." action={canAct ? <button type="button" onClick={actions.findJobs} className="text-sm font-[550] text-[var(--color-primary-subtle-fg)] hover:underline">Find jobs</button> : undefined} />;
  }

  const toggle = "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-sm";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-3)]">
          <span className="text-body-strong text-[var(--color-text)]">{all.length - closedCount - moveOnCount} active</span> · {moveOnCount} Move On · {closedCount} older closed · {ws.suggestions.length > 0 ? `${ws.suggestions.length} recruiter ${ws.suggestions.length === 1 ? "email suggests" : "emails suggest"} a status update` : ws.inbox?.connection ? "pipeline matches the inbox" : "inbox not connected"}
        </p>
        <div className="flex items-center gap-2">
          <div ref={switchRef} className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5" role="group" aria-label="Which applications">
            {(["active", "review", "irrelevant"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => chooseScope(s)} className={cn(toggle, scope === s ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
                {s === "active" ? "Active" : s === "review" ? `BDE review ${ws.reviewTotal}` : `Irrelevant ${irrelevantCount}`}
              </button>
            ))}
          </div>
          {scope === "active" ? <div className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5" role="group" aria-label="View">
            {([["board", "Board", Columns3], ["list", "List", List]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={cn(toggle, view === id ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
                <Icon size={14} aria-hidden />{label}
              </button>
            ))}
          </div> : null}
        </div>
      </div>

      {canAct && ws.suggestions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-violet-bg)] px-3 py-2 text-sm text-[var(--color-violet-fg)]">
          <span className="font-[550]">From the inbox:</span>
          {ws.suggestions.slice(0, 3).map((s) => {
            const app = all.find((a) => a.id === s.applicationId);
            return (
              <button key={s.message.id} type="button" onClick={() => actions.applySuggestion(s)} className="rounded-[var(--radius-full)] border border-current/30 bg-[var(--color-surface)] px-2.5 py-0.5 hover:border-current">
                {app?.companyNameAtApply} → {STATUS_LABEL[s.to]}
              </button>
            );
          })}
        </div>
      ) : null}

      {scope === "review" ? (
        <ReviewQueue ws={ws} actions={actions} />
      ) : scope === "irrelevant" ? (
        <IrrelevantEmails ws={ws} actions={actions} />
      ) : view === "board" ? (
        <ApplicationBoard showReviewColumn={false} apps={visible} saving={ws.saving} onMove={onMove} canAct={canAct} onOpen={actions.openApplication} />
      ) : (
        <ApplicationList apps={visible} onOpen={actions.openApplication} />
      )}
      <div ref={spacerRef} aria-hidden className="-mt-4" />
    </div>
  );
}

/** The nearest element that scrolls vertically (the app shell's content area), else the page itself. */
function scrollParent(el: HTMLElement): HTMLElement | Window {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return window;
}
