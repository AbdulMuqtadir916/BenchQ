import { button, MOTION, SOFT_TEXT } from "../ui";
import { CompanyLogo } from "./CompanyLogo";
import { CHECK } from "./icons";

type AppliedPageProps = {
  title: string;
  company: string;
  logoUrl?: string;
  candidateName: string;
  /** The application on the website (`applications.detail`), when the firm is known. */
  viewUrl: string | null;
  /** Back to the BDE's jobs: the tab lets go of this job. */
  onBack: () => void;
};

/** The big tick: the application is logged. */
const CIRCLE = "grid size-20 flex-none place-items-center rounded-full border border-[color-mix(in_srgb,var(--color-success-fg)_25%,transparent)] bg-[var(--color-success-bg)] text-[var(--color-success-fg)] [&_svg]:size-9 motion-safe:animate-tick-in";
const CARD = "mt-8 w-full rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left shadow-[var(--shadow-xs)]";
const LABEL = "text-caption font-[700] uppercase tracking-wider text-[var(--color-text-3)]";
const BACK = `w-full rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-[650] text-[var(--color-text-2)] transition-[background,color] ${MOTION} hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]`;

/** Once the job is marked applied (the design's "Great job!" page): the job, whose application it is, its status,
 * then the application in BenchQ, or back to the jobs. */
export default function AppliedPage({ title, company, logoUrl, candidateName, viewUrl, onBack }: AppliedPageProps) {
  return <section data-slot="applied-page" className="-mx-3 flex min-h-0 flex-1 flex-col" aria-labelledby="applied-title">
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6 text-center">
      <span className={CIRCLE} aria-hidden="true">{CHECK}</span>
      <h2 id="applied-title" className="mt-6 text-h1 text-[var(--color-text)]">Great job!</h2>
      <p className={`mt-2 max-w-60 leading-relaxed ${SOFT_TEXT}`}>Your application has been successfully logged.</p>
      <div data-slot="applied-job" className={CARD}>
        <div className="mb-4 flex min-w-0 items-center gap-4 border-b border-[var(--color-border)] pb-4">
          <CompanyLogo company={company || title} url={logoUrl} size="lg" />
          <div className="grid min-w-0">
            <p className="truncate text-sm font-[700] text-[var(--color-text)]" title={title}>{title}</p>
            {company && <p className="truncate text-caption text-[var(--color-text-3)]">{company}</p>}
          </div>
        </div>
        <dl className="grid gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <dt className={LABEL}>Candidate</dt>
            <dd className="min-w-0 truncate text-sm font-[700] text-[var(--color-text)]">{candidateName}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className={LABEL}>Status</dt>
            <dd className="text-sm font-[700] text-[var(--color-success-fg)]">Applied</dd>
          </div>
        </dl>
      </div>
    </div>
    <div data-slot="applied-actions" className="grid flex-none gap-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      {viewUrl && <a className={`w-full ${button("primary", "large")}`} href={viewUrl} target="_blank" rel="noreferrer">View in BenchQ</a>}
      <button type="button" data-slot="applied-back" className={BACK} onClick={onBack}>Back to jobs</button>
    </div>
  </section>;
}
