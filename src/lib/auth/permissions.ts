"use client";

import { useSignedInPrincipal } from "@/lib/stores/session-store";
import type { RouteDef } from "@/lib/routes/registry";
import { can, type Action } from "./policy";

/** The permission policy for components: the pure policy (./policy) plus hooks. `<Can>` is in ./can.tsx. */
export * from "./policy";

export function useCan(action: Action): boolean {
  return can(useSignedInPrincipal(), action);
}

/** May the signed-in principal open this route? (`can(principal, "route.view", route)`) */
export function useCanView(route: RouteDef): boolean {
  return can(useSignedInPrincipal(), "route.view", route);
}
