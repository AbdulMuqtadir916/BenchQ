import { z } from "zod";
import { ApplicationStatus, LegacyApplicationStatus, type StoredApplicationStatus } from "@/lib/schemas/enums";
import type { Application, ApplicationEvent } from "@/lib/schemas/application";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * backend/api/routes_applications.py `_app_to_dict`. Only the fields the frontend `Application` needs are read.
 *
 * STATUS VOCABULARY (docs/02 §2.1): the ten target values are the backend value in upper case. Older stored values
 * map to a read-only legacy value with its own label (never guessed into a target stage, never hidden). A blank or
 * unrecognised value becomes UNKNOWN. Rows without a candidate (the legacy non-candidate tracker) are not shown here.
 */
const TransitionDto = z.object({
  from: z.string().nullable().optional(),
  to: z.string(),
  at: z.string(),
  source: z.string().nullable().optional(),
  actor_user_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  event_id: z.string().optional(),
  undo_event_id: z.string().nullable().optional(),
  revision: z.number().int().nullable().optional(),
  email_id: z.string().nullable().optional(),
});

export const BackendApplicationSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  candidate_id: z.string().nullable(),
  submitted_by_user_id: z.string().nullable(),
  status: z.string().nullable(),
  status_revision: z.number().int(),
  pending_reviews: z.array(z.object({ id: z.string() }).passthrough()).default([]),
  applied_at: z.string().nullable(),
  notes: z.string().nullable(),
  status_transitions: z.array(TransitionDto),
  updated_at: z.string().nullable(),
  discovered_at: z.string().nullable().optional(),
  company: z.string().nullable(),
  company_canonical: z.string().nullable().optional(),
  title: z.string().nullable(),
  /** Booked interviews (the calendar picker). Only the date and state are read. */
  interviews: z.array(z.object({ when_at: z.string().nullable().optional(), status: z.string().nullable().optional() })).default([]),
  /** The exact résumé version sent with the application; null when none was recorded (e.g. a move to Applied by hand). */
  resume_id: z.string().nullable().optional(),
});
export type BackendApplication = z.infer<typeof BackendApplicationSchema>;

export const BackendApplicationListSchema = z.object({
  total: z.number().int(),
  applications: z.array(BackendApplicationSchema),
});

const LEGACY: Readonly<Record<string, StoredApplicationStatus>> = {
  response: "RESPONSE", screening: "SCREENING", interview: "INTERVIEW", placed: "PLACED", rejected: "REJECTED",
  withdrawn: "WITHDRAWN", expired: "EXPIRED", other: "OTHER", phone_screen: "PHONE_SCREEN", final_round: "FINAL_ROUND",
};

/** The frontend value for a stored backend status: exact target value, labelled legacy value, or UNKNOWN. */
export function toFrontendStatus(status: string | null | undefined): StoredApplicationStatus {
  const value = (status ?? "").trim().toLowerCase();
  const target = ApplicationStatus.safeParse(value.toUpperCase());
  if (target.success) return target.data;
  if (LEGACY[value]) return LEGACY[value];
  const legacy = LegacyApplicationStatus.safeParse(value.toUpperCase());
  return legacy.success ? legacy.data : "UNKNOWN";
}

/** The backend command value for a selectable frontend status. */
export function toBackendStatus(status: ApplicationStatus): string {
  return status.toLowerCase();
}

function toEvents(dto: BackendApplication): ApplicationEvent[] {
  const events: ApplicationEvent[] = [];
  dto.status_transitions.forEach((transition, index) => {
    const to = toFrontendStatus(transition.to);
    events.push({
      id: transition.event_id ?? `${dto.id}:${index}`,
      applicationId: fromBackendId(dto.id),
      fromStatus: transition.from ? toFrontendStatus(transition.from) : null,
      toStatus: to,
      note: transition.note ?? null,
      actorUserId: transition.actor_user_id ? fromBackendId(transition.actor_user_id) : null,
      isAutomated: transition.source === "email_classifier",
      source: transition.source ?? null,
      revision: transition.revision ?? null,
      emailId: transition.email_id ? fromBackendId(transition.email_id) : null,
      createdAt: toIso(transition.at),
    });
  });
  return events;
}

/**
 * The stage dates the backend doesn't store, read off its history (docs/integration/03-applications.md, the field
 * table), oldest move first:
 * - heard back: the first move out of Applied, except back to Saved (a correction, not a reply). Move On counts.
 * - interview: the earliest booked interview that wasn't cancelled, else the first move to Interview scheduled.
 * - offer: the first move to Offer, or to a legacy Placed (D6: a placement reached Offer).
 */
function stageDates(dto: BackendApplication): Pick<Application, "firstResponseAt" | "interviewAt" | "offerAt"> {
  const undone = new Set(dto.status_transitions.flatMap((move) => (move.undo_event_id ? [move.undo_event_id] : [])));
  const moves = dto.status_transitions
    // An undone automatic move never happened as far as the stage dates go, nor did the Undo that took it back.
    .filter((move) => move.source !== "email_undo" && !(move.event_id && undone.has(move.event_id)))
    .map((move) => ({ from: move.from ? toFrontendStatus(move.from) : null, to: toFrontendStatus(move.to), at: toIsoOrNull(move.at) }))
    .filter((move): move is typeof move & { at: string } => move.at !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const firstMove = (test: (move: (typeof moves)[number]) => boolean) => moves.find(test)?.at ?? null;
  const booked = dto.interviews
    .filter((interview) => interview.status?.toLowerCase() !== "cancelled")
    .map((interview) => toIsoOrNull(interview.when_at ?? null))
    .filter((when): when is string => when !== null)
    .sort()[0];
  return {
    firstResponseAt: firstMove((move) => move.from === "APPLIED" && move.to !== "APPLIED" && move.to !== "SAVED"),
    interviewAt: booked ?? firstMove((move) => move.to === "INTERVIEW_SCHEDULED"),
    offerAt: firstMove((move) => move.to === "OFFER" || move.to === "PLACED"),
  };
}

/** One application, or null for a row without a candidate (the legacy non-candidate tracker). */
export function toApplication(dto: BackendApplication, firmId: string): Application | null {
  if (!dto.candidate_id) return null;
  const status = toFrontendStatus(dto.status);
  const appliedAt = toIsoOrNull(dto.applied_at);
  return {
    id: fromBackendId(dto.id),
    firmId,
    candidateId: fromBackendId(dto.candidate_id),
    jobId: fromBackendId(dto.job_id),
    resumeVersionId: dto.resume_id ? fromBackendId(dto.resume_id) : null,
    submittedByUserId: dto.submitted_by_user_id ? fromBackendId(dto.submitted_by_user_id) : "",
    status,
    statusRevision: dto.status_revision,
    pendingReviewCount: dto.pending_reviews.length,
    companyNameAtApply: dto.company_canonical ?? dto.company ?? "",
    jobTitleAtApply: dto.title ?? "",
    appliedAt,
    ...stageDates(dto),
    closedAt: null,
    expiresAt: null,
    coverLetterText: null,
    notes: dto.notes,
    events: toEvents(dto),
    createdAt: appliedAt ?? toIsoOrNull(dto.discovered_at) ?? toIsoOrNull(dto.updated_at) ?? new Date(0).toISOString(),
  };
}

export function toApplications(rows: BackendApplication[], firmId: string): Application[] {
  return rows.flatMap((row) => toApplication(row, firmId) ?? []);
}
