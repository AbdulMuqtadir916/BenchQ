import { useState, type KeyboardEvent, type ReactNode } from "react";
import { button, MOTION, SOFT_TEXT } from "../ui";
import ChoicePicker from "./ChoicePicker";
import { fieldLabel, filledValue } from "./form-memory";
import { CHEVRON_DOWN_ICON } from "./icons";
import { Tick } from "./marks";
import type { BankEntry, ReviewRow } from "./types";

type ReviewListProps = {
  rows: ReviewRow[];
  isFilling: boolean;
  onGoTo: (row: ReviewRow) => void;
  /** Writes the saved answers over values the form already held. */
  onReplace?: (rows: ReviewRow[]) => void;
  /** A dropdown's options, for a row Autofill found no clear option in, and the one the BDE picks from them. */
  onListOptions?: (row: ReviewRow) => Promise<string[] | null>;
  onChoose?: (row: ReviewRow, label: string) => void;
  /** Fills a field with one of the saved answers suggested for it. */
  onSuggest?: (row: ReviewRow, entry: BankEntry) => void;
};

type RowActions = Pick<ReviewListProps, "isFilling" | "onGoTo" | "onListOptions" | "onChoose" | "onSuggest">;

/** One line per field: its tick, its label, and what it holds. The row hangs into the margin, so ticks line up with the
 * heading above. */
const ROW = `-mx-1.5 flex cursor-pointer gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 transition-[background] ${MOTION} aria-disabled:cursor-default aria-[disabled=false]:hover:bg-[var(--color-surface-2)]`;
const NOTE = "text-caption text-[var(--color-text-3)] wrap-anywhere";
/** A value from the form: two lines at most, the rest on hover (07 Q56). */
const VALUE = `line-clamp-2 wrap-anywhere ${SOFT_TEXT}`;
const REQUIRED = "flex-none rounded-full bg-[var(--color-surface-3)] px-1.5 text-caption font-[550] text-[var(--color-text-2)]";
/** A saved answer to use with a click: a card that wraps, never a line cut off at the panel's edge (07 Q54). */
const ANSWER_CARD = `grid w-full gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left text-sm text-[var(--color-text)] wrap-anywhere transition-[background,border-color] ${MOTION} hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50`;
const LINK = "text-caption text-[var(--color-text-2)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline";
const FOLD = `-mx-1.5 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-left text-sm font-[550] transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:transition-transform motion-reduce:[&_svg]:transition-none aria-expanded:[&_svg]:rotate-180`;
/** An answer longer than this shows four lines until "Show all". */
const LONG_ANSWER = 220;

const isFilled = (row: ReviewRow) => Boolean(filledValue(row));
const isUpload = ({ field }: ReviewRow) => field.kind === "file";

/** Fields still to fill first, each kind in the form's order. A run keeps every row in place, so it ticks where it is. */
const stillToFillFirst = (rows: ReviewRow[]) => [...rows.filter((row) => !isFilled(row)), ...rows.filter(isFilled)];

/** A field BenchQ never touches keeps its value on the form: the row says it's filled, and an upload gives its name. */
const shownValue = (row: ReviewRow) => (row.status === "blocked" && row.isUnsaved ? "" : filledValue(row));

/** Answers the BDE needs to hand, because they didn't fit this field. */
const savedAnswers = ({ status, alternatives, source }: ReviewRow) =>
  (status === "manual" ? alternatives ?? (source ? [source.answer] : []) : []);

/** A row goes to its field on the form. Not a <button>, so its text can still be selected and copied. */
function RowBody({ row, isFilling, onGoTo, children }: RowActions & { row: ReviewRow; children: ReactNode }) {
  const go = () => {
    if (!isFilling && !getSelection()?.toString()) onGoTo(row);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    go();
  };
  return <div data-slot="review-jump" className={ROW} role="button" tabIndex={isFilling ? -1 : 0} aria-disabled={isFilling} title="Go to this field on the form" onClick={go} onKeyDown={onKeyDown}>
    {children}
  </div>;
}

