import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ALERT, button, EYEBROW, MOTION, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON } from "../ui";
import { CHECK, CHEVRON_DOWN_ICON, EXTERNAL_ICON, EYE_ICON, RESUME_ICON, SEARCH_ICON, SPARKLES_ICON } from "./icons";
import type { ResumeChoice } from "./resume-choices";
import type { Resumes } from "./use-resumes";

type ResumePickerProps = {
  resumes: Resumes;
  candidateName: string;
  /** The candidate's Resumes tab on the website, for a candidate with none yet. */
  resumesUrl: string | null;
  /** One version in the website's studio, when the panel can link there. */
  studioUrl: (versionId: string) => string | null;
  isBusy: boolean;
  onPick: (id: string) => void;
  onRetry: () => void;
  onRetryContext: () => void;
  /** Tailor the résumé for this job, in the panel's tailoring view (Simplify's Tailor Resume under the résumé). */
  onTailor?: () => void;
  /** Folded to its heading, with the résumé in use named in it: once the form is filled, the fields take the room. */
  isFolded?: boolean;
  /** Folds or unfolds the card; without it the card stays open, with no chevron. */
  onFold?: () => void;
  /** Under the résumé, folded or not: what its file needs the BDE for (their own file, a file that couldn't be made). */
  fileLine?: ReactNode;
  /** Once the form is filled: the résumé's row alone, so the fields keep the room. */
  isCompact?: boolean;
};

/** The design's résumé section: its name in small capitals with Tailor beside it, then the résumé in use. */
const CARD = "grid flex-none gap-2";
const HEAD = "flex min-w-0 items-center gap-2";
const LABEL = "flex-none text-caption font-[700] uppercase tracking-widest text-[var(--color-text-3)]";
const FOLD = `grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-3)] transition-[background,color] ${MOTION} hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] [&_svg]:size-[var(--icon-md)] [&_svg]:transition-transform aria-expanded:[&_svg]:rotate-180 motion-reduce:[&_svg]:transition-none`;
/** The résumé in use and its eye, joined in one box, as Simplify's row. */
const BOX = "flex min-w-0 items-stretch rounded-[var(--radius-lg)] border border-[var(--color-primary)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)] focus-within:shadow-[var(--ring-input)]";
/** The résumé in use, as a select: the whole row opens the list (07 Q55), its › says so. */
const SELECT = `group flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50`;
/** The résumé's file mark at the row's start, in the primary blue. */
const FILE_MARK = "flex-none text-[var(--color-primary)] [&_svg]:size-5";
const CHEVRON = "flex-none text-[var(--color-text-3)] [&_svg]:size-[var(--icon-md)] [&_svg]:-rotate-90";
/** Open, the row is the search, as in Simplify: type to find a résumé, ⌃ closes the list. */
const SEARCH_ROW = "flex min-w-0 flex-1 items-center gap-2 pl-3";
/** The box's blue border shows the search has the focus, so the field draws no outline of its own inside it. */
const SEARCH = "min-w-0 flex-1 bg-transparent py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus-visible:outline-none";
const SEARCH_MARK = "flex-none text-[var(--color-text-3)] [&_svg]:size-[var(--icon-sm)]";
const CLOSE = `grid w-9 flex-none place-items-center text-[var(--color-text-3)] transition-[color] ${MOTION} hover:text-[var(--color-text)] [&_svg]:size-[var(--icon-md)] [&_svg]:rotate-180`;
/** The eye on the row's right, past a hairline: the résumé in use, previewed in BenchQ. */
const EYE = `grid w-11 flex-none place-items-center border-l border-[var(--color-border)] text-[var(--color-primary)] transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] [&_svg]:size-[var(--icon-md)]`;
/** The open list: a menu over what's below it, scrolling when there are many. */
const MENU = "absolute inset-x-0 top-full z-20 mt-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)]";
const OPTIONS = "grid max-h-60 overflow-y-auto overscroll-contain [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
const NO_MATCH = "px-2 py-1.5 text-caption text-[var(--color-text-3)]";
/** One résumé in the open list: the whole row picks it; the one in use is filled blue, as Simplify's. */
const OPTION = `group/opt flex w-full min-w-0 items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary)] aria-pressed:hover:bg-[var(--color-primary-active)] disabled:cursor-not-allowed disabled:opacity-50`;
const TICK = "mt-0.5 flex-none text-[var(--color-primary)] group-aria-pressed/opt:text-[var(--color-primary-fg)] [&_svg]:size-[var(--icon-sm)]";
const TAG = "flex-none rounded-[var(--radius-sm)] border px-1.5 text-caption font-[700] uppercase tracking-wide";
/** The base in use, tagged as the website tags it (its blue Active tag). */
const ACTIVE = `${TAG} border-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]`;
/** A résumé tailored for this job, tagged as the website tags one (its teal Tailored tag). */
const TAILORED = `${TAG} border-[color-mix(in_srgb,var(--color-teal-fg)_35%,transparent)] bg-[var(--color-teal-bg)] text-[var(--color-teal-fg)]`;
/** A group's name in the open list: this job's tailored résumés, then the bases. */
const GROUP = `px-2 pt-1.5 pb-0.5 ${EYEBROW}`;
/** Under the list: another résumé is added in BenchQ. */
const ADD = "mt-1 flex items-center gap-1 border-t border-[var(--color-border)] px-2.5 pt-1.5 pb-1 text-caption font-[550] text-[var(--color-text-2)] hover:text-[var(--color-primary)] [&_svg]:size-[var(--icon-sm)]";
/** The design's Tailor resume: a blue link with its sparkles, beside the section's name. */
const TAILOR = "inline-flex items-center gap-1 text-caption font-[700] text-[var(--color-primary)] hover:underline [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

