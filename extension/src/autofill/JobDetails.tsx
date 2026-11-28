import type { ReactNode } from "react";
import { ALERT, ICON_BUTTON_QUIET, SKELETON_LINE, TEXT_BUTTON } from "../ui";
import { CompanyLogo } from "./CompanyLogo";
import { BACK_ICON, CHECK_CIRCLE_ICON, CLOCK_ICON, HOME_ICON, PIN_ICON } from "./icons";
import { textOfHtml } from "./job-details";

/** A job as its details page shows it: a saved application's, or the page's the BDE is adding. Only what's known. */
export type JobFacts = {
  title: string;
  company: string;
  location?: string | null;
  logoUrl?: string;
  employmentType?: string | null;
  workMode?: string | null;
  pay?: string | null;
  posted?: string | null;
  requisitionId?: string | null;
  /** The posting's description: its HTML (a JobPosting's) or its text. */
  description?: string | null;
};

type Kind = "about" | "requirements" | "benefits" | "company";
export type Section = { title: string; kind: Kind; paragraphs: string[]; items: string[] };

/** A line that names what follows it in a posting: "Requirements", "What you'll do:", "About us". */
const HEADING = /^(about (the )?(role|job|position|team|us|company)|the (role|team|opportunity)|(your |key |main |primary )?(responsibilities|duties)|what you('|’)?ll (do|bring|need|work on)|what we('|’)?re looking for|who you are|(minimum |basic |preferred |required |desired )?(qualifications|requirements|skills)|nice to haves?|bonus points|benefits|perks( (and|&) benefits)?|what we offer|why join us|compensation( (and|&) benefits)?|who we are|our (company|team|mission)|company overview|overview|summary|job description|description)\b/i;
const REQUIREMENTS = /\b(requirements?|qualifications?|skills|need|bring|looking for|who you are|nice to have|bonus points)\b/i;
const BENEFITS = /\b(benefits?|perks?|offer|why join)\b/i;
const COMPANY = /\b(about (us|the company)|who we are|our (company|mission)|company overview)\b/i;
const BULLET = /^(?:[•·▪◦*–-]|\d+[.)])\s+/;

/** A posting's description as lines: each paragraph, heading and list item on its own, list items marked "• ". */
function linesOf(description: string): string[] {
  const isHtml = /<[a-z][\s\S]*>/i.test(description);
  const text = isHtml
    ? textOfHtml(description
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<h[1-6]\b[^>]*>/gi, "\n"))
    : description;
  return text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const isHeading = (line: string) => line.length <= 60 && !/[.!?]$/.test(line)
  && (HEADING.test(line.replace(/:$/, "")) || (/:$/.test(line) && line.split(" ").length <= 6));

const kindOf = (title: string): Kind => (COMPANY.test(title) ? "company" : BENEFITS.test(title) ? "benefits"
  : REQUIREMENTS.test(title) ? "requirements" : "about");

/** The description in the details page's sections: what comes before any heading is About the role, then each heading
 * with its paragraphs and its list. */
export function sectionsOf(description: string | null | undefined): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of linesOf(description ?? "")) {
    if (isHeading(line)) {
      const title = line.replace(/:$/, "");
      current = { title, kind: kindOf(title), paragraphs: [], items: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: "About the role", kind: "about", paragraphs: [], items: [] };
      sections.push(current);
    }
    if (BULLET.test(line)) current.items.push(line.replace(BULLET, ""));
    else current.paragraphs.push(line);
  }
  return sections.filter((section) => section.paragraphs.length > 0 || section.items.length > 0);
}

const SUBHEAD = "flex flex-none items-center gap-2 border-b border-[var(--color-border)] px-3 py-2";
const HEAD_CARD = "border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-5";
const BADGE = "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-caption font-[550] text-[var(--color-text-2)] [&_svg]:size-3 [&_svg]:flex-none";
const SECTION_TITLE = "mb-2 text-caption font-[700] uppercase tracking-wider text-[var(--color-text)]";
const TEXT = "text-sm leading-relaxed text-[var(--color-text-2)] wrap-anywhere";
const CHIP = "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-caption font-[600] text-[var(--color-text-2)] [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-[var(--color-primary)]";
const TABLE = "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]";
const ROW = "flex items-center justify-between gap-3 border-b border-[var(--color-border)] p-3 last:border-b-0";

function Facts({ title, rows }: { title: string; rows: Array<[string, string | null | undefined]> }) {
  const shown = rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (shown.length === 0) return null;
  return <section>
    <h3 className={SECTION_TITLE}>{title}</h3>
    <dl className={TABLE}>
      {shown.map(([name, value]) => <div key={name} className={ROW}>
        <dt className="text-caption font-[600] text-[var(--color-text-3)]">{name}</dt>
        <dd className="min-w-0 text-right text-sm font-[650] text-[var(--color-text)] wrap-anywhere">{value}</dd>
      </div>)}
    </dl>
  </section>;
}

