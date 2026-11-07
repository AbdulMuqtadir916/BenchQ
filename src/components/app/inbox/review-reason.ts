import type { EmailCategory } from "@/lib/schemas/inbox";
import type { ApplicationStatus } from "@/lib/schemas/enums";

/** Why an email is waiting for a BDE, as one sentence (backend reason codes: policy.py, worker, PR 4). */
const REASONS: Record<string, string> = {
  UNMATCHED: "No matching application was found",
  LOW_CONFIDENCE: "The classifier is not sure enough",
  OUTCOME_REQUIRES_REVIEW: "Offers and rejections always need a person to confirm",
  SENDER_UNVERIFIED: "The sender could not be verified",
  RECEIVE_TIME_UNVERIFIED: "The time the email arrived could not be verified",
  STALE_EMAIL: "The email is older than the application's last change",
  REPEATED_ROUND: "It mentions another interview round",
  LEGACY_OR_CLOSED_STATUS: "The application has an older or closed status",
  MANUAL_STAGE_REVIEW: "This stage is only changed by a person",
  BACKWARD_STAGE: "It would move the application backwards",
  AUTO_STATUS_DISABLED: "Automatic updates are off",
  FORWARDED_EMAIL: "It is a forwarded email",
  INSUFFICIENT_CONTENT: "The email has too little text to judge",
  CONFIDENCE_DISAGREEMENT: "The classifier's two confidence values disagree",
  EMAIL_ALREADY_APPLIED: "This email already changed the application once",
  AUTOMATIC_CHANGE_UNDONE: "The automatic change from this email was undone",
};

export function reviewReasonLabel(reason: string): string {
  return REASONS[reason] ?? "This email needs a decision";
}

const CATEGORY_LABEL: Record<EmailCategory, string> = {
  applied: "Application received", screening_call: "Screening call", shortlisted: "Shortlisted",
  interview_schedule_request: "Interview schedule request", interview_scheduled: "Interview scheduled",
  assessment: "Assessment", offer: "Offer", move_on: "Not selected", incomplete_application: "Incomplete application",
  other: "Not about an application",
};

export function emailCategoryLabel(category: EmailCategory): string {
  return CATEGORY_LABEL[category];
}

/** The application stage an email category suggests, or null (Other suggests nothing). */
export function categoryStatus(category: EmailCategory | null | undefined): ApplicationStatus | null {
  if (!category || category === "other") return null;
  return category.toUpperCase() as ApplicationStatus;
}
