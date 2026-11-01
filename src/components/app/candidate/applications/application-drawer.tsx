"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Clock3, X } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { formatRelative } from "@/lib/format/timezone";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/tag";
import { TRACKER_STATUSES, STATUS_LABEL, STATUS_TONE, isClosed, visibleApplicationStatuses } from "@/components/app/applications/status-meta";
import { ApplicationProgress } from "@/components/app/applications/application-progress";
import { ResumeSent } from "@/components/app/applications/resume-sent";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import { useHref } from "@/lib/routes/use-href";



interface DrawerProps {
  ws: CandidateWorkspace;
  applicationId: string | null;
  canAct: boolean;
  onMove: (id: string, to: ApplicationStatus) => void;
  onClose: () => void;
}

/** Side sheet for one submission. Esc closes and focus returns to where it came from. */
export function ApplicationDrawer({ ws, applicationId, canAct, onMove, onClose }: DrawerProps) {
  const reduce = useReducedMotion() ?? false;
  const app = ws.applications.find((a) => a.id === applicationId) ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openId = app?.id;

  useEffect(() => {
    if (!openId) return;
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) closeRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocus);
      returnTo?.focus?.();
    };
  }, [openId, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {app ? (
        <motion.div key="drawer" className="fixed inset-0 z-50 flex justify-end" initial="closed" animate="open" exit="closed">
          <motion.div className="absolute inset-0 bg-[var(--color-overlay)]" variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }} onClick={onClose} aria-hidden />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${app.jobTitleAtApply} at ${app.companyNameAtApply}`}
            variants={{ open: { x: 0 }, closed: { x: reduce ? 0 : "100%" } }}
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
            className="relative flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
          >
            <DrawerBody messages={ws.messages} app={app} resumes={ws.resumesQuery.data ?? []} resumesLoading={ws.resumesQuery.isLoading} canAct={canAct} onMove={onMove} closeRef={closeRef} onClose={onClose} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function DrawerBody({ app, messages, resumes, resumesLoading, canAct, onMove, closeRef, onClose }: { app: Application; messages: CandidateWorkspace["messages"]; resumes: NonNullable<CandidateWorkspace["resumesQuery"]["data"]>; resumesLoading: boolean; canAct: boolean; onMove: (id: string, to: ApplicationStatus) => void; closeRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const toHref = useHref();
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
        <section aria-label="Current application status" className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
          <h3 className="mb-3 text-label text-[var(--color-text-3)]">Current status</h3>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-full)]", isClosed(app.status) ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]" : "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]")}>
                <Clock3 size={15} />
              </span>
              <span className="min-w-0">
                <span className="block font-[550] text-[var(--color-text)]">{STATUS_LABEL[app.status]}</span>
                <span className="block text-caption text-[var(--color-text-3)]">{app.appliedAt ? `Applied ${formatRelative(app.appliedAt)}` : "Application not submitted"}</span>
              </span>
            </div>
            <Tag tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Tag>
          </div>
          {app.pendingReviews.length ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-fg)]">BDE review pending. The current status stays {STATUS_LABEL[app.status]} until a BDE confirms a change.</p> : null}
          {canAct && !app.pendingReviews.length ? (
            <label className="mt-3 block text-sm">Change status
              <select aria-label="Change application status" className="bq-input mt-1 w-full" value={app.status}
                onChange={(event) => {
                  const status = event.target.value as ApplicationStatus;
                  onMove(app.id, status);
                }}>
                {!TRACKER_STATUSES.includes(app.status) ? <option value={app.status}>{STATUS_LABEL[app.status]}</option> : null}
                {visibleApplicationStatuses(app, messages).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <ApplicationProgress application={app} messages={messages} />

        <section aria-label="Resume sent" className="space-y-2">
          <h3 className="text-label text-[var(--color-text-3)]">Resume used</h3>
          <ResumeSent application={app} resumes={resumes} isLoading={resumesLoading} />
        </section>

        {app.notes ? <section aria-label="Application notes" className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"><h3 className="mb-2 text-label text-[var(--color-text-3)]">Notes</h3><p className="text-sm text-[var(--color-text-2)]">{app.notes}</p></section> : null}
      </div>

      <footer className="border-t border-[var(--color-border)] p-3">
        <Link href={toHref("applications.detail", { id: app.id })} className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
          Open full application <ArrowUpRight size={13} aria-hidden />
        </Link>
      </footer>
    </>
  );
}
