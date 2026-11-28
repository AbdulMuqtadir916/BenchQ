import type { KeyboardEvent } from "react";
import { MOTION } from "./ui";

export type JobTab = "saved" | "applied";

const TABS: { id: JobTab; label: string }[] = [{ id: "saved", label: "Saved" }, { id: "applied", label: "Applied" }];

/** Underline tabs, as the design mock has them: the chosen one in the primary colour. */
const TAB = `group -mb-px flex min-h-[var(--control-height)] flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-[600] text-[var(--color-text-3)] transition-[color,border-color] ${MOTION} hover:text-[var(--color-text)] aria-selected:border-[var(--color-primary)] aria-selected:text-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]`;
const TAB_COUNT = "inline-flex h-[var(--count-size)] min-w-[var(--count-size)] items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-surface-3)] px-1 text-mono-sm font-normal text-[var(--color-text-2)] group-aria-selected:bg-[var(--color-primary-subtle)] group-aria-selected:text-[var(--color-primary-subtle-fg)]";

export const tabId = (tab: JobTab) => `job-tab-${tab}`;
export const JOB_PANEL = "job-panel";

type JobTabsProps = {
  active: JobTab;
  /** Null while the jobs are loading: each count keeps its place, without a number that is about to change. */
  counts: Record<JobTab, number> | null;
  onChange: (tab: JobTab) => void;
};

/** Saved and Applied, the way the website's tabs work: one tab stop, then arrow keys, Home and End. */
export default function JobTabs({ active, counts, onChange }: JobTabsProps) {
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const steps: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: TABS.length - 1 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const { id } = TABS[(step + TABS.length) % TABS.length]!;
    onChange(id);
    document.getElementById(tabId(id))?.focus();
  };

  return <div className="-mx-3 mb-3 flex border-b border-[var(--color-border)]" role="tablist" aria-label="Job status">
    {TABS.map(({ id, label }, index) => <button
      key={id}
      type="button"
      role="tab"
      id={tabId(id)}
      className={TAB}
      aria-selected={active === id}
      aria-controls={JOB_PANEL}
      tabIndex={active === id ? 0 : -1}
      onClick={() => onChange(id)}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      {label} <span className={TAB_COUNT}>{counts?.[id] ?? "…"}</span>
    </button>)}
  </div>;
}
