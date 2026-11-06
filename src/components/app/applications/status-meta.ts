import {
  AlertCircle, BadgeCheck, Bookmark, CalendarCheck, CalendarClock, CheckCircle2, ClipboardCheck, History, MessageCircle,
  Phone, Search, Send, Star, XCircle, type LucideIcon,
} from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import { ApplicationStatus, LegacyApplicationStatus, type StoredApplicationStatus } from "@/lib/schemas/enums";
import type { TagTone } from "@/components/ui/tag";

/**
 * One vocabulary for application stages, shared by every board, list, drawer and counter (docs/02 §2.1).
 * Selectable statuses are the ten target values; legacy values are shown with a label but never selected.
 */

/** Forward display order. Move On and Incomplete sit outside it; display order is not a transition allowlist. */
export const PIPELINE: ApplicationStatus[] = [
  "SAVED", "APPLIED", "SCREENING_CALL", "SHORTLISTED", "INTERVIEW_SCHEDULE_REQUEST", "INTERVIEW_SCHEDULED", "ASSESSMENT", "OFFER",
];

/** Closing outcomes: Move On, plus the legacy closed values (Placed is a closed success). */
export const CLOSED: StoredApplicationStatus[] = ["MOVE_ON", "PLACED", "REJECTED", "WITHDRAWN", "EXPIRED"];

/** Conditional stage: only with explicit incomplete-application evidence (or a human choosing it). */
export const INCOMPLETE: ApplicationStatus = "INCOMPLETE_APPLICATION";

/** Every status a person may choose (drawer, review, board). */
export const SELECTABLE: readonly ApplicationStatus[] = ApplicationStatus.options;

/** The usual next step, offered as the drawer's one-click action. */
export const NEXT_STATUS: Partial<Record<StoredApplicationStatus, ApplicationStatus>> = {
  SAVED: "APPLIED", APPLIED: "SCREENING_CALL", SCREENING_CALL: "SHORTLISTED", SHORTLISTED: "INTERVIEW_SCHEDULE_REQUEST",
  INTERVIEW_SCHEDULE_REQUEST: "INTERVIEW_SCHEDULED", INTERVIEW_SCHEDULED: "ASSESSMENT", ASSESSMENT: "OFFER",
  INCOMPLETE_APPLICATION: "APPLIED",
};

export const STATUS_LABEL: Record<StoredApplicationStatus, string> = {
  SAVED: "Saved",
  APPLIED: "Applied",
  SCREENING_CALL: "Screening call",
  SHORTLISTED: "Shortlisted",
  INTERVIEW_SCHEDULE_REQUEST: "Interview schedule request",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  ASSESSMENT: "Assessment",
  OFFER: "Offer",
  MOVE_ON: "Move On (rejected)",
  INCOMPLETE_APPLICATION: "Incomplete application",
  RESPONSE: "Recruiter reply (legacy)",
  SCREENING: "Screening (legacy)",
  INTERVIEW: "Interview (legacy)",
  PLACED: "Placed (legacy)",
  REJECTED: "Rejected (legacy)",
  WITHDRAWN: "Withdrawn (legacy)",
  EXPIRED: "Expired (legacy)",
  OTHER: "Other (legacy)",
  PHONE_SCREEN: "Phone screen (legacy)",
  FINAL_ROUND: "Final round (legacy)",
  UNKNOWN: "Unknown (legacy)",
};

export const STATUS_TONE: Record<StoredApplicationStatus, TagTone> = {
  SAVED: "neutral", APPLIED: "blue", SCREENING_CALL: "violet", SHORTLISTED: "violet", INTERVIEW_SCHEDULE_REQUEST: "amber",
  INTERVIEW_SCHEDULED: "amber", ASSESSMENT: "amber", OFFER: "green", MOVE_ON: "red", INCOMPLETE_APPLICATION: "amber",
  RESPONSE: "neutral", SCREENING: "neutral", INTERVIEW: "neutral", PLACED: "teal", REJECTED: "red", WITHDRAWN: "neutral",
  EXPIRED: "neutral", OTHER: "neutral", PHONE_SCREEN: "neutral", FINAL_ROUND: "neutral", UNKNOWN: "neutral",
};

export const STATUS_ICON: Record<StoredApplicationStatus, LucideIcon> = {
  SAVED: Bookmark, APPLIED: Send, SCREENING_CALL: Phone, SHORTLISTED: Star, INTERVIEW_SCHEDULE_REQUEST: CalendarClock,
  INTERVIEW_SCHEDULED: CalendarCheck, ASSESSMENT: ClipboardCheck, OFFER: BadgeCheck, MOVE_ON: XCircle,
  INCOMPLETE_APPLICATION: AlertCircle, RESPONSE: MessageCircle, SCREENING: Search, INTERVIEW: CalendarCheck,
  PLACED: CheckCircle2, REJECTED: XCircle, WITHDRAWN: History, EXPIRED: History, OTHER: History, PHONE_SCREEN: Phone,
  FINAL_ROUND: CalendarCheck, UNKNOWN: History,
};

const MUTED = "text-[var(--color-text-3)]";
export const STATUS_COLOR: Record<StoredApplicationStatus, string> = {
  SAVED: MUTED,
  APPLIED: "text-[var(--color-info-fg)]",
  SCREENING_CALL: "text-[var(--color-violet-fg)]",
  SHORTLISTED: "text-[var(--color-violet-fg)]",
  INTERVIEW_SCHEDULE_REQUEST: "text-[var(--color-warning-fg)]",
  INTERVIEW_SCHEDULED: "text-[var(--color-warning-fg)]",
  ASSESSMENT: "text-[var(--color-warning-fg)]",
  OFFER: "text-[var(--color-success-fg)]",
  MOVE_ON: "text-[var(--color-danger-fg)]",
  INCOMPLETE_APPLICATION: "text-[var(--color-warning-fg)]",
  RESPONSE: MUTED, SCREENING: MUTED, INTERVIEW: MUTED,
  PLACED: "text-[var(--color-teal-fg)]",
  REJECTED: "text-[var(--color-danger-fg)]",
  WITHDRAWN: MUTED, EXPIRED: MUTED, OTHER: MUTED, PHONE_SCREEN: MUTED, FINAL_ROUND: MUTED, UNKNOWN: MUTED,
};

export function isSelectable(status: StoredApplicationStatus): status is ApplicationStatus {
  return ApplicationStatus.safeParse(status).success;
}

export function isLegacy(status: StoredApplicationStatus): boolean {
  return LegacyApplicationStatus.safeParse(status).success;
}

/** Position along the forward pipeline; closed, incomplete and legacy values sit outside it (-1). */
export function stageRank(status: StoredApplicationStatus): number {
  return PIPELINE.indexOf(status as ApplicationStatus);
}

export function isClosed(status: StoredApplicationStatus): boolean {
  return CLOSED.includes(status);
}

/** Submitted and still open: counted as active work. Saved drafts and closed outcomes are not. */
export function isActive(status: StoredApplicationStatus): boolean {
  return status !== "SAVED" && !isClosed(status);
}

/** Reached an offer, or a legacy placement (D6: "the candidate got selected"). */
export function reachedOffer(application: Pick<Application, "status" | "events">): boolean {
  return application.status === "OFFER" || application.status === "PLACED"
    || application.events.some((event) => event.toStatus === "OFFER" || event.toStatus === "PLACED");
}

/** When the application entered its current stage — drives "days in stage". */
export function stageEnteredAt(application: Application): string {
  const entered = [...application.events].reverse().find((event) => event.toStatus === application.status);
  return entered?.createdAt ?? application.appliedAt ?? application.createdAt;
}
