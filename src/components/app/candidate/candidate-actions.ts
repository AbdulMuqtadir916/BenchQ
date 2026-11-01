import type { CandidateTabId } from "./candidate-tabs";
import type { Suggestion } from "./use-candidate-workspace";
import type { ApplicationStatus } from "@/lib/schemas/enums";

/** Cross-tab actions the page owns, so any card can jump to the thing it mentions. */
export interface CandidateActions {
  openTab: (tab: CandidateTabId) => void;
  openApplication: (applicationId: string) => void;
  openMessage: (messageId: string) => void;
  applySuggestion: (suggestion: Suggestion) => void;
  reviewInboxMessage: (input: { messageId: string; applicationId: string; status: ApplicationStatus; expectedRevision: number; reviewId?: string; expectedReviewRevision?: number }) => void;
  retryInboxClassification: (messageId: string) => void;
  findJobs: () => void;
  /** Open the master resume builder on its first unverified claim. */
  reviewMasterResume: () => void;
}
