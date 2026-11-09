import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ALERT, button, EYEBROW, MOTION, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON } from "../ui";
import { CHEVRON_DOWN_ICON, EXTERNAL_ICON, RESUME_ICON } from "./icons";
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
};

const SECTION = "grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5";
const TITLE = "flex min-w-0 items-center gap-1.5 text-sm font-[550] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const LINK = `justify-self-start ${button("secondary", "compact")}`;
/** The résumé in use, as a select: the whole row opens the list (07 Q55). */
const SELECT = `flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left transition-[background,border-color] ${MOTION} hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-[var(--icon-md)] [&>svg]:flex-none [&>svg]:text-[var(--color-text-3)] [&>svg]:transition-transform motion-reduce:[&>svg]:transition-none aria-expanded:[&>svg]:rotate-180`;
const ROW = "flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1.5";

function Section({ children }: { children: ReactNode }) {
  return <section data-slot="resume-picker" className={SECTION} aria-labelledby="resume-picker-title">
    <h3 id="resume-picker-title" className={TITLE}>{RESUME_ICON}Answers from</h3>
    {children}
  </section>;
}

function ViewLink({ url }: { url: string | null }) {
  return url ? <a className={LINK} href={url} target="_blank" rel="noreferrer">View in BenchQ{EXTERNAL_ICON}</a> : null;
}

/** A résumé as the picker names it: whether it's tailored or a base, then its label. */
function Named({ choice }: { choice: ResumeChoice }) {
  return <span className="grid min-w-0 flex-1">
    <span className={EYEBROW}>{choice.isTailored ? "Tailored" : "Base"}</span>
    <span data-slot="resume-picked" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{choice.label}</span>
  </span>;
}

/** Which résumé Autofill answers from (docs/02 §8.1): closed by default on the one in use, a select-style row whose ▾
 * opens the candidate's résumés, each with Pick (07 Q55). Esc or a pick closes it. Picking reads that résumé's answers
 * and fills the form at once when it's on the page (the panel does that), its file first when BenchQ has one. One
 * résumé is a plain row: there's nothing to change. */
export default function ResumePicker({ resumes, candidateName, resumesUrl, studioUrl, isBusy, onPick, onRetry }: ResumePickerProps) {
  const [isListed, setIsListed] = useState(false);
  const listId = useId();
  const select = useRef<HTMLButtonElement>(null);
  if (resumes.status === "loading") {
    return <Section><p className={MUTED_TEXT} role="status">Loading {candidateName}&apos;s resumes…</p></Section>;
  }
  if (resumes.status === "error") {
    return <Section>
      <p className={ALERT} role="alert">Could not load {candidateName}&apos;s resumes.</p>
      <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Try again</button>
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
    return <Section>
      <div className={ROW}><Named choice={current} /></div>
      <ViewLink url={studioUrl(current.id)} />
    </Section>;
  }
  const close = () => {
    setIsListed(false);
    select.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isListed) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const pick = (id: string) => {
    close();
    onPick(id);
  };
  return <Section>
    <button ref={select} type="button" data-slot="resume-select" className={SELECT} disabled={isBusy} aria-expanded={isListed}
      aria-controls={listId} aria-label={`Change the resume. In use: ${current.label}`} onKeyDown={onKeyDown} onClick={() => setIsListed(!isListed)}>
      <Named choice={current} />
      {CHEVRON_DOWN_ICON}
    </button>
    {isListed ? <ul id={listId} className="grid gap-1.5" aria-label={`${candidateName}'s resumes`}>
      {choices.map((choice) => {
        const isPicked = choice.id === current.id;
        return <li key={choice.id} data-slot="resume-choice" className="grid gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
          <Named choice={choice} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={button(isPicked ? "secondary" : "primary", "compact")} disabled={isBusy} aria-pressed={isPicked}
              onKeyDown={onKeyDown} onClick={() => pick(choice.id)}>
              {isPicked ? "Picked" : "Pick"}
            </button>
            <ViewLink url={studioUrl(choice.id)} />
          </div>
        </li>;
      })}
    </ul> : <ViewLink url={studioUrl(current.id)} />}
  </Section>;
}
