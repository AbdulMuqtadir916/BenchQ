import { useCallback, useEffect, useRef, useState } from "react";
import { getRunningTailorings, getTailoring, isSessionExpired, startTailoring, type TailoringRun } from "../api";

/** Tailoring the candidate's résumé for the connected job, through the website's own tailoring routes
 * (backend/api/routes_resume_tailoring.py): start one, follow its steps while it runs (about a minute), and say when its
 * résumé is ready or why it failed. One for this job started on the website, or before the panel opened, is followed too. */

/** A run's steps in order (backend/resume_tailor), named as the website names them (src/components/app/tailoring). */
export const TAILORING_STEPS = ["analyse", "draft", "review", "revise", "verify", "save"] as const;
const STEP_LABELS: Record<(typeof TAILORING_STEPS)[number], string> = {
  analyse: "Reading the job",
  draft: "Writing the draft",
  review: "Reviewing the draft",
  revise: "Revising",
  verify: "Checking against the resume",
  save: "Saving the resume",
};

export const stepLabel = (step: string | null) => STEP_LABELS[step as keyof typeof STEP_LABELS] ?? "Getting started";
export const stepIndex = (step: string | null) => Math.max(0, TAILORING_STEPS.indexOf(step as (typeof TAILORING_STEPS)[number]));

/** How often a running tailoring is read again: the website's 3 s (decided 2026-11-12, part 3 R2-Q4). */
export const TAILORING_POLL_MS = 3000;

export type Tailoring =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running"; runId: string; step: string | null; startedAt: number }
  | { status: "completed"; resumeId: string }
  | { status: "failed"; message: string; canRetry: boolean };

const IDLE: Tailoring = { status: "idle" };

/** Why a run failed, in one sentence, and whether Try again can help: the website's reasons (tailoring/messages.ts). */
export function runFailure(code: string | null): { message: string; canRetry: boolean } {
  if (code === "gone") return { message: "The resume or the job was removed in BenchQ.", canRetry: false };
  if (code === "hidden") return { message: "The base resume is hidden in BenchQ. Show it again, then tailor.", canRetry: false };
  if (code === "setup") return { message: "Tailoring isn't set up yet. Tell your admin.", canRetry: false };
  return { message: "Tailoring didn't finish. Try again.", canRetry: true };
}

/** Why a start was refused, in words the BDE can act on: BenchQ's own reason when it gives one (the same résumé and
 * job already tailoring, no active base, five running), else what the answer means. */
export function startRefusal(error: unknown): { message: string; canRetry: boolean } {
  const status = (error as { status?: number }).status ?? 0;
  const said = error instanceof Error ? error.message : "";
  if (status === 422) return { message: "This job has no description in BenchQ to tailor the resume to.", canRetry: false };
  if (status === 404) return { message: "BenchQ couldn't find this job or resume for the candidate. Reload jobs, then try again.", canRetry: false };
  if (status >= 500) return { message: "Tailoring isn't set up yet, or BenchQ had a problem. Try again, or tell your admin.", canRetry: true };
  return { message: said || "Tailoring didn't start. Try again.", canRetry: status === 0 || status === 429 };
}

const runningFrom = (run: TailoringRun, startedAt = Date.now()): Tailoring =>
  ({ status: "running", runId: run.run_id, step: run.step ?? null, startedAt: run.started_at ? Date.parse(run.started_at) || startedAt : startedAt });

type Options = {
  firmId: string | null;
  candidateId: string;
  /** The connected job, as BenchQ holds it for the candidate (`job_postings.id`); null while it isn't known. */
  jobId: string | null;
  onSessionExpired: () => void;
  /** A tailoring finished: its résumé, which the list doesn't hold yet. */
  onTailored: (resumeId: string) => void;
};

