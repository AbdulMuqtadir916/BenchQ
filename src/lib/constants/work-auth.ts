import type { WorkAuth } from "@/lib/schemas/enums";

/** Statuses that need an employer to sponsor (or transfer) the visa. The new-candidate flow works out `needsSponsorship` and `needsTransfer` from this and sends them; the backend only checks they were sent. */
export const NEEDS_SPONSOR: readonly WorkAuth[] = ["H1B", "OPT", "CPT", "H4_EAD", "TN"];

export const needsSponsorship = (workAuth: WorkAuth): boolean => NEEDS_SPONSOR.includes(workAuth);
export const needsTransfer = (workAuth: WorkAuth): boolean => workAuth === "H1B";
