"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, Mail, X, XCircle } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { formatIst, formatRelative } from "@/lib/format/timezone";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { mailSignalMeta } from "@/components/app/inbox/signal-meta";
import { NEXT_STATUS, STATUS_LABEL, STATUS_TONE, isClosed, stageRank } from "@/components/app/applications/status-meta";
import { ResumeSent } from "@/components/app/applications/resume-sent";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { useHref } from "@/lib/routes/use-href";

const STEPS: ApplicationStatus[] = ["APPLIED", "RESPONSE", "SCREENING", "INTERVIEW", "OFFER", "PLACED"];

interface DrawerProps {
  ws: CandidateWorkspace;
  applicationId: string | null;
  canAct: boolean;
  actions: CandidateActions;
  onMove: (id: string, to: ApplicationStatus) => void;
  onClose: () => void;
}

/** Side sheet for one submission. Esc closes and focus returns to where it came from. */
export function ApplicationDrawer({ ws, applicationId, canAct, actions, onMove, onClose }: DrawerProps) {
  const reduce = useReducedMotion() ?? false;
  const app = ws.applications.find((a) => a.id === applicationId) ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const openId = app?.id;

  useEffect(() => {
    if (!openId) return;
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    };
  }, [openId, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {app ? (
        <motion.div key="drawer" className="fixed inset-0 z-50 flex justify-end" initial="closed" animate="open" exit="closed">
          <motion.div className="absolute inset-0 bg-[var(--color-overlay)]" variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }} onClick={onClose} aria-hidden />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${app.jobTitleAtApply} at ${app.companyNameAtApply}`}
            variants={{ open: { x: 0 }, closed: { x: reduce ? 0 : "100%" } }}
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
            className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
          >
            <DrawerBody app={app} ws={ws} canAct={canAct} actions={actions} onMove={onMove} closeRef={closeRef} onClose={onClose} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function DrawerBody({ app, ws, canAct, actions, onMove, closeRef, onClose }: { app: Application; ws: CandidateWorkspace; canAct: boolean; actions: CandidateActions; onMove: (id: string, to: ApplicationStatus) => void; closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const toHref = useHref();
  const emails = ws.messages.filter((m) => m.applicationId === app.id);
  const suggestion = ws.suggestions.find((s) => s.applicationId === app.id);
  const next = NEXT_STATUS[app.status];
  const rank = stageRank(app.status);
  const reachedAt = (s: ApplicationStatus) => app.events.find((e) => e.toStatus === s)?.createdAt;
  const closedAt = isClosed(app.status) ? app.events.at(-1)?.createdAt : undefined;

  return (
    <>
      <header className="flex items-start gap-3 border-b border-[var(--color-border)] p-4">
        <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-h3 text-[var(--color-text-2)]">{app.companyNameAtApply.charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h3 text-[var(--color-text)]">{app.jobTitleAtApply}</h2>
          <p className="text-sm text-[var(--color-text-3)]">{app.companyNameAtApply}{app.appliedAt ? ` · applied ${formatRelative(app.appliedAt)}` : ""}</p>
          <Tag tone={STATUS_TONE[app.status]} className="mt-2">{STATUS_LABEL[app.status]}</Tag>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="bq-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]"><X size={15} aria-hidden /></button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {suggestion && canAct ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-violet-bg)] p-3">
            <p className="text-sm text-[var(--color-violet-fg)]"><span className="font-[550]">{mailSignalMeta(suggestion.message.signal).label}</span> — email from {suggestion.message.fromName} {formatRelative(suggestion.message.receivedAt)}.</p>
            <Button size="sm" className="mt-2" onClick={() => actions.applySuggestion(suggestion)}>Move to {STATUS_LABEL[suggestion.to]}</Button>
          </div>
        ) : null}

        <section aria-label="Progress">
          <h3 className="mb-2 text-label text-[var(--color-text-3)]">Progress</h3>
          <ol className="relative space-y-3 pl-1">
            {STEPS.map((s, i) => {
              const isDone = !isClosed(app.status) ? stageRank(s) < rank || (s === app.status && s === "PLACED") : !!reachedAt(s);
              const isCurrent = s === app.status;
              const at = reachedAt(s);
              return (
                <li key={s} className="relative flex items-center gap-3">
                  {i < STEPS.length - 1 ? <span aria-hidden className={cn("absolute left-[0.6875rem] top-6 h-3 w-px", isDone ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]")} /> : null}
                  <span aria-hidden className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-full)] border", isDone ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : isCurrent ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]" : "border-[var(--color-border-strong)]")}>
                    {isDone ? <Check size={12} /> : isCurrent ? <span className="h-2 w-2 rounded-[var(--radius-full)] bg-[var(--color-primary)]" /> : null}
                  </span>
                  <span className={cn("flex-1 text-sm", isCurrent ? "font-[550] text-[var(--color-text)]" : isDone ? "text-[var(--color-text-2)]" : "text-[var(--color-text-3)]")}>{STATUS_LABEL[s]}</span>
                  {at ? <span className="text-caption text-[var(--color-text-3)]">{formatIst(at, "MMM d")}</span> : null}
                </li>
              );
            })}
          </ol>
          {closedAt ? <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--color-danger-fg)]"><XCircle size={14} aria-hidden />{STATUS_LABEL[app.status]} {formatRelative(closedAt)}</p> : null}
          {canAct && next ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestion?.to === next ? null : <Button size="sm" variant="secondary" onClick={() => onMove(app.id, next)}>Move to {STATUS_LABEL[next]} <ArrowRight size={13} aria-hidden /></Button>}
              {app.status !== "SAVED" ? <Button size="sm" variant="ghost" onClick={() => onMove(app.id, "REJECTED")}>Mark not selected</Button> : null}
            </div>
          ) : null}
        </section>

        <section aria-label="Resume sent">
          <h3 className="mb-2 text-label text-[var(--color-text-3)]">Resume sent</h3>
          <ResumeSent application={app} resumes={ws.resumesQuery.data ?? []} isLoading={ws.resumesQuery.isLoading} />
        </section>

        <section aria-label="Emails">
          <h3 className="mb-2 text-label text-[var(--color-text-3)]">Recruiter emails ({emails.length})</h3>
          {emails.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-text-3)]">{ws.inbox?.connection ? "No emails matched to this application yet." : "Connect the inbox to match recruiter emails here."}</p>
          ) : (
            <ul className="space-y-1.5">
              {emails.map((m) => {
                const meta = mailSignalMeta(m.signal);
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => actions.openMessage(m.id)} className="flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5 text-left hover:bg-[var(--color-surface-2)]">
                      <Mail size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-3)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--color-text)]">{m.subject}</span>
                        <span className="block text-caption text-[var(--color-text-3)]">{m.fromName} · {formatRelative(m.receivedAt)}</span>
                      </span>
                      <Tag tone={meta.tone} className="shrink-0">{meta.label}</Tag>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-[var(--color-border)] p-3">
        <Link href={toHref("applications.detail", { id: app.id })} className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
          Open full application <ArrowUpRight size={13} aria-hidden />
        </Link>
      </footer>
    </>
  );
}
