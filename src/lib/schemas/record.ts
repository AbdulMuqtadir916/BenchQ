import { z } from "zod";
import { ClaimState, FieldSource } from "./enums";

/** Substantiation. A claim cannot be VERIFIED without one of these. */
export const RecordEvidenceSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  entityType: z.enum(["experience", "skill", "project", "certificate", "summary"]),
  entityId: z.string(),
  documentId: z.string().nullable(),
  excerpt: z.string().nullable(),
  pageNumber: z.number().int().nullable(),
  confirmedByUserId: z.string().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  source: FieldSource,
});
export type RecordEvidence = z.infer<typeof RecordEvidenceSchema>;

export const RecordBulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  state: ClaimState,
  evidenceId: z.string().nullable(),
});
export type RecordBullet = z.infer<typeof RecordBulletSchema>;

export const RecordExperienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
  isCurrent: z.boolean(),
  bullets: z.array(RecordBulletSchema),
  technologies: z.array(z.string()),
  sortOrder: z.number().int(),
  source: FieldSource,
  state: ClaimState,
});
export type RecordExperience = z.infer<typeof RecordExperienceSchema>;

export const RecordSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  canonicalName: z.string(),
  family: z.string().nullable(),
  yearsUsed: z.number().nullable(),
  lastUsedYear: z.number().int().nullable(),
  proficiency: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"]).nullable(),
  source: FieldSource,
  state: ClaimState,
});
export type RecordSkill = z.infer<typeof RecordSkillSchema>;

export const RecordEducationSchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  source: FieldSource,
  state: ClaimState,
});
export type RecordEducation = z.infer<typeof RecordEducationSchema>;

export const RecordCertificateSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().nullable(),
  issueDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  credentialId: z.string().nullable(),
  credentialUrl: z.string().url().nullable(),
  source: FieldSource,
  state: ClaimState,
});
export type RecordCertificate = z.infer<typeof RecordCertificateSchema>;

export const RecordSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  summaryState: ClaimState,
  experiences: z.array(RecordExperienceSchema),
  educations: z.array(RecordEducationSchema),
  skills: z.array(RecordSkillSchema),
  certificates: z.array(RecordCertificateSchema),
  evidence: z.array(RecordEvidenceSchema),
  lastVerifiedAt: z.string().datetime().nullable(),
});
export type Record_ = z.infer<typeof RecordSchema>;

/** DERIVED — computed, never stored. */
export const RecordCompletenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  missing: z.array(
    z.object({
      field: z.string(),
      label: z.string(),
      severity: z.enum(["BLOCKER", "IMPORTANT", "MINOR"]),
    }),
  ),
});
export type RecordCompleteness = z.infer<typeof RecordCompletenessSchema>;
