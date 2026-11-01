import { BadgeCheck, CalendarClock, ClipboardCheck, CircleHelp, FileWarning, MailCheck, PhoneCall, Star, XCircle, type LucideIcon } from "lucide-react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage, MailSignal } from "@/lib/schemas/inbox";
import type { TagTone } from "@/components/ui/tag";

export const SIGNAL_META: Record<MailSignal, { label: string; Icon: LucideIcon; tone: TagTone }> = {
  APPLIED: { label: "Application received", Icon: MailCheck, tone: "neutral" },
  SCREENING_CALL: { label: "Screening call", Icon: PhoneCall, tone: "blue" },
  INTERVIEW_SCHEDULE_REQUEST: { label: "Interview availability requested", Icon: CalendarClock, tone: "amber" },
  MOVE_ON: { label: "Move on (rejected)", Icon: XCircle, tone: "red" },
  INCOMPLETE_APPLICATION: { label: "Incomplete application", Icon: FileWarning, tone: "amber" },
  OTHER: { label: "Other", Icon: CircleHelp, tone: "neutral" },
  SHORTLISTED: { label: "Shortlisted", Icon: Star, tone: "violet" },
  CALL_REQUEST: { label: "Call requested", Icon: PhoneCall, tone: "blue" },
  INTERVIEW_SCHEDULED: { label: "Interview scheduled", Icon: CalendarClock, tone: "amber" },
  ASSESSMENT: { label: "Assessment", Icon: ClipboardCheck, tone: "teal" },
  OFFER: { label: "Offer", Icon: BadgeCheck, tone: "green" },
  REJECTED: { label: "Not selected", Icon: XCircle, tone: "red" },
  CONFIRMATION: { label: "Application received", Icon: MailCheck, tone: "neutral" },
};

/**
 * Only a persisted backend review can propose a human decision. Automatically
 * handled results and old emails never re-create a suggestion from stage order.
 */
export function pendingSuggestion(message: InboxMessage, currentStatus: ApplicationStatus | undefined): ApplicationStatus | null {
  const implied = message.impliedStatus;
  if (message.classificationState !== "DONE" || message.classificationOutcome !== "REVIEW"
      || !message.applicationId || !implied || !currentStatus) return null;
  return implied;
}

export function needsBdeReview(message: InboxMessage, hasPendingReview = false): boolean {
  if (message.classificationState !== "DONE") return false;
  if (message.classificationOutcome === "REVIEW" && hasPendingReview) return true;
  return message.classificationOutcome === "UNMATCHED" && !message.applicationId
    && message.signal !== null && message.signal !== "OTHER";
}

/** Most recent meaningful email per application — confirmations don't count as news. */
export function latestSignalByApplication(messages: InboxMessage[]): Map<string, InboxMessage> {
  const map = new Map<string, InboxMessage>();
  for (const m of messages) {
    if (!m.applicationId || !m.signal || m.signal === "CONFIRMATION") continue;
    const current = map.get(m.applicationId);
    if (!current || m.receivedAt > current.receivedAt) map.set(m.applicationId, m);
  }
  return map;
}
