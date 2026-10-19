"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BellRing, CalendarClock, CheckCircle2, CircleHelp, Mail, PhoneCall, Stamp, type LucideIcon } from "lucide-react";
import type { TagTone } from "@/components/ui/tag";
import { formatIst, formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SIGNAL_META } from "@/components/app/inbox/signal-meta";
import { STATUS_LABEL } from "@/components/app/applications/status-meta";
import { expiryStatus } from "../documents/document-meta";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";

interface Item {
  key: string;
  Icon: LucideIcon;
  tone: TagTone;
  title: string;
  detail: string;
  when?: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}

/** Enough to act on without burying the rest of the page. */
const VISIBLE = 5;

const TONE_CLASS: Record<TagTone, string> = {
  neutral: "bg-[var(--color-unverified-bg)] text-[var(--color-unverified-fg)]",
  blue: "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
  green: "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
  amber: "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]",
  red: "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]",
  violet: "bg-[var(--color-violet-bg)] text-[var(--color-violet-fg)]",
  teal: "bg-[var(--color-teal-bg)] text-[var(--color-teal-fg)]",
};

/**
 * The first thing on the page: what needs the BDE tonight, each with the action that resolves it.
 * Read-only (`canAct` false: a VIEWER, a support view): only the items' views are offered — no status
 * move, no inbox connection.
 */
export function AttentionCard({ ws, actions, canAct }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const [showAll, setShowAll] = useState(false);
  const appById = new Map(ws.applications.map((a) => [a.id, a]));
  const first = ws.candidate?.fullName.split(" ")[0] ?? "the candidate";

  const items: Item[] = [
    ...ws.upcoming.slice(0, 3).map((m): Item => {
      const app = m.applicationId ? appById.get(m.applicationId) : undefined;
      const isInterview = m.signal === "INTERVIEW_SCHEDULED";
      return {
        key: `up_${m.id}`,
        Icon: isInterview ? CalendarClock : PhoneCall,
        tone: isInterview ? "amber" : "blue",
        title: `${isInterview ? "Interview" : "Recruiter call"} with ${app?.companyNameAtApply ?? m.fromName}`,
        detail: `${app?.jobTitleAtApply ?? m.subject} · ${formatIst(m.scheduledFor!, "EEE, MMM d · h:mm a")} IST`,
        when: formatRelative(m.scheduledFor!),
        primary: { label: "Prepare", onClick: () => m.applicationId && actions.openApplication(m.applicationId) },
        secondary: { label: "Email", onClick: () => actions.openMessage(m.id) },
      };
    }),
    ...ws.suggestions.map((s): Item => {
      const app = appById.get(s.applicationId);
      const meta = SIGNAL_META[s.message.signal];
      return {
        key: `sg_${s.message.id}`,
        Icon: meta.Icon,
        tone: meta.tone,
        title: `${app?.companyNameAtApply ?? s.message.fromName}: ${meta.label.toLowerCase()}`,
        detail: `${app?.jobTitleAtApply ?? ""} · still marked ${STATUS_LABEL[app?.status ?? "APPLIED"].toLowerCase()}`,
        when: formatRelative(s.message.receivedAt),
        ...(canAct
          ? { primary: { label: `Move to ${STATUS_LABEL[s.to]}`, onClick: () => actions.applySuggestion(s) }, secondary: { label: "Email", onClick: () => actions.openMessage(s.message.id) } }
          : { primary: { label: "Email", onClick: () => actions.openMessage(s.message.id) } }),
      };
    }),
    ...ws.followups
      .filter((f) => new Date(f.snoozedUntil ?? f.dueAt).getTime() < ws.now + 86_400_000)
      .slice(0, 3)
      .map((f): Item => {
        const due = f.snoozedUntil ?? f.dueAt;
        return {
          key: `fu_${f.id}`,
          Icon: BellRing,
          tone: new Date(due).getTime() < ws.now ? "red" : "amber",
          title: `Follow up with ${f.companyName}`,
          detail: f.jobTitle,
          when: `due ${formatRelative(due)}`,
          primary: { label: "Open", onClick: () => actions.openApplication(f.applicationId) },
        };
      }),
    ...(canAct && ws.inbox && !ws.inbox.connection
      ? [{ key: "connect", Icon: Mail, tone: "blue" as const, title: `Connect ${first}'s inbox`, detail: "Recruiter replies, shortlists and interviews get tracked automatically", primary: { label: "Connect", onClick: () => actions.openTab("inbox") } }]
      : []),
    ...ws.expiringDocuments.slice(0, 2).map((d): Item => ({
      key: `doc_${d.id}`,
      Icon: Stamp,
      tone: expiryStatus(d, ws.now)?.tone === "red" ? "red" : "amber",
      title: `${d.title} ${expiryStatus(d, ws.now)?.label.toLowerCase()}`,
      detail: `Ask ${first} for the renewed copy — vendors will ask for it`,
      primary: { label: "Documents", onClick: () => actions.openTab("documents") },
    })),
    ...(ws.master && ws.master.gate.unverifiedCount > 0
      ? [{ key: "master", Icon: CircleHelp, tone: "neutral" as const, title: `${ws.master.gate.unverifiedCount} master resume ${ws.master.gate.unverifiedCount === 1 ? "claim needs" : "claims need"} evidence`, detail: "No copy can be exported until they're verified", primary: { label: "Review", onClick: actions.reviewMasterResume } }]
      : []),
  ];

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-h3 text-[var(--color-text)]">Needs your attention</h2>
        <span className="tabular text-caption text-[var(--color-text-3)]">{items.length} {items.length === 1 ? "item" : "items"}</span>
      </div>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-8 text-body text-[var(--color-text-2)]">
          <CheckCircle2 size={18} aria-hidden className="text-[var(--color-success-fg)]" />
          All caught up — nothing is waiting on you for {first}.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          <AnimatePresence initial={false}>
            {(showAll ? items : items.slice(0, VISIBLE)).map((item, i) => (
              <motion.li
                key={item.key}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: Math.min(i, 6) * 0.04, ease: EASE_OUT } }}
                exit={{ opacity: 0, x: reduce ? 0 : 24, transition: { duration: 0.2 } }}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
              >
                <span aria-hidden className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]", TONE_CLASS[item.tone])}>
                  <item.Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-strong text-[var(--color-text)]">{item.title}</p>
                  <p className="truncate text-sm text-[var(--color-text-3)]">{item.detail}{item.when ? ` · ${item.when}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.secondary ? <Button size="sm" variant="ghost" onClick={item.secondary.onClick}>{item.secondary.label}</Button> : null}
                  <Button size="sm" variant="secondary" onClick={item.primary.onClick}>{item.primary.label}</Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {items.length > VISIBLE ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="w-full border-t border-[var(--color-border)] py-2.5 text-sm font-[550] text-[var(--color-primary-subtle-fg)] hover:bg-[var(--color-surface-2)]">
          {showAll ? "Show fewer" : `Show ${items.length - VISIBLE} more`}
        </button>
      ) : null}
    </Card>
  );
}
