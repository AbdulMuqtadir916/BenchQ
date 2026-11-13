import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ALERT, button, EYEBROW, ICON_BUTTON_QUIET, MOTION, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON } from "../ui";
import { CHECK, CHEVRON_DOWN_ICON, EXTERNAL_ICON, RESUME_ICON } from "./icons";
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
  /** At the section's foot once the résumés are in: Tailor for this job. */
  footer?: ReactNode;
};

const SECTION = "grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5";
/** The one résumé, as text: no border, so it doesn't pass for a dropdown that won't open. */
const PLAIN = "flex min-w-0 flex-1 items-center gap-2 px-0.5";
const CHANGE = "flex flex-none items-center gap-1 text-sm font-[550] text-[var(--color-text-2)] [&_svg]:size-[var(--icon-md)] [&_svg]:text-[var(--color-text-3)] [&_svg]:transition-transform motion-reduce:[&_svg]:transition-none";
const TITLE = "flex min-w-0 items-center gap-1.5 text-sm font-[550] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const LINK = `justify-self-start ${button("secondary", "compact")}`;
/** The résumé in use, as a select: the whole row opens the list (07 Q55), and says so with "Change ▾". */
const SELECT = `group flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left transition-[background,border-color] ${MOTION} hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50`;
/** One résumé in the open list: the whole row picks it; the one in use is ticked. */
const OPTION = `flex min-w-0 flex-1 items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-[background] ${MOTION} hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-subtle)] disabled:cursor-not-allowed disabled:opacity-50`;
const TICK = "mt-0.5 flex-none text-[var(--color-primary)] [&_svg]:size-[var(--icon-md)]";
const TAG = "flex-none rounded-full px-1.5 text-caption font-[550]";
/** The base in use, tagged as the website tags it (its blue Active tag). */
const ACTIVE = `${TAG} bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]`;
/** A résumé tailored for this job, tagged as the website tags one (its teal Tailored tag). */
const TAILORED = `${TAG} bg-[var(--color-teal-bg)] text-[var(--color-teal-fg)]`;
/** A group's name in the open list: this job's tailored résumés, then the bases. */
const GROUP = `px-2 pt-1.5 pb-0.5 ${EYEBROW}`;

const resumesCount = (count: number) => `${count} resume${count === 1 ? "" : "s"}`;

/** The section, titled with how many résumés the candidate has once they're known (07 Q5): "Resume to use · 3 resumes":
 * the résumé whose answers fill the form, in plain words. */
function Section({ count, children }: { count?: number; children: ReactNode }) {
  return <section data-slot="resume-picker" className={SECTION} aria-labelledby="resume-picker-title">
    <h3 id="resume-picker-title" className={TITLE}>
      {RESUME_ICON}Resume to use
      {count ? <span data-slot="resume-count" className="font-normal text-[var(--color-text-3)]">· {resumesCount(count)}</span> : null}
    </h3>
    {children}
  </section>;
}

/** The résumé in BenchQ's studio, as a small icon beside its row. */
function ViewLink({ url, choice }: { url: string | null; choice: ResumeChoice }) {
  return url ? <a className={ICON_BUTTON_QUIET} href={url} target="_blank" rel="noreferrer" aria-label={`View ${choice.label} in BenchQ`} title="View in BenchQ">{EXTERNAL_ICON}</a> : null;
}

/** A résumé in two lines: its role across the whole row, then which base it is (or was tailored from) and its version,
 * with its tag after them: Tailored for one made for this job, Active for the base the candidate's workflow uses (picked
 * in BenchQ). Without a role, that second line heads it, and the tag sits under it. */
function Named({ choice }: { choice: ResumeChoice }) {
  const tag = choice.isTailored ? <span data-slot="resume-tailored" className={TAILORED}>Tailored</span>
    : choice.isActive ? <span data-slot="resume-active" className={ACTIVE}>Active</span> : null;
  return <span className="grid min-w-0 flex-1 gap-0.5">
    <span data-slot="resume-picked" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{choice.title ?? choice.meta}</span>
    {(choice.title || tag) && <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {choice.title && <span className={`${MUTED_TEXT} wrap-anywhere`}>{choice.meta}</span>}
      {tag}
    </span>}
  </span>;
}

/** Which résumé Autofill answers from (docs/02 §8.1), with how many the candidate has in the title. Several: closed by
 * default on the one in use, a select-style row whose "Change ▾" opens the candidate's résumés, one row each (07 Q55). A
 * click or Enter on a row picks it, the arrow keys move through them, and Esc closes the list. Picking reads that
 * résumé's answers and fills the form at once when it's on the page (the panel does that), its file first when BenchQ
 * has one. One résumé is plain text that says it's the only one, with a way to add another in BenchQ. */
