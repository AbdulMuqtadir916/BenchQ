import type { ReactNode } from "react";
import type { Application } from "../api";
import { ICON_BUTTON_QUIET } from "../ui";
import { CLOCK_ICON, CROSS_ICON, PAY_ICON, PIN_ICON } from "./icons";
import { foundText, initialOf, payText } from "./job-details";
import type { JobSummary } from "./types";

type JobCardProps = {
  job: JobSummary;
  /** The saved application, once the panel has it. Until then the card shows what the tab's connection carries. */
  details: Application | null;
  candidateName: string;
  onDisconnect: () => void;
};

type Fact = { key: string; icon: ReactNode; text: string; name?: string; isWide?: boolean };

const FACT = "flex min-w-0 items-center gap-1 text-caption text-[var(--color-text-3)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
const TILE = "grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-sm)] bg-[var(--color-primary-subtle)] text-caption font-[550] text-[var(--color-primary-subtle-fg)]";

function factsOf(details: Application | null): Fact[] {
  if (!details) return [];
  const pay = payText(details.salary_min, details.salary_max);
  const found = foundText(details.discovered_at);
  const facts: Fact[] = [
    details.location
      ? { key: "location", icon: PIN_ICON, text: details.location, name: "Location", isWide: true }
      : { key: "location", icon: PIN_ICON, text: "Location not listed", isWide: true },
    pay ? { key: "pay", icon: PAY_ICON, text: pay, name: "Pay" } : { key: "pay", icon: PAY_ICON, text: "Pay not listed" },
  ];
  return found ? [...facts, { key: "found", icon: CLOCK_ICON, text: found }] : facts;
}

/** The linked job at a glance, in little room: what it is, for whom, then where on a row of its own, and its pay and how
 * long BenchQ has known it side by side. */
export default function JobCard({ job, details, candidateName, onDisconnect }: JobCardProps) {
  const title = job.title || "Untitled role";
  const facts = factsOf(details);
  return <div data-slot="job-card" className="flex items-start gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
    <span className={TILE} aria-hidden="true">{initialOf(job.company || title)}</span>
    <div className="min-w-0 flex-1">
      <h2 id="autofill-title" className="text-body-strong wrap-anywhere">{title}</h2>
      <p className="truncate text-caption text-[var(--color-text-2)]">{job.company || "Company not listed"} · for {candidateName}</p>
      {facts.length > 0 && <ul data-slot="job-facts" className="mt-0.5 grid grid-cols-2 gap-x-3">
        {facts.map(({ key, icon, text, name, isWide }) => <li key={key} className={`${FACT} ${isWide ? "col-span-2" : ""}`} title={text}>
          {icon}
          {name && <span className="sr-only">{name}: </span>}
          <span className="truncate">{text}</span>
        </li>)}
      </ul>}
    </div>
    <button type="button" className={`-mt-1 -mr-1 ${ICON_BUTTON_QUIET}`} onClick={onDisconnect} aria-label="Disconnect this tab from the job" title="Disconnect this tab">
      {CROSS_ICON}
    </button>
  </div>;
}
