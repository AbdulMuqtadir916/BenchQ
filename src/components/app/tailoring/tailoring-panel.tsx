"use client";

import Link from "next/link";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, LoaderCircle, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { TAILORING_STEPS, type TailoringRun } from "@/lib/schemas/tailoring";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useMyTailorings, useStartTailoring } from "@/lib/hooks/use-tailoring";
import { useHref } from "@/lib/routes/use-href";
import { AgentRunPanel } from "@/components/app/ai";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { STEP_LABELS, runFailure, startRefusal } from "./messages";
import { readStored, writeStored } from "./stored";

const Dismissed = z.array(z.string()).catch([]);
const Folded = z.boolean().catch(false);

const STAGES = TAILORING_STEPS.map((step) => STEP_LABELS[step]);
const DISMISSED_KEY = "benchq:tailoring:dismissed";
const HIDDEN_KEY = "benchq:tailoring:hidden";

/** Seconds since `iso` (or between two times), for a row's timer. */
function seconds(fromIso: string | null, toMs: number): number {
  return fromIso ? Math.max(0, Math.round((toMs - new Date(fromIso).getTime()) / 1000)) : 0;
}
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

/**
 * The BDE's tailorings on every page of the firm (decided 2026-11-12, part 3 R2-Q2, R2-Q3, R3-Q2): each running one
 * with its real step and a timer (the open one as the staged panel), each finished one with Open or its reason and
 * Try again, for 30 minutes or until dismissed (× is remembered in this browser). Hide folds it to a pill; the
 * tailorings go on. Nothing shows for someone with no tailorings.
 */
export function TailoringPanel() {
  const principal = useSignedInPrincipal();
  // A support view (a platform admin) never tailors; firm users read their own runs (an owner's list is empty).
  return principal.kind === "firm" ? <Panel /> : null;
}

function Panel() {
  const toHref = useHref();
  const reduce = useReducedMotion() ?? false;
  const runsQuery = useMyTailorings();
  const candidatesQuery = useCandidates();
  const retry = useStartTailoring();
  // Each failed row's own retry: in progress, or why it was refused (Abdul's review, 2026-11-12: the row kept the old
  // reason when Try again was refused, e.g. with five running).
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryRefusals, setRetryRefusals] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<string[]>(() => readStored(DISMISSED_KEY, Dismissed));
  const [isHidden, setHidden] = useState<boolean>(() => readStored(HIDDEN_KEY, Folded));
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const runs = useMemo(() => (runsQuery.data ?? []).filter((run) => !dismissed.includes(run.runId)), [runsQuery.data, dismissed]);
  const running = runs.filter((run) => run.status === "running");
  const isTicking = running.length > 0;
  useEffect(() => {
    if (!isTicking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isTicking]);

  if (runs.length === 0) return null;
  const names = new Map((candidatesQuery.data ?? []).map((c) => [c.id, c.fullName]));
  const open = runs.find((run) => run.runId === openId && run.status === "running") ?? running[0] ?? null;
  const ready = runs.filter((run) => run.status === "completed").length;
  const rest = runs.filter((run) => run !== open);

  function dismiss(runId: string) {
    const next = [...dismissed, runId].slice(-100);
    setDismissed(next);
    writeStored(DISMISSED_KEY, next);
  }
  function hide(next: boolean) {
    setHidden(next);
    writeStored(HIDDEN_KEY, next);
  }

  const summary = [running.length ? `${running.length} tailoring` : null, ready ? `${ready} ready` : null].filter(Boolean).join(" · ") || "Tailorings";

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex justify-end sm:inset-x-auto sm:right-4">
      <AnimatePresence mode="wait" initial={false}>
        {isHidden ? (
          <motion.div key="pill" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE_OUT }} className="pointer-events-auto">
            <Button variant="secondary" size="sm" onClick={() => hide(false)} aria-label={`Show tailorings: ${summary}`} className="shadow-[var(--shadow-lg)]">
              {running.length ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}{summary}
            </Button>
          </motion.div>
        ) : (
          <motion.section key="panel" aria-label="Tailorings" initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22, ease: EASE_OUT }}
            className="pointer-events-auto w-full space-y-2 sm:w-80">
            <div className="flex items-center justify-between rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
              <span className="text-sm font-[550] text-[var(--color-text)]" aria-live="polite">{summary}</span>
              <Button variant="ghost" size="sm" onClick={() => hide(true)} aria-label="Hide tailorings"><ChevronDown size={14} aria-hidden />Hide</Button>
            </div>
            {open ? (
              <AgentRunPanel className="shadow-[var(--shadow-lg)]" title={open.jobTitle || "Tailoring"}
                stages={STAGES} activeStage={open.step ? TAILORING_STEPS.indexOf(open.step) : 0} status="running"
                elapsedMs={seconds(open.startedAt, now) * 1000} />
            ) : null}
            {rest.length ? <ul className="max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)]">
              {rest.map((run) => (
                <Row key={run.runId} run={run} name={names.get(run.candidateId) ?? null} now={now}
                  onOpenSteps={() => setOpenId(run.runId)}
                  openHref={run.resumeId ? toHref("resumes.studio", { id: run.resumeId }) : null}
                  onRetry={() => {
                    setRetrying(run.runId);
                    setRetryRefusals((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== run.runId)));
                    retry.mutateAsync({ candidateId: run.candidateId, jobId: run.jobId ?? "", resumeId: run.sourceResumeId ?? undefined }).then(
                      () => dismiss(run.runId),
                      (error: unknown) => setRetryRefusals((all) => ({ ...all, [run.runId]: startRefusal(error).message })),
                    ).finally(() => setRetrying((current) => (current === run.runId ? null : current)));
                  }}
                  retryRefusal={retryRefusals[run.runId] ?? null}
                  isRetrying={retrying === run.runId} onDismiss={() => dismiss(run.runId)} />
              ))}
            </ul> : null}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One tailoring in the panel (exported for its test). */
