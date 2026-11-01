import { BadgeCheck, CalendarClock, ClipboardCheck, Mail, MailCheck, PhoneCall, Star, XCircle, type LucideIcon } from "lucide-react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage, MailSignal } from "@/lib/schemas/inbox";
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

export function mailSignalMeta(signal: MailSignal | null) {
  return signal ? SIGNAL_META[signal] : { label: "Unclassified email", Icon: Mail, tone: "neutral" as const };
}

/**
 * An email suggests a status change while its application is still behind the
 * stage the email implies. Derived — once the status moves, the suggestion is gone.
 */
export function pendingSuggestion(message: InboxMessage, currentStatus: ApplicationStatus | undefined): ApplicationStatus | null {
  const implied = message.impliedStatus;
  if (!implied || !currentStatus || implied === "APPLIED") return null;
  if (implied === "REJECTED") return isClosed(currentStatus) || currentStatus === "PLACED" ? null : "REJECTED";
  const current = stageRank(currentStatus);
  return current >= 0 && current < stageRank(implied) ? implied : null;
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
