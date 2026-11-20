import { z } from "zod";
import { OutreachChannel, OutreachResult, StoredApplicationStatus } from "./enums";

export const ApplicationEventSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  fromStatus: StoredApplicationStatus.nullable(),
  toStatus: StoredApplicationStatus,
  note: z.string().nullable(),
  actorUserId: z.string().nullable(),
  isAutomated: z.boolean(),
  createdAt: z.string().datetime(),
  /** Who or what made the change: ui | bde_review | email_classifier | email_undo (null on mock/legacy rows). */
  source: z.string().nullable().default(null),
  /** The application revision this change produced; Undo is offered only while it is still the latest. */
  revision: z.number().int().nonnegative().nullable().default(null),
  /** The email that caused or confirmed the change, when there is one. */
  emailId: z.string().nullable().default(null),
});
export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;

export const ApplicationSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  resumeVersionId: z.string().nullable(),
  submittedByUserId: z.string(),

  status: StoredApplicationStatus,
  /** Server-confirmed status revision; sent back as expected_revision with every move (docs/02, PR 4). */
  statusRevision: z.number().int().nonnegative().default(0),
  /** Email reviews waiting on this application; the backend refuses a manual move until they are decided. */
  pendingReviewCount: z.number().int().nonnegative().default(0),

  companyNameAtApply: z.string(),
  jobTitleAtApply: z.string(),

  appliedAt: z.string().datetime().nullable(),
  firstResponseAt: z.string().datetime().nullable(),
  interviewAt: z.string().datetime().nullable(),
  offerAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),

  coverLetterText: z.string().nullable(),
  notes: z.string().nullable(),

  events: z.array(ApplicationEventSchema),
  createdAt: z.string().datetime(),
});
export type Application = z.infer<typeof ApplicationSchema>;

export const RecruiterContactSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  enrichedFrom: z.enum(["MANUAL", "APOLLO", "SNOV"]).nullable(),
});
export type RecruiterContact = z.infer<typeof RecruiterContactSchema>;

export const OutreachTouchSchema = z.object({
  id: z.string(),
  applicationId: z.string().nullable(),
  contactId: z.string(),
  sentByUserId: z.string(),
  channel: OutreachChannel,
  templateId: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  result: OutreachResult,
  generatedBy: z.enum(["HUMAN", "AGENT"]),
  sentAt: z.string().datetime(),
  repliedAt: z.string().datetime().nullable(),
});
export type OutreachTouch = z.infer<typeof OutreachTouchSchema>;
