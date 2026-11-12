"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/stores/session-store";
import { can } from "@/lib/auth/policy";
import { Mail, RefreshCw } from "lucide-react";
import { EmailCategory, type InboxMessage, type MailSignal } from "@/lib/schemas/inbox";
import { useInboxBody, useMarkRead, useSyncMailbox } from "@/lib/hooks/use-inbox";
import { formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { CATEGORY_META, mailSignalMeta } from "@/components/app/inbox/signal-meta";
import { NeedsReviewBadge } from "@/components/app/inbox/needs-review-badge";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { InboxConnect } from "./inbox-connect";
import { InboxReader } from "./inbox-reader";
import { MailboxConfirmation } from "./mailbox-confirmation";
import { InboxContentDialog } from "./inbox-content-dialog";
import { DisconnectMailboxDialog } from "./disconnect-mailbox-dialog";

/** All, then one filter per email category (docs/02 §2.1), labelled like the email badges. */
const InboxFilter = z.enum(["ALL", ...EmailCategory.options]).catch("ALL");
type Filter = z.infer<typeof InboxFilter>;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "ALL", label: "All" },
  ...EmailCategory.options.map((category) => ({ id: category, label: CATEGORY_META[category].label })),
];
/** Mock mail carries a signal instead of a category; the same filters apply to it. */
const SIGNAL_CATEGORY: Record<MailSignal, EmailCategory> = {
  SHORTLISTED: "shortlisted", CALL_REQUEST: "screening_call", INTERVIEW_SCHEDULED: "interview_scheduled",
  ASSESSMENT: "assessment", OFFER: "offer", REJECTED: "move_on", CONFIRMATION: "applied",
};

