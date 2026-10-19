"use client";

import { useState } from "react";
import { Columns3, List, Send } from "lucide-react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { ApplicationBoard } from "@/components/app/applications/application-board";
import { STATUS_LABEL, isClosed } from "@/components/app/applications/status-meta";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { ApplicationList } from "./application-list";

type View = "board" | "list";
type Scope = "active" | "all";

/** Every submission for this candidate: a board to move stages, a list to scan fast. */
export function ApplicationsTab({ ws, actions, canAct, onMove }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; onMove: (id: string, to: ApplicationStatus) => void }) {
  const [view, setView] = useState<View>("board");
  const [scope, setScope] = useState<Scope>("active");
  const all = ws.applications;
  const visible = scope === "active" ? all.filter((a) => !isClosed(a.status)) : all;
  const closedCount = all.filter((a) => isClosed(a.status)).length;

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
          <span className="text-body-strong text-[var(--color-text)]">{all.length - closedCount} active</span> · {closedCount} closed · {ws.suggestions.length > 0 ? `${ws.suggestions.length} recruiter ${ws.suggestions.length === 1 ? "email suggests" : "emails suggest"} a status update` : ws.inbox?.connection ? "pipeline matches the inbox" : "inbox not connected"}
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

      {view === "board" ? (
        <ApplicationBoard apps={visible} onMove={onMove} canAct={canAct} signals={ws.signals} onOpen={actions.openApplication} showClosed={scope === "all"} />
      ) : (
        <ApplicationList apps={visible} signals={ws.signals} onOpen={actions.openApplication} />
      )}
    </div>
  );
}
