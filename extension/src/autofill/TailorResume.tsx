import { useEffect, useId, useState } from "react";
import { ALERT, button, ICON_BUTTON_QUIET, MOTION, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { CHECK, CROSS_ICON, EXTERNAL_ICON, SPARKLES_ICON, SPINNER_ICON } from "./icons";
import { stepIndex, stepLabel, TAILORING_STEPS, type Tailoring } from "./use-tailoring";

type TailorResumeProps = {
  tailoring: Tailoring;
  /** The base Tailor reads, as the list names it ("Base 2 · Active"); null when the candidate has none to tailor. */
  from: string | null;
  /** The job it's tailored for, as "Role at Company", for the screen's description. */
  forJob: string;
  /** That base has a résumé tailored for this job already: Tailor makes its next version, as on the website. */
  isAgain: boolean;
  /** The finished résumé is in the list (the list is read again when one finishes), and whether it's the one in use. */
  isReadyListed: boolean;
  isInUse: boolean;
  /** The finished résumé in the website's studio, when the panel can link there. */
  studioUrl: string | null;
  /** A fill is running: picking another résumé waits until it ends. */
  isBusy: boolean;
  /** The list couldn't be read again once it finished: Reload resumes reads it again. */
  refreshFailed: boolean;
  onStart: () => void;
  onUse: () => void;
  onDismiss: () => void;
  /** Back to the Autofill view while a tailoring carries on. */
  onBack: () => void;
  onReload: () => void;
};

const SPIN = "[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none";
/** The mark at the top of a screen: a soft round tile. */
const HALO = "grid size-14 place-items-center rounded-full [&_svg]:size-6";
const RING = 2 * Math.PI * 34;
/** A step of a running tailoring, small: its mark, then its name. */
const STEP_ROW = {
  done: "flex items-center gap-2 text-sm text-[var(--color-text-2)]",
  now: "flex items-center gap-2 text-sm font-[600] text-[var(--color-text)]",
  next: "flex items-center gap-2 text-sm text-[var(--color-text-3)]",
} as const;
const STEP_MARK = "grid size-4 flex-none place-items-center [&_svg]:size-[var(--icon-sm)]";
/** The tab's foot: its one action, fixed under the screen (the design mock's bottom bar). */
const FOOT = "-mx-3 grid flex-none gap-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2.5 pb-3";

/** "1:05": how long a run has been going. */
const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** The time, once a second while `isTicking`, for a running tailoring's clock: read at once when it starts, so a panel
 * open a while doesn't show its own age as the run's for a second (PR #140's review). */
function useNow(isTicking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTicking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isTicking]);
  return now;
}

/** Tailor the candidate's résumé for this job (the website's Tailor, docs/02 §8.3): the Résumé tailoring view, its
 * screen centred in the tab and its action fixed at the foot. Before: what Tailor does, then Tailor. While it runs (about
 * a minute): the design mock's screen, a ring that turns and fills step by step, the job, the steps and the time, then
 * the way back to the form, as the run carries on by itself (BenchQ has no route to stop one). After: the résumé,
 * listed and tagged Tailored, to use with a click, which fills the form from it as any pick does; or why it failed, with
 * Try again when that can help. Nothing changes under the BDE until they use it. */
