import { z } from "zod";
import { ApplicationStatus } from "./enums";

/**
 * Candidate mailbox (Google account) — the BDE connects the inbox the
 * candidate applies from, and recruiter emails are matched to applications.
 * The adapter switches between mock data and candidate-scoped Gmail endpoints.
 */

/** What a recruiter email means for the application it belongs to. */
export const MailSignal = z.enum([
  "SHORTLISTED",
  "CALL_REQUEST",
  "INTERVIEW_SCHEDULED",
  "ASSESSMENT",
  "OFFER",
  "REJECTED",
  "CONFIRMATION",
]);
export type MailSignal = z.infer<typeof MailSignal>;

export const InboxMessageSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  /** Null when the email couldn't be matched to an application. */
  applicationId: z.string().nullable(),
  fromName: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  snippet: z.string(),
  body: z.string(),
  receivedAt: z.string().datetime(),
  signal: MailSignal.nullable(),
  sourceAddress: z.string().optional(),
  isRead: z.boolean(),
  /** The stage this email implies. A suggestion is pending while the application is behind it. */
  impliedStatus: ApplicationStatus.nullable(),
  /** Call or interview time mentioned in the email. */
  scheduledFor: z.string().datetime().nullable(),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

export const MailboxConnectionSchema = z.object({
  firmId: z.string(),
  candidateId: z.string(),
  provider: z.literal("GOOGLE"),
  address: z.string(),
  connectedAt: z.string().datetime(),
  lastSyncedAt: z.string().datetime().nullable(),
  status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]).default("CONNECTED"),
  lastSyncError: z.string().nullable().default(null),
});
export type MailboxConnection = z.infer<typeof MailboxConnectionSchema>;

export const CandidateInboxSchema = z.object({
  firmId: z.string(),
  connection: MailboxConnectionSchema.nullable(),
  messages: z.array(InboxMessageSchema),
});
export type CandidateInbox = z.infer<typeof CandidateInboxSchema>;

export const UpdateApplicationStatusSchema = z.object({
  status: ApplicationStatus,
  note: z.string().nullable(),
});
export type UpdateApplicationStatus = z.infer<typeof UpdateApplicationStatusSchema>;
