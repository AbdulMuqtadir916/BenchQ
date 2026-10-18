import type { QueryClient } from "@tanstack/react-query";
import type { Principal } from "@/lib/schemas/tenancy";
import { useSession } from "@/lib/stores/session-store";

/** Who is signed in, as one string: a change means a different person (or firm) is looking. */
export function principalKey(principal: Principal | null): string {
  if (!principal) return "signed-out";
  return principal.kind === "firm" ? `firm:${principal.firmId}:${principal.userId}` : `platform:${principal.userId}:${principal.support?.firmId ?? "-"}`;
}

/**
 * Clear the WHOLE query cache the moment the principal changes: the dev switcher, sign-in and sign-out
 * all go through the session store, so this one subscription covers them. It runs synchronously inside
 * the store update, before React renders the new principal, so no screen can read the previous
 * person's data. (Same-firm switches matter most: OWNER → BDE keeps the same firm keys.) The provider
 * also remounts the app under the new principal, so mounted queries start from this empty cache.
 * Returns the unsubscribe function.
 */
export function clearCacheOnPrincipalChange(client: QueryClient): () => void {
  return useSession.subscribe((state, previous) => {
    if (principalKey(state.principal) !== principalKey(previous.principal)) client.clear();
  });
}
