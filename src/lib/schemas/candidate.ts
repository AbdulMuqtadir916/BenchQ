import { z } from "zod";
import {
  CandidateStatus,
  ClaimState,
  EmploymentType,
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
  assignedUserIds: z.array(z.string()),
  primaryUserId: z.string().nullable(),
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
 * New candidate (docs/04 §4.2, `POST /api/candidates`): what the intake form sends. `assignedUserId` is
 * the BDE to assign — only a principal with `candidate.assign` may name one; a BDE's new candidate is
 * always assigned to themself, so it lands in their own scope.
 */
export const CreateCandidateSchema = CandidateSchema.pick({
  email: true,
  phone: true,
  workAuth: true,
  needsSponsorship: true,
  needsTransfer: true,
}).extend({
  fullName: z.string().trim().min(1, "Enter the candidate's name."),
  primaryRole: z.string().trim().min(1, "Enter the target role."),
  assignedUserId: z.string().nullable(),
});
export type CreateCandidate = z.infer<typeof CreateCandidateSchema>;
