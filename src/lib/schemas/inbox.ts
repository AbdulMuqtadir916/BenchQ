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
  classificationState: z.enum(["NOT_QUEUED", "PENDING", "PROCESSING", "DONE", "ERROR", "EXCLUDED"]).optional(),
  sourceAddress: z.string().optional(),
  isRead: z.boolean(),
  /** The stage this email implies. A suggestion is pending while the application is behind it. */
  impliedStatus: ApplicationStatus.nullable(),
  /** Call or interview time mentioned in the email. */
  scheduledFor: z.string().datetime().nullable(),
  /** Revisions a review or retry command echoes back (live inbox only). */
  contentRevision: z.number().int().nonnegative().optional(),
  classificationVersion: z.number().int().nonnegative().optional(),
  /** The classifier's latest category and its confidence, once classified. */
  classificationCategory: z.lazy(() => EmailCategory).nullable().optional(),
  classificationConfidence: z.number().min(0).max(1).nullable().optional(),
  /** Why classification failed (a code), and whether the automatic attempts are used up (live inbox only). */
  classificationError: z.string().nullable().optional(),
  classificationRetryExhausted: z.boolean().optional(),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

/** The ten email categories (docs/02 §2.1). `other` is never an application status; `saved` is never a category. */
export const EmailCategory = z.enum([
  "applied", "screening_call", "shortlisted", "interview_schedule_request", "interview_scheduled",
  "assessment", "offer", "move_on", "incomplete_application", "other",
]);
export type EmailCategory = z.infer<typeof EmailCategory>;

/** A pending BDE review of one email (PR 4 review loop). */
export const EmailReviewSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  applicationId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  applicationRevision: z.number().int().nonnegative().nullable(),
  reason: z.string(),
  subject: z.string(),
  fromName: z.string(),
  receivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type EmailReview = z.infer<typeof EmailReviewSchema>;

export const EmailReviewPageSchema = z.object({
  reviews: z.array(EmailReviewSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative(),
});
export type EmailReviewPage = z.infer<typeof EmailReviewPageSchema>;

export const ReviewEmailAction = z.enum(["SET_STATUS", "KEEP_CURRENT", "LINK_ONLY", "DISMISS_NON_APPLICATION"]);
export type ReviewEmailAction = z.infer<typeof ReviewEmailAction>;

/** One human decision on a review; every revision is the server-confirmed one the decision was made on. */
export const ReviewEmailCommandSchema = z.object({
  reviewId: z.string(),
  expectedReviewRevision: z.number().int().nonnegative(),
  expectedContentRevision: z.number().int().nonnegative(),
  applicationId: z.string().nullable(),
  expectedApplicationRevision: z.number().int().nonnegative().nullable(),
  action: ReviewEmailAction,
  status: ApplicationStatus.optional(),
  note: z.string().max(2000).nullable(),
});
export type ReviewEmailCommand = z.infer<typeof ReviewEmailCommandSchema>;

export const MailboxConnectionSchema = z.object({
  firmId: z.string(),
  candidateId: z.string(),
  provider: z.literal("GOOGLE"),
  address: z.string(),
  connectedAt: z.string().datetime(),
  lastSyncedAt: z.string().datetime().nullable(),
  status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]).default("CONNECTED"),
  lastSyncError: z.string().nullable().default(null),
  syncState: z.enum(["IDLE", "QUEUED", "IMPORTING", "FAILED"]).default("IDLE"),
});
export type MailboxConnection = z.infer<typeof MailboxConnectionSchema>;

export const CandidateInboxSchema = z.object({
  firmId: z.string(),
  connection: MailboxConnectionSchema.nullable(),
  messages: z.array(InboxMessageSchema),
  nextCursor: z.string().nullable().default(null),
  totalCount: z.number().int().nonnegative().optional(),
  /** Emails hidden as not about a job (count only; encrypted and kept 30 days). */
  hiddenCount: z.number().int().nonnegative().optional(),
});
export type CandidateInbox = z.infer<typeof CandidateInboxSchema>;

export const UpdateApplicationStatusSchema = z.object({
  status: ApplicationStatus,
  note: z.string().nullable(),
  /** The server-confirmed revision the move is based on (live adapter; the mock ignores it). */
  expectedRevision: z.number().int().nonnegative().optional(),
});
export type UpdateApplicationStatus = z.infer<typeof UpdateApplicationStatusSchema>;
