import { useState, type KeyboardEvent, type ReactNode } from "react";
import { BELOW_TOP_BAR, MOTION } from "../ui";
import ChoicePicker from "./ChoicePicker";
import { isChoosable, ownOptions } from "./choices";
import { fieldLabel, filledValue } from "./form-memory";
import { BOOKMARK_ICON, CHECK, LIGHTBULB_ICON } from "./icons";
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
  onSave?: (row: ReviewRow, isOnlyThisResume: boolean) => Promise<boolean>;
};

type RowActions = Pick<ReviewListProps, "isFilling" | "onGoTo" | "onListOptions" | "onChoose" | "onSuggest" | "onSave">;

/** One line per field: its tick, its label, and what it holds. The row hangs into the margin, so ticks line up with the
 * heading above. */
const ROW = `-mx-1.5 flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 transition-[background] ${MOTION} aria-disabled:cursor-default aria-[disabled=false]:hover:bg-[var(--color-surface-2)]`;
const NOTE = "text-caption text-[var(--color-text-3)] wrap-anywhere";
/** The saved answers that might fit a question nothing matched: a box of their own, set apart from the field's row. */
const SUGGESTIONS = "ml-[calc(var(--icon-md)+var(--spacing)*2)] mt-1 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5";
const SUGGESTIONS_TITLE = "flex items-center gap-1.5 text-sm font-[550] text-[var(--color-text)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const LINK = "text-caption text-[var(--color-text-2)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline";
/** An answer longer than this shows four lines until "Show all". */
const LONG_ANSWER = 220;

/** Save for next time: a small pill in the primary tint, as Use is, with a bookmark. */
const SAVE_BUTTON = `inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[var(--color-primary-subtle)] px-2.5 py-1 text-left text-caption font-[650] text-[var(--color-primary)] wrap-anywhere transition-[border-color,background] ${MOTION} enabled:hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:text-[color-mix(in_srgb,var(--color-primary)_55%,transparent)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none`;
const SAVED = "flex items-center gap-1 text-caption font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
/** A checkbox in BenchQ's colours: the native box stays, unseen, for the keyboard and screen readers. */
const CHOICE_LABEL = "inline-flex cursor-pointer items-center gap-1.5 text-caption font-[550] text-[var(--color-text-2)] hover:text-[var(--color-text)]";
const CHECKBOX = `grid size-3.5 flex-none place-items-center rounded-[calc(var(--radius-sm)/2)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-primary-fg)] transition-[background,border-color] ${MOTION} peer-checked:border-[var(--color-primary)] peer-checked:bg-[var(--color-primary)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-focus-ring)] [&_svg]:size-2.5 [&_svg]:opacity-0 peer-checked:[&_svg]:opacity-100`;
/** Use, on a saved answer that might fit: a small pill in the primary tint. */
const USE = `inline-flex flex-none items-center rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-primary)_45%,transparent)] bg-[var(--color-primary-subtle)] px-2.5 py-1 text-caption font-[650] text-[var(--color-primary)] transition-[border-color,background] ${MOTION} hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50`;

/** Keeping a typed answer for next time (07 Q58): the button says what saving does, saving a new answer or updating the
 * one saved before (Q21), and "Only this résumé" keeps it to the picked résumé (Q22): that version, which other jobs may use too. */
function SaveAnswer({ row, isFilling, onSave }: { row: ReviewRow; isFilling: boolean; onSave: NonNullable<ReviewListProps["onSave"]> }) {
  const [isOnlyThisResume, setIsOnlyThisResume] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const offer = row.saveOffer;
  if (offer === "saved") return <p data-slot="review-saved-note" className={`pl-[calc(var(--icon-md)+var(--spacing)*2)] ${SAVED}`}>{CHECK}Saved for next time</p>;
  if (!offer) return null;
  const save = async () => {
    setIsSaving(true);
    await onSave(row, isOnlyThisResume);
    setIsSaving(false);
  };
  return <div data-slot="review-save" className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[calc(var(--icon-md)+var(--spacing)*2)]">
    <button type="button" className={SAVE_BUTTON} disabled={isFilling || isSaving} onClick={() => void save()}>{BOOKMARK_ICON}{isSaving ? "Saving…" : offer.label}</button>
    <label className={CHOICE_LABEL} title="Ticked: only the résumé picked now keeps this answer. Unticked: this résumé and every version of it (its tailored copies for other jobs) keep it.">
      <input type="checkbox" className="peer sr-only" checked={isOnlyThisResume} onChange={(event) => setIsOnlyThisResume(event.target.checked)} />
      <span className={CHECKBOX} aria-hidden="true">{CHECK}</span>Only this résumé
    </label>
  </div>;
}

const isFilled = (row: ReviewRow) => Boolean(filledValue(row));
const isUpload = ({ field }: ReviewRow) => field.kind === "file";
const isKept = (row: ReviewRow) => row.status === "kept";
/** Answers the BDE typed and can keep, or kept already (07 Q58). */
const isOfferedIn = (canSave: boolean) => (row: ReviewRow) => (typeof row.saveOffer === "object" || row.saveOffer === "saved") && canSave;

/** The fields still the BDE's to fill: neither an upload, a value the form held already, nor an answer to keep. The
 * list's Needs you group, and the count a finished run gives (AutofillDone). */
export function needsYou(rows: ReviewRow[], canSave: boolean): ReviewRow[] {
  const isOffered = isOfferedIn(canSave);
  return rows.filter((row) => !isUpload(row) && !isKept(row) && !isOffered(row) && !isFilled(row));
}

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
  return <div data-slot="review-jump" className={ROW} role="button" tabIndex={isFilling ? -1 : 0} aria-disabled={isFilling} title={row.reason && !row.field.current ? `${row.reason} Click to go to this field.` : "Go to this field on the form"} onClick={go} onKeyDown={onKeyDown}>
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
          <span data-slot="review-label" className="min-w-0 text-sm leading-snug text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
        </span>
        {value && <span data-slot="review-value" className="sr-only">{value}</span>}
        {!filled && note && <span data-slot="review-reason" className="sr-only">{note}</span>}
        {!filled && savedAnswers(row).map((answer) => <span key={answer} data-slot="review-saved" className="sr-only">Saved: {answer}</span>)}
      </span>
    </RowBody>
    {isChoosable(row) && !filled && actions.onListOptions && actions.onChoose && <div className="pl-[calc(var(--icon-md)+var(--spacing)*2)]">
      <ChoicePicker row={row} isFilling={actions.isFilling} known={ownOptions(row.field) ?? undefined} onListOptions={actions.onListOptions} onChoose={actions.onChoose} />
    </div>}
    {/* A question with its own answers (Yes or No, a list) is answered from them: saved answers to other questions
        would only crowd them out. */}
    {row.suggestions && !filled && actions.onSuggest && !(isChoosable(row) && ownOptions(row.field)) && <Suggestions row={row} suggestions={row.suggestions} isFilling={actions.isFilling} onSuggest={actions.onSuggest} />}
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
    <button type="button" data-slot="suggestion-use" className={USE} disabled={isFilling}
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

/** A section heading as the design mock has it: small capitals, wide spacing, coloured by what the section means. */
const SECTION_TITLE = "text-sm font-[700] text-[var(--color-text)]";
const COUNT = "font-[450] text-[var(--color-text-3)]";
/** A small action on a line: Replace, Replace all. */
const TEXT_ACTION = "flex-none text-caption font-[600] text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50";


function Group({ title, count, rows, slot, action, ...actions }: RowActions & { title: string; count: string; rows: ReviewRow[]; slot?: string; action?: ReactNode }) {
  if (rows.length === 0) return null;
  // A section the panel scrolls to stops under the sticky top bar.
  return <section data-slot={slot} className={`grid min-w-0 gap-1 ${slot ? BELOW_TOP_BAR : ""}`} aria-label={title}>
    <div className="flex items-center justify-between gap-2">
      <h3 data-slot={slot && `${slot}-title`} tabIndex={slot ? -1 : undefined} className={SECTION_TITLE}>{title} <span className={COUNT}>({count})</span></h3>
      {action}
    </div>
    <ul className="grid gap-0.5">{rows.map((row) => <Row key={row.key} row={row} {...actions} />)}</ul>
  </section>;
}

/** Values the form held before BenchQ looked, typed earlier or filled by the site, that differ from the saved answers.
 * Autofill leaves them: Replace writes the saved answer over one, Replace all over every one. Each is one plain line, as
 * the list's other rows: the field, what the form holds struck through, then the saved answer. */
function KeptGroup({ rows, isFilling, onGoTo, onReplace }: RowActions & { rows: ReviewRow[]; onReplace?: ReviewListProps["onReplace"] }) {
  if (rows.length === 0) return null;
  return <section data-slot="review-kept" className="grid min-w-0 gap-1" aria-label="Already on the form">
    <div className="flex items-center justify-between gap-2">
      <h3 className={SECTION_TITLE}>Already on the form <span className={COUNT}>({rows.length})</span></h3>
      {onReplace && rows.length > 1 && <button type="button" className={TEXT_ACTION} disabled={isFilling} onClick={() => onReplace(rows)}>Replace all</button>}
    </div>
    <p className={NOTE}>These differ from the saved answers, so Autofill leaves them.</p>
    <ul className="grid gap-0.5">{rows.map((row) => <li key={row.key} data-slot="review-row" className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <RowBody row={row} isFilling={isFilling} onGoTo={onGoTo}>
          <Tick isFilled slot="review-tick" />
          <span className="min-w-0 flex-1 text-sm leading-snug wrap-anywhere">
            <span data-slot="review-label" className="text-[var(--color-text)]">{fieldLabel(row.field)}</span>{" "}
            <span data-slot="review-value" className="text-[var(--color-text-3)] line-through" title={row.field.current}><span className="sr-only">On the form: </span>{row.field.current}</span>
            {row.proposed && <>{" "}<span data-slot="review-proposed" className="font-[600] text-[var(--color-success-fg)]"><span aria-hidden="true">→ </span><span className="sr-only">Saved answer: </span>{row.proposed}</span></>}
            <span data-slot="review-saved" className="sr-only">Saved: {row.proposed}</span>
          </span>
        </RowBody>
      </div>
      {onReplace && <button type="button" className={`mt-1 ${TEXT_ACTION}`} disabled={isFilling} aria-label={`Replace ${fieldLabel(row.field)} with the saved answer`} onClick={() => onReplace([row])}>Replace</button>}
    </li>)}</ul>
  </section>;
}

/** The form's fields and what each holds, as Simplify lists them once it has filled a form: what the form already held
 * that differs from the saved answers and answers to keep first, then the required fields and the optional ones, each in
 * the form's order, ticked once filled, then any upload the Resume and Cover letter sections don't stand for. Labels and values come from the employer's page and render as plain text. */
export default function ReviewList({ rows, isFilling, onGoTo, onReplace, onListOptions, onChoose, onSuggest, onSave }: ReviewListProps) {
  const actions = { isFilling, onGoTo, onListOptions, onChoose, onSuggest, onSave };
  // Answers the BDE typed and can keep come first, in sight, until they're saved (07 Q58).
  // A saved one stays there, saying so, rather than folding away the moment it's kept.
  const isOffered = isOfferedIn(Boolean(onSave));
  // The uploads too, the résumé's and the cover letter's among them: fields like any other.
  const fields = rows.filter((row) => !isKept(row) && !isOffered(row));
  const required = fields.filter(({ field }) => field.required);
  const optional = fields.filter(({ field }) => !field.required);
  const isOptionalLeft = optional.some((row) => !isFilled(row));
  const filledOf = (list: ReviewRow[]) => `${list.filter(isFilled).length} of ${list.length} filled`;
  // Where the BDE takes over once Autofill is done: the panel scrolls to the first section with a field left.
  const isRequiredLeft = required.some((row) => !isFilled(row));
  // In the panel's fields section, which scrolls between the résumé and the actions, as Simplify's field list does.
  return <div data-slot="review" className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <KeptGroup rows={rows.filter(isKept)} onReplace={onReplace} {...actions} />
    <Group title="Save for next time" count={String(rows.filter(isOffered).length)} rows={rows.filter(isOffered)} {...actions} />
    <Group title="Required" count={filledOf(required)} slot={isRequiredLeft ? "review-needed" : undefined} rows={required} {...actions} />
    <Group title="Optional" count={filledOf(optional)} slot={!isRequiredLeft && isOptionalLeft ? "review-needed" : undefined} rows={optional} {...actions} />
  </div>;
}
