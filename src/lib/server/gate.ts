import { can } from "@/lib/auth/policy";
import { matchRoute } from "@/lib/routes/registry";
import type { Session } from "@/lib/schemas/session";
import { firmOutcome, type FirmLookup } from "@/lib/tenancy/firm-outcome";
import { platformOutcome } from "@/lib/tenancy/platform-outcome";

/**
 * What a layout does with a request once the server knows the principal (docs/07 Phase D items 2–4).
 * Pure, so the table is a unit test. It reuses `firmOutcome` / `platformOutcome` and the permission
 * policy: the browser gates and this decide by the same rules, this one before any page renders, so the
 * answer can be a real status. Not-found never confirms a firm or the admin area exists (principle 4).
 *
 * Only the layouts ask: a layout doesn't re-run on a client-side navigation, so the browser gates
 * stay for those. They are UX; the backend's 401 / 404 on every endpoint is the enforcement.
 */
export type ServerGate = { kind: "ok" } | { kind: "sign-in" } | { kind: "not-found" } | { kind: "forbidden" };

const OK: ServerGate = { kind: "ok" };

export function firmGate(session: Session | null, lookup: FirmLookup, pathname: string | null): ServerGate {
  const principal = session?.principal ?? null;
  const outcome = firmOutcome(principal, lookup);
  if (outcome.kind === "signed-out") return { kind: "sign-in" };
  if (outcome.kind === "not-found") return { kind: "not-found" };
  // The suspended screen, the support interstitial and a backend error are answered in place (200).
  if (outcome.kind !== "open" || !principal || pathname === null) return OK;
  const route = matchRoute(pathname);
  if (!route) return { kind: "not-found" };
  // A route that sends a denied role to its landing is a redirect the browser gate makes, not a 403.
  if (route.onDenied === "landing") return OK;
  return can(principal, "route.view", route) ? OK : { kind: "forbidden" };
}

export function platformGate(session: Session | null, pathname: string | null): ServerGate {
  const outcome = platformOutcome(session?.principal ?? null, { isHydrated: true, isSettling: false });
  if (outcome === "sign-in") return { kind: "sign-in" };
  if (outcome === "not-found") return { kind: "not-found" };
  // An /admin URL with no page: decided here, because the catch-all page's own notFound() runs after the response has started (200).
  if (pathname !== null && !matchRoute(pathname)) return { kind: "not-found" };
  return OK;
}