export function useTailoring({ firmId, candidateId, jobId, onSessionExpired, onTailored }: Options) {
  const context = firmId && jobId ? `${firmId}:${candidateId}:${jobId}` : null;
  const [state, setState] = useState<{ context: string | null; tailoring: Tailoring }>({ context: null, tailoring: IDLE });
  // Looks for a run of this job again: on opening, and when a start is refused because one already runs.
  const [lookups, setLookups] = useState(0);
  const tailoring = state.context === context ? state.tailoring : IDLE;
  const latest = useRef({ onTailored, onSessionExpired });
  useEffect(() => { latest.current = { onTailored, onSessionExpired }; });

  // One already running for this job (started on the website, or before the panel opened) is followed here.
  useEffect(() => {
    if (!firmId || !jobId || !context) return;
    let isCurrent = true;
    getRunningTailorings(firmId, candidateId).then((runs) => {
      const run = runs.find((one) => one.job_posting_id === jobId && one.status === "running");
      if (!isCurrent || !run) return;
      setState((now) => (now.context === context && (now.tailoring.status === "running" || now.tailoring.status === "starting")
        ? now : { context, tailoring: runningFrom(run) }));
    }, (error: unknown) => {
      if (isCurrent && isSessionExpired(error)) latest.current.onSessionExpired();
    });
    return () => { isCurrent = false; };
  }, [firmId, candidateId, jobId, context, lookups]);

  // A running one is read again every TAILORING_POLL_MS until it finishes. A read that fails is tried again.
  const runId = tailoring.status === "running" ? tailoring.runId : null;
  useEffect(() => {
    if (!firmId || !runId || !context) return;
    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Tailoring) => setState((now) => (now.context === context ? { context, tailoring: next } : now));
    const read = () => {
      getTailoring(firmId, candidateId, runId).then((run) => {
        if (!isCurrent) return;
        if (run.status === "completed" && run.resume_id) {
          settle({ status: "completed", resumeId: run.resume_id });
          latest.current.onTailored(run.resume_id);
        } else if (run.status === "running") {
          setState((now) => (now.context === context && now.tailoring.status === "running" && now.tailoring.runId === runId
            ? { context, tailoring: { ...now.tailoring, step: run.step ?? null } } : now));
          timer = setTimeout(read, TAILORING_POLL_MS);
        } else settle({ status: "failed", ...runFailure(run.error_code) });
      }, (error: unknown) => {
        if (!isCurrent) return;
        if (isSessionExpired(error)) latest.current.onSessionExpired();
        else if ((error as { status?: number }).status === 404) settle({ status: "failed", message: "BenchQ no longer has this tailoring.", canRetry: true });
        else timer = setTimeout(read, TAILORING_POLL_MS);
      });
    };
    timer = setTimeout(read, TAILORING_POLL_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [firmId, candidateId, runId, context]);

  /** Tailor `resumeId` (a base's version 1) for the job; none: the active base's. */
  const start = useCallback((resumeId: string | null) => {
    if (!firmId || !jobId || !context) return;
    setState({ context, tailoring: { status: "starting" } });
    const startedAt = Date.now();
    startTailoring(firmId, candidateId, jobId, resumeId).then(({ run_id }) => {
      setState((now) => (now.context === context ? { context, tailoring: { status: "running", runId: run_id, step: null, startedAt } } : now));
    }, (error: unknown) => {
      if (isSessionExpired(error)) {
        setState((now) => (now.context === context ? { context, tailoring: IDLE } : now));
        latest.current.onSessionExpired();
        return;
      }
      setState((now) => (now.context === context ? { context, tailoring: { status: "failed", ...startRefusal(error) } } : now));
      // The same résumé and job are tailoring already (409): follow that one instead.
      if ((error as { status?: number }).status === 409) setLookups((count) => count + 1);
    });
  }, [firmId, candidateId, jobId, context]);

  const dismiss = useCallback(() => setState({ context, tailoring: IDLE }), [context]);
  return { tailoring, start, dismiss };
}
