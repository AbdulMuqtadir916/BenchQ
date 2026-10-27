import { currentPlatformUser } from "./auth";
import { mockResult } from "./_shared";
import { allCandidates } from "./candidates";
import { injectedFailure } from "./membership";

/** Candidates are still mocks (the Candidates track). The platform tier counts them for usage (A2); platform admins only. */
export const candidateUsageMock = {
  usage: () => {
    currentPlatformUser();
    injectedFailure("platform.candidates.usage");
    return mockResult(allCandidates.map((candidate) => ({ firmId: candidate.firmId, status: candidate.status, bdeId: candidate.bdeId })));
  },
};
