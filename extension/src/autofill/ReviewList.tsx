import { useState, type KeyboardEvent, type ReactNode } from "react";
import { button, MOTION, SOFT_TEXT } from "../ui";
import ChoicePicker from "./ChoicePicker";
import { fieldLabel, filledValue } from "./form-memory";
import { CHECK, CHEVRON_DOWN_ICON, LIGHTBULB_ICON } from "./icons";
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
  /** Keeps an answer the BDE typed for next time, for every job of the candidate or this one only (07 Q58). */
  onSave?: (row: ReviewRow, isOnlyThisJob: boolean) => Promise<boolean>;
};

type RowActions = Pick<ReviewListProps, "isFilling" | "onGoTo" | "onListOptions" | "onChoose" | "onSuggest" | "onSave">;

/** One line per field: its tick, its label, and what it holds. The row hangs into the margin, so ticks line up with the
 * heading above. */
const ROW = `-mx-1.5 flex cursor-pointer gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 transition-[background] ${MOTION} aria-disabled:cursor-default aria-[disabled=false]:hover:bg-[var(--color-surface-2)]`;
const NOTE = "text-caption text-[var(--color-text-3)] wrap-anywhere";
/** A value from the form: two lines at most, the rest on hover (07 Q56). */
const VALUE = `line-clamp-2 wrap-anywhere ${SOFT_TEXT}`;
const REQUIRED = "flex-none rounded-full bg-[var(--color-surface-3)] px-1.5 text-caption font-[550] text-[var(--color-text-2)]";
/** The saved answers that might fit a question nothing matched: a box of their own, set apart from the field's row. */
const SUGGESTIONS = "ml-[calc(var(--icon-md)+var(--spacing)*2)] mt-1 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5";
const SUGGESTIONS_TITLE = "flex items-center gap-1.5 text-sm font-[550] text-[var(--color-text)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const LINK = "text-caption text-[var(--color-text-2)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline";
const FOLD = `-mx-1.5 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-left text-sm font-[550] transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:transition-transform motion-reduce:[&_svg]:transition-none aria-expanded:[&_svg]:rotate-180`;
/** An answer longer than this shows four lines until "Show all". */
const LONG_ANSWER = 220;

const SAVE_BUTTON = `bq-secondary inline-flex min-h-[var(--control-sm)] max-w-full items-center rounded-[var(--radius-md)] px-2 py-0.5 text-left text-sm font-[550] wrap-anywhere transition-[background,box-shadow] ${MOTION} disabled:cursor-not-allowed disabled:opacity-50`;
const SAVED = "flex items-center gap-1 text-caption font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

/** Keeping a typed answer for next time (07 Q58): the button says what saving does, saving a new answer or updating the
 * one saved before (Q21), and "Only this job" keeps it to the picked résumé (Q22). */
function SaveAnswer({ row, isFilling, onSave }: { row: ReviewRow; isFilling: boolean; onSave: NonNullable<ReviewListProps["onSave"]> }) {
  const [isOnlyThisJob, setIsOnlyThisJob] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const offer = row.saveOffer;
  if (offer === "saved") return <p data-slot="review-saved-note" className={`pl-[calc(var(--icon-md)+var(--spacing)*2)] ${SAVED}`}>{CHECK}Saved for next time</p>;
  if (!offer) return null;
  const save = async () => {
    setIsSaving(true);
    await onSave(row, isOnlyThisJob);
    setIsSaving(false);
  };
  return <div data-slot="review-save" className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[calc(var(--icon-md)+var(--spacing)*2)]">
    <button type="button" className={SAVE_BUTTON} disabled={isFilling || isSaving} onClick={() => void save()}>{isSaving ? "Saving…" : offer.label}</button>
    <label className="flex items-center gap-1 text-caption text-[var(--color-text-2)]">
      <input type="checkbox" checked={isOnlyThisJob} onChange={(event) => setIsOnlyThisJob(event.target.checked)} />Only this job
    </label>
  </div>;
}

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
    {row.saveOffer && actions.onSave && <SaveAnswer row={row} isFilling={actions.isFilling} onSave={actions.onSave} />}
  </li>;
}

