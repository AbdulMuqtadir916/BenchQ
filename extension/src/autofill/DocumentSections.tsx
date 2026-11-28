import { useRef } from "react";
import type { Application } from "../api";
import { button, FITTED_BUTTONS, WARNING } from "../ui";
import { documentOf, OWN_FILE_TYPES, type DocumentKind } from "./documents";
import { filledValue } from "./form-memory";
import { CHECK, CHEVRON_DOWN_ICON, EXTERNAL_ICON, UPLOAD_ICON } from "./icons";
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
  /** The picked résumé's file couldn't be loaded or made this time; Try again asks once more. */
  fileProblem?: boolean;
  onRetryFile?: () => void;
  /** A file from the BDE's computer in place of the résumé's own (Q5), why one was refused, and taking it off again. */
  ownFileError?: string | null;
  onOwnFile?: (file: File) => void;
  onRemoveOwnFile?: () => void;
  /** The BDE's own file while they use one, whether or not this form's upload takes it. */
  ownFile?: { name: string } | null;
  /** The kinds the form's résumé upload takes, when the file offered isn't one of them. */
  refusedAccept?: string | null;
  /** The file BenchQ attached on this page, whether or not a chip shows it: its card offers Use a different file, which
   * BenchQ swaps in (#148's review). A file attached by hand is the BDE's to change on the page. */
  benchQFile?: string | null;
};

/** Use a file from the computer, as a small link on the résumé card. */
const PICK = "inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-3 py-2.5 text-caption font-[600] text-[var(--color-text-3)] transition-[background,color] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
/** A small icon button on the file's line: Use a different file. */
const ICON_ACTION = "grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-md)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-sm)]";
/** Go to field, small, on the field's own line. */
const GO = "inline-flex flex-none items-center gap-0.5 text-caption font-[600] text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-sm)] [&_svg]:-rotate-90";
const FILE_STATUS = "flex items-center gap-1 font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";
const FILE_LINK = "font-[550] text-[var(--color-text-2)] underline underline-offset-2 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50";

type AttachedProps = { name: string; isFilling?: boolean; onChange?: () => void; onGoTo?: () => void; onPickFile?: (file: File) => void };

/** A file on the form (07 Q53, Q56): one line with its name, two at most (the whole name on hover), then small actions:
 * that it's attached, Change resume (another résumé to pick), Use a different file (one from the computer, in place of
 * the file BenchQ attached: #148's review) and Go to field. */
function AttachedFile({ name, isFilling = false, onChange, onGoTo, onPickFile }: AttachedProps) {
  const input = useRef<HTMLInputElement>(null);
  return <div data-slot="document-attached" className="flex min-w-0 flex-1 items-center justify-end gap-2">
    <span data-slot="document-value" className="min-w-0 truncate text-sm font-[550] text-[var(--color-text)]" title={name}>{name}</span>
    <span className="flex flex-none items-center gap-2 text-caption">
      <span className={FILE_STATUS}>{CHECK}<span className="sr-only">Attached</span></span>
      {onChange && <button type="button" data-slot="document-change" className={FILE_LINK} disabled={isFilling} onClick={onChange}>Change resume</button>}
      {onPickFile && <>
        <input ref={input} type="file" accept={OWN_FILE_TYPES} hidden data-slot="own-file-input" onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (chosen) onPickFile(chosen);
        }} />
        <button type="button" data-slot="own-file-pick" className={ICON_ACTION} title="Use a different file" disabled={isFilling} onClick={() => input.current?.click()}>
          {UPLOAD_ICON}<span className="sr-only">Use a different file</span>
        </button>
      </>}
      {onGoTo && <button type="button" className={GO} disabled={isFilling} onClick={onGoTo}>Go to field{CHEVRON_DOWN_ICON}</button>}
    </span>
  </div>;
}

function resumeHeld(details: Application | null): string | null {
  if (!details) return null;
  const name = details.tailored_resume_name;
  if (!name) return "No tailored resume for this job yet.";
  return details.tailored_resume_deleted ? `Tailored for this job: ${name} (deleted in BenchQ)` : `Tailored for this job: ${name}`;
}

const TAG = "flex-none rounded-full px-1.5 text-caption font-[550]";
const SOURCE_TAG: Record<ResumeFileSource, string> = {
  generated: `${TAG} bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]`,
  uploaded: `${TAG} bg-[var(--color-surface-3)] text-[var(--color-text-2)]`,
  picked: `${TAG} bg-[var(--color-teal-bg)] text-[var(--color-teal-fg)]`,
};

