import { useState, type ReactNode } from "react";
import { ALERT, button, EYEBROW, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON } from "../ui";
import { EXTERNAL_ICON, RESUME_ICON } from "./icons";
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

function Section({ children }: { children: ReactNode }) {
  return <section data-slot="resume-picker" className={SECTION} aria-labelledby="resume-picker-title">
    <h3 id="resume-picker-title" className={TITLE}>{RESUME_ICON}Answers from</h3>
    {children}
  </section>;
}

function ViewLink({ url }: { url: string | null }) {
  return url ? <a className={LINK} href={url} target="_blank" rel="noreferrer">View in BenchQ{EXTERNAL_ICON}</a> : null;
}

/** Which résumé Autofill answers from (docs/02 §8.1): the candidate's résumés, each with Pick, until the BDE picks one;
 * then one line with Change. Picking reads that résumé's answers and fills the form at once when it's on the page (the
 * panel does that). BenchQ never uploads the file. */
export default function ResumePicker({ resumes, candidateName, resumesUrl, studioUrl, isBusy, onPick, onRetry }: ResumePickerProps) {
  const [isListed, setIsListed] = useState(true);
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
  if (choices.length === 0) {
    return <Section>
      <p className={SOFT_TEXT}>{candidateName} has no resume in BenchQ yet, so there are no answers to fill.</p>
      {resumesUrl && <a className={LINK} href={resumesUrl} target="_blank" rel="noreferrer">Add one in BenchQ{EXTERNAL_ICON}</a>}
    </Section>;
  }
  if (picked && !isListed) {
    return <Section>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span data-slot="resume-picked" className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{picked.label}</span>
        {choices.length > 1 && <button type="button" className={`flex-none ${button("secondary", "compact")}`} disabled={isBusy} onClick={() => setIsListed(true)}>Change</button>}
      </div>
      <ViewLink url={studioUrl(picked.id)} />
    </Section>;
  }
  const pick = (id: string) => {
    setIsListed(false);
    onPick(id);
  };
  return <Section>
    <ul className="grid gap-1.5" aria-label={`${candidateName}'s resumes`}>
      {choices.map((choice) => {
        const isPicked = choice.id === picked?.id;
        return <li key={choice.id} data-slot="resume-choice" className="grid gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
          <span className={EYEBROW}>{choice.isTailored ? "Tailored" : "Base"}</span>
          <span className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{choice.label}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={button(isPicked ? "secondary" : "primary", "compact")} disabled={isBusy} aria-pressed={isPicked} onClick={() => pick(choice.id)}>
              {isPicked ? "Picked" : "Pick"}
            </button>
            <ViewLink url={studioUrl(choice.id)} />
          </div>
        </li>;
      })}
    </ul>
    {picked && <button type="button" className={TEXT_BUTTON} onClick={() => setIsListed(false)}>Close</button>}
  </Section>;
}
