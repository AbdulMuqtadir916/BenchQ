import { base64Of } from "../api";
import { normalize } from "./text";
import type { ResumeFile, ReviewRow, ScannedField } from "./types";

export type DocumentKind = "resume" | "cover-letter";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXTENSIONS: Record<string, string> = { [PDF_MIME]: ".pdf", [DOCX_MIME]: ".docx", "application/msword": ".doc" };

const RESUME = /\b(resume|cv|curriculum vitae)\b/;
const COVER_LETTER = /\bcover ?letter\b/;
/** A text box is the cover letter only when that's what its label is about, not a question that mentions one. */
const COVER_LETTER_BOX = /^cover ?letter\b/;

/** Which document a field asks for, from its label and attributes: an upload of the résumé or the cover letter, or a
 * text box for the cover letter. Its own rule, because the engine's types miss résumé uploads and read a box like
 * "Additional information" as a cover letter. An upload asking for both is the résumé's. */
export function documentOf({ kind, label, hints }: Pick<ScannedField, "kind" | "label" | "hints">): DocumentKind | null {
  if (kind === "textarea") return COVER_LETTER_BOX.test(normalize(label)) ? "cover-letter" : null;
  if (kind !== "file") return null;
  const text = normalize(`${label} ${hints}`.replace(/([a-z])([A-Z])/g, "$1 $2"));
  if (RESUME.test(text)) return "resume";
  return COVER_LETTER.test(text) ? "cover-letter" : null;
}

/** The picked résumé's file for the form's first résumé upload (07 Q51), never a cover letter's. It's filled like an
 * answer, so a file that was there before BenchQ looked stays, and one BenchQ attached is replaced when another résumé
 * is picked. Without a file the upload stays the BDE's to do. */
export function withResumeFile(rows: ReviewRow[], file: ResumeFile | null): ReviewRow[] {
  const upload = file && rows.find(({ field }) => field.kind === "file" && documentOf(field) === "resume");
  if (!file || !upload) return rows;
  return rows.map((row) => (row === upload
    ? { ...row, status: "ready" as const, reason: undefined, proposed: file.name, write: { type: "file" as const, ...file } }
    : row));
}

/** What the Resume section's file picker offers (Q5). */
export const OWN_FILE_TYPES = ".pdf,.doc,.docx";
/** BenchQ's own limit on a résumé upload (resume_parses' 10 MB check). */
const MAX_OWN_FILE_BYTES = 10 * 1024 * 1024;
const MIME_OF: Record<string, string> = { pdf: PDF_MIME, doc: "application/msword", docx: DOCX_MIME };

/** A file the BDE picked from their computer for the form's résumé upload (Q5), read into the panel's memory: its type
 * from its extension, its bytes in base64. The reason instead, as the panel says it, when it isn't a PDF or Word file
 * or is over 10 MB. */
export async function readOwnFile(file: File): Promise<ResumeFile | string> {
  const extension = /\.(pdf|docx?)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension) return "Pick a PDF or Word file.";
  if (file.size > MAX_OWN_FILE_BYTES) return "That file is over 10 MB. Pick a smaller one.";
  return { name: file.name, mimeType: MIME_OF[extension]!, data: base64Of(new Uint8Array(await file.arrayBuffer())), source: "picked" };
}

/** Whether an upload's `accept` list takes a file of this type: by its type, its extension or a wildcard. An empty list
 * takes anything. */
export function accepts(accept: string | undefined, mimeType: string): boolean {
  const kinds = (accept ?? "").toLowerCase().split(",").map((kind) => kind.trim()).filter(Boolean);
  if (kinds.length === 0) return true;
  return kinds.some((kind) => kind === mimeType || kind === EXTENSIONS[mimeType] || kind === "*/*"
    || kind === `${mimeType.split("/")[0]}/*`);
}

/** Whether the form's résumé upload (the first, as `withResumeFile` takes) takes a file of this type; a form without
 * one takes any. A file it won't take stays off the form, for the BDE to attach. */
export function fitsUpload(fields: Pick<ScannedField, "kind" | "label" | "hints" | "accept">[], mimeType: string): boolean {
  const upload = fields.find((field) => field.kind === "file" && documentOf(field) === "resume");
  return !upload || accepts(upload.accept, mimeType);
}

/** The kind of file the form's résumé upload (the first, as `withResumeFile` takes) needs when it won't take
 * `mimeType`: "pdf" or "docx" when its `accept` list names that one, else null (Q3: PDF unless it takes only Word). */
export function formatFor(fields: Pick<ScannedField, "kind" | "label" | "hints" | "accept">[], mimeType: string): "pdf" | "docx" | null {
  const upload = fields.find((field) => field.kind === "file" && documentOf(field) === "resume");
  if (!upload || accepts(upload.accept, mimeType)) return null;
  if (accepts(upload.accept, PDF_MIME)) return "pdf";
  return accepts(upload.accept, DOCX_MIME) ? "docx" : null;
}

/** The name the picked résumé's file goes on a form by, without its extension: "<Candidate> - <Title>" (07 Q52), with
 * what a file name can't hold taken out. */
export function resumeFileName(candidate: string, title: string | null): string {
  const clean = (text: string) => text.replace(/[\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
  return [clean(candidate), clean(title ?? "") || "Resume"].filter(Boolean).join(" - ");
}
