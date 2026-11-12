import type { CandidateTabId } from "./candidate-tabs";
import type { Suggestion } from "./use-candidate-workspace";

/** Cross-tab actions the page owns, so any card can jump to the thing it mentions. */
export interface CandidateActions {
  openTab: (tab: CandidateTabId) => void;
  openApplication: (applicationId: string) => void;
  openMessage: (messageId: string) => void;
  applySuggestion: (suggestion: Suggestion) => void;
  /** "Find jobs": starts a real search (docs/02 §6.z). Only for the candidate's BDE: absent for anyone else, so no link offers it. */
  findJobs?: () => void;
}
