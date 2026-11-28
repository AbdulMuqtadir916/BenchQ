import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MOTION } from "../ui";
import { ALERT_ICON, CHECK, CHEVRON_DOWN_ICON, SEARCH_ICON, SPINNER_ICON } from "./icons";
import type { ReviewRow } from "./types";

type ChoicePickerProps = {
  row: ReviewRow;
  isFilling: boolean;
  /** The answers the question shows on the form (`ownOptions`): a few are buttons to press, more a list to open. */
  known?: string[];
  onListOptions: (row: ReviewRow) => Promise<string[] | null>;
  onChoose: (row: ReviewRow, label: string) => void;
};

/** One answer of a short question (Yes, No, Prefer not to say): pressed, it goes on the form. */
const ANSWER = `inline-flex min-h-[var(--control-sm)] max-w-full items-center rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-left text-sm font-[550] text-[var(--color-text)] wrap-anywhere transition-[background,border-color,color] ${MOTION} enabled:hover:border-[var(--color-primary)] enabled:hover:bg-[var(--color-primary-subtle)] enabled:hover:text-[var(--color-primary-subtle-fg)] disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:text-[var(--color-text-3)]`;
/** A question with this many answers or fewer shows them as buttons. */
const BUTTONS_UP_TO = 4;

/** The picker, closed, as the résumé picker's box: what it's for and a chevron. Open, it's the options' search. */
const BOX = `flex min-w-0 items-stretch rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] transition-[border-color,box-shadow] ${MOTION} focus-within:border-[var(--color-primary)] focus-within:shadow-[var(--ring-input)]`;
const OPEN = `flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-[550] text-[var(--color-text-2)] transition-[background,color] ${MOTION} hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;
const TITLE = "flex min-w-0 flex-1 items-center px-3 py-2 text-sm font-[550] text-[var(--color-text)]";
const CHEVRON = "ml-auto text-[var(--color-text-3)]";
const SPIN = "animate-spin text-[var(--color-primary)] motion-reduce:animate-none";
const SEARCH_ROW = "flex min-w-0 flex-1 items-center gap-2 pl-3 text-[var(--color-text-3)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
const SEARCH = "min-w-0 flex-1 bg-transparent py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus-visible:outline-none";
const CLOSE = `grid w-9 flex-none place-items-center text-[var(--color-text-3)] transition-[color] ${MOTION} hover:text-[var(--color-text)] [&_svg]:size-[var(--icon-md)] [&_svg]:rotate-180`;
/** The options under it, in a card of their own: each one a row that lights up as it's pointed at. */
const MENU = "mt-1 grid gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-sm)]";
const OPTION = `group/opt flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm text-[var(--color-text)] transition-[background,color] ${MOTION} hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary-subtle-fg)] focus-visible:bg-[var(--color-primary-subtle)] focus-visible:text-[var(--color-primary-subtle-fg)] disabled:cursor-not-allowed disabled:opacity-50`;
const PICK_MARK = "flex-none text-[var(--color-primary)] opacity-0 transition-opacity group-hover/opt:opacity-100 group-focus-visible/opt:opacity-100 [&_svg]:size-[var(--icon-sm)]";
const MORE = "justify-self-start rounded-[var(--radius-sm)] px-2.5 py-1 text-caption font-[600] text-[var(--color-primary)] hover:underline";
const QUIET = "px-2.5 py-1.5 text-caption text-[var(--color-text-3)]";
const NONE = "mt-1 flex items-start gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-2.5 py-2 text-caption text-[var(--color-text-2)] [&_svg]:mt-px [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:text-[var(--color-warning-fg)]";
/** No scroll inside the panel (07 Q54): the first few, then all of them on request. */
const SHOWN_OPTIONS = 8;
/** A list longer than this gets a search box. */
const SEARCH_FROM = 6;

/** For a dropdown Autofill found no clear option in: its options, read from the form when the BDE asks, to pick one
 * here. BenchQ then selects it on the page. Arrow keys move through the options and Esc closes them. */
export default function ChoicePicker({ row, isFilling, known, onListOptions, onChoose }: ChoicePickerProps) {
  const [options, setOptions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isAll, setIsAll] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const isClosing = useRef(false);
  const label = row.field.label || "this field";

  const isShown = isOpen && options !== null && options.length > 0;
  useEffect(() => {
    if (isShown) (searchBox.current ?? list.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [isShown]);
  useEffect(() => {
    if (isOpen || !isClosing.current) return;
    isClosing.current = false;
    openButton.current?.focus();
  }, [isOpen]);

  const open = async () => {
    setIsOpen(true);
    if (options !== null) return;
    if (known) {
      setOptions(known);
      return;
    }
    setIsLoading(true);
    setOptions((await onListOptions(row)) ?? []);
    setIsLoading(false);
  };
  const close = (isByKey = false) => {
    isClosing.current = isByKey;
    setIsOpen(false);
    setQuery("");
    setIsAll(false);
  };
  const choose = (option: string) => {
    close();
    onChoose(row, option);
  };

  // Yes or No, and other short questions: their answers as buttons, one press each, whether the form shows them or a
  // dropdown's were just read from the page.
  const short = known ?? (isOpen && options !== null && options.length > 0 ? options : null);
  if (short && short.length > 0 && short.length <= BUTTONS_UP_TO) {
    return <div data-slot="choice-list" role="group" aria-label={`Answers for ${label}`} className="mt-1 flex flex-wrap gap-1.5">
      {short.map((option) => <button key={option} type="button" data-slot="choice-answer" className={ANSWER} disabled={isFilling} onClick={() => onChoose(row, option)}>
        {option}
      </button>)}
    </div>;
  }
  if (!isOpen || options === null) {
    return <div className={`mt-1 ${BOX}`}>
      <button ref={openButton} type="button" data-slot="choice-open" className={OPEN} disabled={isFilling || isLoading} aria-expanded={false} onClick={() => void open()}>
        {isLoading ? <><span className={SPIN} aria-hidden="true">{SPINNER_ICON}</span>Reading the options…</>
          : <>Choose an option<span className={CHEVRON} aria-hidden="true">{CHEVRON_DOWN_ICON}</span></>}
      </button>
    </div>;
  }
  if (options.length === 0) {
    return <p data-slot="choice-none" className={NONE} role="status">{ALERT_ICON}<span>BenchQ couldn&apos;t read this dropdown&apos;s options. Choose one on the page.</span></p>;
  }
  const wanted = query.trim().toLowerCase();
  const matching = wanted ? options.filter((option) => option.toLowerCase().includes(wanted)) : options;
  const shown = isAll ? matching : matching.slice(0, SHOWN_OPTIONS);
  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const onListKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(at + 1, all.length - 1) : at - 1;
    if (next < 0) searchBox.current?.focus();
    else all[next]?.focus();
  };

  return <div className="mt-1" onKeyDown={onListKey}>
    <div className={BOX}>
      {options.length > SEARCH_FROM ? <label className={SEARCH_ROW}>
        {SEARCH_ICON}
        <input ref={searchBox} type="search" data-slot="choice-search" className={SEARCH} value={query} placeholder={`Search ${options.length} options`}
          aria-label={`Search the options for ${label}`} onChange={(event) => { setQuery(event.target.value); setIsAll(false); }}
          onKeyDown={(event) => {
            // Enter takes the one option the search leaves.
            if (event.key === "Enter" && matching.length === 1) {
              event.preventDefault();
              choose(matching[0]!);
            }
          }} />
      </label> : <span className={TITLE}>Choose an option</span>}
      <button type="button" data-slot="choice-close" className={CLOSE} aria-label="Close the options" onClick={() => close(true)}>{CHEVRON_DOWN_ICON}</button>
    </div>
    <div className={MENU}>
      <ul ref={list} data-slot="choice-list" className="grid gap-0.5" aria-label={`Options for ${label}`}>
        {shown.map((option) => <li key={option}>
          <button type="button" className={OPTION} disabled={isFilling} onClick={() => choose(option)}>
            <span className="min-w-0 flex-1 wrap-anywhere">{option}</span><span className={PICK_MARK} aria-hidden="true">{CHECK}</span>
          </button>
        </li>)}
      </ul>
      {matching.length === 0 && <p data-slot="choice-no-match" className={QUIET}>No option matches “{query.trim()}”.</p>}
      {shown.length < matching.length && <button type="button" data-slot="choice-all" className={MORE} onClick={() => setIsAll(true)}>
        Show all {matching.length} options
      </button>}
    </div>
  </div>;
}
