import type { WorkAuth } from "@/lib/schemas/enums";

/** Statuses that need an employer to sponsor (or transfer) the visa. The new-candidate flow works out `needsSponsorship` and `needsTransfer` from this and sends them; the backend only checks they were sent. */
export const NEEDS_SPONSOR: readonly WorkAuth[] = ["H1B", "OPT", "CPT", "H4_EAD", "TN"];

export const needsSponsorship = (workAuth: WorkAuth): boolean => NEEDS_SPONSOR.includes(workAuth);
export const needsTransfer = (workAuth: WorkAuth): boolean => workAuth === "H1B";

/**
 * A work authorization change as an update: the new status with the sponsorship and transfer it implies, the same rule
 * as the new-candidate flow (the backend refuses a new `work_auth` without both). Nothing when it didn't change.
 */
export function workAuthChange(current: WorkAuth, next: WorkAuth): { workAuth: WorkAuth; needsSponsorship: boolean; needsTransfer: boolean } | Record<string, never> {
  return next === current ? {} : { workAuth: next, needsSponsorship: needsSponsorship(next), needsTransfer: needsTransfer(next) };
}

/** How a work authorization is written (the same words as the backend's first base, backend/candidates/first_base.py). */
export const WORK_AUTH_LABEL: Record<WorkAuth, string> = {
  H1B: "H-1B",
  H4_EAD: "H4 EAD",
  OPT: "OPT",
  CPT: "CPT",
  GC: "Green Card",
  GC_EAD: "GC EAD",
  USC: "US Citizen",
  TN: "TN",
};
