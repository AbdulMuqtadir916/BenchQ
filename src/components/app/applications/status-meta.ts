import { Bookmark, Calendar, CheckCircle2, Circle, BadgeCheck, MessageCircle, Search, Send, XCircle, type LucideIcon } from "lucide-react";
import type { InboxMessage } from "@/lib/schemas/inbox";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { TagTone } from "@/components/ui/tag";

/** One vocabulary for application stages, shared by every board, list and drawer. */
export const TRACKER_STATUSES: ApplicationStatus[] = ["SAVED", "APPLIED", "INCOMPLETE_APPLICATION", "SCREENING_CALL", "SHORTLISTED", "INTERVIEW_SCHEDULE_REQUEST", "INTERVIEW_SCHEDULED", "ASSESSMENT", "OFFER", "MOVE_ON", "OTHER"];

/** Display order only; these categories do not imply a mandatory sequence. */
export const PIPELINE: ApplicationStatus[] = [...TRACKER_STATUSES, "RESPONSE", "SCREENING", "INTERVIEW", "PLACED"];
export const CLOSED: ApplicationStatus[] = ["MOVE_ON", "REJECTED", "WITHDRAWN", "EXPIRED"];

export const NEXT_STATUS: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  SAVED: "APPLIED", APPLIED: "RESPONSE", RESPONSE: "SCREENING", SCREENING: "INTERVIEW", INTERVIEW: "OFFER", OFFER: "PLACED",
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  SCREENING_CALL: "Screening call",
  INTERVIEW_SCHEDULE_REQUEST: "Interview schedule request",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  SHORTLISTED: "Shortlisted",
  MOVE_ON: "Move on (rejected)",
  INCOMPLETE_APPLICATION: "Incomplete application",
  ASSESSMENT: "Assessment",
  OTHER: "Other",

  SAVED: "Saved", APPLIED: "Applied", RESPONSE: "Recruiter reply", SCREENING: "Shortlisted", INTERVIEW: "Interview", OFFER: "Offer", PLACED: "Placed", REJECTED: "Rejected", WITHDRAWN: "Withdrawn", EXPIRED: "Expired",
};

export const STATUS_TONE: Record<ApplicationStatus, TagTone> = {
  SCREENING_CALL: "blue",
  INTERVIEW_SCHEDULE_REQUEST: "amber",
  INTERVIEW_SCHEDULED: "amber",
  SHORTLISTED: "violet",
  MOVE_ON: "red",
  INCOMPLETE_APPLICATION: "amber",
  ASSESSMENT: "teal",
  OTHER: "neutral",

  SAVED: "neutral", APPLIED: "blue", RESPONSE: "violet", SCREENING: "violet", INTERVIEW: "amber", OFFER: "green", PLACED: "teal", REJECTED: "red", WITHDRAWN: "neutral", EXPIRED: "neutral",
};

export const STATUS_ICON: Record<ApplicationStatus, LucideIcon> = {
  SCREENING_CALL: MessageCircle,
  INTERVIEW_SCHEDULE_REQUEST: Calendar,
  INTERVIEW_SCHEDULED: Calendar,
  SHORTLISTED: Search,
  MOVE_ON: XCircle,
  INCOMPLETE_APPLICATION: Circle,
  ASSESSMENT: CheckCircle2,
  OTHER: Circle,

  SAVED: Bookmark, APPLIED: Send, RESPONSE: MessageCircle, SCREENING: Search, INTERVIEW: Calendar, OFFER: BadgeCheck, PLACED: CheckCircle2, REJECTED: XCircle, WITHDRAWN: Circle, EXPIRED: Circle,
};

export const STATUS_COLOR: Record<ApplicationStatus, string> = {
  SCREENING_CALL: "text-[var(--color-text-3)]",
  INTERVIEW_SCHEDULE_REQUEST: "text-[var(--color-text-3)]",
  INTERVIEW_SCHEDULED: "text-[var(--color-text-3)]",
  SHORTLISTED: "text-[var(--color-text-3)]",
  MOVE_ON: "text-[var(--color-text-3)]",
  INCOMPLETE_APPLICATION: "text-[var(--color-text-3)]",
  ASSESSMENT: "text-[var(--color-text-3)]",
  OTHER: "text-[var(--color-text-3)]",

  SAVED: "text-[var(--color-text-3)]",
  APPLIED: "text-[var(--color-info-fg)]",
  RESPONSE: "text-[var(--color-violet-fg)]",
  SCREENING: "text-[var(--color-violet-fg)]",
  INTERVIEW: "text-[var(--color-warning-fg)]",
  OFFER: "text-[var(--color-success-fg)]",
  PLACED: "text-[var(--color-teal-fg)]",
  REJECTED: "text-[var(--color-danger-fg)]",
  WITHDRAWN: "text-[var(--color-text-3)]",
  EXPIRED: "text-[var(--color-text-3)]",
};

/** Position along the pipeline; closed outcomes sit outside it (-1). */
export function stageRank(status: ApplicationStatus): number {
  return PIPELINE.indexOf(status);
}

export function isClosed(status: ApplicationStatus): boolean {
  return CLOSED.includes(status);
}

/** When the application entered its current stage — drives "days in stage". */
export function stageEnteredAt(application: Application): string {
  const entered = [...application.events].reverse().find((event) => event.toStatus === application.status);
  return entered?.createdAt ?? application.appliedAt ?? application.createdAt;
}

/** Optional stages require accepted evidence for this application, not another candidate's email. */
export function hasIncompleteEvidence(application: Application, messages: InboxMessage[] = []): boolean {
  return application.status === "INCOMPLETE_APPLICATION"
    || application.events.some((event) => event.toStatus === "INCOMPLETE_APPLICATION" || event.fromStatus === "INCOMPLETE_APPLICATION")
    || messages.some((message) => message.applicationId === application.id && message.candidateId === application.candidateId
      && message.firmId === application.firmId && message.signal === "INCOMPLETE_APPLICATION"
      && message.classificationState === "DONE" && (message.classificationConfidence ?? 0) >= 0.6
      && (message.classificationOutcome === "AUTO_APPLIED" || message.classificationOutcome === "NO_CHANGE"));
}

export function visibleApplicationStatuses(application: Application, messages: InboxMessage[] = []): ApplicationStatus[] {
  return TRACKER_STATUSES.filter((status) => status !== "INCOMPLETE_APPLICATION" || hasIncompleteEvidence(application, messages));
}
