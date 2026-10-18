import { isNotFoundError } from "@/lib/api/client";
import type { Firm } from "@/lib/schemas/session";
import type { FirmPrincipal } from "@/lib/schemas/tenancy";

/**
 * What the firm layout renders for a `/[firm]/…` URL (docs/07 §2.5), decided in the doc's order before
 * any page renders. Pure, so the §2.5 table is a unit test. Client-side, so UX, not security (Phase D).
 *
 * Not here yet: the platform admin's support interstitial (Phase P; platform sessions aren't selectable
 * before it). An ONBOARDING firm has no users until its OWNER accepts, which makes it ACTIVE, so a firm
 * user never meets one.
 */
export type FirmOutcome =
  | { kind: "signed-out" }
  | { kind: "resolving" }
  | { kind: "not-found" }
  | { kind: "error"; error: Error }
  | { kind: "suspended"; firm: Firm }
  | { kind: "open"; firm: Firm };

export type FirmLookup = { status: "pending" } | { status: "error"; error: Error } | { status: "success"; firm: Firm };

export function firmOutcome(principal: FirmPrincipal | null, lookup: FirmLookup): FirmOutcome {
  if (!principal) return { kind: "signed-out" };
  if (lookup.status === "pending") return { kind: "resolving" };
  // An unknown slug and another firm's slug are both a 404 from the backend: never confirm a firm exists.
  if (lookup.status === "error") return isNotFoundError(lookup.error) ? { kind: "not-found" } : { kind: "error", error: lookup.error };
  // The backend only resolves the principal's own firm; checked again here (docs/07 §3).
  if (lookup.firm.id !== principal.firmId) return { kind: "not-found" };
  if (lookup.firm.status === "SUSPENDED") return { kind: "suspended", firm: lookup.firm };
  return { kind: "open", firm: lookup.firm };
}
