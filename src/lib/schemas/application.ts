import { z } from "zod";
import { ApplicationStatus, FollowUpKind, FollowUpState, OutreachChannel, OutreachResult } from "./enums";

export const ApplicationEventSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  fromStatus: ApplicationStatus.nullable(),
  toStatus: ApplicationStatus,
  note: z.string().nullable(),
  actorUserId: z.string().nullable(),
  isAutomated: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;

export const ApplicationSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  resumeVersionId: z.string().nullable(),
  submittedByUserId: z.string(),

  status: ApplicationStatus,

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

export const FollowUpTaskSchema = z.object({
  id: z.string(),
  firmId: z.string(),
  applicationId: z.string(),
  assignedToUserId: z.string(),
  kind: FollowUpKind,
  dueAt: z.string().datetime(),
  state: FollowUpState,
  completedAt: z.string().datetime().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  note: z.string().nullable(),

  candidateName: z.string(),
  companyName: z.string(),
  jobTitle: z.string(),
});
export type FollowUpTask = z.infer<typeof FollowUpTaskSchema>;
