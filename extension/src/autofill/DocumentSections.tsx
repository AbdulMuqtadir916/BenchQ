import type { ReactNode } from "react";
import type { Application } from "../api";
import { button, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { documentOf, type DocumentKind } from "./documents";
import { fieldLabel, filledValue } from "./form-memory";
import { CHECK, EXTERNAL_ICON, LETTER_ICON, RESUME_ICON } from "./icons";
import { Tick } from "./marks";
import type { ReviewRow } from "./types";

type DocumentSectionsProps = {
  rows: ReviewRow[];
  details: Application | null;
  /** The candidate's résumés on the website, when the panel can link there. */
  resumesUrl: string | null;
  isFilling: boolean;
  onGoTo: (row: ReviewRow) => void;
  /** The résumé Autofill answers from, which is the one to attach. `file`: the name Autofill attaches it by, when
   * BenchQ has its file (an uploaded résumé's first version, 07 Q49); else the BDE attaches it. */
  picked?: { label: string; url: string | null; file?: string | null } | null;
  /** The last file BenchQ attached on this page: shown even when the site swapped its input for a chip (07 Q53). */
  attached?: string | null;
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
  attached?: string | null;
};

const SECTION = "grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5";
const TITLE = "flex min-w-0 items-center gap-1.5 text-sm font-[550] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const ATTACHED = "inline-flex max-w-full items-center gap-1 justify-self-start rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-caption font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

/** A file on the form, as a green chip (07 Q56). */
function AttachedChip({ name }: { name: string }) {
  return <span data-slot="document-attached" className={ATTACHED}>{CHECK}<span className="min-w-0 wrap-anywhere">Attached: <span data-slot="document-value">{name}</span></span></span>;
}

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
  const state = isUpload ? "No file attached yet" : value ? "Written" : "Not written yet";
  return <div data-slot="document-field" className="flex items-start gap-2">
    <Tick isFilled={Boolean(value)} slot="document-tick" />
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
      {isUpload && value ? <AttachedChip name={value} />
        : <span data-slot="document-value" className={`truncate ${SOFT_TEXT}`} title={state}>{state}</span>}
    </span>
    <button type="button" className={`flex-none ${button("secondary", "compact")}`} disabled={isFilling} onClick={() => onGoTo(row)}>Go to field</button>
  </div>;
}

function DocumentSection({ kind, title, icon, rows, held, link, attached = null, isFilling, onGoTo }: SectionProps) {
  const id = `document-${kind}-title`;
  const status = rows.length === 0 ? (attached ? "Attached" : "No field found") : rows.some(({ field }) => field.required) ? "Required" : "Optional";
  return <section data-slot="document" data-document={kind} className={SECTION} aria-labelledby={id}>
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className={TITLE}>{icon}{title}</h3>
      <span data-slot="document-status" className={`flex-none ${MUTED_TEXT}`}>{status}</span>
    </div>
    {rows.map((row) => <DocumentField key={row.key} row={row} isFilling={isFilling} onGoTo={onGoTo} />)}
    {rows.length === 0 && attached && <AttachedChip name={attached} />}
    {rows.length > 0 && held && <p data-slot="document-held" className={MUTED_TEXT}>{held}</p>}
    {rows.length > 0 && link && <a className={`justify-self-start ${button("secondary", "compact")}`} href={link} target="_blank" rel="noreferrer">
      Open in BenchQ{EXTERNAL_ICON}
    </a>}
  </section>;
}

/** What the Resume section says about the picked résumé: the file Autofill attaches, or that it's the BDE's to attach. */
function pickedHeld({ label, file }: NonNullable<DocumentSectionsProps["picked"]>) {
  return file ? `Autofill attaches: ${file}` : `Attach by hand: ${label}`;
}

/** The résumé and the cover letter, each in a section of its own whether or not the form asks for it. A section says
 * what the form wants, takes the BDE to the field, and says what goes there: Autofill attaches the picked résumé's file
 * when BenchQ has it, and otherwise says which résumé to attach. A cover letter is always the BDE's. */
export default function DocumentSections({ rows, details, resumesUrl, isFilling, onGoTo, picked = null, attached = null }: DocumentSectionsProps) {
  const of = (kind: DocumentKind) => rows.filter(({ field }) => documentOf(field) === kind);
  const actions = { isFilling, onGoTo };
  return <div data-slot="documents" className="grid gap-2">
    <DocumentSection kind="resume" title="Resume" icon={RESUME_ICON} rows={of("resume")} held={picked ? pickedHeld(picked) : resumeHeld(details)}
      link={picked?.url ?? resumesUrl} attached={attached} {...actions} />
    <DocumentSection kind="cover-letter" title="Cover letter" icon={LETTER_ICON} rows={of("cover-letter")} held={letterHeld(details)} link={null} {...actions} />
  </div>;
}
