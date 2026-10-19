import type { Principal } from "@/lib/schemas/tenancy";

/**
 * What the admin layout renders for `/admin/…` (docs/07 §2.3, P2): only a PLATFORM_ADMIN gets the
 * admin area — inside a support view too (the admin shell is theirs). Signed out → sign-in with
 * returnTo; any firm user → not-found, never Forbidden, so the admin area's existence isn't confirmed
 * (principle 4). Pure, so the rows are a unit test. Client-side: UX, not security (Phase D).
 */
export type PlatformOutcome = "waiting" | "sign-in" | "not-found" | "open";

export function platformOutcome(principal: Principal | null, state: { isHydrated: boolean; isSettling: boolean }): PlatformOutcome {
  if (!state.isHydrated || state.isSettling) return "waiting";
  if (!principal) return "sign-in";
  return principal.kind === "platform" ? "open" : "not-found";
}
