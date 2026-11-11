import { z } from "zod";

/**
 * All enums per docs/02 §2. Single source of truth — import from here,
 * never redeclare inline.
 */

export const FirmRole = z.enum(["OWNER", "MANAGER", "BDE", "VIEWER"]);
export type FirmRole = z.infer<typeof FirmRole>;

export const WorkAuth = z.enum([
  "H1B",
  "H4_EAD",
  "OPT",
  "CPT",
  "GC",
  "GC_EAD",
  "USC",
  "TN",
]);
// No "OTHER" (Abdul, 2026-11-06): every status has a sponsorship rule, so needsSponsorship is always true or false.
export type WorkAuth = z.infer<typeof WorkAuth>;

export const EmploymentType = z.enum(["C2C", "W2", "TEEN99", "FTE"]);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const CandidateStatus = z.enum([
  "ON_BENCH",
  "INTERVIEWING",
  "OFFER",
  "PLACED",
  "PAUSED",
  "INACTIVE",
]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const JobSourceType = z.enum([
  "CONNECTOR",
  "AGGREGATOR",
  "USER_SUBMITTED",
  "MANUAL",
]);
export type JobSourceType = z.infer<typeof JobSourceType>;

export const LegalBasis = z.enum([
  "PUBLIC_DOCUMENTED",
  "LICENSED_API",
  "USER_SESSION",
]);
export type LegalBasis = z.infer<typeof LegalBasis>;

export const RemoteMode = z.enum(["ONSITE", "HYBRID", "REMOTE"]);
export type RemoteMode = z.infer<typeof RemoteMode>;

export const VerificationVerdict = z.enum([
  "VERIFIED",
  "CAUTION",
  "REJECTED",
  "UNKNOWN",
]);
export type VerificationVerdict = z.infer<typeof VerificationVerdict>;

export const ClientType = z.enum([
  "DIRECT_CLIENT",
  "PRIME_VENDOR",
  "IMPLEMENTATION_PARTNER",
  "STAFFING_AGENCY",
  "UNKNOWN",
]);
export type ClientType = z.infer<typeof ClientType>;

/**
 * The ten selectable candidate application statuses (docs/02 §2.1, D3). The only values a new command may write.
 * Spelling is the backend value in upper case.
 */
export const ApplicationStatus = z.enum([
  "SAVED",
  "APPLIED",
  "SCREENING_CALL",
  "SHORTLISTED",
  "INTERVIEW_SCHEDULE_REQUEST",
  "INTERVIEW_SCHEDULED",
  "ASSESSMENT",
  "OFFER",
  "MOVE_ON",
  "INCOMPLETE_APPLICATION",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

/**
 * Older stored values (docs/02 §2.1 legacy table). Read and shown with a legacy label, never selectable, never
 * guessed into a target stage. UNKNOWN stands for a blank or unrecognised stored value.
 */
export const LegacyApplicationStatus = z.enum([
  "RESPONSE",
  "SCREENING",
  "INTERVIEW",
  "PLACED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
  "OTHER",
  "PHONE_SCREEN",
  "FINAL_ROUND",
  "UNKNOWN",
]);
export type LegacyApplicationStatus = z.infer<typeof LegacyApplicationStatus>;

/** What an application or a history event may hold: a selectable status or a preserved legacy one. */
export const StoredApplicationStatus = z.union([ApplicationStatus, LegacyApplicationStatus]);
export type StoredApplicationStatus = z.infer<typeof StoredApplicationStatus>;

export const OutreachChannel = z.enum([
  "EMAIL",
  "LINKEDIN_CONNECT",
  "LINKEDIN_MESSAGE",
  "PHONE",
  "OTHER",
]);
export type OutreachChannel = z.infer<typeof OutreachChannel>;

export const OutreachResult = z.enum([
  "SENT",
  "OPENED",
  "REPLIED",
  "BOUNCED",
  "NO_RESPONSE",
]);
export type OutreachResult = z.infer<typeof OutreachResult>;

/** JobNavigator-aligned: two scoring depths for cost control. */
export const ScoringDepth = z.enum(["LIGHT", "FULL"]);
export type ScoringDepth = z.infer<typeof ScoringDepth>;

export const RequirementKind = z.enum(["MANDATORY", "PREFERRED", "ADJACENT"]);
export type RequirementKind = z.infer<typeof RequirementKind>;

export const RequirementMatch = z.enum(["HAVE", "MISSING", "ADJACENT"]);
export type RequirementMatch = z.infer<typeof RequirementMatch>;