/** The candidate's recruiter mail, matched to applications. Connect first if it isn't. */
export function InboxTab({ ws, actions, canAct, selectedId, onSelect }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const params = useSearchParams();
  const filter = InboxFilter.parse(params.get("inbox_filter") ?? "ALL");
  const setFilter = (value: Filter) => {
    const url = new URL(window.location.href);
    if (value === "ALL") url.searchParams.delete("inbox_filter");
    else url.searchParams.set("inbox_filter", value);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const candidate = ws.candidate!;
  const attempt = params.get("mailbox_confirmation");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const more = ws.inboxQuery;
  const principal = useSession(s => s.principal);
  const canDelete = !!principal && can(principal, "candidate.assign");
  const [callbackMessage, setCallbackMessage] = useState(() => {
    const result = params.get("mailbox");
    return !result ? null : result === "connected" ? "Google account connected." : "Google connection was not completed. Try again.";
  });
  useEffect(() => {
    const result = params.get("mailbox");
    if (!result) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("mailbox");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [params]);
  const markRead = useMarkRead(candidate.id);
  const sync = useSyncMailbox(candidate.id);
  const connected = ws.inbox?.connection?.status === "CONNECTED";
  const pendingIds = new Set(ws.suggestions.map((s) => s.message.id));
  const reviewIds = new Set(ws.reviews.map((r) => r.messageId));
  // Live mail carries the classifier's category; mock mail carries a signal (PR 4).
  const categoryOf = (m: InboxMessage): EmailCategory | null => m.classificationCategory ?? (m.signal ? SIGNAL_CATEGORY[m.signal] : null);
  const inFilter = (f: Filter, m: InboxMessage) => f === "ALL" || categoryOf(m) === f;
  const filtered = ws.messages.filter((m) => inFilter(filter, m));
  const count = (f: Filter) => ws.messages.filter((m) => inFilter(f, m)).length;
  const selectedSummary = ws.messages.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const body = useInboxBody(candidate.id, attempt ? null : selectedId ?? selectedSummary?.id ?? null);
  const selected = body.data ?? selectedSummary;
  const list = body.data && selectedId && !ws.messages.some(m => m.id === selectedId) && inFilter(filter, body.data)
    ? [...filtered, body.data] : filtered;

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
      if (!attempt && canAct && openId && isUnread) markAsRead(openId);
    }
  }, [attempt, canAct, openId, isUnread, markAsRead, resetRead]);

  if (ws.inboxQuery.error && !ws.inboxQuery.data) return <ErrorState error={ws.inboxQuery.error} onRetry={() => void ws.inboxQuery.refetch()} />;
  if (ws.inboxQuery.isLoading) return <SkeletonList rows={6} />;
  if (attempt) return <MailboxConfirmation candidate={candidate} attempt={attempt} onClose={cleanupPending => {
    const url = new URL(window.location.href); url.searchParams.delete("mailbox_confirmation");
    window.history.replaceState(null, "", url.pathname + url.search);
    if (cleanupPending) setCallbackMessage("Connection cancelled. Google cleanup is pending and will retry. You can remove BenchQ access in your Google account permissions.");
  }} />;
  if (!connected && ws.messages.length === 0) {
    return canAct ? (
      <>
        {callbackMessage ? <p role="status">{callbackMessage}</p> : null}
        {ws.inbox?.connection?.status === "ERROR" ? <><p role="alert">Reconnect required: Google access expired.</p><Button variant="secondary" onClick={() => setConfirmDisconnect(true)}>Disconnect</Button></> : null}
        {ws.inbox?.connection?.lastSyncError ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{ws.inbox.connection.lastSyncError}</p> : null}
        <InboxConnect candidate={candidate} />
        {/* The Disconnect button above opens this; the main screen below is never reached here (Abdul's review on #127). */}
        {confirmDisconnect ? <DisconnectMailboxDialog candidateId={candidate.id} candidateName={candidate.fullName}
          onClose={() => setConfirmDisconnect(false)} /> : null}
      </>
    ) : (
      <EmptyState icon={Mail} title={ws.inbox?.connection?.status === "ERROR" ? "Reconnect required" : "Inbox not connected"} description="A recruiter on this candidate can connect their Google account." />
    );
  }

  return (
    <div className="space-y-3">
      {callbackMessage ? <p role="status">{callbackMessage}</p> : null}
      {["QUEUED", "IMPORTING"].includes(ws.inbox?.connection?.syncState ?? "") ? <p role="status">Importing emails… You can continue using BenchQ.</p> : null}
      {ws.inbox?.hiddenCount ? (
        <p className="text-caption text-[var(--color-text-3)]">
          {ws.inbox.hiddenCount} {ws.inbox.hiddenCount === 1 ? "email was" : "emails were"} hidden as not about a job (newsletters, notifications). They are kept encrypted for 30 days and are never deleted from Gmail. When the inbox was connected, BenchQ imported the last 3 days of mail.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-3)]">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"><Mail size={13} /></span>
          {connected ? <><span className="text-body-strong text-[var(--color-text)]">{ws.inbox?.connection?.address}</span> · synced {ws.inbox?.connection?.lastSyncedAt ? formatRelative(ws.inbox.connection.lastSyncedAt) : "not yet"}</> : ws.inbox?.connection?.status === "ERROR" ? "Reconnect required · imported email retained" : "Mailbox disconnected · imported email retained"}
        </p>
        <div className="flex items-center gap-1.5">
          {connected && canAct ? <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw size={13} aria-hidden className={sync.isPending ? "animate-spin" : undefined} />Sync now
          </Button> : null}
          {ws.inbox?.connection && ws.inbox.connection.status !== "DISCONNECTED" && canAct ? <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>Disconnect</Button> : null}
        </div>
      </div>

      {!connected && canAct ? <InboxConnect candidate={candidate} compact /> : null}
      {ws.inbox?.connection?.lastSyncError ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{ws.inbox.connection.lastSyncError}</p> : null}
      {sync.error ? <ErrorState error={sync.error} onRetry={() => sync.mutate()} /> : null}
      {markRead.error && selected ? <ErrorState error={markRead.error} onRetry={() => markRead.mutate(selected.id)} /> : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter emails">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-full)] border px-3 text-sm transition-colors", filter === f.id ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] font-[550] text-[var(--color-primary-subtle-fg)]" : "border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]")}>
            {f.label}<span className="tabular text-caption opacity-70">{count(f.id)}</span>
          </button>
        ))}
      </div>

      <div className="bq-card grid overflow-hidden p-0 lg:h-[calc(100dvh-22rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <ul className="max-h-[26rem] divide-y divide-[var(--color-border)] overflow-y-auto border-b border-[var(--color-border)] lg:max-h-none lg:border-b-0 lg:border-r" aria-label="Emails">
          {list.length === 0 ? <li className="px-4 py-8 text-center text-sm text-[var(--color-text-3)]">No emails in this view.</li> : null}
          {list.map((m, i) => {
            const meta = mailSignalMeta(m.signal, m.classificationState, m.classificationCategory, m.classificationError);
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
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {meta.isBadge ? <span data-tone={meta.tone} className="bq-tag"><meta.Icon size={11} aria-hidden />{meta.label}</span> : null}
                      {reviewIds.has(m.id) ? <NeedsReviewBadge /> : null}
                      {pendingIds.has(m.id) ? <span className="text-caption font-[550] text-[var(--color-violet-fg)]">Update suggested</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-h-[24rem] min-w-0">
          {body.error ? <ErrorState error={body.error} onRetry={() => void body.refetch()} /> : null}
          <InboxReader
            message={selected}
            application={ws.applications.find((a) => a.id === selected?.applicationId)}
            suggestion={ws.suggestions.find((s) => s.message.id === selected?.id)}
            canAct={canAct}
            actions={actions}
            review={ws.reviews.find((r) => r.messageId === selected?.id)}
            isBodyLoading={body.isLoading}
            applications={ws.applications}
          />
        </div>
      </div>
      {more.hasNextPage ? <Button variant="secondary" disabled={more.isFetchingNextPage} onClick={() => void more.fetchNextPage().then(result => {
        if (!result.isError) {const url = new URL(window.location.href); url.searchParams.set("inbox_pages", String(more.loadedPageCount + 1)); window.history.replaceState(null, "", url.pathname + url.search);}
      })}>Load more</Button> : ws.messages.length ? <p className="text-sm text-[var(--color-text-3)]">All stored emails loaded.</p> : null}
      {more.isFetchNextPageError ? <ErrorState error={more.error} onRetry={() => void more.fetchNextPage()} /> : null}
      {canDelete && (ws.inbox?.totalCount ?? ws.messages.length) > 0 ? <details className="bq-card p-4">
        <summary className="cursor-pointer text-sm text-[var(--color-text)]">Email storage controls</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => setDeleteTarget("all")}>Delete retained emails</Button>
          {selected ? <Button variant="secondary" onClick={() => setDeleteTarget(selected.id)}>Delete selected email</Button> : null}
        </div>
      </details> : null}
      {confirmDisconnect ? <DisconnectMailboxDialog candidateId={candidate.id} candidateName={candidate.fullName}
        onClose={() => setConfirmDisconnect(false)} /> : null}
      {deleteTarget ? <InboxContentDialog candidateId={candidate.id} candidateName={candidate.fullName}
        count={deleteTarget === "all" ? ws.inbox?.totalCount ?? ws.messages.length : 1}
        messageId={deleteTarget === "all" ? undefined : deleteTarget} onDeleted={onSelect} onClose={() => setDeleteTarget(null)} /> : null}
    </div>
  );
}