const resumesCount = (count: number) => `${count} resume${count === 1 ? "" : "s"}`;

/** The card: its mark and "Resume", how many the candidate has once they're known (07 Q5), and, folded, the résumé in
 * use, then the rest. */
function Section({ count, folded, action, isFolded = false, onFold, footer = null, isCompact = false, children }: { count?: number; folded?: ReactNode; action?: ReactNode; isFolded?: boolean; onFold?: () => void; footer?: ReactNode; isCompact?: boolean; children: ReactNode }) {
  // Compact: the row alone, its name said for screen readers.
  if (isCompact) {
    return <section data-slot="resume-picker" className="grid flex-none" aria-labelledby="resume-picker-title">
      <h3 id="resume-picker-title" className="sr-only">Resume</h3>
      {count ? <span data-slot="resume-count" className="sr-only">{resumesCount(count)}</span> : null}
      {children}
    </section>;
  }
  return <section data-slot="resume-picker" className={CARD} aria-labelledby="resume-picker-title">
    <div className={HEAD}>
      <h3 id="resume-picker-title" className={LABEL}>Resume</h3>
      {count ? <span data-slot="resume-count" className="sr-only">{resumesCount(count)}</span> : null}
      {isFolded && folded}
      {!isFolded && action && <span className="ml-auto flex-none">{action}</span>}
      {onFold && <button type="button" data-slot="resume-fold" className={`${FOLD} ${isFolded || !action ? "ml-auto" : ""}`} aria-expanded={!isFolded}
        aria-label={isFolded ? "Show the resume" : "Fold the resume"} onClick={onFold}>{CHEVRON_DOWN_ICON}</button>}
    </div>
    {!isFolded && children}
    {footer}
  </section>;
}

/** A résumé in two short lines: its role with its tag right after it, where it's seen at a glance (Tailored for one made
 * for this job, Active for the base the candidate's workflow uses, picked in BenchQ), then which base it is (or was
 * tailored from) and its version. Without a role, that base line heads it, with the tag. In the open list, the one in use
 * is white on blue. */
function Named({ choice, isClipped = false, isOneLine = false }: { choice: ResumeChoice; isClipped?: boolean; isOneLine?: boolean }) {
  const tag = choice.isTailored ? <span data-slot="resume-tailored" className={TAILORED}>Tailored</span>
    : choice.isActive ? <span data-slot="resume-active" className={ACTIVE}>Active</span> : null;
  return <span className="grid min-w-0 flex-1">
    <span className="flex min-w-0 items-center gap-1.5">
      <span data-slot="resume-picked" className={`min-w-0 text-sm font-[650] text-[var(--color-text)] group-aria-pressed/opt:text-[var(--color-primary-fg)] ${isClipped ? "truncate" : "wrap-anywhere"}`}
        title={isClipped ? `${choice.title ?? choice.meta}${choice.title ? ` · ${choice.meta}` : ""}` : undefined}>{choice.title ?? choice.meta}</span>
      {tag}
    </span>
    {/* On the select's one row (Simplify's), which base and version is said, not shown. */}
    {choice.title && <span className={isOneLine ? "sr-only" : `text-caption text-[var(--color-text-3)] group-aria-pressed/opt:text-[var(--color-primary-fg)] ${isClipped ? "truncate" : "wrap-anywhere"}`}>{choice.meta}</span>}
  </span>;
}

