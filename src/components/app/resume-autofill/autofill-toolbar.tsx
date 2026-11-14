"use client";

import type { ReactNode, RefObject } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AutofillShow, AutofillSummary } from "@/lib/derive/autofill-view";

type AutofillToolbarProps = {
  summary: AutofillSummary;
  show: AutofillShow;
  onShow: (show: AutofillShow) => void;
  search: string;
  onSearch: (search: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
};

const SEGMENTS = "inline-flex shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-0.5";
const SEGMENT = cn(
  "inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)]",
  "peer-checked:border peer-checked:border-[var(--color-border)] peer-checked:bg-[var(--color-surface)] peer-checked:font-[550] peer-checked:text-[var(--color-text)] peer-checked:shadow-[var(--shadow-control)]",
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--color-focus-ring)]",
);

/** A choice of a few, as segments: native radios underneath, so the arrow keys move between them. */
function Segments<T extends string>({ name, label, value, options, onChange }: {
  name: string; label: string; value: T; options: Array<{ id: T; label: ReactNode; hint?: string }>; onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={SEGMENTS}>
      {options.map((option) => (
        <label key={option.id} title={option.hint} className="relative">
          <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} className="peer sr-only" />
          <span className={SEGMENT}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

const Count = ({ value }: { value: number }) => <span className="tabular text-caption text-[var(--color-text-3)]">{value}</span>;

/**
 * The top of the Autofill tab: what it is (a change is saved to this version only), how ready the answers are, and the
 * filters and search, which stay in view while the list scrolls. Every number is counted from the answers.
 */
export function AutofillToolbar({ summary, show, onShow, search, onSearch, searchRef }: AutofillToolbarProps) {
  const percent = summary.total ? Math.round((summary.answered / summary.total) * 100) : 0;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h2 className="text-h2 text-[var(--color-text)]">Autofill answers</h2>
          <p className="text-body text-[var(--color-text-2)]">
            What the extension fills on application forms from this resume version. BenchQ builds the answers from the resume and the candidate&apos;s profile; yours replace them, on this version only.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-[var(--color-text-2)]">
            <span className="tabular text-body-strong text-[var(--color-text)]">{summary.answered}</span> of <span className="tabular">{summary.total}</span> questions answered
          </span>
          {summary.missing > 0 ? <span className="text-[var(--color-text-3)]">{summary.missing} not answered yet</span> : null}
        </div>
        <div role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.answered}
          className="h-1.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-3)]">
          <div className="h-full rounded-[var(--radius-full)] bg-[var(--color-primary)] transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-[var(--color-surface)] px-1 py-2">
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
          <Segments name="autofill-show" label="Show" value={show} onChange={onShow} options={[
            { id: "all", label: <>All <Count value={summary.total} /></> },
            { id: "missing", label: <>To answer <Count value={summary.missing} /></> },
            { id: "review", label: <>Needs a look <Count value={summary.review} /></> },
            { id: "yours", label: <>Yours <Count value={summary.yours} /></> },
          ]} />
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input ref={searchRef} type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search questions"
            aria-label="Search questions" aria-keyshortcuts="/" className="w-full pl-9 pr-8"
            onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); event.stopPropagation(); onSearch(""); } }} />
          {!search ? <kbd aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mono-sm text-[var(--color-text-3)]">/</kbd> : null}
        </div>
      </div>
    </>
  );
}
