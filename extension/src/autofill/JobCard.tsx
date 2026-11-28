import type { ReactNode } from "react";
import type { Application } from "../api";
import { CROSS_ICON, PAY_ICON, PIN_ICON } from "./icons";
import { payText } from "./job-details";
import { CompanyLogo } from "./CompanyLogo";
import type { JobSummary } from "./types";

type JobCardProps = {
  job: JobSummary;
  /** The saved application, once the panel has it. Until then the card shows what the tab's connection carries. */
  details: Application | null;
  candidateName: string;
  onDisconnect: () => void;
  /** Once the form is filled: the title and the company only, so the fields have the room. */
  isCompact?: boolean;
};

type Fact = { key: string; icon: ReactNode; text: string; name?: string; isWide?: boolean };

const FACT = "flex min-w-0 items-center gap-1 text-caption text-[var(--color-text-3)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

function factsOf(details: Application | null): Fact[] {
  if (!details) return [];
  const pay = payText(details.salary_min, details.salary_max);
  const facts: Fact[] = [
    details.location
      ? { key: "location", icon: PIN_ICON, text: details.location, name: "Location", isWide: true }
      : { key: "location", icon: PIN_ICON, text: "Location not listed", isWide: true },
    pay ? { key: "pay", icon: PAY_ICON, text: pay, name: "Pay" } : { key: "pay", icon: PAY_ICON, text: "Pay not listed" },
  ];
  return facts;
}

/** The linked job at a glance, in little room: what it is, for whom, then where on a row of its own, and its pay and how
 * long BenchQ has known it side by side. */
/** The design mock's red Disconnect pill: small, and unmistakably the way out. */
const DISCONNECT = "grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-md)] text-[var(--color-text-3)] transition-[background,color] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-fg)] [&_svg]:size-[var(--icon-md)]";

export default function JobCard({ job, details, candidateName, onDisconnect, isCompact = false }: JobCardProps) {
  const title = job.title || "Untitled role";
  const facts = factsOf(details);
  return <div data-slot="job-card" className="flex flex-none items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 shadow-[var(--shadow-xs)]">
    <CompanyLogo url={details?.logoUrl} company={job.company || title} />
    <div className="min-w-0 flex-1">
      <h2 id="autofill-title" className="truncate text-sm font-[650] leading-snug" title={title}>{title}</h2>
      <p className="truncate text-caption text-[var(--color-text-2)]">{job.company || "Company not listed"} · for {candidateName}</p>
      {facts.length > 0 && !isCompact && <ul data-slot="job-facts" className="mt-0.5 flex min-w-0 gap-x-3">
        {facts.map(({ key, icon, text, name, isWide }) => <li key={key} className={`${FACT} ${isWide ? "flex-1" : "flex-none"}`} title={text}>
          {icon}
          {name && <span className="sr-only">{name}: </span>}
          <span className="truncate">{text}</span>
        </li>)}
      </ul>}
    </div>
    <button type="button" className={DISCONNECT} onClick={onDisconnect} aria-label="Disconnect this tab from the job" title="Disconnect this tab">
      {CROSS_ICON}
    </button>
  </div>;
}