type ResumeFileProps = Pick<DocumentSectionsProps, "fileProblem" | "onRetryFile" | "onOwnFile" | "onRemoveOwnFile" | "ownFile" | "refusedAccept"> & {
  picked: NonNullable<DocumentSectionsProps["picked"]>;
  isFilling: boolean;
  /** A file is on the form already: only the BDE's own file says so, with Remove to stop using it. */
  isOnForm?: boolean;
  /** The card of the file BenchQ attached offers Use a different file itself, so this line needn't. */
  isPickOnCard?: boolean;
  /** BenchQ's file is on the form's upload: this line offers Use a different file. */
  canSwap?: boolean;
};

/** What the Resume section says about the picked résumé's file: the file Autofill attaches and where it came from (made
 * from the version, as uploaded, or the BDE's own), with a way to use a file from their computer instead (Q5); that it
 * couldn't be made, with Try again; that the form's upload doesn't take its kind; or that it's the BDE's to attach. The
 * BDE's own file keeps Remove in every case, on the form or not, taken or not, so they can always stop using it. */
function ResumeFile({ picked, isFilling, isOnForm = false, isPickOnCard = false, canSwap = false, fileProblem = false, onRetryFile, onOwnFile, onRemoveOwnFile,
  ownFile = null, refusedAccept = null }: ResumeFileProps) {
  const input = useRef<HTMLInputElement>(null);
  const remove = ownFile && onRemoveOwnFile && <button type="button" data-slot="own-file-remove" className={button("secondary", "compact")}
    disabled={isFilling} title="Stop using your file for this candidate's forms" onClick={onRemoveOwnFile}>Remove</button>;
  const choose = (label: string) => onOwnFile && <>
    <input ref={input} type="file" accept={OWN_FILE_TYPES} hidden data-slot="own-file-input"
      onChange={(event) => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (chosen) onOwnFile(chosen);
      }} />
    <button type="button" data-slot="own-file-pick" className={PICK} disabled={isFilling} onClick={() => input.current?.click()}>
      {UPLOAD_ICON}{label}
    </button>
  </>;
  const ownTag = ownFile && <span data-slot="resume-file-source" className={SOURCE_TAG.picked}>Your file</span>;
  // A refused file says so first, though an older one is on the form: that one stays there (#148's review).
  if (refusedAccept !== null) {
    const what = ownFile ? `Your file, ${ownFile.name}, isn't` : "The resume's file isn't";
    const stays = isOnForm ? " The file already on the form stays." : "";
    return <div data-slot="resume-file" className="grid basis-full gap-1.5">
      <p data-slot="resume-file-refused" className={WARNING} role="status">
        {what} a kind this form&apos;s upload takes{refusedAccept ? ` (${refusedAccept})` : ""}.{stays} Use another file, or attach one by hand.
      </p>
      <div className="flex flex-wrap items-center gap-2">{ownTag}{!isPickOnCard && choose(ownFile ? "Use a different file" : "Use a file")}{remove}</div>
    </div>;
  }
  if (isOnForm) {
    if (ownFile) return <span data-slot="resume-file" className="flex flex-none items-center gap-2">{ownTag}{remove}</span>;
    return canSwap ? <span data-slot="resume-file" className="flex flex-none items-center gap-2">{choose("Use a different file")}</span> : null;
  }
  if (fileProblem && !ownFile) {
    return <div data-slot="resume-file" className="grid basis-full gap-1.5">
      <p data-slot="resume-file-problem" className={WARNING} role="status">The resume file couldn&apos;t be made. Try again, or use a file from your computer.</p>
      <div className={FITTED_BUTTONS}>
        {onRetryFile && <button type="button" className={button("secondary", "compact")} disabled={isFilling} onClick={onRetryFile}>Try again</button>}
        {choose("Use a file")}
      </div>
    </div>;
  }
  if (!picked.file) {
    return <span data-slot="resume-file" className="flex flex-none items-center gap-2" title={`Attach by hand: ${picked.label}`}>
      <span data-slot="document-held" className="sr-only">Attach by hand: {picked.label}</span>
      {ownFile && <>{ownTag}{remove}</>}
    </span>;
  }
  const tag = ownFile ? null : picked.source === "generated" ? `Made from ${picked.meta || picked.label}` : picked.source === "uploaded" ? "Uploaded file" : null;
  return <span data-slot="resume-file" className="flex flex-none items-center gap-2" title={`Autofill attaches: ${picked.file}`}>
    <span data-slot="document-held" className="sr-only">Autofill attaches: <span>{picked.file}</span></span>
    {ownTag}
    {tag && picked.source && <span data-slot="resume-file-source" className="sr-only">{tag}</span>}
    {ownFile ? remove : choose("Use a different file")}
  </span>;
}

