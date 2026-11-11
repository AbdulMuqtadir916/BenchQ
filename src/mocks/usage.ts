import type { CandidateUsageRow } from "@/lib/api/platform";
import { currentPlatformUser } from "./auth";
import { mockResult } from "./_shared";
import { injectedFailure } from "./membership";

/**
 * The platform tier's candidate usage (A2; platform admins only). Candidates are the backend's now (no candidates mock,
 * decided 2026-11-11), and the backend has no platform-wide candidate count yet, so this reports none until it does.
 */
export const candidateUsageMock = {
  usage: () => {
    currentPlatformUser();
    injectedFailure("platform.candidates.usage");
    return mockResult([] as CandidateUsageRow[]);
  },
};