/** The uploads section says why the BDE fills these itself, so a row only needs to say if it's required. */
const rowNote = (row: ReviewRow) => {
  if (!isUpload(row)) return row.reason;
  return row.field.required ? "Required" : "";
};

function Row({ row, ...actions }: RowActions & { row: ReviewRow }) {
  const filled = isFilled(row);
  const value = shownValue(row);
  const note = rowNote(row);
  return <li data-slot="review-row">
    <RowBody row={row} {...actions}>
      <Tick isFilled={filled} slot="review-tick" />
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-start justify-between gap-2">
          <span data-slot="review-label" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
          {!filled && row.field.required && !isUpload(row) && <span data-slot="review-required" className={REQUIRED}>Required</span>}
        </span>
        {value && <span data-slot="review-value" className={VALUE} title={value}>{value}</span>}
        {!filled && note && <span data-slot="review-reason" className={NOTE}>{note}</span>}
        {!filled && savedAnswers(row).map((answer) => <span key={answer} data-slot="review-saved" className={NOTE}>Saved: {answer}</span>)}
      </span>
    </RowBody>
    {row.canChoose && !filled && actions.onListOptions && actions.onChoose && <div className="pl-[calc(var(--icon-md)+var(--spacing)*2)]">
      <ChoicePicker row={row} isFilling={actions.isFilling} onListOptions={actions.onListOptions} onChoose={actions.onChoose} />
    </div>}
    {row.suggestions && !filled && actions.onSuggest && <Suggestions row={row} suggestions={row.suggestions} isFilling={actions.isFilling} onSuggest={actions.onSuggest} />}
  </li>;
}

/** Saved answers that might answer a question nothing matched: one click fills the field with one. */
type SuggestionProps = { row: ReviewRow; isFilling: boolean; onSuggest: (row: ReviewRow, entry: BankEntry) => void };

/** One saved answer: the question it was saved for, small, then the answer on as many lines as it takes. A long one
 * shows four lines until "Show all". */