/** The résumé and the cover letter, each in a section of its own whether or not the form asks for it. A section says
 * what the form wants, takes the BDE to the field, and says what goes there: Autofill attaches the picked résumé's file
 * when BenchQ has it, and otherwise says which résumé to attach; once a file is on the form, its card says so instead.
 * A cover letter is always the BDE's. */
export default function DocumentSections({ rows, details, resumesUrl, isFilling, picked = null, attached = null,
  fileProblem, onRetryFile, ownFileError, onOwnFile, onRemoveOwnFile, ownFile = null, refusedAccept = null, benchQFile = null }: DocumentSectionsProps) {
  const of = (kind: DocumentKind) => rows.filter(({ field }) => documentOf(field) === kind);
  const resumes = of("resume");
  const hasFile = resumes.some((row) => Boolean(filledValue(row))) || (resumes.length === 0 && Boolean(attached));
  // The line says what goes on the form's upload; once a file is on it, or the form has none (any more), it stays only
  // for the BDE's own file, so they can always stop using it.
  const hasUpload = resumes.length > 0;
  // The card of the file BenchQ attached has its own Use a different file: the line below it doesn't offer a second.
  const isPickOnCard = Boolean(onOwnFile && benchQFile) && resumes.length === 0 && Boolean(attached);
  const canSwap = Boolean(onOwnFile && benchQFile) && resumes.some((row) => filledValue(row) === benchQFile);
  const fileLine = picked && (hasUpload ? !hasFile || ownFile || canSwap : ownFile) ? <ResumeFile picked={picked} isOnForm={hasFile || !hasUpload} isPickOnCard={isPickOnCard} canSwap={canSwap}
    isFilling={isFilling} fileProblem={fileProblem}
    onRetryFile={onRetryFile} onOwnFile={onOwnFile} onRemoveOwnFile={onRemoveOwnFile} ownFile={ownFile}
    refusedAccept={refusedAccept} /> : null;
  // Why a file from the computer wasn't taken: shown whatever's on the form, as the card's Use a different file can pick
  // one with a file already attached (#148's review).
  const pickError = ownFileError ? <p data-slot="own-file-error" className="text-caption text-[var(--color-danger-fg)]" role="alert">{ownFileError}</p> : null;
  const extra = fileLine || pickError ? <>{fileLine}{pickError}</> : null;
  // A section the form doesn't ask for says nothing the BDE needs: it shows only for a field of its kind, a file BenchQ
  // put on the page, or the BDE's own file, which keeps Remove.
  // What needs the BDE about the résumé's file, on its card: the file a chip shows, the BDE's own file, a file that
  // couldn't be made or isn't taken, or Use a different file. Nothing else: the fields themselves are in the list.
  const isChip = resumes.length === 0 && Boolean(attached);
  const link = picked ? null : resumesUrl;
  if (!isChip && !extra && !(resumes.length > 0 && link)) return null;
  const status = resumes.length === 0 ? (attached ? "Attached" : "No field found") : resumes.some(({ field }) => field.required) ? "Required" : "Optional";
  const held = picked ? null : resumeHeld(details);
  return <div data-slot="documents" className="grid gap-1">
    <section data-slot="document" data-document="resume" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" aria-label="The resume's file">
      <span data-slot="document-status" className="sr-only">{status}</span>
      {isChip && <AttachedFile name={attached ?? ""} isFilling={isFilling} onPickFile={onOwnFile} />}
      {extra}
      {!extra && resumes.length > 0 && held && <p data-slot="document-held" className="sr-only">{held}</p>}
      {resumes.length > 0 && link && <a className={button("secondary", "compact")} href={link} target="_blank" rel="noreferrer">Open in BenchQ{EXTERNAL_ICON}</a>}
    </section>
  </div>;
}
