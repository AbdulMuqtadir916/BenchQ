import { z } from "zod";

/** JobNavigator-aligned: tracer link per resume/letter, with open + click tracking. */
export const TracerSchema = z.object({
  token: z.string(),
  url: z.string().url(),
  openCount: z.number().int(),
  clickCount: z.number().int(),
  firstOpenedAt: z.string().datetime().nullable(),
  lastOpenedAt: z.string().datetime().nullable(),
});
export type Tracer = z.infer<typeof TracerSchema>;

/** JobNavigator-aligned: tailoring history per job. */
export const TailoringSchema = z.object({
  /** A17: tailoring runs are firm-scoped (AI spend by firm in /admin/system). */
  firmId: z.string(),
  targetJobId: z.string(),
  targetJobTitle: z.string(),
  targetCompanyName: z.string(),
  keywordsTargeted: z.array(z.string()),
  bulletsRewritten: z.number().int(),
  generatedBy: z.enum(["HUMAN", "AGENT"]),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  generatedAt: z.string().datetime().nullable(),
});
export type Tailoring = z.infer<typeof TailoringSchema>;

/** One line of a version's text: the summary, or one bullet of a job or project. */
export const ResumeLineSchema = z.object({
  id: z.string(),
  resumeVersionId: z.string(),
  section: z.enum(["summary", "experience", "project"]),
  entityId: z.string().nullable(),
  bulletIndex: z.number().int().nullable(),
  text: z.string(),
});
export type ResumeLine = z.infer<typeof ResumeLineSchema>;

export const AtsIssueSchema = z.object({
  check: z.string(),
  label: z.string(),
  passed: z.boolean(),
  severity: z.enum(["BLOCKER", "IMPORTANT", "MINOR"]),
  message: z.string(),
  fix: z.string().nullable(),
});
export type AtsIssue = z.infer<typeof AtsIssueSchema>;

export const ResumeVersionSchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  versionNumber: z.number().int(),
  parentVersionId: z.string().nullable(),

  templateId: z.string(),
  includedSectionIds: z.array(z.string()),
  includedBulletIds: z.array(z.string()),
  bulletOverrides: z.record(z.string(), z.string()),

  atsScore: z.number().int().min(0).max(100).nullable(),
  atsGrade: z.enum(["A", "B", "C", "D", "F"]).nullable(),
  atsIssues: z.array(AtsIssueSchema),

  keywordScore: z.number().int().min(0).max(100).nullable(),
  keywordsMatched: z.array(z.string()),
  keywordsMissing: z.array(z.string()),

  lines: z.array(ResumeLineSchema),
  tailoring: TailoringSchema.nullable(),
  tracer: TracerSchema.nullable(),

  pdfUrl: z.string().nullable(),
  docxUrl: z.string().nullable(),
  renderedAt: z.string().datetime().nullable(),

  changeSummary: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
});
export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;

export const ResumeSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  /** The base this résumé belongs to: a base's own versions, or the base a tailored copy was made from (docs/02 §8.1). */
  baseResumeId: z.string().nullable(),
  name: z.string(),
  /** A base's own versions (`category = 'BASE'`); false for a copy tailored to a job. */
  isMaster: z.boolean(),
  targetJobId: z.string().nullable(),
  templateId: z.string(),
  versions: z.array(ResumeVersionSchema),
  latestVersionId: z.string(),
});
export type Resume = z.infer<typeof ResumeSchema>;

/** A base résumé: one per upload, promotion or form; exactly one active per candidate (docs/02 §8.1). */
export const BaseResumeSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  source: z.enum(["UPLOAD", "PROMOTED", "MANUAL"]),
  /** Whether the base is a résumé yet: a file or a version is; a base made from the New candidate form alone isn't until
   *  a later version adds résumé content (the backend's `has_resume`). */
  hasResume: z.boolean().default(true),
  isActive: z.boolean(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  /** PROMOTED: the version it was copied from. */
  promotedFromResumeId: z.string().nullable(),
  /** Set while hidden (a used base the BDE deleted); null otherwise. */
  archivedAt: z.string().datetime().nullable(),
});
export type BaseResume = z.infer<typeof BaseResumeSchema>;

/** What a résumé list reads: the bases and every résumé of them (a base's versions, the tailored copies). */
export const ResumeShelfSchema = z.object({
  bases: z.array(BaseResumeSchema),
  resumes: z.array(ResumeSchema),
});
export type ResumeShelf = z.infer<typeof ResumeShelfSchema>;

/**
 * What deleting a base or a version would do, or did (resume-versioning.md §4.7): deleted, hidden (a base something
 * uses), or refused. `uses` names what uses it; `rest` is what "also delete what nothing uses" would delete (a
 * hidden base only).
 */
export const ResumeRemovalSchema = z.object({
  outcome: z.enum(["DELETE", "HIDE", "REFUSED"]),
  message: z.string(),
  uses: z.record(z.string(), z.number().int()),
  rest: z.object({ versions: z.number().int().optional(), tailored: z.number().int().optional() }),
});
export type ResumeRemoval = z.infer<typeof ResumeRemovalSchema>;