export default function ResumePicker({ resumes, candidateName, resumesUrl, studioUrl, isBusy, onPick, onRetry, onRetryContext, footer = null }: ResumePickerProps) {
  const [isListed, setIsListed] = useState(false);
  const listId = useId();
  const select = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The list opens on the résumé in use, so the arrow keys start from it.
  useEffect(() => {
    if (isListed) list.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
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
      {resumesUrl && <a className={LINK} href={resumesUrl} target="_blank" rel="noreferrer">Open resumes in BenchQ{EXTERNAL_ICON}</a>}
      <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Reload resumes</button>
    </Section>;
  }
  const { choices, picked } = resumes;
  const current = picked ?? choices[0];
  if (!current) {
    return <Section>
      <p className={SOFT_TEXT}>{candidateName} has no resume in BenchQ yet, so there are no answers to fill.</p>
      {resumesUrl && <a className={LINK} href={resumesUrl} target="_blank" rel="noreferrer">Add one in BenchQ{EXTERNAL_ICON}</a>}
    </Section>;
  }
  if (choices.length < 2) {
    return <Section count={1}>
      <div className="flex min-w-0 items-center gap-1"><div className={PLAIN}><Named choice={current} /></div><ViewLink url={studioUrl(current.id)} choice={current} /></div>
      <p data-slot="resume-only" className={`flex flex-wrap items-center gap-x-1.5 px-0.5 ${MUTED_TEXT}`}>
        <span>Only resume</span>
        {resumesUrl && <>
          <span aria-hidden="true">·</span>
          <a className="inline-flex items-center gap-1 text-[var(--color-text-2)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline [&_svg]:size-[var(--icon-sm)]"
            href={resumesUrl} target="_blank" rel="noreferrer">Add another in BenchQ{EXTERNAL_ICON}</a>
        </>}
      </p>
      {footer}
    </Section>;
  }
  const close = () => {
    setIsListed(false);
    select.current?.focus();
  };
  const onSelectKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" && !isListed) {
      event.preventDefault();
      setIsListed(true);
    } else if (event.key === "Escape" && isListed) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  const onOptionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    // Through both groups, in the order they show.
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-slot='resume-option']") ?? [])];
    const at = options.indexOf(event.currentTarget);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1);
    options[next]?.focus();
  };
  // This job's tailored résumés, then the bases: each group named when there are both.
  const groups = [
    { key: "tailored", title: "Tailored for this job", choices: choices.filter(({ isTailored, isOtherJob }) => isTailored && !isOtherJob) },
    { key: "bases", title: "Base resumes", choices: choices.filter(({ isTailored, isOtherJob }) => !isTailored || isOtherJob) },
  ].filter((group) => group.choices.length > 0);
  const isGrouped = groups.length > 1;
  // The one in use only closes the list: picking it again would fill the form again.
  const pick = (id: string) => {
    close();
    if (id !== current.id) onPick(id);
  };
  return <Section count={choices.length}>
    <div className="flex min-w-0 items-center gap-1">
      <button ref={select} type="button" data-slot="resume-select" className={SELECT} disabled={isBusy} aria-expanded={isListed}
        aria-controls={listId} aria-label={`Change the resume, ${resumesCount(choices.length)} to choose from. In use: ${current.label}`}
        onKeyDown={onSelectKey} onClick={() => setIsListed(!isListed)}>
        <Named choice={current} />
        <span data-slot="resume-change" className={`${CHANGE} group-aria-expanded:[&_svg]:rotate-180`}>Change{CHEVRON_DOWN_ICON}</span>
      </button>
      {!isListed && <ViewLink url={studioUrl(current.id)} choice={current} />}
    </div>
    {isListed && <div className="grid gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-1">
      <p id={`${listId}-title`} data-slot="resume-list-title" className={`px-2 pt-1 pb-0.5 ${MUTED_TEXT}`}>{resumesCount(choices.length)} for {candidateName}</p>
      <div ref={list} id={listId} role="group" aria-labelledby={`${listId}-title`} className="grid gap-1">
        {groups.map((group) => <div key={group.key} data-slot="resume-group" data-group={group.key} className="grid gap-0.5">
          {isGrouped && <p id={`${listId}-${group.key}`} data-slot="resume-group-title" className={GROUP}>{group.title}</p>}
          <ul className="grid gap-0.5" aria-labelledby={isGrouped ? `${listId}-${group.key}` : `${listId}-title`}>
            {group.choices.map((choice) => {
              const isPicked = choice.id === current.id;
              return <li key={choice.id} data-slot="resume-choice" className="flex min-w-0 items-center gap-1">
                <button type="button" data-slot="resume-option" className={OPTION} disabled={isBusy} aria-pressed={isPicked}
                  onKeyDown={onOptionKey} onClick={() => pick(choice.id)}>
                  <span className={`${TICK} ${isPicked ? "" : "invisible"}`} aria-hidden="true">{CHECK}</span>
                  <Named choice={choice} />
                </button>
                <ViewLink url={studioUrl(choice.id)} choice={choice} />
              </li>;
            })}
          </ul>
        </div>)}
      </div>
    </div>}
    {footer}
  </Section>;
}
