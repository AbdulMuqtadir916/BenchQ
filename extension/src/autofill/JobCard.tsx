import type { Application } from "../api";
import { ICON_BUTTON_QUIET, MOTION } from "../ui";
import { CompanyLogo } from "./CompanyLogo";
import { INFO_ICON, PIN_ICON } from "./icons";
import type { JobSummary } from "./types";

type JobCardProps = {
  job: JobSummary;
  /** The saved application, once the panel has it. Until then the card shows what the tab's connection carries. */
  details: Application | null;
  candidateName: string;
  onDisconnect: () => void;
  /** Opens the job's own page, with everything else about it (`JobDetails`). */
  onDetails?: () => void;
  /** Once the form is filled: the title and the candidate only, so the fields have the room. */
  isCompact?: boolean;
};

/** The linked job as the design's bar: the title, whose job it is (in small capitals) and where, with the details a
 * press away and the red Disconnect pill. Everything else about the job is on its details page. */
const BAR = "flex flex-none items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5";
const TITLE = "truncate text-caption font-[700] leading-snug text-[var(--color-text)]";
const WHO = "truncate text-caption font-[600] uppercase tracking-wide text-[var(--color-text-2)]";
const WHERE = "mt-0.5 flex min-w-0 items-center gap-1 text-caption text-[var(--color-text-3)] [&_svg]:size-3 [&_svg]:flex-none";
/** The design mock's red Disconnect pill: small, and unmistakably the way out. */
const DISCONNECT = `flex-none rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-danger-fg)_25%,transparent)] bg-[var(--color-danger-bg)] px-2 py-1 text-caption font-[700] text-[var(--color-danger-fg)] transition-[border-color] ${MOTION} hover:border-[var(--color-danger-fg)]`;

export default function JobCard({ job, details, candidateName, onDisconnect, onDetails, isCompact = false }: JobCardProps) {
  const title = job.title || details?.title || "Untitled role";
  const location = details?.location || "Location not listed";
  return <div data-slot="job-card" className={BAR}>
    <CompanyLogo url={details?.logoUrl} company={job.company || title} size="md" />
    <div className="min-w-0 flex-1">
      <h2 id="autofill-title" className={TITLE} title={title}>{title}</h2>
      <p data-slot="job-card-candidate" className={WHO} title={candidateName}>{candidateName}</p>
      {!isCompact && <p data-slot="job-card-location" className={WHERE} title={location}>{PIN_ICON}<span className="truncate">{location}</span></p>}
    </div>
    {onDetails && <button type="button" data-slot="job-details-open" className={ICON_BUTTON_QUIET} aria-label="Job details" title="Job details" onClick={onDetails}>{INFO_ICON}</button>}
    <button type="button" className={DISCONNECT} onClick={onDisconnect} aria-label="Disconnect this tab from the job" title="Disconnect this tab">
      Disconnect
    </button>
  </div>;
}
