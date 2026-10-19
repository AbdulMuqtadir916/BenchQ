"use client";

import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { can, type FirmAction, type FirmVisibility } from "./policy";

/** The permission policy for components: the pure policy (./policy) plus the hook. */
export * from "./policy";

export function useCan(action: FirmAction | FirmVisibility): boolean {
  return can(useSignedInPrincipal(), action);
}
