"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { sessionApi } from "@/lib/api/session";
import { queryKeys } from "@/lib/query/keys";
import { useSession } from "@/lib/stores/session-store";

/** DEV ONLY: every fixture principal, for the dev principal switcher. */
export function useDevPrincipals(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.session.devPrincipals(), queryFn: () => sessionApi.devPrincipals(), enabled, staleTime: Infinity });
}

/**
 * DEV ONLY: sign in as another fixture user. The mock backend switches who is signed in, then the
 * client session follows. Setting the session clears the whole query cache and remounts the app
 * (src/lib/query/principal-boundary.ts), so nothing of the previous principal's data can render.
 */
export function useDevSignInAs() {
  const setSession = useSession((s) => s.setSession);
  return useMutation({
    mutationFn: (userId: string) => sessionApi.devSignInAs(userId),
    onSuccess: (session) => setSession(session),
  });
}
