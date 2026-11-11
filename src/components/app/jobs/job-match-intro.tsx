"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { Check, LoaderCircle, SkipForward } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import { deriveMatchScore, isJobForCandidate } from "@/lib/derive";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkAuthChip } from "@/components/app/work-auth-chip";
import { CandidateAvatar } from "@/components/app/candidate-avatar";

interface JobMatchIntroProps {
  candidate: Candidate | null;
  jobs: Job[];
  applications: Application[];
  /** Data has loaded — the sequence only starts once there is something real to count. */
  isReady: boolean;
  /** A real search is running (docs/02 §6.z): the last step holds, "Searching…", until it ends. */
  isSearching?: boolean;
  onDone: () => void;
}

/** Every figure is derived from the loaded jobs — the same filters the explorer applies. */
function useMatchStats(candidate: Candidate | null, jobs: Job[], applications: Application[]) {
  return useMemo(() => {
    const active = jobs.filter((j) => j.isActive && j.dedupe.duplicateOfJobId === null);
    if (!candidate) return { active: active.length, eligible: 0, strong: 0, best: null as null | { score: number; job: Job } };
    const applied = new Set(applications.filter((a) => a.candidateId === candidate.id).map((a) => a.jobId));
    const eligible = active.filter((j) => isJobForCandidate(j, candidate) && !applied.has(j.id));
    const scored = eligible.map((job) => ({ job, score: deriveMatchScore(candidate, job) }));
    const best = scored.reduce<null | { score: number; job: Job }>((top, s) => (!top || s.score > top.score ? s : top), null);
    return { active: active.length, eligible: eligible.length, strong: scored.filter((s) => s.score >= 70).length, best };
  }, [candidate, jobs, applications]);
}

function CountUp({ to, duration }: { to: number; duration: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, to, { duration, ease: EASE_OUT, onUpdate: (v) => setValue(Math.round(v)) });
    return () => controls.stop();
  }, [to, duration]);
  return <span className="tabular">{value}</span>;
}

/**
 * "Find jobs" from a candidate: a short, skippable matching sequence before the
 * ranked list — read the profile, filter by work authorization, score, rank.
 */
export function JobMatchIntro({ candidate, jobs, applications, isReady, isSearching = false, onDone }: JobMatchIntroProps) {
  const reduce = useReducedMotion() ?? false;
  const stats = useMatchStats(candidate, jobs, applications);
  const [stage, setStage] = useState(0);
  const step = reduce ? 0.15 : 0.75;
  const isRunning = isReady && candidate !== null;

  useEffect(() => {
    if (!isRunning) return;
    const timers = [1, 2, 3].map((n) => setTimeout(() => setStage(n), step * 1000 * n));
    return () => timers.forEach(clearTimeout);
  }, [isRunning, step]);

  // The last step finishes once no search is running: at once without one, when it ends with one.
  useEffect(() => {
    if (!isRunning || stage < 3 || isSearching) return;
    const timers = [setTimeout(() => setStage(4), step * 1000), setTimeout(onDone, step * 1000 + (reduce ? 100 : 650))];
    return () => timers.forEach(clearTimeout);
  }, [isRunning, stage, isSearching, step, reduce, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const first = candidate?.fullName.split(" ")[0] ?? "the candidate";
  const stages = [
    { label: `Reading ${first}'s profile`, done: `Read ${first}'s profile`, detail: candidate ? [candidate.primaryRole, ...candidate.targetRoles].filter(Boolean).slice(0, 4).join(" · ") : "" },
    { label: "Checking work authorization", done: "Filtered by work authorization", detail: <><CountUp to={stats.eligible} duration={step} /> of {stats.active} open roles accept this visa</> },
    { label: `Scoring ${stats.eligible} roles against the profile`, done: `Scored ${stats.eligible} roles`, detail: <><CountUp to={stats.strong} duration={step} /> strong matches (70+)</> },
    { label: isSearching ? "Searching for new jobs…" : "Ranking the best matches", done: "Ranked the best matches", detail: stats.best ? `Top match ${stats.best.score} — ${stats.best.job.title} at ${stats.best.job.company.name}` : "No eligible roles right now" },
  ];

  return (
    <div className="bq-card relative mx-auto flex max-w-xl flex-col items-center overflow-hidden px-6 py-10 text-center sm:px-10">
      <div className="relative mb-5 flex h-20 w-20 items-center justify-center" aria-hidden>
        {!reduce && stage < 4
          ? [0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute inset-0 rounded-[var(--radius-full)] border border-[var(--color-primary)]"
                initial={{ scale: 0.8, opacity: 0.6 }}
                animate={{ scale: 2.1, opacity: 0 }}
                transition={{ duration: 2.1, delay: i * 0.7, repeat: Infinity, ease: "easeOut" }}
              />
            ))
          : null}
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="relative inline-flex h-16 w-16 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-surface-3)] text-[var(--color-text-3)]"
        >
          {candidate ? <CandidateAvatar name={candidate.fullName} colorKey={candidate.id} size="xl" /> : <LoaderCircle size={22} className="animate-spin" />}
        </motion.span>
      </div>

      {candidate ? (
        <>
          <h2 className="text-h2 text-[var(--color-text)]">Finding roles for {candidate.fullName}</h2>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-body text-[var(--color-text-3)]">
            <span>{[candidate.primaryRole, [candidate.city, candidate.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
            <WorkAuthChip workAuth={candidate.workAuth} />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2" role="status" aria-label="Loading candidate">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
      )}

      <ol className="mt-7 w-full space-y-2.5 text-left" aria-live="polite">
        {stages.map((s, i) => {
          const isDone = stage > i;
          const isActive = isRunning && stage === i;
          return (
            <motion.li
              key={s.done}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: isDone || isActive ? 1 : 0.45, y: 0 }}
              transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.06, ease: EASE_OUT }}
              className={cn("flex gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors", isActive ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]" : "border-[var(--color-border)]")}
            >
              <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-full)]", isDone ? "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]" : "text-[var(--color-text-3)]")} aria-hidden>
                {isDone ? <Check size={12} /> : isActive ? <LoaderCircle size={14} className="animate-spin text-[var(--color-primary)]" /> : <span className="h-1.5 w-1.5 rounded-[var(--radius-full)] bg-[var(--color-border-strong)]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-strong text-[var(--color-text)]">{isDone ? s.done : s.label}</span>
                {isDone ? <span className="block truncate text-sm text-[var(--color-text-3)]">{s.detail}</span> : null}
                {isActive && i === 2 ? (
                  <span className="mt-2 block h-1 overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-3)]">
                    <motion.span className="block h-full rounded-[var(--radius-full)] bg-[var(--color-primary)]" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: step, ease: "linear" }} />
                  </span>
                ) : null}
              </span>
            </motion.li>
          );
        })}
      </ol>

      <Button variant="ghost" size="sm" className="mt-5" onClick={onDone}>
        Skip to results
        <SkipForward size={13} aria-hidden />
      </Button>
    </div>
  );
}