function SectionView({ section }: { section: Section }) {
  return <section data-slot="job-details-section">
    <h3 className={SECTION_TITLE}>{section.title}</h3>
    {section.paragraphs.map((text, index) => <p key={index} className={`${section.kind === "company" ? "text-caption text-[var(--color-text-3)]" : TEXT} [&+p]:mt-2`}>{text}</p>)}
    {section.items.length > 0 && (section.kind === "benefits"
      ? <ul className={`flex flex-wrap gap-2 ${section.paragraphs.length ? "mt-2" : ""}`}>
        {section.items.map((item, index) => <li key={index} className={CHIP}>{CHECK_CIRCLE_ICON}{item}</li>)}
      </ul>
      : <ul className={`grid gap-2 ${section.paragraphs.length ? "mt-2" : ""}`}>
        {section.items.map((item, index) => <li key={index} className="flex items-start gap-2">
          <span className="mt-0.5 flex-none text-[var(--color-primary)] [&_svg]:size-3.5" aria-hidden="true">{CHECK_CIRCLE_ICON}</span>
          <span className={TEXT}>{item}</span>
        </li>)}
      </ul>)}
  </section>;
}

type JobDetailsProps = {
  job: JobFacts;
  /** Whether the description is still being read from BenchQ, or couldn't be (`onRetry` reads it again). */
  descriptionStatus?: "ready" | "loading" | "error";
  onRetry?: () => void;
  onBack: () => void;
  actions?: ReactNode;
};

/** The job's own page in the panel (the design's Job Details): the job at the top with its facts as badges, its
 * description in sections, its pay and posting facts, and actions fixed at the foot. Back returns to where the BDE was. */
export default function JobDetails({ job, descriptionStatus = "ready", onRetry, onBack, actions }: JobDetailsProps) {
  const sections = sectionsOf(job.description);
  const facts: Array<[ReactNode, string | null | undefined]> = [[PIN_ICON, job.location], [CLOCK_ICON, job.employmentType], [HOME_ICON, job.workMode]];
  const badges = facts.filter((badge): badge is [ReactNode, string] => Boolean(badge[1]));
  return <section data-slot="job-details" className="-mx-3 flex min-h-0 flex-1 flex-col" aria-labelledby="job-details-heading">
    <div className={SUBHEAD}>
      <button type="button" data-slot="job-details-back" className={ICON_BUTTON_QUIET} aria-label="Back" onClick={onBack}>{BACK_ICON}</button>
      <h2 id="job-details-heading" className="text-h3 font-[700]">Job Details</h2>
    </div>
    <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]">
      <div className={HEAD_CARD}>
        <CompanyLogo company={job.company || job.title} url={job.logoUrl} size="2xl" />
        <h3 data-slot="job-details-title" className="mt-4 text-h2 text-[var(--color-text)] wrap-anywhere">{job.title}</h3>
        {job.company && <p className="mt-1 text-sm font-[650] text-[var(--color-primary)]">{job.company}</p>}
        {badges.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">
          {badges.map(([icon, text]) => <li key={text} className={BADGE}>{icon}{text}</li>)}
        </ul>}
      </div>
      <div className="grid gap-6 p-5">
        {descriptionStatus === "loading" ? <div data-slot="job-details-loading" role="status" className="grid gap-2.5">
          {["w-1/3", "w-full", "w-11/12", "w-4/5", "w-2/3"].map((width) => <div key={width} className={`${SKELETON_LINE} ${width}`} aria-hidden="true" />)}
          <span className="sr-only">Loading the job&apos;s description…</span>
        </div>
          : descriptionStatus === "error" ? <div data-slot="job-details-error">
            <p className={ALERT} role="alert">Could not load the job&apos;s description.</p>
            {onRetry && <button type="button" className={TEXT_BUTTON} onClick={onRetry}>Try again</button>}
          </div>
            : sections.length > 0 ? sections.map((section, index) => <SectionView key={index} section={section} />)
              : <p className={TEXT}>This posting gives no description.</p>}
        <Facts title="Compensation" rows={[["Base salary", job.pay]]} />
        <Facts title="Posting" rows={[["Posted", job.posted], ["Job ID", job.requisitionId]]} />
      </div>
    </div>
    {actions && <div data-slot="job-details-actions" className="flex flex-none gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3 *:flex-1">{actions}</div>}
  </section>;
}
