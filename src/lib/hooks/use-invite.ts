"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invitesApi, type AcceptInviteInput } from "@/lib/api/invites";
import { queryKeys } from "@/lib/query/keys";
import { landingHref } from "@/lib/routes/landing";
import { useSession } from "@/lib/stores/session-store";

/** /invite/[token]: what the invite offers, or why it can't be accepted. Public. */
export function useInviteLookup(token: string) {
  return useQuery({ queryKey: queryKeys.invite(token), queryFn: () => invitesApi.lookup(token), staleTime: 0 });
}

/**
 * Accept: the account is created and signed in; then, as after a sign-in (useSignIn), navigate to its
 * landing first (an OWNER's first run is /welcome) and commit the session once that URL is in place.
 */
export function useAcceptInvite(token: string) {
  const router = useRouter();
  const setPending = useSession((s) => s.setPending);
  return useMutation({
    mutationFn: (input: AcceptInviteInput) => invitesApi.accept(token, input),
    onSuccess: (session) => {
      const path = landingHref(session);
      setPending({ session, path });
      router.replace(path);
    },
  });
}
