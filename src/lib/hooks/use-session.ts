"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { landingHref } from "@/lib/routes/landing";
import { sessionApi } from "@/lib/api/session";
import { queryKeys } from "@/lib/query/keys";
import type { FirmSession } from "@/lib/schemas/session";
import { useSession } from "@/lib/stores/session-store";

/**
 * Who the backend says is signed in, with their own firm. Used for where to send them (the landing,
 * links from pages outside a firm), never as the firm a page shows: that is the URL's (docs/07 §1.3).
 */
export function useCurrentSession() {
  const isSignedIn = useSession((s) => s.principal !== null);
  return useQuery({ queryKey: queryKeys.session.current(), queryFn: () => sessionApi.current(), enabled: isSignedIn, staleTime: Infinity });
}

/** The firm a URL slug names, for the firm layout (docs/07 §2.5). 404 for an unknown slug and another firm's alike. */
export function useFirmBySlug(slug: string) {
  const isSignedIn = useSession((s) => s.principal !== null);
  return useQuery({ queryKey: queryKeys.session.firmBySlug(slug), queryFn: () => sessionApi.firmBySlug(slug), enabled: isSignedIn, staleTime: Infinity });
}

/** DEV ONLY: every fixture principal, for the dev principal switcher. */
export function useDevPrincipals(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.session.devPrincipals(), queryFn: () => sessionApi.devPrincipals(), enabled, staleTime: Infinity });
}

/**
 * DEV ONLY: sign in as another fixture user. The mock backend switches who is signed in, then the
 * client session follows. Setting the session clears the whole query cache and remounts the app
 * (src/lib/query/principal-boundary.ts), so nothing of the previous principal's data can render.
 *
 * `navigateTo` names a page to go to first (a switch to another firm's user: their landing). Then the
 * session changes only once that page's URL is in place (SessionCommitter), so the page being left
 * never re-renders under the new principal.
 */
export function useDevSignInAs(options: { navigateTo?: (session: FirmSession) => string | null } = {}) {
  const router = useRouter();
  const setSession = useSession((s) => s.setSession);
  const setPending = useSession((s) => s.setPending);
  const { navigateTo } = options;
  return useMutation({
    mutationFn: (userId: string) => sessionApi.devSignInAs(userId),
    // Mutation-level callbacks run even when the switch unmounts the caller.
    onSuccess: (session) => {
      const path = navigateTo?.(session) ?? null;
      if (!path) return setSession(session);
      setPending({ session, path });
      router.replace(path);
    },
  });
}

/** Sign out: the backend first, then the client session (which clears the cache, principal-boundary.ts). */
export function useSignOut() {
  const signOut = useSession((s) => s.signOut);
  return useMutation({ mutationFn: () => sessionApi.signOut(), onSuccess: () => signOut() });
}

/**
 * DEV ONLY: commits a pending cross-firm switch (useDevSignInAs) once the URL it waits for is in place.
 * Mounted once, above the per-principal remount, in the query provider.
 */
export function useCommitPendingSession() {
  const pathname = usePathname();
  const pending = useSession((s) => s.pending);
  const setSession = useSession((s) => s.setSession);
  useEffect(() => {
    if (pending && pathname === pending.path.split(/[?#]/)[0]) setSession(pending.session);
  }, [pending, pathname, setSession]);
}

/**
 * Finish (or skip) an OWNER's first run on /welcome (docs/07 T7): the backend marks the user active,
 * the client session and the cached session follow, then on to the landing, now the dashboard.
 */
export function useFinishFirstRun() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setSession = useSession((s) => s.setSession);
  return useMutation({
    mutationFn: () => sessionApi.finishFirstRun(),
    onSuccess: (session) => {
      setSession(session);
      queryClient.setQueryData(queryKeys.session.current(), session);
      router.replace(landingHref(session));
    },
  });
}
