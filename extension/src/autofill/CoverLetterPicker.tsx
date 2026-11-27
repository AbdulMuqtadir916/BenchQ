import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { CoverLetter } from "../api";
import { ALERT, MOTION, MUTED_TEXT, TEXT_BUTTON } from "../ui";
import { CHECK, CHEVRON_DOWN_ICON, LETTER_ICON } from "./icons";
import type { CoverLetters } from "./use-cover-letters";

type CoverLetterPickerProps = {
  letters: CoverLetters;
  /** The cover letter Autofill attaches to the form's cover-letter upload; null for none. */
  pickedId: string | null;
  /** The form has a cover-letter upload to put it on. */
  hasField: boolean;
  isBusy: boolean;
  onPick: (id: string | null) => void;
  onRetry: () => void;
};

/** The résumé card's look (Simplify's), for the cover letter. */
const CARD = "grid flex-none gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-xs)]";
const SELECT = `group flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-left transition-[background,border-color] ${MOTION} hover:bg-[var(--color-surface-2)] aria-expanded:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50`;
const CHEVRON = "flex-none text-[var(--color-text-3)] [&_svg]:size-[var(--icon-md)] [&_svg]:-rotate-90 group-aria-expanded:[&_svg]:rotate-0";
const MENU = "absolute inset-x-0 top-full z-20 mt-1 grid max-h-60 gap-0.5 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)]";
const OPTION = `group/opt flex w-full min-w-0 items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary)] aria-pressed:hover:bg-[var(--color-primary-active)]`;
const TICK = "mt-0.5 flex-none text-[var(--color-primary)] group-aria-pressed/opt:text-[var(--color-primary-fg)] [&_svg]:size-[var(--icon-sm)]";
const NAME = "min-w-0 truncate text-sm font-[650] text-[var(--color-text)] group-aria-pressed/opt:text-[var(--color-primary-fg)]";
const WHEN = "text-caption text-[var(--color-text-3)] group-aria-pressed/opt:text-[var(--color-primary-fg)]";

const nameOf = (letter: CoverLetter) => letter.name?.trim() || "Cover letter";
/** "Nov 26": when it last changed, for telling two letters apart. */
const whenOf = (letter: CoverLetter) => {
  const at = Date.parse(letter.updated_at ?? letter.created_at ?? "");
  return Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
};

/** Which of the job's cover letters in BenchQ Autofill attaches, as the résumé's picker does: a select row on the one in
 * use, its list with "No cover letter" first. A click or Enter picks, the arrow keys move, Esc or a click outside closes.
 * The form's cover-letter upload gets the picked one as a PDF; without such an upload, the card says so. */
export default function CoverLetterPicker({ letters, pickedId, hasField, isBusy, onPick, onRetry }: CoverLetterPickerProps) {
  const [isListed, setIsListed] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (isListed) list.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
  }, [isListed]);
  useEffect(() => {
    if (!isListed) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsListed(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isListed]);
  if (letters.status === "none") return null;
  const head = <div className="flex min-w-0 items-center gap-2">
    <span className="flex-none text-[var(--color-text-2)] [&_svg]:size-[var(--icon-md)]" aria-hidden="true">{LETTER_ICON}</span>
    <h3 id="cover-letter-title" className="flex-none text-body-strong text-[var(--color-text)]">Cover letter</h3>
    {!hasField && <span data-slot="cover-letter-no-field" className="ml-auto text-caption text-[var(--color-text-3)]">No field found</span>}
  </div>;
  if (letters.status === "loading") {
    return <section data-slot="cover-letter-picker" className={CARD} aria-labelledby="cover-letter-title">
      {head}<p className={MUTED_TEXT} role="status">Loading cover letters…</p>
    </section>;
  }
  if (letters.status === "error") {
    return <section data-slot="cover-letter-picker" className={CARD} aria-labelledby="cover-letter-title">
      {head}
      <p className={ALERT} role="alert">Could not load the cover letters.</p>
      <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Try again</button>
    </section>;
  }
  const choices = letters.letters;
  if (choices.length === 0) {
    return <section data-slot="cover-letter-picker" className={CARD} aria-labelledby="cover-letter-title">
      {head}<p data-slot="cover-letter-none" className={MUTED_TEXT}>No cover letter for this job in BenchQ yet.</p>
    </section>;
  }
  const current = choices.find(({ id }) => id === pickedId) ?? null;
  const close = () => {
    setIsListed(false);
    select.current?.focus();
  };
  const pick = (id: string | null) => {
    close();
    if (id !== pickedId) onPick(id);
  };
  const onOptionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-slot='cover-letter-option']") ?? [])];
    const at = options.indexOf(event.currentTarget);
    options[event.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1)]?.focus();
  };
  const option = (id: string | null, name: string, when = "") => <li key={id ?? "none"}>
    <button type="button" data-slot="cover-letter-option" className={OPTION} disabled={isBusy} aria-pressed={id === pickedId}
      onKeyDown={onOptionKey} onClick={() => pick(id)}>
      <span className={`${TICK} ${id === pickedId ? "" : "invisible"}`} aria-hidden="true">{CHECK}</span>
      <span className="grid min-w-0 flex-1">
        <span className={NAME}>{name}</span>
        {when && <span className={WHEN}>Updated {when}</span>}
      </span>
    </button>
  </li>;
  return <section data-slot="cover-letter-picker" className={CARD} aria-labelledby="cover-letter-title">
    {head}
    <div ref={root} className="relative">
      <button ref={select} type="button" data-slot="cover-letter-select" className={SELECT} disabled={isBusy} aria-expanded={isListed}
        aria-controls={listId} aria-label={`Change the cover letter. In use: ${current ? nameOf(current) : "none"}`}
        onClick={() => setIsListed(!isListed)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || isListed) return;
          event.preventDefault();
          setIsListed(true);
        }}>
        <span className="min-w-0 flex-1 truncate text-sm font-[650] text-[var(--color-text)]">{current ? nameOf(current) : "No cover letter"}</span>
        <span className={CHEVRON} aria-hidden="true">{CHEVRON_DOWN_ICON}</span>
      </button>
      {isListed && <ul ref={list} id={listId} aria-labelledby="cover-letter-title" className={MENU}>
        {option(null, "No cover letter")}
        {choices.map((letter) => option(letter.id, nameOf(letter), whenOf(letter)))}
      </ul>}
    </div>
  </section>;
}
