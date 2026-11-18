import { useRef, type ReactNode } from "react";
import type { Application } from "../api";
import { button, FITTED_BUTTONS, MUTED_TEXT, SOFT_TEXT, WARNING } from "../ui";
import { documentOf, OWN_FILE_TYPES, type DocumentKind } from "./documents";
import { fieldLabel, filledValue } from "./form-memory";
import { CHECK, EXTERNAL_ICON, LETTER_ICON, RESUME_ICON, UPLOAD_ICON } from "./icons";
import { Tick } from "./marks";
import type { ResumeFileSource, ReviewRow } from "./types";

type DocumentSectionsProps = {
  rows: ReviewRow[];
  details: Application | null;
  /** The candidate's résumés on the website, when the panel can link there. */
  resumesUrl: string | null;
  isFilling: boolean;
  onGoTo: (row: ReviewRow) => void;
  /** The résumé Autofill answers from, which is the one to attach. `file`: the name Autofill attaches it by, once BenchQ
   * has the file; `source`: where that file came from (as uploaded, or made from the version's text: docs/02 §8.2), or
   * the BDE's own pick; `meta`: the version as the picker names it ("Base 2 · v1"). Without a file the BDE attaches it. */
  picked?: { label: string; meta?: string; url: string | null; file?: string | null; source?: ResumeFileSource | null } | null;
  /** The last file BenchQ attached on this page: shown even when the site swapped its input for a chip (07 Q53). */
  attached?: string | null;
  /** Opens the résumé picker, when the candidate has another résumé to pick: the attached file's Change resume. */
  onChangeResume?: () => void;
  /** The picked résumé's file couldn't be loaded or made this time; Try again asks once more. */
  fileProblem?: boolean;
  onRetryFile?: () => void;
  /** A file from the BDE's computer in place of the résumé's own (Q5), why one was refused, and taking it off again. */
  ownFileError?: string | null;
  onOwnFile?: (file: File) => void;
  onRemoveOwnFile?: () => void;
};

type Actions = Pick<DocumentSectionsProps, "isFilling" | "onGoTo"> & { onChange?: () => void };

type SectionProps = Actions & {
  kind: DocumentKind;
  title: string;
  icon: ReactNode;
  rows: ReviewRow[];
  /** What BenchQ holds for this job, once the panel knows. */
  held: string | null;
  link: string | null;
  attached?: string | null;
  /** In place of `held`: the Resume section's file line. */
  extra?: ReactNode;
};

const SECTION = "grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5";
const TITLE = "flex min-w-0 items-center gap-1.5 text-sm font-[550] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none [&_svg]:text-[var(--color-text-3)]";
const FILE_ICON = "mt-0.5 flex-none text-[var(--color-text-3)] [&_svg]:size-[var(--icon-md)]";
const FILE_ACTIONS = "flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[calc(var(--icon-md)+var(--spacing)*2)] text-caption";
const FILE_STATUS = "flex items-center gap-1 font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
const FILE_LINK = "font-[550] text-[var(--color-text-2)] underline underline-offset-2 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50";

type AttachedProps = { name: string; isFilling?: boolean; onChange?: () => void; onGoTo?: () => void };

/** A file on the form (07 Q53, Q56): one line with its name, two at most (the whole name on hover), then small actions:
 * that it's attached, Change resume (another résumé to pick) and Go to field. */
