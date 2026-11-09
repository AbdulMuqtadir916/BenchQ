import type { KeyboardEvent, ReactNode } from "react";
import { button, MOTION, SOFT_TEXT } from "../ui";
import ChoicePicker from "./ChoicePicker";
import { fieldLabel, filledValue } from "./form-memory";
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
        <span data-slot="review-label" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
        {value && <span data-slot="review-value" className={`truncate ${SOFT_TEXT}`} title={value}>{value}</span>}
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
function Suggestions({ row, suggestions, isFilling, onSuggest }: { row: ReviewRow; suggestions: BankEntry[]; isFilling: boolean; onSuggest: (row: ReviewRow, entry: BankEntry) => void }) {
  return <div data-slot="review-suggestions" className="grid gap-1 pl-[calc(var(--icon-md)+var(--spacing)*2)]">
    <p className={NOTE}>Saved answers that might fit:</p>
    <ul className="grid gap-1">{suggestions.map((entry) => <li key={entry.id}>
      <button type="button" className={`max-w-full text-left ${button("secondary", "compact")}`} disabled={isFilling}
        aria-label={`Fill ${fieldLabel(row.field)} with "${entry.answer}", saved for "${entry.question}"`} onClick={() => onSuggest(row, entry)}>
        <span className="min-w-0 wrap-anywhere"><span className="text-[var(--color-text-3)]">{entry.question}</span> {entry.answer}</span>
      </button>
    </li>)}</ul>
  </div>;
}

function Group({ title, rows, ...actions }: RowActions & { title: string; rows: ReviewRow[] }) {
  if (rows.length === 0) return null;
  const { isFilling } = actions;
  const inOrder = isFilling ? rows : stillToFillFirst(rows);
  return <section className="grid min-w-0 gap-1" aria-label={title}>
    <h3 className="text-sm font-[550]">{title} <span className="font-normal text-[var(--color-text-3)]">({rows.filter(isFilled).length} of {rows.length} filled)</span></h3>
    <ul className="grid gap-0.5">{inOrder.map((row) => <Row key={row.key} row={row} {...actions} />)}</ul>
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
            <span data-slot="review-value" className={`truncate ${SOFT_TEXT}`} title={row.field.current}>On the form: {row.field.current}</span>
            <span data-slot="review-saved" className={NOTE}>Saved: {row.proposed}</span>
          </span>
        </RowBody>
      </div>
      {onReplace && <button type="button" className={button("secondary", "compact")} disabled={isFilling} aria-label={`Replace ${fieldLabel(row.field)} with the saved answer`} onClick={() => onReplace([row])}>Replace</button>}
    </li>)}</ul>
  </section>;
}

/** The form's fields and what each holds: what the form already held that differs from the saved answers, what's
 * required, what's optional, then any upload the Resume and Cover letter sections don't stand for, since Autofill leaves
 * uploads to the BDE every time. Labels and values come from the employer's page and render as plain text. */
export default function ReviewList({ rows, isFilling, onGoTo, onReplace, onListOptions, onChoose, onSuggest }: ReviewListProps) {
  const actions = { isFilling, onGoTo, onListOptions, onChoose, onSuggest };
  const isKept = (row: ReviewRow) => row.status === "kept";
  const typed = rows.filter((row) => !isUpload(row) && !isKept(row));
  return <div data-slot="review" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <KeptGroup rows={rows.filter(isKept)} onReplace={onReplace} {...actions} />
    <Group title="Required" rows={typed.filter(({ field }) => field.required)} {...actions} />
    <Group title="Optional" rows={typed.filter(({ field }) => !field.required)} {...actions} />
    <Group title="Other uploads" rows={rows.filter(isUpload)} {...actions} />
  </div>;
}