/** Which résumé Autofill answers from (docs/02 §8.1), as Simplify's résumé card. Several: the one in use as a select row
 * with its eye; a click opens the list, the row becoming its search, this job's tailored ones first, one row each (07
 * Q55). A click or Enter on a row picks it, the arrow keys, Home and End move through them, and Esc or a click outside
 * closes the list. Picking reads that résumé's answers and fills the form at once when it's on the page (the panel does
 * that), its file first when BenchQ has one. One résumé shows the same row, its list with a way to add another in BenchQ. */
export default function ResumePicker({ resumes, candidateName, resumesUrl, studioUrl, isBusy, onPick, onRetry, onRetryContext, onTailor, isFolded = false, onFold, fileLine = null, isCompact = false }: ResumePickerProps) {
  const [isListed, setIsListed] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Opened from the keyboard, the list starts on the résumé in use, for the arrow keys; opened with a click, at the search.
  const isByKey = useRef(false);
  // The select comes back once the list closes, and the focus with it, when the list had it.
  const isRefocus = useRef(false);
  useEffect(() => {
    if (isListed) {
      if (isByKey.current) list.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
      else search.current?.focus();
    } else if (isRefocus.current) {
      isRefocus.current = false;
      select.current?.focus();
    }
  }, [isListed]);
  // A click anywhere outside the list closes it, as a dropdown does.
  useEffect(() => {
    if (!isListed) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsListed(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isListed]);
  if (resumes.status === "loading") {
    return <Section><p className={MUTED_TEXT} role="status">Loading {candidateName}&apos;s resumes…</p></Section>;
  }
  if (resumes.status === "error") {
    return <Section>
      <p className={ALERT} role="alert">Could not load {candidateName}&apos;s resumes.</p>
      <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Try again</button>
    </Section>;
  }
  if (resumes.status === "unavailable") {
    return <Section>
      <p className={ALERT} role="alert">Could not confirm this connected job in BenchQ. Reload it before filling or marking applied.</p>
      <button type="button" className={TEXT_BUTTON} onClick={onRetryContext}>Reload jobs</button>
    </Section>;
  }
  if (resumes.status === "missing") {
    return <Section>
      <p className={ALERT} role="alert">The resume saved with this application is no longer available. Restore it in BenchQ, then reload the resumes before filling.</p>
      {resumesUrl && <a className={`justify-self-start ${button("secondary", "compact")}`} href={resumesUrl} target="_blank" rel="noreferrer">Open resumes in BenchQ{EXTERNAL_ICON}</a>}
      <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Reload resumes</button>
    </Section>;
  }
  const { choices, picked } = resumes;
  const current = picked ?? choices[0];
  if (!current) {
    return <Section>
      <p className={SOFT_TEXT}>{candidateName} has no resume in BenchQ yet, so there are no answers to fill.</p>
      {resumesUrl && <a className={`justify-self-start ${button("secondary", "compact")}`} href={resumesUrl} target="_blank" rel="noreferrer">Add one in BenchQ{EXTERNAL_ICON}</a>}
    </Section>;
  }
  const viewUrl = studioUrl(current.id);
  const folded = <span data-slot="resume-folded" className="min-w-0 truncate text-sm text-[var(--color-text-2)]">· {current.title ?? current.meta}</span>;
  const tailor = onTailor && <button type="button" data-slot="resume-tailor" className={TAILOR} onClick={onTailor}>{SPARKLES_ICON}Tailor résumé</button>;
  const close = () => {
    isRefocus.current = true;
    setIsListed(false);
  };
  // Each time the list opens it shows every résumé: no search left over from the last time.
  const open = (isKey: boolean) => {
    isByKey.current = isKey;
    setQuery("");
    setIsListed(true);
  };
  const onSelectKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" && !isListed) {
      event.preventDefault();
      open(true);
    }
  };
  const onOptionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // A letter typed on a row goes to the search, which takes it from there.
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      search.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    // Through both groups, in the order they show; up from the first row is the search.
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-slot='resume-option']") ?? [])];
    const at = options.indexOf(event.currentTarget);
    if (event.key === "ArrowUp" && at === 0) {
      search.current?.focus();
      return;
    }
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1);
    options[next]?.focus();
  };
  // This job's tailored résumés, then the bases: each group named when there are both. A search keeps the résumés
  // whose role, base or version has its words.
  const needle = query.trim().toLowerCase();
  const isShown = ({ title, meta, label }: ResumeChoice) => !needle || [title ?? "", meta, label].some((text) => text.toLowerCase().includes(needle));
  const groups = [
    { key: "tailored", title: "Tailored for this job", choices: choices.filter(({ isTailored, isOtherJob }) => isTailored && !isOtherJob) },
    { key: "bases", title: "Base resumes", choices: choices.filter(({ isTailored, isOtherJob }) => !isTailored || isOtherJob) },
  ].map((group) => ({ ...group, choices: group.choices.filter(isShown) })).filter((group) => group.choices.length > 0);
  const isGrouped = groups.length > 1;
  // The one in use only closes the list: picking it again would fill the form again.
  const pick = (id: string) => {
    close();
    if (id !== current.id) onPick(id);
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Esc clears the search first, then closes the list.
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery("");
      else close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      list.current?.querySelector<HTMLButtonElement>("[data-slot='resume-option']")?.focus();
    } else if (event.key === "Enter") {
      // Enter picks the first résumé the search shows.
      event.preventDefault();
      const first = groups[0]?.choices[0];
      if (first) pick(first.id);
    }
  };
  return <Section count={choices.length} folded={folded} action={tailor} isFolded={isFolded} onFold={onFold} footer={fileLine} isCompact={isCompact}>
    <div ref={root} className="relative">
      {/* The résumé in use and its eye in one box; open, the row is the list's search. */}
      <div className={BOX}>
        <button ref={select} type="button" data-slot="resume-select" className={`${SELECT} ${viewUrl ? "rounded-l-[var(--radius-md)]" : "rounded-[var(--radius-md)]"}`}
          hidden={isListed} disabled={isBusy} aria-expanded={isListed} aria-controls={listId}
          aria-label={`Change the resume, ${resumesCount(choices.length)} to choose from. In use: ${current.label}`}
          onKeyDown={onSelectKey} onClick={() => open(false)}>
          <span className={FILE_MARK} aria-hidden="true">{RESUME_ICON}</span>
          <Named choice={current} isClipped isOneLine />
          <span data-slot="resume-change" className={CHEVRON} aria-hidden="true">{CHEVRON_DOWN_ICON}</span>
        </button>
        {isListed && <div className={SEARCH_ROW}>
          <span className={SEARCH_MARK} aria-hidden="true">{SEARCH_ICON}</span>
          <input ref={search} type="search" data-slot="resume-search" className={SEARCH} value={query} placeholder="Search…"
            aria-label="Search resumes" aria-controls={listId} autoComplete="off" spellCheck={false}
            onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} />
          <button type="button" data-slot="resume-close" className={CLOSE} aria-label="Close the resume list" onClick={close}>{CHEVRON_DOWN_ICON}</button>
        </div>}
        {viewUrl && <a data-slot="resume-view" className={`${EYE} rounded-r-[var(--radius-md)]`} href={viewUrl} target="_blank" rel="noreferrer"
          aria-label={`View ${current.label} in BenchQ`} title="Preview in BenchQ">{EYE_ICON}</a>}
      </div>
      {isListed && <div ref={list} id={listId} role="group" aria-labelledby="resume-picker-title" className={MENU}>
        <div className={OPTIONS}>
          {groups.map((group) => <div key={group.key} data-slot="resume-group" data-group={group.key} className="grid gap-0.5">
            {isGrouped && <p id={`${listId}-${group.key}`} data-slot="resume-group-title" className={GROUP}>{group.title}</p>}
            <ul className="grid gap-0.5" aria-labelledby={isGrouped ? `${listId}-${group.key}` : "resume-picker-title"}>
              {group.choices.map((choice) => {
                const isPicked = choice.id === current.id;
                return <li key={choice.id} data-slot="resume-choice">
                  <button type="button" data-slot="resume-option" className={OPTION} disabled={isBusy} aria-pressed={isPicked}
                    onKeyDown={onOptionKey} onClick={() => pick(choice.id)}>
                    <span className={`${TICK} ${isPicked ? "" : "invisible"}`} aria-hidden="true">{CHECK}</span>
                    <Named choice={choice} />
                  </button>
                </li>;
              })}
            </ul>
          </div>)}
          {/* Said as it happens: a search that leaves no résumé. */}
          <p data-slot="resume-no-match" role="status" className={groups.length ? "sr-only" : NO_MATCH}>
            {groups.length ? "" : `No resume matches “${query.trim()}”.`}
          </p>
        </div>
        {resumesUrl && <a data-slot="resume-add" className={ADD} href={resumesUrl} target="_blank" rel="noreferrer">Add another in BenchQ{EXTERNAL_ICON}</a>}
      </div>}
    </div>
  </Section>;
}
