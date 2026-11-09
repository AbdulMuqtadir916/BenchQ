import { useState } from "react";
import { button, MUTED_TEXT } from "../ui";
import type { ReviewRow } from "./types";

type ChoicePickerProps = {
  row: ReviewRow;
  isFilling: boolean;
  onListOptions: (row: ReviewRow) => Promise<string[] | null>;
  onChoose: (row: ReviewRow, label: string) => void;
};

const OPTION = "w-full rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-sm text-[var(--color-text)] wrap-anywhere hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50";
const MORE = "px-1.5 text-caption text-[var(--color-text-2)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline";
const SHOWN_OPTIONS = 8;

/** For a dropdown Autofill found no clear option in: its options, read from the form when the BDE asks, to pick one
 * here. BenchQ then selects it on the page. */
export default function ChoicePicker({ row, isFilling, onListOptions, onChoose }: ChoicePickerProps) {
  const [options, setOptions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAll, setIsAll] = useState(false);
  const label = row.field.label || "this field";

  const load = async () => {
    setIsLoading(true);
    setOptions((await onListOptions(row)) ?? []);
    setIsLoading(false);
  };

  if (options === null) {
    return <button type="button" data-slot="choice-open" className={`mt-1 ${button("secondary", "compact")}`} disabled={isFilling || isLoading} onClick={() => void load()}>
      {isLoading ? "Reading the options…" : "Choose an option"}
    </button>;
  }
  if (options.length === 0) return <p data-slot="choice-none" className={`mt-1 ${MUTED_TEXT}`}>BenchQ couldn&apos;t read this dropdown&apos;s options. Choose one on the page.</p>;
  // No scroll inside the panel (07 Q54): the first few, then all of them on request.
  const shown = isAll ? options : options.slice(0, SHOWN_OPTIONS);
  return <div className="mt-1 grid justify-items-start gap-0.5">
    <ul data-slot="choice-list" className="grid w-full gap-0.5" aria-label={`Options for ${label}`}>
      {shown.map((option) => <li key={option}>
        <button type="button" className={OPTION} disabled={isFilling} onClick={() => onChoose(row, option)}>{option}</button>
      </li>)}
    </ul>
    {shown.length < options.length && <button type="button" data-slot="choice-all" className={MORE} onClick={() => setIsAll(true)}>
      Show all {options.length} options
    </button>}
  </div>;
}
