"use client";

import { create } from "zustand";
import type { FirmSession, User } from "@/lib/schemas/session";
import type { FirmPrincipal } from "@/lib/schemas/tenancy";

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
  /** null = signed out. */
  principal: FirmPrincipal | null;
  user: User | null;
  /** Replace the session (sign-in, the dev principal switcher). Only who is signed in is kept: the firm a page shows comes from its URL (docs/07 §1.3, T6). */
  setSession: (session: FirmSession) => void;
  /**
   * DEV ONLY: a switch to another firm's user, waiting for the navigation to `path` to land before the
   * session changes (SessionCommitter). Switching first would turn the page you are leaving into a
   * not-found for the new principal for as long as the navigation takes.
   */
  pending: { session: FirmSession; path: string } | null;
  setPending: (pending: { session: FirmSession; path: string } | null) => void;
  signOut: () => void;
  /** Back to the default fixture user (tests). */
  reset: () => void;
}

const signedIn = (session: FirmSession) => ({ principal: session.principal, user: session.user });

export const useSession = create<SessionState>((set) => ({
  ...signedIn(DEFAULT_SESSION),
  pending: null,
  setSession: (session) => set({ ...signedIn(session), pending: null }),
  setPending: (pending) => set({ pending }),
  signOut: () => set({ principal: null, user: null, pending: null }),
  reset: () => set({ ...signedIn(DEFAULT_SESSION), pending: null }),
}));

/**
 * The signed-in user, for screens under the firm layout or the dev layout: both render nothing of
 * their children while signed out (docs/07 §2.5), so here the user is always there.
 */
export function useSignedInUser(): User {
  const user = useSession((s) => s.user);
  if (!user) throw new Error("useSignedInUser() rendered while signed out: it belongs under the firm or dev layout.");
  return user;
}
