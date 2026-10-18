"use client";

import { create } from "zustand";
import type { Session, User } from "@/lib/schemas/session";
import type { PlatformUser, Principal } from "@/lib/schemas/tenancy";

/**
 * Who is signed in, on the client (docs/07 §3, T4): the principal and its user, or nobody. It holds no
 * firm: a page's firm is the `[firm]` URL segment, resolved by the firm layout (`useFirm()`,
 * `useFirmId()` in src/lib/tenancy/firm-context.tsx).
 *
 * The app starts signed out and **bootstrapping**: `useSessionSync` (query provider) asks the session
 * layer who is signed in (a stored session survives reloads and is shared by tabs, Q27) and follows
 * other tabs' changes. Mock auth: this store shapes the UI, it is not security (Phase D).
 */

interface SessionState {
  /** null = signed out. A firm user or a platform admin (docs/07 §3). */
  principal: Principal | null;
  /** The firm user, when the principal is a firm principal. */
  user: User | null;
  /** The platform admin, when the principal is a platform principal. */
  platformUser: PlatformUser | null;
  /** Replace the session (sign-in, start-up, another tab's change). Only who is signed in is kept: the firm a page shows comes from its URL (docs/07 §1.3, T6). */
  setSession: (session: Session) => void;
  /**
   * DEV ONLY: a switch to another firm's user, waiting for the navigation to `path` to land before the
   * session changes (SessionCommitter). Switching first would turn the page you are leaving into a
   * not-found for the new principal for as long as the navigation takes.
   */
  pending: { session: Session; path: string } | null;
  setPending: (pending: { session: Session; path: string } | null) => void;
  /** True until the session layer has said who is signed in (on start-up, after a reload). Gates wait. */
  bootstrapping: boolean;
  setBootstrapped: () => void;
  signOut: () => void;
  /** Signed out and bootstrapped (tests). */
  reset: () => void;
}

const signedIn = (session: Session) =>
  "user" in session
    ? { principal: session.principal, user: session.user, platformUser: null }
    : { principal: session.principal, user: null, platformUser: session.platformUser };

const SIGNED_OUT = { principal: null, user: null, platformUser: null };

export const useSession = create<SessionState>((set) => ({
  ...SIGNED_OUT,
  pending: null,
  bootstrapping: true,
  setSession: (session) => set({ ...signedIn(session), pending: null, bootstrapping: false }),
  setPending: (pending) => set({ pending }),
  setBootstrapped: () => set({ bootstrapping: false }),
  signOut: () => set({ ...SIGNED_OUT, pending: null }),
  reset: () => set({ ...SIGNED_OUT, pending: null, bootstrapping: false }),
}));

/**
 * The signed-in user, for screens under the firm layout or the dev layout: both render nothing of
 * their children while signed out (docs/07 §2.5), so here the user is always there.
 */
export function useSignedInUser(): User {
  const user = useSession((s) => s.user);
  if (!user) throw new Error("useSignedInUser() rendered without a signed-in firm user: it belongs under the firm layout.");
  return user;
}

/**
 * Is the session not yet known or about to change (start-up / reload, or a sign-in landing on this
 * URL)? Gates show their skeleton meanwhile instead of judging a principal that isn't settled.
 */
export function useIsSessionSettling(): boolean {
  return useSession((s) => s.pending !== null || s.bootstrapping);
}

/** Who is signed in, for pages that render only when someone is (the firm, admin and dev layouts). */
export function useSignedInPrincipal(): Principal {
  const principal = useSession((s) => s.principal);
  if (!principal) throw new Error("useSignedInPrincipal() rendered while signed out: it belongs under a signed-in layout.");
  return principal;
}

/** The signed-in person's display name and role label, whichever tier they are on. */
export function useSignedInIdentity(): { name: string; roleLabel: string } {
  const user = useSession((s) => s.user);
  const admin = useSession((s) => s.platformUser);
  if (admin) return { name: admin.name, roleLabel: "Super Admin" };
  if (user) return { name: user.name, roleLabel: ROLE_LABEL[user.role] };
  throw new Error("useSignedInIdentity() rendered while signed out.");
}

const ROLE_LABEL: Record<User["role"], string> = { OWNER: "Owner", MANAGER: "Manager", BDE: "BDE", VIEWER: "Viewer" };
