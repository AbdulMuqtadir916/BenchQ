import type { ReactNode } from "react";
import type { Application } from "../api";
import { button, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { documentOf, type DocumentKind } from "./documents";
import { fieldLabel, filledValue } from "./form-memory";
import { EXTERNAL_ICON, LETTER_ICON, RESUME_ICON } from "./icons";
import { Tick } from "./marks";
import type { ReviewRow } from "./types";

type DocumentSectionsProps = {
  rows: ReviewRow[];
  details: Application | null;
  /** The candidate's résumés on the website, when the panel can link there. */
  resumesUrl: string | null;
  isFilling: boolean;
  onGoTo: (row: ReviewRow) => void;
};

type Actions = Pick<DocumentSectionsProps, "isFilling" | "onGoTo">;

type SectionProps = Actions & {
  kind: DocumentKind;
  title: string;
  icon: ReactNode;
  rows: ReviewRow[];
  /** What BenchQ holds for this job, once the panel knows. */
  held: string | null;
  link: string | null;
};

const SECTION = "grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5";
const TITLE = "flex min-w-0 items-center gap-1.5 text-sm font-[550] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";

function resumeHeld(details: Application | null): string | null {
  if (!details) return null;
  const name = details.tailored_resume_name;
  if (!name) return "No tailored resume for this job yet.";
  return details.tailored_resume_deleted ? `Tailored for this job: ${name} (deleted in BenchQ)` : `Tailored for this job: ${name}`;
}

function letterHeld(details: Application | null): string | null {
  if (!details) return null;
  return details.has_cover_letter ? "A cover letter for this job is saved in BenchQ." : "No cover letter saved for this job.";
}

/** One field the section stands for: an upload shows the file's name once attached, a text box whether it's written. */
function DocumentField({ row, isFilling, onGoTo }: Actions & { row: ReviewRow }) {
  const value = filledValue(row);
  const isUpload = row.field.kind === "file";
  const state = isUpload ? value || "No file attached yet" : value ? "Written" : "Not written yet";
  return <div data-slot="document-field" className="flex items-start gap-2">
    <Tick isFilled={Boolean(value)} slot="document-tick" />
    <span className="grid min-w-0 flex-1">
      <span className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
      <span data-slot="document-value" className={`truncate ${SOFT_TEXT}`} title={state}>{state}</span>
    </span>
    <button type="button" className={`flex-none ${button("secondary", "compact")}`} disabled={isFilling} onClick={() => onGoTo(row)}>Go to field</button>
  </div>;
}

function DocumentSection({ kind, title, icon, rows, held, link, isFilling, onGoTo }: SectionProps) {
  const id = `document-${kind}-title`;
  const status = rows.length === 0 ? "No field found" : rows.some(({ field }) => field.required) ? "Required" : "Optional";
  return <section data-slot="document" data-document={kind} className={SECTION} aria-labelledby={id}>
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className={TITLE}>{icon}{title}</h3>
      <span data-slot="document-status" className={`flex-none ${MUTED_TEXT}`}>{status}</span>
    </div>
    {rows.map((row) => <DocumentField key={row.key} row={row} isFilling={isFilling} onGoTo={onGoTo} />)}
    {rows.length > 0 && held && <p data-slot="document-held" className={MUTED_TEXT}>{held}</p>}
    {rows.length > 0 && link && <a className={`justify-self-start ${button("secondary", "compact")}`} href={link} target="_blank" rel="noreferrer">
      Open in BenchQ{EXTERNAL_ICON}
    </a>}
  </section>;
}

/** The résumé and the cover letter, each in a section of its own whether or not the form asks for it. Autofill never
 * uploads a file: a section says what the form wants, takes the BDE to the field, and says what BenchQ holds. */
export default function DocumentSections({ rows, details, resumesUrl, isFilling, onGoTo }: DocumentSectionsProps) {
  const of = (kind: DocumentKind) => rows.filter(({ field }) => documentOf(field) === kind);
  const actions = { isFilling, onGoTo };
  return <div data-slot="documents" className="grid gap-2">
    <DocumentSection kind="resume" title="Resume" icon={RESUME_ICON} rows={of("resume")} held={resumeHeld(details)} link={resumesUrl} {...actions} />
    <DocumentSection kind="cover-letter" title="Cover letter" icon={LETTER_ICON} rows={of("cover-letter")} held={letterHeld(details)} link={null} {...actions} />
  </div>;
}
