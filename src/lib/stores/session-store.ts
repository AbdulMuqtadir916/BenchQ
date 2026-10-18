"use client";

import { create } from "zustand";
import type { Firm, FirmSession, User } from "@/lib/schemas/session";
import type { FirmPrincipal } from "@/lib/schemas/tenancy";

/**
 * Who is signed in, on the client (docs/07 §3, T4). Holds a firm session: the principal, plus the user
 * and firm it points at so screens don't look them up. Platform sessions (Super Admin) join in Phase P.
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
  principal: FirmPrincipal;
  user: User;
  firm: Firm;
  /** Replace the whole session (sign-in, the dev principal switcher). */
  setSession: (session: FirmSession) => void;
  reset: () => void;
}

export const useSession = create<SessionState>((set) => ({
  ...DEFAULT_SESSION,
  setSession: (session) => set({ principal: session.principal, user: session.user, firm: session.firm }),
  reset: () => set({ ...DEFAULT_SESSION }),
}));

/**
 * The firm whose data the current screen shows. Today: the signed-in principal's firm. Phase T6
 * changes only this hook, to read the `[firm]` URL segment (docs/07 §1.3); every data hook keeps
 * calling it.
 */
export function useFirmId(): string {
  return useSession((s) => s.principal.firmId);
}
