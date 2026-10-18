"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionApi } from "@/lib/api/session";
import { queryKeys } from "@/lib/query/keys";
import { useSession } from "@/lib/stores/session-store";

/** DEV ONLY: every fixture principal, for the dev principal switcher. */
export function useDevPrincipals(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.session.devPrincipals(), queryFn: () => sessionApi.devPrincipals(), enabled, staleTime: Infinity });
}

/**
 * DEV ONLY: sign in as another fixture user. The mock backend switches who is signed in, then the
 * client session follows. Cached data is keyed by firm, but user-specific lists (follow-ups, scopes)
 * change with the user too, so everything is refetched.
 */
export function useDevSignInAs() {
  const queryClient = useQueryClient();
  const setSession = useSession((s) => s.setSession);
  return useMutation({
    mutationFn: (userId: string) => sessionApi.devSignInAs(userId),
    onSuccess: (session) => {
      setSession(session);
      void queryClient.invalidateQueries();
    },
  });
}
