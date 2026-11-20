"use client";

import { Mail, MailX } from "lucide-react";
import type { InboxMessage } from "@/lib/schemas/inbox";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { formatRelative } from "@/lib/format/timezone";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";

/** Emails the classifier marked as not about a job (category `other`), newest first. */
export function irrelevantEmails(messages: InboxMessage[]): InboxMessage[] {
  return messages
    .filter((m) => m.classificationState === "DONE" && m.classificationCategory === "other")
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/**
 * The Irrelevant tab: emails classified as not about a job. They are shown, not hidden, and erased 30 days after
 * classification once retention is switched on. Each row opens the exact email in the Inbox.
 */
export function IrrelevantEmails({ ws, actions }: { ws: CandidateWorkspace; actions: CandidateActions }) {
  const query = ws.inboxQuery;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <SkeletonList rows={4} />;
  if (!ws.inbox?.connection) {
    return <EmptyState icon={MailX} title="Inbox not connected" description="Connect the candidate's Gmail in the Inbox tab; emails that aren't about a job will be listed here." />;
  }
  const emails = irrelevantEmails(ws.messages);
  if (emails.length === 0) {
    return <EmptyState icon={MailX} title="No irrelevant emails" description="Emails the classifier marks as not about a job (newsletters, notifications) show up here." />;
  }
  return (
    <section aria-label={`Irrelevant emails, ${emails.length}`}>
      <ul className="grid gap-2 md:grid-cols-2">
        {emails.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => actions.openMessage(m.id)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:bg-[var(--color-surface-2)]">
              <span className="flex items-center gap-1.5 text-caption text-[var(--color-text-3)]"><MailX size={12} aria-hidden />Irrelevant</span>
              <span className="mt-0.5 block truncate text-body-strong text-[var(--color-text)]">{m.subject || "(no subject)"}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-caption text-[var(--color-text-3)]">
                <Mail size={12} aria-hidden />{m.fromName || "Unknown sender"} · {formatRelative(m.receivedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
