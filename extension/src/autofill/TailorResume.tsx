import { useEffect, useState } from "react";
import { ALERT, button, ICON_BUTTON_QUIET, MOTION, MUTED_TEXT } from "../ui";
import { CHECK, CROSS_ICON, EXTERNAL_ICON, SPARKLES_ICON, SPINNER_ICON } from "./icons";
import { stepIndex, stepLabel, TAILORING_STEPS, type Tailoring } from "./use-tailoring";

type TailorResumeProps = {
  tailoring: Tailoring;
  /** The base Tailor reads, as the list names it ("Base 2 · Active"); null when the candidate has none to tailor. */
  from: string | null;
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
  onReload: () => void;
};

const ROW = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5";
const SPIN = "[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none";
const STEP = `flex min-w-0 items-center gap-1.5 text-sm font-[550] text-[var(--color-text)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:text-[var(--color-primary)] ${SPIN}`;
const DONE = "flex min-w-0 items-center gap-1 text-sm font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

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

/** Tailor the candidate's résumé for this job (the website's Tailor, docs/02 §8.3), at the foot of the résumé section:
 * which base it reads, then its steps as it runs (about a minute, while the BDE keeps filling), then the résumé, listed
 * and tagged Tailored, to use with a click, which fills the form from it as any pick does; or why it failed, with Try
 * again when that can help. Nothing changes under the BDE until they use it. */
export default function TailorResume({ tailoring, from, isAgain, isReadyListed, isInUse, studioUrl, isBusy, refreshFailed, onStart, onUse, onDismiss, onReload }: TailorResumeProps) {
  const now = useNow(tailoring.status === "running");
  return <div data-slot="tailor" className="grid gap-2 border-t border-[var(--color-border)] pt-2.5">
    {(tailoring.status === "idle" || tailoring.status === "starting") && <div className={ROW}>
      <button type="button" data-slot="tailor-start" className={`${button("secondary", "compact")} ${tailoring.status === "starting" ? SPIN : ""}`}
        disabled={!from || tailoring.status === "starting"} onClick={onStart}>
        {tailoring.status === "starting" ? <>{SPINNER_ICON}Starting…</> : <>{SPARKLES_ICON}{isAgain ? "Tailor again" : "Tailor resume for this job"}</>}
      </button>
      {/* What Tailor does, in plain words, for a BDE who hasn't used it: which résumé it rewrites, and how long it takes. */}
      <span data-slot="tailor-from" className={MUTED_TEXT}>{from ? `Rewrites ${from} to fit this job · about a minute` : "No base resume to tailor from"}</span>
    </div>}

    {tailoring.status === "running" && <div data-slot="tailor-running" className="grid gap-1.5">
      <div className={ROW}>
        <span role="status" className={STEP}>{SPINNER_ICON}{stepLabel(tailoring.step)}…</span>
        <span data-slot="tailor-clock" className="text-caption tabular-nums text-[var(--color-text-3)]" aria-hidden="true">{clock(now - tailoring.startedAt)}</span>
      </div>
      <div role="progressbar" aria-label="Tailoring" aria-valuemin={1} aria-valuemax={TAILORING_STEPS.length}
        aria-valuenow={stepIndex(tailoring.step) + 1} aria-valuetext={`Step ${stepIndex(tailoring.step) + 1} of ${TAILORING_STEPS.length}: ${stepLabel(tailoring.step)}`}
        className="grid grid-cols-6 gap-1">
        {TAILORING_STEPS.map((step, index) => <span key={step}
          className={`h-1 rounded-full transition-colors ${MOTION} ${index <= stepIndex(tailoring.step) ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]"}`} />)}
      </div>
      <p className={MUTED_TEXT}>Tailoring {from ?? "the resume"} for this job. Keep filling meanwhile: it shows in the list when it&apos;s ready.</p>
    </div>}

    {tailoring.status === "completed" && <div data-slot="tailor-done" className="grid gap-1">
      <div className={ROW}>
        <span role="status" className={DONE}>{CHECK}{isInUse ? "Tailored resume in use" : "Tailored resume ready"}</span>
        <span className="flex flex-none items-center gap-1">
          {!isInUse && <button type="button" data-slot="tailor-use" className={button("primary", "compact")} disabled={!isReadyListed || isBusy} onClick={onUse}>Use this resume</button>}
          {studioUrl && <a className={ICON_BUTTON_QUIET} href={studioUrl} target="_blank" rel="noreferrer" aria-label="View the tailored resume in BenchQ" title="View in BenchQ">{EXTERNAL_ICON}</a>}
          <button type="button" data-slot="tailor-close" className={ICON_BUTTON_QUIET} aria-label="Close" title="Close" onClick={onDismiss}>{CROSS_ICON}</button>
        </span>
      </div>
      {!isInUse && isReadyListed && <p className={MUTED_TEXT}>Using it fills the form with its answers.</p>}
      {!isInUse && !isReadyListed && !refreshFailed && <p className={MUTED_TEXT} role="status">Adding it to the list…</p>}
      {/* The list couldn't be read again: said, with a way to read it again (PR #140's review). */}
      {!isInUse && !isReadyListed && refreshFailed && <div data-slot="tailor-reload" role="alert" className={ALERT}>
        <p>BenchQ couldn&apos;t add the new resume to the list.</p>
        <button type="button" className={`mt-1.5 ${button("secondary", "compact")}`} onClick={onReload}>Reload resumes</button>
      </div>}
    </div>}

    {tailoring.status === "failed" && <div data-slot="tailor-failed" role="alert" className={ALERT}>
      <p className="wrap-anywhere">{tailoring.message}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tailoring.canRetry && from && <button type="button" data-slot="tailor-retry" className={button("secondary", "compact")} onClick={onStart}>Try again</button>}
        <button type="button" className={button("secondary", "compact")} onClick={onDismiss}>Close</button>
      </div>
    </div>}
  </div>;
}
