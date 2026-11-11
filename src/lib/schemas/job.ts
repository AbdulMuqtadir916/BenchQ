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
  /** The candidates this job was found or captured for, only those the viewer may see (docs/02 §6.z). The mock's
   * fixture jobs belong to no candidate (decided 2026-11-11). */
  candidateIds: z.array(z.string()).default([]),
});
export type Job = z.infer<typeof JobSchema>;

/**
 * Capture a job by hand for one candidate (docs/02 §6.z): what the capture form sends to
 * `POST …/candidates/{candidateId}/job-postings`. The backend keeps only these; the same job again for the
 * candidate is the one they already have (`DUPLICATE_JOB`).
 */
export const CaptureJobSchema = z.object({
  candidateId: z.string().min(1, "Choose the candidate."),
  sourceUrl: z.string().trim().url("Enter the job's URL."),
  title: z.string().trim().min(1, "Enter the job title.").max(300),
  companyName: z.string().trim().min(1, "Enter the company.").max(300),
  location: z.string().trim().max(300),
  description: z.string().trim().min(1, "Paste the job description.").max(100_000),
});
export type CaptureJob = z.infer<typeof CaptureJobSchema>;

/** A person's saved / hidden job (docs/02 §6.x, approved 2026-10-20): personal, firm-scoped. */
export const JobMarkKind = z.enum(["SAVED", "HIDDEN"]);
export type JobMarkKind = z.infer<typeof JobMarkKind>;

export const JobMarkSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  userId: z.string(),
  jobId: z.string(),
  kind: JobMarkKind,
  createdAt: z.string().datetime(),
});
export type JobMark = z.infer<typeof JobMarkSchema>;
