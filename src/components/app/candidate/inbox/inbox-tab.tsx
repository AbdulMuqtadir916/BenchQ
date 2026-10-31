"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import type { InboxMessage, MailSignal } from "@/lib/schemas/inbox";
import { useDisconnectMailbox, useMarkRead, useSyncMailbox } from "@/lib/hooks/use-inbox";
import { formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { needsBdeReview, SIGNAL_META } from "@/components/app/inbox/signal-meta";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { InboxConnect } from "./inbox-connect";
import { InboxReader } from "./inbox-reader";

type Filter = "ALL" | "REVIEW" | MailSignal;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "REVIEW", label: "Needs BDE review" },
  { id: "INTERVIEW_SCHEDULED", label: "Interviews" },
  { id: "SHORTLISTED", label: "Shortlisted" },
  { id: "CALL_REQUEST", label: "Calls" },
  { id: "OFFER", label: "Offers" },
  { id: "REJECTED", label: "Not selected" },
];

/** The candidate's recruiter mail, matched to applications. Connect first if it isn't. */
export function InboxTab({ ws, actions, canAct, selectedId, onSelect }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const candidate = ws.candidate!;
  const markRead = useMarkRead(candidate.id);
  const disconnect = useDisconnectMailbox(candidate.id);
  const sync = useSyncMailbox(candidate.id);
  const connected = ws.inbox?.connection?.status === "CONNECTED";
  const pendingReviewIds = new Set(ws.applications.flatMap((application) =>
    application.pendingReviews.map((review) => review.messageId)));
  const reviewIds = new Set(ws.messages
    .filter((message) => needsBdeReview(message, pendingReviewIds.has(message.id)))
    .map((message) => message.id));
  const inFilter = (f: Filter, m: InboxMessage) =>
    f === "ALL" || (f === "REVIEW" ? reviewIds.has(m.id)
      : m.signal === f || (f === "SHORTLISTED" && m.signal === "ASSESSMENT")
        || (f === "CALL_REQUEST" && m.signal === "SCREENING_CALL")
        || (f === "REJECTED" && m.signal === "MOVE_ON"));
  const list = ws.messages.filter((m) => inFilter(filter, m));
  const count = (f: Filter) => ws.messages.filter((m) => inFilter(f, m)).length;
  const selected = selectedId && (ws.inboxQuery.isLoadingSelection || ws.inboxQuery.selectionError)
    ? null : selectedId ? ws.messages.find((m) => m.id === selectedId) ?? null : list[0] ?? null;

  // An email counts as read once it's open in the reader — for someone who works the inbox. A read-only
  // reader (a VIEWER, a support view) leaves the firm's unread state as it is.
  const openId = selected?.id;
  const isUnread = !!selected && !selected.isRead;
  const { mutate: markAsRead, reset: resetRead } = markRead;
  const readAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (readAttempt.current !== openId) {
      readAttempt.current = openId ?? null;
      resetRead();
      if (canAct && openId && isUnread) markAsRead(openId);
    }
  }, [canAct, openId, isUnread, markAsRead, resetRead]);

  if (ws.inboxQuery.error) return <ErrorState error={ws.inboxQuery.error} onRetry={() => void ws.inboxQuery.refetch()} />;
  if (ws.inboxQuery.isLoading) return <SkeletonList rows={6} />;
  if (!connected && ws.messages.length === 0) {
    return canAct ? (
      <InboxConnect candidate={candidate} />
    ) : (
      <EmptyState icon={Mail} title="Inbox not connected" description="A recruiter on this candidate can connect their Google account." />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-3)]">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"><Mail size={13} /></span>
          {connected ? <><span className="text-body-strong text-[var(--color-text)]">{ws.inbox?.connection?.address}</span> · synced {ws.inbox?.connection?.lastSyncedAt ? formatRelative(ws.inbox.connection.lastSyncedAt) : "not yet"}</>
            : <>Mailbox disconnected · imported email is retained</>}
        </p>
        <div className="flex items-center gap-1.5">
          {connected && canAct ? <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw size={13} aria-hidden className={sync.isPending ? "animate-spin" : undefined} />Sync now
          </Button>
            : canAct ? <InboxConnect candidate={candidate} compact /> : null}
          {connected && canAct ? <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()}>Disconnect</Button> : null}
        </div>
      </div>
      {connected && sync.error ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{sync.error.message}</p> : null}
      {disconnect.error ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{disconnect.error.message}</p> : null}
      {markRead.error ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">Couldn’t mark this email read. <button type="button" className="underline" disabled={markRead.isPending} onClick={() => { if (openId) markAsRead(openId); }}>Retry</button></p> : null}
      {connected && ws.inbox?.connection?.lastSyncError ? <p role="status" className="text-sm text-[var(--color-warning-fg)]">The last sync failed. Try again or reconnect the candidate account.</p> : null}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter emails">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-full)] border px-3 text-sm transition-colors", filter === f.id ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] font-[550] text-[var(--color-primary-subtle-fg)]" : "border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]")}>
            {f.label}<span className="tabular text-caption">{count(f.id)}</span>
          </button>
        ))}
      </div>

      {selected && !list.some((message) => message.id === selected.id) ? <p role="status" className="text-sm text-[var(--color-text-2)]">The selected email is outside this filter. <button type="button" className="underline" onClick={() => setFilter("ALL")}>Show all emails</button></p> : null}

      <div className="bq-card grid overflow-hidden p-0 lg:h-[calc(100dvh-22rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <ul className="max-h-[26rem] divide-y divide-[var(--color-border)] overflow-y-auto border-b border-[var(--color-border)] lg:max-h-none lg:border-b-0 lg:border-r" aria-label="Emails">
          {list.length === 0 ? <li className="px-4 py-8 text-center text-sm text-[var(--color-text-3)]">No emails in this view.</li> : null}
          {list.map((m, i) => {
            const meta = m.signal ? SIGNAL_META[m.signal] : { label: "Unclassified email", tone: "neutral" as const, Icon: Mail };
            const isSelected = selected?.id === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={isSelected || undefined}
                  onClick={() => onSelect(m.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    e.preventDefault();
                    const next = list[i + (e.key === "ArrowDown" ? 1 : -1)];
                    if (next) { onSelect(next.id); requestAnimationFrame(() => document.getElementById(`mail-${next.id}`)?.focus()); }
                  }}
                  id={`mail-${m.id}`}
                  className={cn("flex w-full gap-2.5 px-4 py-3 text-left transition-colors", isSelected ? "bg-[var(--color-primary-subtle)]" : "hover:bg-[var(--color-surface-2)]")}
                >
                  <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[var(--radius-full)]", m.isRead ? "bg-transparent" : "bg-[var(--color-primary)]")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm text-[var(--color-text)]", !m.isRead && "font-[550]")}>{m.fromName}</span>
                      <span className={cn("shrink-0 text-caption", isSelected ? "text-[var(--color-text-2)]" : "text-[var(--color-text-3)]")}>{formatRelative(m.receivedAt)}</span>
                    </span>
                    <span className="block truncate text-sm text-[var(--color-text-2)]">{m.subject}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="inline-flex rounded-[var(--radius-sm)] bg-[var(--color-surface)]"><span data-tone={meta.tone} className="bq-tag"><meta.Icon size={11} aria-hidden />{meta.label}</span></span>
                      {reviewIds.has(m.id) ? <span className="text-caption font-[550] text-[var(--color-warning-fg)]">Needs BDE review</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-h-[24rem] min-w-0">
          {ws.inboxQuery.isLoadingSelection ? <div role="status" className="p-4">Loading selected email…</div>
            : ws.inboxQuery.selectionError ? <ErrorState error={ws.inboxQuery.selectionError} onRetry={() => void ws.inboxQuery.retrySelection()} />
            : <InboxReader
            message={selected}
            application={ws.applications.find((a) => a.id === selected?.applicationId)}
            applications={ws.applications}
            suggestion={ws.suggestions.find((s) => s.message.id === selected?.id)}
            canAct={canAct}
            actions={actions}
          />}
        </div>
      </div>
    </div>
  );
}
