"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { landingHref, signInTarget } from "@/lib/routes/landing";
import { sessionApi } from "@/lib/api/session";
import { queryKeys } from "@/lib/query/keys";
import type { Session } from "@/lib/schemas/session";
import { principalKey } from "@/lib/query/principal-boundary";
import { useSession } from "@/lib/stores/session-store";

/**
 * Who the backend says is signed in, with their own firm. Used for where to send them (the landing,
 * links from pages outside a firm), never as the firm a page shows: that is the URL's (docs/07 §1.3).
 */
export function useCurrentSession() {
  const isSignedIn = useSession((s) => s.principal !== null);
  return useQuery({ queryKey: queryKeys.session.current(), queryFn: () => sessionApi.current(), enabled: isSignedIn, staleTime: Infinity });
}

/**
 * The firm a URL slug names, for the firm layout (docs/07 §2.5). For a firm user: 404 for an unknown
 * slug and another firm's alike. For a platform admin: the firm if it exists (they manage every firm),
 * 404 only for an unknown slug.
 */
export function useFirmBySlug(slug: string) {
  const isSignedIn = useSession((s) => s.principal !== null);
  return useQuery({ queryKey: queryKeys.session.firmBySlug(slug), queryFn: () => sessionApi.firmBySlug(slug), enabled: isSignedIn, staleTime: Infinity });
}

/**
 * Sign in on /sign-in (docs/07 L2) with email + password. On success it navigates first (to the
 * same-origin `returnTo` if this account can open it, else its landing: signInTarget) and the session changes once that URL is in
 * place (useCommitPendingSession): the change clears the cache and remounts the app, and doing it
 * first would re-render /sign-in under the new principal. Any failure is the one generic error.
 */
export function useSignIn(returnTo: string | null) {
  const router = useRouter();
  const setPending = useSession((s) => s.setPending);
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) => sessionApi.signIn(credentials.email, credentials.password),
    // Mutation-level callbacks run even when the change unmounts the caller.
    onSuccess: (session) => {
      const path = signInTarget(session, returnTo);
      setPending({ session, path });
      router.replace(path);
    },
  });
}

/**
 * Sign out: the backend first, then the client session (which clears the cache, principal-boundary.ts).
 * The session is shared by tabs (Q27), so every other open tab follows through useSessionSync.
 */
export function useSignOut() {
  const signOut = useSession((s) => s.signOut);
  return useMutation({ mutationFn: () => sessionApi.signOut(), onSuccess: () => signOut() });
}

/**
 * Commits a pending sign-in (useSignIn) once the URL it navigated to is in place. Mounted once, above
 * the per-principal remount, in the query provider.
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

/**
 * Bring the client session in line with the session layer: on start-up (the stored session, if any)
 * and when another tab signs in, out or as someone else (Q27). A different principal goes through
 * setSession, so the cache-clear-and-remount boundary applies exactly as for a sign-in here.
 */
export function applySession(session: Session | null): void {
  const store = useSession.getState();
  if (session === null) {
    if (store.principal !== null) store.signOut();
    store.setBootstrapped();
    return;
  }
  if (principalKey(store.principal) !== principalKey(session.principal)) store.setSession(session);
  else store.setBootstrapped();
}

/**
 * Mounted once, above the per-principal remount (query provider): asks the session layer who is
 * signed in on start-up, then follows other tabs. Until the first answer the store is bootstrapping
 * and every gate shows its skeleton.
 */
export function useSessionSync() {
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      sessionApi.current().then(
        (session) => alive && applySession(session),
        () => alive && applySession(null),
      );
    void refresh();
    const stop = sessionApi.watch(() => void refresh());
    return () => {
      alive = false;
      stop();
    };
  }, []);
}