function Suggestion({ row, entry, isFilling, onSuggest }: SuggestionProps & { entry: BankEntry }) {
  const [isOpen, setIsOpen] = useState(false);
  const isLong = entry.answer.length > LONG_ANSWER || entry.answer.split("\n").length > 4;
  return <li className="grid justify-items-start gap-0.5">
    <button type="button" className={ANSWER_CARD} disabled={isFilling} onClick={() => onSuggest(row, entry)}
      aria-label={`Fill ${fieldLabel(row.field)} with "${entry.answer}", saved for "${entry.question}"`}>
      <span className="text-caption text-[var(--color-text-3)]">{entry.question}</span>{" "}
      <span className={isLong && !isOpen ? "line-clamp-4" : undefined}>{entry.answer}</span>
    </button>
    {isLong && <button type="button" className={LINK} aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Show less" : "Show all"}</button>}
  </li>;
}

function Suggestions({ suggestions, ...props }: SuggestionProps & { suggestions: BankEntry[] }) {
  return <div data-slot="review-suggestions" className="grid gap-1 pl-[calc(var(--icon-md)+var(--spacing)*2)]">
    <p className={NOTE}>Saved answers that might fit:</p>
    <ul className="grid gap-1">{suggestions.map((entry) => <Suggestion key={entry.id} entry={entry} {...props} />)}</ul>
  </div>;
}

function Group({ title, count, rows, ...actions }: RowActions & { title: string; count: string; rows: ReviewRow[] }) {
  if (rows.length === 0) return null;
  return <section className="grid min-w-0 gap-1" aria-label={title}>
    <h3 className="text-sm font-[550]">{title} <span className="font-normal text-[var(--color-text-3)]">({count})</span></h3>
    <ul className="grid gap-0.5">{rows.map((row) => <Row key={row.key} row={row} {...actions} />)}</ul>
  </section>;
}

/** What already holds a value, folded under its count so what's left comes first (07 Q56). */
function FilledGroup({ rows, ...actions }: RowActions & { rows: ReviewRow[] }) {
  const [isOpen, setIsOpen] = useState(false);
  if (rows.length === 0) return null;
  return <section data-slot="review-filled" className="grid min-w-0 gap-1" aria-label="Filled">
    <button type="button" data-slot="review-filled-toggle" className={FOLD} aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
      {CHEVRON_DOWN_ICON}Filled <span className="font-normal text-[var(--color-text-3)]">({rows.length})</span>
    </button>
    {isOpen && <ul className="grid gap-0.5">{rows.map((row) => <Row key={row.key} row={row} {...actions} />)}</ul>}
  </section>;
}

/** Values the form held before BenchQ looked, typed earlier or filled by the site, that differ from the saved answers.
 * Autofill leaves them: Replace writes the saved answer over one, Replace all over every one. */
function KeptGroup({ rows, isFilling, onGoTo, onReplace }: RowActions & { rows: ReviewRow[]; onReplace?: ReviewListProps["onReplace"] }) {
  if (rows.length === 0) return null;
  return <section data-slot="review-kept" className="grid min-w-0 gap-1" aria-label="Already on the form">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-[550]">Already on the form <span className="font-normal text-[var(--color-text-3)]">({rows.length})</span></h3>
      {onReplace && rows.length > 1 && <button type="button" className={button("secondary", "compact")} disabled={isFilling} onClick={() => onReplace(rows)}>Replace all</button>}
    </div>
    <p className={NOTE}>These differ from the saved answers, so Autofill leaves them as they are.</p>
    <ul className="grid gap-0.5">{rows.map((row) => <li key={row.key} data-slot="review-row" className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <RowBody row={row} isFilling={isFilling} onGoTo={onGoTo}>
          <Tick isFilled slot="review-tick" />
          <span className="grid min-w-0 flex-1">
            <span data-slot="review-label" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
            <span data-slot="review-value" className={VALUE} title={row.field.current}>On the form: {row.field.current}</span>
            <span data-slot="review-saved" className={NOTE}>Saved: {row.proposed}</span>
          </span>
        </RowBody>
      </div>
      {onReplace && <button type="button" className={button("secondary", "compact")} disabled={isFilling} aria-label={`Replace ${fieldLabel(row.field)} with the saved answer`} onClick={() => onReplace([row])}>Replace</button>}
    </li>)}</ul>
  </section>;
}

/** The form's fields and what each holds: what the form already held that differs from the saved answers, what still
 * needs the BDE (required first, each marked), what's filled (folded under its count), then any upload the Resume and
 * Cover letter sections don't stand for. Labels and values come from the employer's page and render as plain text. */
export default function ReviewList({ rows, isFilling, onGoTo, onReplace, onListOptions, onChoose, onSuggest }: ReviewListProps) {
  const actions = { isFilling, onGoTo, onListOptions, onChoose, onSuggest };
  const isKept = (row: ReviewRow) => row.status === "kept";
  const typed = rows.filter((row) => !isUpload(row) && !isKept(row));
  const needed = typed.filter((row) => !isFilled(row));
  const uploads = rows.filter(isUpload);
  return <div data-slot="review" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <KeptGroup rows={rows.filter(isKept)} onReplace={onReplace} {...actions} />
    <Group title="Needs you" count={String(needed.length)} {...actions}
      rows={[...needed.filter(({ field }) => field.required), ...needed.filter(({ field }) => !field.required)]} />
    <FilledGroup rows={typed.filter(isFilled)} {...actions} />
    <Group title="Other uploads" count={`${uploads.filter(isFilled).length} of ${uploads.length} filled`} rows={stillToFillFirst(uploads)} {...actions} />
  </div>;
}
