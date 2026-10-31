"use client";

import { useState } from "react";
import { Columns3, List, Send } from "lucide-react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { ApplicationBoard } from "@/components/app/applications/application-board";
import { isClosed } from "@/components/app/applications/status-meta";
import { needsBdeReview } from "@/components/app/inbox/signal-meta";
import { useUnmatchedInboxReviews } from "@/lib/hooks/use-inbox";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { ApplicationList } from "./application-list";

type View = "board" | "list";
type Scope = "active" | "all";

/** Every submission for this candidate: a board to move stages, a list to scan fast. */
export function ApplicationsTab({ ws, actions, canAct, onMove }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; onMove: (id: string, to: ApplicationStatus) => void }) {
  const [view, setView] = useState<View>("board");
  const [scope, setScope] = useState<Scope>("active");
  const reviewsQuery = useUnmatchedInboxReviews();
  const all = ws.applications;
  const visible = scope === "active" ? all.filter((a) => a.pendingReviews.length > 0 || !isClosed(a.status)) : all;
  const closedCount = all.filter((a) => isClosed(a.status)).length;
  const unmatched = (reviewsQuery.data ?? []).filter((message) => message.candidateId === ws.candidate?.id
    && !message.applicationId && needsBdeReview(message));
  const reviewCount = all.filter((app) => app.pendingReviews.length > 0).length + unmatched.length;
  const loadError = ws.applicationsQuery.error ?? reviewsQuery.error;

  if (loadError) return <ErrorState error={loadError} onRetry={() => { void ws.applicationsQuery.refetch(); void reviewsQuery.refetch(); }} />;
  if (ws.applicationsQuery.isLoading || reviewsQuery.isLoading) return <SkeletonList rows={6} />;
  if (all.length === 0 && unmatched.length === 0) {
    return <EmptyState icon={Send} title="No applications yet" description="Find matching jobs and submit — every application shows up here with its status." action={canAct ? <button type="button" onClick={actions.findJobs} className="text-sm font-[550] text-[var(--color-primary-subtle-fg)] hover:underline">Find jobs</button> : undefined} />;
  }

  const toggle = "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-sm";
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-3)]">Move applications to their current status. Every manual change is saved with its actor and timestamp.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-3)]">
          <span className="text-body-strong text-[var(--color-text)]">{all.length - closedCount} active</span> · {closedCount} closed · {reviewCount > 0 ? `${reviewCount} need BDE review` : ws.inbox?.connection ? "pipeline matches the inbox" : "inbox not connected"}
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5" role="group" aria-label="Which applications">
            {(["active", "all"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={cn(toggle, scope === s ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
                {s === "active" ? "Active" : "All"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5" role="group" aria-label="View">
            {([["board", "Board", Columns3], ["list", "List", List]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={cn(toggle, view === id ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
                <Icon size={14} aria-hidden />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "board" ? (
        <ApplicationBoard
          apps={visible}
          unmatchedReviewMessages={unmatched}
          onMove={onMove}
          canAct={canAct}
          canMove
          signals={ws.signals}
          onOpen={actions.openApplication}
          showClosed={scope === "all"}
        />
      ) : (
        <ApplicationList apps={visible} signals={ws.signals} onOpen={(id) => {
          const review = all.find((app) => app.id === id)?.pendingReviews[0];
          if (review) actions.openMessage(review.messageId);
          else actions.openApplication(id);
        }} />
      )}
    </div>
  );
}