function AttachedFile({ name, isFilling = false, onChange, onGoTo }: AttachedProps) {
  return <div data-slot="document-attached" className="grid gap-0.5">
    <div className="flex min-w-0 items-start gap-2">
      <span className={FILE_ICON} aria-hidden="true">{RESUME_ICON}</span>
      <span data-slot="document-value" className="line-clamp-2 min-w-0 text-sm font-[550] text-[var(--color-text)] wrap-anywhere" title={name}>{name}</span>
    </div>
    <div className={FILE_ACTIONS}>
      <span className={FILE_STATUS}>{CHECK}Attached</span>
      {onChange && <button type="button" data-slot="document-change" className={FILE_LINK} disabled={isFilling} onClick={onChange}>Change resume</button>}
      {onGoTo && <button type="button" className={FILE_LINK} disabled={isFilling} onClick={onGoTo}>Go to field</button>}
    </div>
  </div>;
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
function DocumentField({ row, isFilling, onGoTo, onChange }: Actions & { row: ReviewRow }) {
  const value = filledValue(row);
  const isUpload = row.field.kind === "file";
  if (isUpload && value) return <AttachedFile name={value} isFilling={isFilling} onChange={onChange} onGoTo={() => onGoTo(row)} />;
  const state = isUpload ? "No file attached yet" : value ? "Written" : "Not written yet";
  return <div data-slot="document-field" className="flex items-start gap-2">
    <Tick isFilled={Boolean(value)} slot="document-tick" />
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{fieldLabel(row.field)}</span>
      <span data-slot="document-value" className={`truncate ${SOFT_TEXT}`} title={state}>{state}</span>
    </span>
    <button type="button" className={`flex-none ${button("secondary", "compact")}`} disabled={isFilling} onClick={() => onGoTo(row)}>Go to field</button>
  </div>;
}

function DocumentSection({ kind, title, icon, rows, held, link, attached = null, extra = null, isFilling, onGoTo, onChange }: SectionProps) {
  const id = `document-${kind}-title`;
  const status = rows.length === 0 ? (attached ? "Attached" : "No field found") : rows.some(({ field }) => field.required) ? "Required" : "Optional";
  return <section data-slot="document" data-document={kind} className={SECTION} aria-labelledby={id}>
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className={TITLE}>{icon}{title}</h3>
      <span data-slot="document-status" className={`flex-none ${MUTED_TEXT}`}>{status}</span>
    </div>
    {rows.map((row) => <DocumentField key={row.key} row={row} isFilling={isFilling} onGoTo={onGoTo} onChange={onChange} />)}
    {rows.length === 0 && attached && <AttachedFile name={attached} isFilling={isFilling} onChange={onChange} />}
    {rows.length > 0 && (extra ?? (held && <p data-slot="document-held" className={MUTED_TEXT}>{held}</p>))}
    {rows.length > 0 && link && <a className={`justify-self-start ${button("secondary", "compact")}`} href={link} target="_blank" rel="noreferrer">
      Open in BenchQ{EXTERNAL_ICON}
    </a>}
  </section>;
}

const TAG = "flex-none rounded-full px-1.5 text-caption font-[550]";
const SOURCE_TAG: Record<ResumeFileSource, string> = {
  generated: `${TAG} bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]`,
  uploaded: `${TAG} bg-[var(--color-surface-3)] text-[var(--color-text-2)]`,
  picked: `${TAG} bg-[var(--color-teal-bg)] text-[var(--color-teal-fg)]`,
};

type ResumeFileProps = Pick<DocumentSectionsProps, "fileProblem" | "onRetryFile" | "ownFileError" | "onOwnFile" | "onRemoveOwnFile"> & {
  picked: NonNullable<DocumentSectionsProps["picked"]>;
  isFilling: boolean;
  /** A file is on the form already: only the BDE's own file says so, with Remove to stop using it. */
  isOnForm?: boolean;
};

/** What the Resume section says about the picked résumé's file, before one is on the form: the file Autofill attaches and
 * where it came from (made from the version, as uploaded, or the BDE's own), with a way to use a file from their
 * computer instead (Q5); that it couldn't be made, with Try again; or, without a file, that it's the BDE's to attach. */
function ResumeFile({ picked, isFilling, isOnForm = false, fileProblem = false, onRetryFile, ownFileError = null, onOwnFile, onRemoveOwnFile }: ResumeFileProps) {
  const input = useRef<HTMLInputElement>(null);
  const isOwn = picked.source === "picked";
  if (isOnForm) {
    return isOwn && onRemoveOwnFile ? <div data-slot="resume-file" className="flex flex-wrap items-center gap-2">
      <span data-slot="resume-file-source" className={SOURCE_TAG.picked}>Your file</span>
      <button type="button" data-slot="own-file-remove" className={button("secondary", "compact")} disabled={isFilling}
        title="Stop using your file for this candidate's forms" onClick={onRemoveOwnFile}>Remove</button>
    </div> : null;
  }
  const choose = onOwnFile && <>
    <input ref={input} type="file" accept={OWN_FILE_TYPES} hidden data-slot="own-file-input"
      onChange={(event) => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (chosen) onOwnFile(chosen);
      }} />
    <button type="button" data-slot="own-file-pick" className={button("secondary", "compact")} disabled={isFilling} onClick={() => input.current?.click()}>
      {UPLOAD_ICON}{fileProblem && !isOwn ? "Use a file" : "Use a different file"}
    </button>
  </>;
  const refused = ownFileError && <p data-slot="own-file-error" className="text-caption text-[var(--color-danger-fg)]" role="alert">{ownFileError}</p>;
  if (fileProblem && !isOwn) {
    return <div data-slot="resume-file" className="grid gap-1.5">
      <p data-slot="resume-file-problem" className={WARNING} role="status">The resume file couldn&apos;t be made. Try again, or use a file from your computer.</p>
      <div className={FITTED_BUTTONS}>
        {onRetryFile && <button type="button" className={button("secondary", "compact")} disabled={isFilling} onClick={onRetryFile}>Try again</button>}
        {choose}
      </div>
      {refused}
    </div>;
  }
  if (!picked.file) {
    return <div data-slot="resume-file" className="grid gap-1.5">
      <p data-slot="document-held" className={MUTED_TEXT}>Attach by hand: {picked.label}</p>
      {refused}
    </div>;
  }
  const tag = picked.source === "generated" ? `Made from ${picked.meta || picked.label}` : picked.source === "uploaded" ? "Uploaded file" : "Your file";
  return <div data-slot="resume-file" className="grid gap-1.5">
    <p data-slot="document-held" className={`wrap-anywhere ${MUTED_TEXT}`}>Autofill attaches: <span className="text-[var(--color-text)]">{picked.file}</span></p>
    <div className="flex flex-wrap items-center gap-2">
      {picked.source && <span data-slot="resume-file-source" className={SOURCE_TAG[picked.source]}>{tag}</span>}
      {isOwn
        ? onRemoveOwnFile && <button type="button" data-slot="own-file-remove" className={button("secondary", "compact")} disabled={isFilling} onClick={onRemoveOwnFile}>Remove</button>
        : choose}
    </div>
    {refused}
  </div>;
}