export function Row({ run, name, now, openHref, onOpenSteps, onRetry, retryRefusal, isRetrying, onDismiss }: {
  run: TailoringRun; name: string | null; now: number; openHref: string | null; onOpenSteps: () => void;
  onRetry: () => void; retryRefusal: string | null; isRetrying: boolean; onDismiss: () => void;
}) {
  const failure = run.status === "failed" ? runFailure(run.errorCode) : null;
  const title = <span className="block truncate text-sm text-[var(--color-text)]">{run.jobTitle || "A job"}</span>;
  const who = name ? <span className="block truncate text-caption text-[var(--color-text-3)]">{name}</span> : null;
  return (
    <li className="flex items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5">
      <span className={cn("mt-0.5 shrink-0", failure ? "text-[var(--color-danger-fg)]" : run.status === "completed" ? "text-[var(--color-success-fg)]" : "text-[var(--color-text-3)]")} aria-hidden>
        {failure ? <TriangleAlert size={15} /> : run.status === "completed" ? <Check size={15} /> : <LoaderCircle size={15} className="animate-spin" />}
      </span>
      <div className="min-w-0 flex-1">
        {run.status === "running" ? (
          <button type="button" onClick={onOpenSteps} className="block w-full text-left" aria-label={`Show the steps for ${run.jobTitle || "this job"}`}>{title}{who}</button>
        ) : <>{title}{who}</>}
        <span className="block text-caption text-[var(--color-text-2)]">
          {run.status === "running"
            ? <>{run.step ? STEP_LABELS[run.step] : "Waiting to start"} · <span className="tabular">{clock(seconds(run.startedAt, now))}</span></>
            : failure ? failure.message : "Tailored résumé ready."}
        </span>
        {retryRefusal ? <span role="alert" className="block text-caption text-[var(--color-danger-fg)]">{`Not started again: ${retryRefusal}`}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {openHref ? <Button asChild size="sm" variant="secondary"><Link href={openHref}>Open</Link></Button> : null}
        {failure?.canRetry && run.jobId ? (
          <Button size="sm" variant="secondary" onClick={onRetry} disabled={isRetrying}><RotateCcw size={13} aria-hidden />Try again</Button>
        ) : null}
        {run.status !== "running" ? (
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label={`Dismiss ${run.jobTitle || "this tailoring"}`}><X size={14} aria-hidden /></Button>
        ) : null}
      </div>
    </li>
  );
}
