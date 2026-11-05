import type { WorkAuth } from "@/lib/schemas/enums";

/** Statuses that need an employer to sponsor (or transfer) the visa. The backend decides for real (backend/candidates/work_auth.py); this copy colours the chip and serves mock mode. */
export const NEEDS_SPONSOR: readonly WorkAuth[] = ["H1B", "OPT", "CPT", "H4_EAD", "TN"];