/** Saved answers that might answer a question nothing matched: one click fills the field with one. */
type SuggestionProps = { row: ReviewRow; isFilling: boolean; onSuggest: (row: ReviewRow, entry: BankEntry) => void };

/** One saved answer: the answer itself first, on as many lines as it takes (a long one four until "Show all"), the
 * question it was saved for under it, and Use, which fills the field with it. */
function Suggestion({ row, entry, isFilling, onSuggest }: SuggestionProps & { entry: BankEntry }) {
  const [isOpen, setIsOpen] = useState(false);
  const isLong = entry.answer.length > LONG_ANSWER || entry.answer.split("\n").length > 4;
  return <li data-slot="suggestion" className="flex min-w-0 items-start gap-3 py-2 first:pt-0 last:pb-0">
    <div className="grid min-w-0 flex-1 justify-items-start gap-0.5">
      <p data-slot="suggestion-answer" className={`text-body-strong text-[var(--color-text)] wrap-anywhere ${isLong && !isOpen ? "line-clamp-4" : ""}`}>{entry.answer}</p>
      <p data-slot="suggestion-question" className="text-caption text-[var(--color-text-3)] wrap-anywhere">Saved for “{entry.question}”</p>
      {isLong && <button type="button" className={LINK} aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Show less" : "Show all"}</button>}
    </div>
    <button type="button" data-slot="suggestion-use" className={`flex-none ${button("secondary", "compact")}`} disabled={isFilling}
      aria-label={`Fill ${fieldLabel(row.field)} with "${entry.answer}", saved for "${entry.question}"`} onClick={() => onSuggest(row, entry)}>Use</button>
  </li>;
}

/** Saved answers that might fit a question nothing matched (07 Q26): what they are in a line, then each one to use or
 * leave. None is ever filled on its own. */
function Suggestions({ suggestions, ...props }: SuggestionProps & { suggestions: BankEntry[] }) {
  return <div data-slot="review-suggestions" className={SUGGESTIONS}>
    <div className="grid gap-0.5">
      <p className={SUGGESTIONS_TITLE}>{LIGHTBULB_ICON}Saved answers that might fit</p>
      <p className={NOTE}>No saved answer matched this question. If one of these answers it, use it.</p>
    </div>
    <ul className="grid divide-y divide-[var(--color-border)]">{suggestions.map((entry) => <Suggestion key={entry.id} entry={entry} {...props} />)}</ul>
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
export default function ReviewList({ rows, isFilling, onGoTo, onReplace, onListOptions, onChoose, onSuggest, onSave }: ReviewListProps) {
  const actions = { isFilling, onGoTo, onListOptions, onChoose, onSuggest, onSave };
  // Answers the BDE typed and can keep come first, in sight, until they're saved (07 Q58).
  const isOffered = (row: ReviewRow) => typeof row.saveOffer === "object" && Boolean(onSave);
  const isKept = (row: ReviewRow) => row.status === "kept";
  const typed = rows.filter((row) => !isUpload(row) && !isKept(row) && !isOffered(row));
  const needed = typed.filter((row) => !isFilled(row));
  const uploads = rows.filter(isUpload);
  return <div data-slot="review" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <KeptGroup rows={rows.filter(isKept)} onReplace={onReplace} {...actions} />
    <Group title="Save for next time" count={String(rows.filter(isOffered).length)} rows={rows.filter(isOffered)} {...actions} />
    <Group title="Needs you" count={String(needed.length)} {...actions}
      rows={[...needed.filter(({ field }) => field.required), ...needed.filter(({ field }) => !field.required)]} />
    <FilledGroup rows={typed.filter(isFilled)} {...actions} />
    <Group title="Other uploads" count={`${uploads.filter(isFilled).length} of ${uploads.length} filled`} rows={stillToFillFirst(uploads)} {...actions} />
  </div>;
}
