import { AlertCircle, BadgeCheck, CalendarCheck, CalendarClock, ClipboardCheck, Clock, Loader, Mail, MailCheck, MailWarning, MailX, PhoneCall, Settings2, Star, XCircle, type LucideIcon } from "lucide-react";
import type { ApplicationStatus, StoredApplicationStatus } from "@/lib/schemas/enums";
import type { EmailCategory, InboxMessage, MailSignal } from "@/lib/schemas/inbox";
import type { TagTone } from "@/components/ui/tag";
import { isClosed, stageRank } from "@/components/app/applications/status-meta";

export const SIGNAL_META: Record<MailSignal, { label: string; Icon: LucideIcon; tone: TagTone }> = {
  SHORTLISTED: { label: "Shortlisted", Icon: Star, tone: "violet" },
  CALL_REQUEST: { label: "Call requested", Icon: PhoneCall, tone: "blue" },
  INTERVIEW_SCHEDULED: { label: "Interview scheduled", Icon: CalendarClock, tone: "amber" },
  ASSESSMENT: { label: "Assessment", Icon: ClipboardCheck, tone: "teal" },
  OFFER: { label: "Offer", Icon: BadgeCheck, tone: "green" },
  REJECTED: { label: "Not selected", Icon: XCircle, tone: "red" },
  CONFIRMATION: { label: "Application received", Icon: MailCheck, tone: "neutral" },
};

/** The ten email categories as badges: label + icon + tone, never colour alone (PR 4, DEBUG D-17). */
export const CATEGORY_META: Record<EmailCategory, { label: string; Icon: LucideIcon; tone: TagTone }> = {
  applied: { label: "Application received", Icon: MailCheck, tone: "neutral" },
  screening_call: { label: "Screening call", Icon: PhoneCall, tone: "blue" },
  shortlisted: { label: "Shortlisted", Icon: Star, tone: "violet" },
  interview_schedule_request: { label: "Interview request", Icon: CalendarClock, tone: "amber" },
  interview_scheduled: { label: "Interview scheduled", Icon: CalendarCheck, tone: "amber" },
  assessment: { label: "Assessment", Icon: ClipboardCheck, tone: "teal" },
  offer: { label: "Offer", Icon: BadgeCheck, tone: "green" },
  move_on: { label: "Not selected", Icon: XCircle, tone: "red" },
  incomplete_application: { label: "Incomplete application", Icon: AlertCircle, tone: "amber" },
  other: { label: "Not about a job", Icon: MailX, tone: "neutral" },
};

/** Failures caused by the classifier's setup, not by the email (PR 4, DEBUG D-27/D-28). */
export const SETUP_ERRORS = ["CLASSIFIER_NOT_CONFIGURED", "PROVIDER_AUTH_REJECTED"];

const FAILURE_REASON: Record<string, string> = {
  CLASSIFIER_NOT_CONFIGURED: "The classifier was not set up when this email arrived.",
  PROVIDER_AUTH_REJECTED: "The classification service refused the classifier's credentials.",
  PROVIDER_UNAVAILABLE: "The classification service was unavailable.",
  PROVIDER_REJECTED: "The classification service refused the request.",
  INVALID_RESPONSE: "The classification service returned an answer that could not be used.",
  INVALID_CATEGORIES: "The classification service returned an answer that could not be used.",
  INVALID_PROBABILITIES: "The classification service returned an answer that could not be used.",
  INCONSISTENT_PROBABILITIES: "The classification service returned an answer that could not be used.",
  INVALID_CONFIDENCE: "The classification service returned an answer that could not be used.",
  RESPONSE_TOO_LARGE: "The classification service returned an answer that could not be used.",
  RETRY_EXHAUSTED: "Classification failed three times in a row.",
  PROCESSING_FAILED: "Something went wrong while classifying this email.",
};

/** A readable reason for a failed classification; never a raw code. */
export function classificationFailureReason(code: string | null | undefined): string {
  return (code && FAILURE_REASON[code]) || "Classification failed.";
}

/**
 * The badge for one email: a mock signal, else the classifier's category, else its processing state (D-28):
 * not yet queued, classifying, waiting for classifier setup, or classification failed.
 */
export function mailSignalMeta(signal: MailSignal | null, state?: InboxMessage["classificationState"], category?: EmailCategory | null, error?: string | null) {
  if (signal) return { ...SIGNAL_META[signal], isBadge: true };
  if (category) return { ...CATEGORY_META[category], isBadge: true };
  if (state === "PENDING" || state === "PROCESSING") return { label: "Classifying…", Icon: Loader, tone: "neutral" as const, isBadge: true };
  if (state === "ERROR" && error && SETUP_ERRORS.includes(error)) return { label: "Waiting for classifier setup", Icon: Settings2, tone: "amber" as const, isBadge: true };
  if (state === "ERROR") return { label: "Classification failed", Icon: MailWarning, tone: "red" as const, isBadge: true };
  if (state === "DONE") return { label: "Classified", Icon: Mail, tone: "neutral" as const, isBadge: true };
  if (state === "NOT_QUEUED") return { label: "Not yet queued", Icon: Clock, tone: "neutral" as const, isBadge: true };
  return { label: "Email", Icon: Mail, tone: "neutral" as const, isBadge: false };
}

/** A one-line activity title: the category when there is one, else the email's own subject (never "Email: Email"). */
export function emailActivityTitle(message: Pick<InboxMessage, "signal" | "classificationState" | "classificationCategory" | "subject">): string {
  const meta = message.classificationCategory || message.signal ? mailSignalMeta(message.signal, undefined, message.classificationCategory) : null;
  return meta ? `Email: ${meta.label}` : `Email: ${message.subject || "(no subject)"}`;
}

/**
 * An email suggests a status change while its application is still behind the
 * stage the email implies. Derived — once the status moves, the suggestion is gone.
 */
export function pendingSuggestion(message: InboxMessage, currentStatus: StoredApplicationStatus | undefined): ApplicationStatus | null {
  const implied = message.impliedStatus;
  if (!implied || !currentStatus || implied === "APPLIED") return null;
  if (implied === "MOVE_ON") return isClosed(currentStatus) ? null : "MOVE_ON";
  const current = stageRank(currentStatus);
  return current >= 0 && current < stageRank(implied) ? implied : null;
}

/** Most recent meaningful email per application — confirmations don't count as news. */
export function latestSignalByApplication(messages: InboxMessage[]): Map<string, InboxMessage> {
  const map = new Map<string, InboxMessage>();
  for (const m of messages) {
    const news = m.signal ? m.signal !== "CONFIRMATION"
      : !!m.classificationCategory && m.classificationCategory !== "applied" && m.classificationCategory !== "other";
    if (!m.applicationId || !news) continue;
    const current = map.get(m.applicationId);
    if (!current || m.receivedAt > current.receivedAt) map.set(m.applicationId, m);
  }
  return map;
}
