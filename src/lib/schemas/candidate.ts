import { z } from "zod";
import {
  CandidateStatus,
  ClaimState,
  EmploymentType,
  FieldSource,
  RemoteMode,
  WorkAuth,
} from "./enums";

export const PersonaSchema = z.object({
  summary: z.string(),
  toneNotes: z.string().nullable(),
  willRelocate: z.boolean(),
  noticePeriodDays: z.number().int().nullable(),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const QaBankEntrySchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.enum([
    "WORK_AUTH",
    "COMPENSATION",
    "AVAILABILITY",
    "RELOCATION",
    "EXPERIENCE",
    "BEHAVIOURAL",
    "OTHER",
  ]),
  useCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
  state: ClaimState,
  evidenceId: z.string().nullable(),
});
export type QaBankEntry = z.infer<typeof QaBankEntrySchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  fullName: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().default("US"),
  willingToRelocate: z.boolean(),
  workAuth: WorkAuth,
  workAuthExpiry: z.string().datetime().nullable(),
  needsSponsorship: z.boolean(),
  needsTransfer: z.boolean(),
  employmentTypes: z.array(EmploymentType),
  rateMin: z.number().nullable(),
  rateTarget: z.number().nullable(),
  status: CandidateStatus,
  benchStartDate: z.string().datetime().nullable(),
  availableFrom: z.string().datetime().nullable(),
  noticePeriodDays: z.number().int().nullable(),
  yearsExperience: z.number().nullable(),
  primaryRole: z.string().nullable(),
  targetRoles: z.array(z.string()),
  /** The candidate's MANAGER. Always set (docs/02 §3.4, 07 Q41). */
  managerId: z.string(),
  /** The one BDE (Q42). null = "Needs a BDE". When set, that BDE's managerId equals `managerId`. */
  bdeId: z.string().nullable(),
  /** Provisional (Q50): remote / hybrid / on-site, several allowed. */
  workSettings: z.array(RemoteMode),
  /** Provisional (Q50): "City, ST". */
  preferredLocations: z.array(z.string()),
  /** Provisional (Q50): how to reach them, interview windows — "Notes for the BDE". */
  contactNotes: z.string().nullable(),
  persona: PersonaSchema.nullable(),
  qaBank: z.array(QaBankEntrySchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** DERIVED — never stored in a fixture. Computed in src/lib/derive/. */
export const CandidateStatsSchema = z.object({
  candidateId: z.string(),
  status: CandidateStatus,
  applicationsSubmitted: z.number().int(),
  distinctCompanies: z.number().int(),
  distinctRoles: z.number().int(),
  responsesReceived: z.number().int(),
  interviewsScheduled: z.number().int(),
  offersReceived: z.number().int(),
  applicationsOpen: z.number().int(),
  responseRatePct: z.number(),
  daysOnBench: z.number().int(),
  firstApplicationAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  isAtRisk: z.boolean(),
  workAuthExpiringSoon: z.boolean(),
});
export type CandidateStats = z.infer<typeof CandidateStatsSchema>;

/** The submission facts a BDE edits from the candidate Overview. */
export const UpdateCandidateSchema = CandidateSchema.pick({
  workAuth: true,
  workAuthExpiry: true,
  rateTarget: true,
  rateMin: true,
  availableFrom: true,
  noticePeriodDays: true,
  willingToRelocate: true,
  employmentTypes: true,
}).partial();
export type UpdateCandidate = z.infer<typeof UpdateCandidateSchema>;

/**
 * New candidate (docs/02 §4, 07 Q41 and Q48): what the new-candidate flow sends. The OWNER names a MANAGER and
 * optionally one of their BDEs; a MANAGER names themself and one of their BDEs (`canAssignTo`, onboarding module 03).
 */
export const CreateCandidateSchema = CandidateSchema.pick({
  phone: true,
  linkedinUrl: true,
  city: true,
  state: true,
  yearsExperience: true,
  workAuth: true,
  workAuthExpiry: true,
  needsSponsorship: true,
  needsTransfer: true,
  employmentTypes: true,
  rateTarget: true,
  rateMin: true,
  availableFrom: true,
  noticePeriodDays: true,
  targetRoles: true,
  willingToRelocate: true,
  workSettings: true,
  preferredLocations: true,
  contactNotes: true,
}).extend({
  fullName: z.string().trim().min(1, "Enter the candidate's name."),
  primaryRole: z.string().trim().min(1, "Enter the title they're marketed as."),
  email: z.string().trim().email("Enter a valid email."),
  summary: z.string().trim().nullable(),
  skills: z.array(z.object({ name: z.string().trim().min(1), family: z.string().nullable(), source: FieldSource })),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  /** The parse to keep: the backend holds the file until create (onboarding module 06). null = no résumé. */
  resumeParseId: z.string().nullable(),
  managerId: z.string().min(1, "Choose a manager."),
  bdeId: z.string().nullable(),
  handoffNote: z.string().trim().max(1000).nullable(),
});
export type CreateCandidate = z.infer<typeof CreateCandidateSchema>;

/** Move a candidate to another manager and/or BDE (07 Q43). One ASSIGN ledger entry per move. */
export const ReassignCandidateSchema = z.object({
  managerId: z.string().min(1, "Choose a manager."),
  bdeId: z.string().nullable(),
  note: z.string().trim().max(1000).nullable(),
});
export type ReassignCandidate = z.infer<typeof ReassignCandidateSchema>;