/** The résumé and the cover letter, each in a section of its own whether or not the form asks for it. A section says
 * what the form wants, takes the BDE to the field, and says what goes there: Autofill attaches the picked résumé's file
 * when BenchQ has it, and otherwise says which résumé to attach; once a file is on the form, its card says so instead.
 * A cover letter is always the BDE's. */
export default function DocumentSections({ rows, details, resumesUrl, isFilling, onGoTo, picked = null, attached = null, onChangeResume,
  fileProblem, onRetryFile, ownFileError, onOwnFile, onRemoveOwnFile }: DocumentSectionsProps) {
  const of = (kind: DocumentKind) => rows.filter(({ field }) => documentOf(field) === kind);
  const actions = { isFilling, onGoTo };
  const resumes = of("resume");
  const hasFile = resumes.some((row) => Boolean(filledValue(row))) || (resumes.length === 0 && Boolean(attached));
  // Once a file is on the form, the line stays only for the BDE's own file, so they can stop using it.
  const fileLine = picked && (!hasFile || picked.source === "picked") ? <ResumeFile picked={picked} isOnForm={hasFile} isFilling={isFilling}
    fileProblem={fileProblem} onRetryFile={onRetryFile} ownFileError={ownFileError} onOwnFile={onOwnFile} onRemoveOwnFile={onRemoveOwnFile} /> : null;
  return <div data-slot="documents" className="grid gap-2">
    <DocumentSection kind="resume" title="Resume" icon={RESUME_ICON} rows={resumes} held={picked ? null : resumeHeld(details)} extra={fileLine}
      link={picked ? null : resumesUrl} attached={attached} onChange={onChangeResume} {...actions} />
    <DocumentSection kind="cover-letter" title="Cover letter" icon={LETTER_ICON} rows={of("cover-letter")} held={letterHeld(details)} link={null} {...actions} />
  </div>;
}
