import { z } from "zod";
import {
  CandidateStatus,
  EmploymentType,
  RemoteMode,
  WorkAuth,
} from "./enums";

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
  /** null = unknown: work authorization "Other" has no rule and nobody entered a value (migration 0015). */
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
  /** Remote / hybrid / on-site, several allowed (Q50, final since migration 0015). */
  workSettings: z.array(RemoteMode),
  /** "City, ST". */
  preferredLocations: z.array(z.string()),
  /** How to reach them, interview windows — "Notes for the BDE". */
  contactNotes: z.string().nullable(),
  /** What the candidate prefers and refuses (wizard step 4). The summary is the active base résumé's, not here. */
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
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

/** The submission facts a BDE edits from the candidate Overview. A new `workAuth` comes with the sponsorship and transfer it implies. */
export const UpdateCandidateSchema = CandidateSchema.pick({
  workAuth: true,
  needsSponsorship: true,
  needsTransfer: true,
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
  /** Worked out by the flow from `workAuth` and sent; the backend only checks they are there. */
  needsSponsorship: z.boolean(),
  needsTransfer: z.boolean(),
  phone: z.string().trim().min(1, "Enter their phone number."),
  country: z.string().trim().min(1, "Enter the country."),
  yearsExperience: z.number().min(0).max(60),
  employmentTypes: z.array(EmploymentType).min(1, "Choose at least one engagement type."),
  targetRoles: z.array(z.string().trim().min(1)).min(1, "Add at least one role they are looking for."),
  fullName: z.string().trim().min(1, "Enter the candidate's name."),
  primaryRole: z.string().trim().min(1, "Enter the title they're marketed as."),
  email: z.string().trim().email("Enter a valid email."),
  summary: z.string().trim().nullable(),
  skills: z.array(z.object({ name: z.string().trim().min(1), family: z.string().nullable() })),
  preferredIndustries: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  /** The parse to keep: the backend holds the file until create (onboarding module 06). Required: no candidate without
   *  their résumé (07 Q58). */
  resumeParseId: z.string().min(1),
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
