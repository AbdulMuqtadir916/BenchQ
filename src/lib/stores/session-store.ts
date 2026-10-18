"use client";

import { create } from "zustand";
import type { FirmSession, Session, User } from "@/lib/schemas/session";
import type { PlatformUser, Principal } from "@/lib/schemas/tenancy";

/**
 * Who is signed in, on the client (docs/07 §3, T4): the principal and its user, or nobody. It holds no
 * firm: a page's firm is the `[firm]` URL segment, resolved by the firm layout (`useFirm()`,
 * `useFirmId()` in src/lib/tenancy/firm-context.tsx). Platform sessions (Super Admin) join in Phase P.
 *
 * There is no real auth yet: the session starts as the default fixture user and the dev principal
 * switcher replaces it. This store shapes the UI; it is not security (Phase D).
 */

/** Must match the fixture records (src/mocks/data/firm.json); session-store.test.ts checks it. */
export const DEFAULT_SESSION: FirmSession = {
  principal: { kind: "firm", userId: "user_adnan", firmId: "firm_hts", role: "BDE" },
  user: {
    id: "user_adnan",
    firmId: "firm_hts",
    name: "Adnan Khan",
    email: "adnan@htsstaffing.com",
    role: "BDE",
    avatarUrl: null,
    isActive: true,
    lastActiveAt: "2026-10-01T05:47:52.943Z",
  },
  firm: {
    id: "firm_hts",
    name: "Hyderabad Tech Staffing LLC",
    slug: "hyderabad-tech-staffing",
    logoUrl: null,
    primaryTimezone: "Asia/Kolkata",
    clientTimezone: "America/New_York",
    truthGuardMode: "BALANCED",
    applicationExpiryDays: 30,
    status: "ACTIVE",
    planId: "plan_growth",
    seatLimit: 10,
    candidateLimit: 100,
    contactPhone: "+91 40 6600 1200",
    createdAt: "2026-06-02T09:00:00.000Z",
  },
};

interface SessionState {
  /** null = signed out. A firm user or a platform admin (docs/07 §3). */
  principal: Principal | null;
  /** The firm user, when the principal is a firm principal. */
  user: User | null;
  /** The platform admin, when the principal is a platform principal. */
  platformUser: PlatformUser | null;
  /** Replace the session (sign-in, the dev principal switcher). Only who is signed in is kept: the firm a page shows comes from its URL (docs/07 §1.3, T6). */
  setSession: (session: Session) => void;
  /**
   * DEV ONLY: a switch to another firm's user, waiting for the navigation to `path` to land before the
   * session changes (SessionCommitter). Switching first would turn the page you are leaving into a
   * not-found for the new principal for as long as the navigation takes.
   */
  pending: { session: Session; path: string } | null;
  setPending: (pending: { session: Session; path: string } | null) => void;
  signOut: () => void;
  /** Back to the default fixture user (tests). */
  reset: () => void;
}

const signedIn = (session: Session) =>
  "user" in session
    ? { principal: session.principal, user: session.user, platformUser: null }
    : { principal: session.principal, user: null, platformUser: session.platformUser };

export const useSession = create<SessionState>((set) => ({
  ...signedIn(DEFAULT_SESSION),
  pending: null,
  setSession: (session) => set({ ...signedIn(session), pending: null }),
  setPending: (pending) => set({ pending }),
  signOut: () => set({ principal: null, user: null, platformUser: null, pending: null }),
  reset: () => set({ ...signedIn(DEFAULT_SESSION), pending: null }),
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
