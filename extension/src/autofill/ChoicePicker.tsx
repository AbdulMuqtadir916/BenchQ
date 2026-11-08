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

/** For a dropdown Autofill found no clear option in: its options, read from the form when the BDE asks, to pick one
 * here. BenchQ then selects it on the page. */
export default function ChoicePicker({ row, isFilling, onListOptions, onChoose }: ChoicePickerProps) {
  const [options, setOptions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
  return <ul data-slot="choice-list" className="mt-1 grid max-h-[calc(var(--control-height)*6)] gap-0.5 overflow-y-auto" aria-label={`Options for ${label}`}>
    {options.map((option) => <li key={option}>
      <button type="button" className={OPTION} disabled={isFilling} onClick={() => onChoose(row, option)}>{option}</button>
    </li>)}
  </ul>;
}
