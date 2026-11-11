import { normalize } from "./text";
import type { ResumeFile, ReviewRow, ScannedField } from "./types";

export type DocumentKind = "resume" | "cover-letter";

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

/** The name the picked résumé's file goes on a form by, without its extension: "<Candidate> - <Title>" (07 Q52), with
 * what a file name can't hold taken out. */
export function resumeFileName(candidate: string, title: string | null): string {
  const clean = (text: string) => text.replace(/[\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
  return [clean(candidate), clean(title ?? "") || "Resume"].filter(Boolean).join(" - ");
}
