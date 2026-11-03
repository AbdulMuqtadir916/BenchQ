"use client";

import { useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { History, Mail, Zap, type LucideIcon } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { cn } from "@/lib/cn";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { EmptyState } from "@/components/app/empty-state";
import { mailSignalMeta } from "@/components/app/inbox/signal-meta";
import { STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "@/components/app/applications/status-meta";

type Kind = "all" | "status" | "email";
interface Entry { id: string; at: string; kind: "status" | "email"; Icon: LucideIcon; iconClass: string; title: string; detail: string; by: string | null; applicationId: string | null }

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, MMM d");
};

/** Everything that happened for this candidate, newest first, grouped by day — the audit view. */
export function ActivityTab({ applications, messages, teamName, onOpenApplication }: { applications: Application[]; messages: InboxMessage[]; teamName: (id: string | null) => string | null; onOpenApplication: (id: string) => void }) {
  const [kind, setKind] = useState<Kind>("all");

  const entries = useMemo<Entry[]>(() => {
    const byId = new Map(applications.map((a) => [a.id, a]));
    const status: Entry[] = applications.flatMap((a) => a.events.map((e) => ({
      id: e.id, at: e.createdAt, kind: "status" as const, Icon: STATUS_ICON[e.toStatus], iconClass: STATUS_COLOR[e.toStatus],
      title: e.fromStatus ? `Moved to ${STATUS_LABEL[e.toStatus]}` : `${STATUS_LABEL[e.toStatus]}`,
      detail: `${a.jobTitleAtApply} · ${a.companyNameAtApply}${e.note ? ` — ${e.note}` : ""}`,
      by: e.isAutomated ? "Automated" : teamName(e.actorUserId), applicationId: a.id,
    })));
    const email: Entry[] = messages.map((m) => {
      const app = m.applicationId ? byId.get(m.applicationId) : undefined;
      return { id: m.id, at: m.receivedAt, kind: "email" as const, Icon: Mail, iconClass: "text-[var(--color-info-fg)]", title: `Email: ${mailSignalMeta(m.signal).label}`, detail: `${m.fromName}${app ? ` · ${app.jobTitleAtApply} at ${app.companyNameAtApply}` : ""}`, by: null, applicationId: m.applicationId };
    });
    return [...status, ...email].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [applications, messages, teamName]);

  const visible = kind === "all" ? entries : entries.filter((e) => e.kind === kind);
  const groups = visible.reduce<Array<{ day: string; items: Entry[] }>>((acc, e) => {
    const day = dayLabel(e.at);
    const last = acc.at(-1);
    if (last?.day === day) last.items.push(e);
    else acc.push({ day, items: [e] });
    return acc;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
        {([["all", "Everything", History], ["status", "Status changes", Zap], ["email", "Emails", Mail]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-full)] border px-3 text-sm", kind === id ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] font-[550] text-[var(--color-primary-subtle-fg)]" : "border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]")}>
            <Icon size={13} aria-hidden />{label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState variant={entries.length ? "filtered" : "first-run"} icon={History} title="No activity yet" description={entries.length ? "Nothing of this type — try Everything." : "Applications and recruiter emails appear here as they happen."} />
      ) : (
        <div className="bq-card p-0">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h3 className="sticky top-[calc(var(--topbar-height)+3.25rem)] z-10 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-1.5 text-label text-[var(--color-text-3)]">{g.day}</h3>
              <ol className="relative px-4 py-2">
                <span aria-hidden className="absolute bottom-3 left-[1.9375rem] top-3 w-px bg-[var(--color-border)]" />
                {g.items.map((e) => (
                  <li key={e.id}>
                    <button type="button" disabled={!e.applicationId} onClick={() => e.applicationId && onOpenApplication(e.applicationId)} className="relative flex w-full items-start gap-3 rounded-[var(--radius-md)] px-1 py-2 text-left enabled:hover:bg-[var(--color-surface-2)] disabled:cursor-default">
                      <span aria-hidden className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface)]"><e.Icon size={13} className={e.iconClass} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-[550] text-[var(--color-text)]">{e.title}</span>
                        <span className="block truncate text-sm text-[var(--color-text-3)]">{e.detail}</span>
                      </span>
                      <span className="shrink-0 text-right text-caption text-[var(--color-text-3)]">
                        <DualTimestamp iso={e.at} format="relative" />
                        {e.by ? <span className="block">{e.by}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
