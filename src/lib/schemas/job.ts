import { z } from "zod";
import { EmploymentType, JobSourceType, LegalBasis, RemoteMode, WorkAuth } from "./enums";
import { CompanySchema } from "./company";

/** JobNavigator-aligned: dual-hash dedup, tracking params stripped before hashing. */
export const JobDedupeSchema = z.object({
  urlHash: z.string(),
  contentHash: z.string(),
  canonicalUrl: z.string().url().nullable(),
  duplicateOfJobId: z.string().nullable(),
});
export type JobDedupe = z.infer<typeof JobDedupeSchema>;

export const JobProvenanceSchema = z.object({
  sourceType: JobSourceType,
  sourceId: z.string(),
  sourceUrl: z.string().url().nullable(),
  legalBasis: LegalBasis,
  capturedByUserId: z.string().nullable(),
  ingestedAt: z.string().datetime(),
});
export type JobProvenance = z.infer<typeof JobProvenanceSchema>;

export const JobRequirementSchema = z.object({
  id: z.string(),
  kind: z.enum(["MANDATORY", "PREFERRED", "ADJACENT"]),
  category: z.enum(["SKILL", "CERTIFICATION", "EXPERIENCE_YEARS", "EDUCATION", "CLEARANCE"]),
  value: z.string(),
  canonicalValue: z.string().nullable(),
  isBlocker: z.boolean(),
});
export type JobRequirement = z.infer<typeof JobRequirementSchema>;

export const JobSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  companyId: z.string(),
  company: CompanySchema,

  title: z.string(),
  normalisedTitle: z.string(),
  description: z.string(),

  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().default("US"),
  remoteMode: RemoteMode,

  employmentType: EmploymentType.nullable(),
  rateMin: z.number().nullable(),
  rateMax: z.number().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),

  allowedWorkAuth: z.array(WorkAuth),
  excludesC2C: z.boolean(),

  postedAt: z.string().datetime().nullable(),
  applicantCount: z.number().int().nullable(),
  applyUrl: z.string().url().nullable(),

  requirements: z.array(JobRequirementSchema),
  dedupe: JobDedupeSchema,
  provenance: JobProvenanceSchema,

  isActive: z.boolean(),
});
export type Job = z.infer<typeof JobSchema>;

/**
 * Capture a job by hand (docs/04 §5.2, `POST /api/jobs`): what the capture form sends. The mock (the
 * backend in Phase D) builds the `Job` from it — provenance `USER_SUBMITTED` / `USER_SESSION`, the
 * company matched by name or added, dedup on the canonical URL.
 */
export const CaptureJobSchema = z.object({
  sourceUrl: z.string().trim().url("Enter the job's URL."),
  title: z.string().trim().min(1, "Enter the job title."),
  companyName: z.string().trim().min(1, "Enter the company."),
  location: z.string().trim(),
  remoteMode: RemoteMode,
  employmentType: EmploymentType.nullable(),
  payPeriod: z.enum(["HOUR", "YEAR"]),
  payMin: z.number().nonnegative().nullable(),
  payMax: z.number().nonnegative().nullable(),
  sponsorsVisa: z.boolean(),
  excludesC2C: z.boolean(),
  experience: z.string().trim(),
  skills: z.array(z.string().trim().min(1)),
  description: z.string().trim().min(1, "Paste the job description."),
});
export type CaptureJob = z.infer<typeof CaptureJobSchema>;