export default function TailorResume({ tailoring, from, forJob, isAgain, isReadyListed, isInUse, studioUrl, isBusy, refreshFailed, onStart, onUse, onDismiss, onBack, onReload }: TailorResumeProps) {
  const now = useNow(tailoring.status === "running");
  const explainId = useId();
  const isIdle = tailoring.status === "idle" || tailoring.status === "starting";
  const at = tailoring.status === "running" ? stepIndex(tailoring.step) : 0;
  return <div data-slot="tailor" className="flex min-h-0 flex-1 flex-col">
    {/* The screen, centred in the tab: a panel too short for it scrolls it rather than cut it off. */}
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div className="my-auto grid w-full justify-items-center gap-3 py-4 text-center">
        {isIdle && <>
          <span className={`${HALO} bg-[var(--color-primary-subtle)] text-[var(--color-primary)]`} aria-hidden="true">{SPARKLES_ICON}</span>
          <div className="grid gap-1">
            <h3 className="text-h3 text-[var(--color-text)]">{isAgain ? "Tailor the resume again" : "Tailor the resume for this job"}</h3>
            <p className={`wrap-anywhere ${SOFT_TEXT}`}>BenchQ rewrites the resume to fit {forJob}. Nothing on the form changes until you use it.</p>
          </div>
        </>}

        {tailoring.status === "running" && <div data-slot="tailor-running" className="grid w-full justify-items-center gap-3">
          <div role="progressbar" aria-label="Tailoring" aria-valuemin={1} aria-valuemax={TAILORING_STEPS.length}
            aria-valuenow={at + 1} aria-valuetext={`Step ${at + 1} of ${TAILORING_STEPS.length}: ${stepLabel(tailoring.step)}`}
            className="relative size-24">
            <svg viewBox="0 0 80 80" className="size-24 -rotate-90" aria-hidden="true">
              <circle cx="40" cy="40" r="34" fill="none" strokeWidth="5" className="stroke-[var(--color-surface-3)]" />
              <circle cx="40" cy="40" r="34" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={RING}
                strokeDashoffset={RING * (1 - (at + 1) / TAILORING_STEPS.length)}
                className={`stroke-[var(--color-primary)] transition-[stroke-dashoffset] ${MOTION}`} />
            </svg>
            {/* The loading turn: a short blue arc circling the ring. */}
            <svg viewBox="0 0 80 80" className="absolute inset-0 size-24 motion-safe:animate-spin" aria-hidden="true">
              <circle cx="40" cy="40" r="39" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray="30 216"
                className="stroke-[color-mix(in_srgb,var(--color-primary)_55%,transparent)]" />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-[var(--color-primary)] motion-safe:animate-pulse [&_svg]:size-8">{SPARKLES_ICON}</span>
          </div>
          <div className="grid gap-0.5">
            <h3 className="text-h3 text-[var(--color-text)]">Tailoring résumé…</h3>
            <p className={`wrap-anywhere ${SOFT_TEXT}`}>Rewriting {from ?? "the resume"} for {forJob}.</p>
          </div>
          <ol className="grid w-full max-w-64 gap-1.5 text-left">
            {TAILORING_STEPS.map((step, index) => {
              const state = index < at ? "done" : index === at ? "now" : "next";
              const mark = state === "done" ? "text-[var(--color-success-fg)]" : state === "now" ? `text-[var(--color-primary)] ${SPIN}` : "";
              return <li key={step} data-slot="tailor-step" data-state={state} className={STEP_ROW[state]}>
                <span className={`${STEP_MARK} ${mark}`} aria-hidden="true">
                  {state === "done" ? CHECK : state === "now" ? SPINNER_ICON : <span className="size-2 rounded-full border border-[var(--color-border-strong)]" />}
                </span>
                {state === "now" ? <span role="status">{stepLabel(step)}…</span> : <span>{stepLabel(step)}</span>}
              </li>;
            })}
          </ol>
          <p className="font-mono text-caption uppercase tracking-widest text-[var(--color-text-3)]" aria-hidden="true">
            Elapsed <span data-slot="tailor-clock" className="tabular-nums">{clock(now - tailoring.startedAt)}</span>
          </p>
        </div>}

        {tailoring.status === "completed" && <div data-slot="tailor-done" className="grid w-full justify-items-center gap-2.5">
          <span className={`${HALO} bg-[var(--color-success-bg)] text-[var(--color-success-fg)]`} aria-hidden="true">{CHECK}</span>
          <span role="status" className="text-h3 text-[var(--color-text)]">{isInUse ? "Tailored resume in use" : "Tailored resume ready"}</span>
          {!isInUse && isReadyListed && <p className={MUTED_TEXT}>Using it fills the form with its answers.</p>}
          {!isInUse && !isReadyListed && !refreshFailed && <p className={MUTED_TEXT} role="status">Adding it to the list…</p>}
          {/* The list couldn't be read again: said, with a way to read it again (PR #140's review). */}
          {!isInUse && !isReadyListed && refreshFailed && <div data-slot="tailor-reload" role="alert" className={`w-full text-left ${ALERT}`}>
            <p>BenchQ couldn&apos;t add the new resume to the list.</p>
            <button type="button" className={`mt-1.5 ${button("secondary", "compact")}`} onClick={onReload}>Reload resumes</button>
          </div>}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {!isInUse && <button type="button" data-slot="tailor-use" className={button("primary")} disabled={!isReadyListed || isBusy} onClick={onUse}>Use this resume</button>}
            {studioUrl && <a className={ICON_BUTTON_QUIET} href={studioUrl} target="_blank" rel="noreferrer" aria-label="View the tailored resume in BenchQ" title="View in BenchQ">{EXTERNAL_ICON}</a>}
            <button type="button" data-slot="tailor-close" className={ICON_BUTTON_QUIET} aria-label="Close" title="Close" onClick={onDismiss}>{CROSS_ICON}</button>
          </div>
        </div>}

        {tailoring.status === "failed" && <div data-slot="tailor-failed" role="alert" className={`w-full text-left ${ALERT}`}>
          <p className="wrap-anywhere">{tailoring.message}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tailoring.canRetry && from && <button type="button" data-slot="tailor-retry" className={button("secondary", "compact")} onClick={onStart}>Try again</button>}
            <button type="button" className={button("secondary", "compact")} onClick={onDismiss}>Close</button>
          </div>
        </div>}
      </div>
    </div>

    {/* The tab's action, fixed at its foot: Tailor, with what it does under it (also its tooltip and description); while
        it runs, the way back to the form. */}
    {(isIdle || tailoring.status === "running") && <div data-slot="tailor-actions" className={FOOT}>
      {isIdle && <>
        <button type="button" data-slot="tailor-start" className={`w-full ${button("primary", "large")} ${tailoring.status === "starting" ? SPIN : ""}`}
          disabled={!from || tailoring.status === "starting"} onClick={onStart} title={from ? `Rewrites ${from} to fit this job` : undefined}
          aria-describedby={explainId}>
          {tailoring.status === "starting" ? <>{SPINNER_ICON}Starting…</> : <>{SPARKLES_ICON}{isAgain ? "Tailor again" : "Tailor resume for this job"}</>}
        </button>
        <span id={explainId} data-slot="tailor-from" className="text-center text-caption text-[var(--color-text-3)]">
          {from ? <>Rewrites {from} to fit this job, about a minute</> : "No base resume to tailor from"}
        </span>
      </>}
      {tailoring.status === "running" && <>
        <p className={`text-center ${MUTED_TEXT}`}>It keeps going if you leave: the resume shows in the list when it&apos;s ready.</p>
        <button type="button" data-slot="tailor-back" className={`w-full ${button("secondary", "large")}`} onClick={onBack}>Back to Autofill</button>
      </>}
    </div>}
  </div>;
}
