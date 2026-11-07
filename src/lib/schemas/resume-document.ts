import { z } from "zod";
import { ResumeSchema } from "./resume";

/**
 * The resume builder's working document — a client-side view model composed
 * from Resume + ResumeVersion + Candidate + Record (see lib/resume-doc/build.ts).
 * A summary, a bullet or a project description is RichText (a little inline
 * formatting); everything else is plain text.
 */
export const RichTextSchema = z.object({
  id: z.string(),
  /** Sanitised inline HTML — only b / i / u / br survive (lib/resume-doc/rich-text.ts). */
  html: z.string(),
});
export type RichText = z.infer<typeof RichTextSchema>;

/**
 * The header's contact details, one field each, as the backend stores them (the parser's `header`). The paper prints
 * the location (city, state, country), phone, email, LinkedIn and GitHub; work authorization is shown in the builder
 * only, read-only: it is the candidate's profile fact (07 Q55, resume-versioning.md §4.3).
 */
export const ResumeHeaderSchema = z.object({
  city: z.string(),
  state: z.string(),
  country: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string(),
  github: z.string(),
  workAuthorization: z.string(),
});
export type ResumeHeader = z.infer<typeof ResumeHeaderSchema>;

export const ExperienceEntrySchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  /** As printed ("Jan 2020 – Present"). */
  dates: z.string(),
  /** "YYYY-MM" or "YYYY"; for sorting and matching, not printed. */
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  bullets: z.array(RichTextSchema),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const SkillRowSchema = z.object({ id: z.string(), category: z.string(), items: z.string() });
export type SkillRow = z.infer<typeof SkillRowSchema>;

export const EducationEntrySchema = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string(),
  /** As printed ("Jun 2025", "Expected Dec 2026"). */
  graduationDate: z.string(),
  /** CGPA, GPA or percentage, as printed. */
  grade: z.string(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

/** A certification or an award: the same four fields (the parser's format). */
export const CredentialEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
  detail: z.string(),
});
export type CredentialEntry = z.infer<typeof CredentialEntrySchema>;

export const ProjectEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string(),
  dates: z.string(),
  technologies: z.string(),
  bullets: z.array(RichTextSchema),
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const ResumeSectionKey = z.enum([
  "header",
  "summary",
  "experience",
  "skills",
  "education",
  "certifications",
  "awards",
  "projects",
]);
export type ResumeSectionKey = z.infer<typeof ResumeSectionKey>;

/** Sections that are arrays of entries with an id — the generic list ops work on these. */
export type ResumeListKey = "experience" | "skills" | "education" | "certifications" | "awards" | "projects";

/** Sections whose entries hold bullets. */
export type BulletSection = "experience" | "projects";

export const ResumeDocumentSchema = z.object({
  /** The version open in the studio (its id is the studio's URL). */
  resumeId: z.string(),
  candidateId: z.string(),
  name: z.string(),
  isMaster: z.boolean(),
  templateId: z.string(),
  fullName: z.string(),
  title: z.string(),
  header: ResumeHeaderSchema,
  summary: RichTextSchema,
  experience: z.array(ExperienceEntrySchema),
  skills: z.array(SkillRowSchema),
  education: z.array(EducationEntrySchema),
  certifications: z.array(CredentialEntrySchema),
  awards: z.array(CredentialEntrySchema),
  projects: z.array(ProjectEntrySchema),
});
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

/** One version opened in the studio: the résumé it belongs to (its versions, no text) and its own text. */
export const OpenedResumeSchema = z.object({
  resume: ResumeSchema,
  versionId: z.string(),
  document: ResumeDocumentSchema,
});
export type OpenedResume = z.infer<typeof OpenedResumeSchema>;

/** A save's answer: the new version, opened, and the notice when another version was saved meanwhile (§4.3). */
export const ResumeSaveResultSchema = z.object({ opened: OpenedResumeSchema, notice: z.string().nullable() });
export type ResumeSaveResult = z.infer<typeof ResumeSaveResultSchema>;

/** AI text actions offered on a text selection.  */
export const RewriteAction = z.enum(["improve", "concise", "quantify", "grammar"]);
export type RewriteAction = z.infer<typeof RewriteAction>;

export const RewriteInputSchema = z.object({ text: z.string().min(1), action: RewriteAction });
export type RewriteInput = z.infer<typeof RewriteInputSchema>;

export const RewriteResultSchema = z.object({ text: z.string(), note: z.string() });
export type RewriteResult = z.infer<typeof RewriteResultSchema>;
