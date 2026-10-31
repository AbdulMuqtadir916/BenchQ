import { z } from "zod";
import { ApplicationSchema, type Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { toIso, toIsoOrNull } from "./shared";

const BackendTransitionSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
  at: z.string(),
  source: z.string().nullable().optional(),
  actor_user_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const BackendApplicationSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  candidate_id: z.string().nullable(),
  submitted_by_user_id: z.string().nullable(),
  status: z.string(),
  status_revision: z.number().int().nonnegative().default(0),
  pending_reviews: z.array(z.object({ id: z.string(), message_id: z.string(), revision: z.number().int(), reason: z.string() })).default([]),
  applied_at: z.string().nullable(),
  cv_version_used: z.string().nullable(),
  notes: z.string().nullable(),
  next_action: z.string().nullable(),
  next_action_date: z.string().nullable(),
  last_email_received: z.string().nullable(),
  last_email_snippet: z.string().nullable(),
  status_transitions: z.array(BackendTransitionSchema),
  updated_at: z.string().nullable(),
  company: z.string().nullable(),
  company_canonical: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  best_cv: z.string().nullable(),
  short_id: z.number().int().nullable(),
  location: z.string().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  source: z.string().nullable(),
  has_cached_page: z.boolean(),
  discovered_at: z.string().nullable(),
  tailored_resume_id: z.string().nullable(),
  tailored_resume_name: z.string().nullable(),
  has_cover_letter: z.boolean(),
  interviews: z.array(z.object({ when_at: z.string().nullable() })).default([]),
});
export type BackendApplication = z.infer<typeof BackendApplicationSchema>;

export const BackendApplicationListSchema = z.object({
  total: z.number().int(),
  applications: z.array(BackendApplicationSchema),
});

const STATUS: Record<string, ApplicationStatus> = {
  saved: "SAVED",
  screening_call: "SCREENING_CALL",
  interview_schedule_request: "INTERVIEW_SCHEDULE_REQUEST",
  interview_scheduled: "INTERVIEW_SCHEDULED",
  shortlisted: "SHORTLISTED",
  move_on: "MOVE_ON",
  incomplete_application: "INCOMPLETE_APPLICATION",
  assessment: "ASSESSMENT",
  other: "OTHER",

  applied: "APPLIED",
  response: "RESPONSE",
  screening: "SCREENING",
  interview: "INTERVIEW",
  offer: "OFFER",
  placed: "PLACED",
  rejected: "REJECTED",
  withdrawn: "WITHDRAWN",
  expired: "EXPIRED",
};

function status(value: string): ApplicationStatus {
  const mapped = STATUS[value.toLowerCase()];
  if (!mapped) throw new Error(`Unsupported backend application status: ${value}`);
  return mapped;
}

export function toApplication(dto: BackendApplication, firmId: string, candidateId: string): Application {
  const events = dto.status_transitions.map((transition, index) => ({
    id: `${dto.id}_t${index}`,
    applicationId: dto.id,
    fromStatus: transition.from ? status(transition.from) : null,
    toStatus: status(transition.to),
    note: transition.note ?? null,
    actorUserId: transition.actor_user_id ?? null,
    isAutomated: !["ui", "bde_review"].includes(transition.source ?? ""),
    createdAt: toIso(transition.at),
  }));
  const firstResponseAt = dto.status_transitions.find((transition) => transition.from?.toLowerCase() === "applied" && !["applied", "saved"].includes(transition.to.toLowerCase()))?.at
    ?? dto.last_email_received;
  const interviewAt = dto.interviews.map((interview) => interview.when_at).filter((value): value is string => Boolean(value)).sort()[0]
    ?? dto.status_transitions.find((transition) => ["interview", "interview_scheduled"].includes(transition.to.toLowerCase()))?.at
    ?? null;
  const offerAt = dto.status_transitions.find((transition) => transition.to.toLowerCase() === "offer")?.at ?? null;
  const closedAt = dto.status_transitions.find((transition) => ["move_on", "rejected", "withdrawn", "expired"].includes(transition.to.toLowerCase()))?.at ?? null;
  const createdAt = dto.applied_at ?? dto.discovered_at ?? dto.updated_at;

  if (!createdAt) throw new Error(`Application ${dto.id} has no backend creation timestamp.`);
  return ApplicationSchema.parse({
    id: dto.id,
    firmId,
    candidateId: dto.candidate_id ?? candidateId,
    jobId: dto.job_id,
    // The backend resume row ID is not a frontend ResumeVersion ID.
    resumeVersionId: null,
    submittedByUserId: dto.submitted_by_user_id,
    status: status(dto.status),
    statusRevision: dto.status_revision,
    pendingReviews: dto.pending_reviews.map((r) => ({ id: r.id, messageId: r.message_id, revision: r.revision, reason: r.reason })),
    companyNameAtApply: dto.company_canonical ?? dto.company ?? "Unknown company",
    jobTitleAtApply: dto.title ?? "Untitled role",
    appliedAt: toIsoOrNull(dto.applied_at),
    firstResponseAt: toIsoOrNull(firstResponseAt),
    interviewAt: toIsoOrNull(interviewAt),
    offerAt: toIsoOrNull(offerAt),
    closedAt: toIsoOrNull(closedAt),
    expiresAt: null,
    coverLetterText: null,
    notes: dto.notes,
    events,
    createdAt: toIso(createdAt),
  });
}
