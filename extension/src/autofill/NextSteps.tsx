import { CHECK } from "./icons";

export type JobStep = { key: string; label: string; isDone: boolean };

const STEP = "flex min-w-0 flex-col items-center gap-0.5 text-center text-caption";
const BADGE = "grid size-5 place-items-center rounded-full border text-caption font-[550] [&_svg]:size-3";
const DONE = "border-transparent bg-[var(--color-success-bg)] text-[var(--color-success-fg)]";
const NOW = "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]";
const LATER = "border-[var(--color-border-strong)] text-[var(--color-text-3)]";

/** The job's steps in one line, for a BDE new to the panel: what's done, and what to do now (the first not done). It
 * takes no click and says nothing the panel doesn't do: Autofill fills, the BDE submits on the site, Mark applied
 * records it. */
export default function NextSteps({ steps }: { steps: JobStep[] }) {
  const now = steps.findIndex(({ isDone }) => !isDone);
  return <ol data-slot="next-steps" aria-label="Steps for this job" className="grid grid-cols-4 gap-1">
    {steps.map((step, index) => {
      const isNow = index === now;
      return <li key={step.key} data-slot="next-step" data-state={step.isDone ? "done" : isNow ? "now" : "later"}
        aria-current={isNow ? "step" : undefined} className={STEP}>
        <span className={`${BADGE} ${step.isDone ? DONE : isNow ? NOW : LATER}`} aria-hidden="true">{step.isDone ? CHECK : index + 1}</span>
        <span className={isNow ? "font-[550] text-[var(--color-text)]" : "text-[var(--color-text-3)]"}>
          {step.label}{step.isDone && <span className="sr-only"> (done)</span>}
        </span>
      </li>;
    })}
  </ol>;
}
