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
  "OTHER",
]);
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

/** The three claim states. The product's core concept. */
export const ClaimState = z.enum(["VERIFIED", "UNVERIFIED", "CONTRADICTED"]);
export type ClaimState = z.infer<typeof ClaimState>;

export const FieldSource = z.enum([
  "MANUAL",
  "RESUME_UPLOAD",
  "LINKEDIN_EXPORT",
  "INTAKE_CALL",
  "AI_EXTRACTED",
]);
export type FieldSource = z.infer<typeof FieldSource>;

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

export const ApplicationStatus = z.enum([
  "SCREENING_CALL",
  "INTERVIEW_SCHEDULE_REQUEST",
  "INTERVIEW_SCHEDULED",
  "SHORTLISTED",
  "MOVE_ON",
  "INCOMPLETE_APPLICATION",
  "ASSESSMENT",
  "OTHER",

  "SAVED",
  "APPLIED",
  "RESPONSE",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "PLACED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

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

export const FollowUpKind = z.enum(["DAY_3_LINKEDIN", "DAY_7_EMAIL", "CUSTOM"]);
export type FollowUpKind = z.infer<typeof FollowUpKind>;

export const FollowUpState = z.enum(["PENDING", "DONE", "SNOOZED", "CANCELLED"]);
export type FollowUpState = z.infer<typeof FollowUpState>;

/** JobNavigator-aligned: two scoring depths for cost control. */
export const ScoringDepth = z.enum(["LIGHT", "FULL"]);
export type ScoringDepth = z.infer<typeof ScoringDepth>;

export const RequirementKind = z.enum(["MANDATORY", "PREFERRED", "ADJACENT"]);
export type RequirementKind = z.infer<typeof RequirementKind>;

export const RequirementMatch = z.enum(["HAVE", "MISSING", "ADJACENT"]);
export type RequirementMatch = z.infer<typeof RequirementMatch>;
