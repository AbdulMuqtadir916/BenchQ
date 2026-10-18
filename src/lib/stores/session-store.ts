"use client";

import { create } from "zustand";
import type { FirmRole } from "@/lib/schemas/enums";

/**
 * Session store. There is no real auth in this repo. A fixture session is
 * loaded on mount; the dev-only RoleSwitcher flips `user.role`.
 * Every permission-dependent surface reads from this store.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: FirmRole;
  avatarUrl: string | null;
}

export interface SessionFirm {
  id: string;
  name: string;
  primaryTimezone: string;
  clientTimezone: string;
}

interface SessionState {
  user: SessionUser;
  firm: SessionFirm;
  setRole: (role: FirmRole) => void;
}

const DEFAULT_USER: SessionUser = {
  id: "user_adnan",
  name: "Adnan Khan",
  email: "adnan@hyderabadtechstaffing.com",
  role: "BDE",
  avatarUrl: null,
};

const DEFAULT_FIRM: SessionFirm = {
  id: "firm_hts",
  name: "Hyderabad Tech Staffing",
  primaryTimezone: "Asia/Kolkata",
  clientTimezone: "America/New_York",
};

export const useSession = create<SessionState>((set) => ({
  user: DEFAULT_USER,
  firm: DEFAULT_FIRM,
  setRole: (role) => set((s) => ({ user: { ...s.user, role } })),
}));
