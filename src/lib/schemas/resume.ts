import { z } from "zod";
import { ClaimState } from "./enums";

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

export const ResumeClaimSchema = z.object({
  id: z.string(),
  resumeVersionId: z.string(),
  section: z.enum(["summary", "experience", "project"]),
  entityId: z.string().nullable(),
  bulletIndex: z.number().int().nullable(),
  text: z.string(),
  state: ClaimState,
  evidenceId: z.string().nullable(),
  reason: z.string().nullable(),
  overriddenByUserId: z.string().nullable(),
  overrideReason: z.string().nullable(),
  overriddenAt: z.string().datetime().nullable(),
});
export type ResumeClaim = z.infer<typeof ResumeClaimSchema>;

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

  claims: z.array(ResumeClaimSchema),
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
  name: z.string(),
  isMaster: z.boolean(),
  targetJobId: z.string().nullable(),
  templateId: z.string(),
  versions: z.array(ResumeVersionSchema),
  latestVersionId: z.string(),
});
export type Resume = z.infer<typeof ResumeSchema>;

/** DERIVED — the export gate. Computed from claims. */
export const ExportGateSchema = z.object({
  canExport: z.boolean(),
  unverifiedCount: z.number().int(),
  contradictedCount: z.number().int(),
  blockingClaimIds: z.array(z.string()),
  message: z.string().nullable(),
});
export type ExportGate = z.infer<typeof ExportGateSchema>;
