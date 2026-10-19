import { isNotFoundError } from "@/lib/api/client";
import type { Firm } from "@/lib/schemas/session";
import type { Principal } from "@/lib/schemas/tenancy";

/**
 * What the firm layout renders for a `/[firm]/…` URL (docs/07 §2.5), decided in the doc's order before
 * any page renders. Pure, so the §2.5 table is a unit test. Client-side, so UX, not security (Phase D).
 *
 * A platform admin is never a member: for an existing firm without a support view of it they get the
 * support interstitial (§2.5 row 4); an unknown slug is not-found for them too (row 2 comes first, so
 * the interstitial is never offered for a firm that doesn't exist). Inside a support view of the firm (P4)
 * the workspace opens read-only, a suspended firm included. An ONBOARDING firm has no users until its OWNER accepts, which makes it ACTIVE, so a firm
 * user never meets one.
 */
export type FirmOutcome =
  | { kind: "signed-out" }
  | { kind: "resolving" }
  | { kind: "not-found" }
  | { kind: "support-required"; firm: Firm }
  | { kind: "error"; error: Error }
  | { kind: "suspended"; firm: Firm }
  | { kind: "open"; firm: Firm };

export type FirmLookup = { status: "pending" } | { status: "error"; error: Error } | { status: "success"; firm: Firm };

export function firmOutcome(principal: Principal | null, lookup: FirmLookup): FirmOutcome {
  if (!principal) return { kind: "signed-out" };
  if (lookup.status === "pending") return { kind: "resolving" };
  // A firm user: an unknown slug and another firm's slug are both a 404 from the backend, so a URL
  // never confirms a firm exists. A platform admin: only an unknown slug is a 404.
  if (lookup.status === "error") return isNotFoundError(lookup.error) ? { kind: "not-found" } : { kind: "error", error: lookup.error };
  if (principal.kind === "platform") {
    // Inside a support view of this firm: the workspace, read-only — a SUSPENDED firm included (§2.5).
    // Without one (or with one of another firm): the interstitial that starts one.
    return principal.support?.firmId === lookup.firm.id ? { kind: "open", firm: lookup.firm } : { kind: "support-required", firm: lookup.firm };
  }
  // The backend only resolves the principal's own firm; checked again here (docs/07 §3).
  if (lookup.firm.id !== principal.firmId) return { kind: "not-found" };
  if (lookup.firm.status === "SUSPENDED") return { kind: "suspended", firm: lookup.firm };
  return { kind: "open", firm: lookup.firm };
}
