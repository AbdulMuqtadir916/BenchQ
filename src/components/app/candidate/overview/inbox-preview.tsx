"use client";

import { ArrowRight, Mail } from "lucide-react";
import type { CandidateInbox } from "@/lib/schemas/inbox";
import { formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { SIGNAL_META } from "@/components/app/inbox/signal-meta";

/**
 * The latest recruiter emails, or the prompt to connect the mailbox. Connecting is a write
 * (`candidate.edit`): a read-only reader (a VIEWER, a support view) sees that the inbox isn't connected,
 * with no Connect.
 */
export function InboxPreview({ inbox, isLoading, firstName, canAct, onOpenMessage, onOpenInbox }: { inbox: CandidateInbox | null; isLoading: boolean; firstName: string; canAct: boolean; onOpenMessage: (id: string) => void; onOpenInbox: () => void }) {
  const latest = (inbox?.messages ?? []).filter((m) => m.signal !== "CONFIRMATION").slice(0, 4);

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-h3 text-[var(--color-text)]">Latest from recruiters</h2>
        {inbox?.connection ? (
          <button type="button" onClick={onOpenInbox} className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
            Open inbox <ArrowRight size={13} aria-hidden />
          </button>
        ) : null}
      </div>
      {isLoading ? (
        <div role="status" aria-label="Loading emails" className="space-y-3 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
      ) : !inbox?.connection ? (
        <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
          <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]"><Mail size={18} /></span>
          {canAct ? (
            <>
              <p className="flex-1 text-sm text-[var(--color-text-2)]">Connect {firstName}&apos;s Google account to see shortlists, recruiter calls and interview invites here as they arrive.</p>
              <Button size="sm" onClick={onOpenInbox}>Connect</Button>
            </>
          ) : (
            <p className="flex-1 text-sm text-[var(--color-text-2)]">{firstName}&apos;s inbox isn&apos;t connected. A recruiter on this candidate can connect it.</p>
          )}
        </div>
      ) : latest.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-text-3)]">No recruiter emails yet. New ones appear here after each sync.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {latest.map((m) => {
            const meta = m.signal ? SIGNAL_META[m.signal] : { label: "Unclassified email", tone: "neutral" as const, Icon: Mail };
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onOpenMessage(m.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-surface-2)]">
                  <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-[var(--radius-full)]", m.isRead ? "bg-transparent" : "bg-[var(--color-primary)]")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm text-[var(--color-text)]", !m.isRead && "font-[550]")}>{m.subject}</p>
                    <p className="truncate text-caption text-[var(--color-text-3)]">{m.fromName} · {formatRelative(m.receivedAt)}</p>
                  </div>
                  <Tag tone={meta.tone} className="shrink-0"><meta.Icon size={11} aria-hidden />{meta.label}</Tag>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
