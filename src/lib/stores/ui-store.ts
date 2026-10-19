"use client";

import { create } from "zustand";

/**
 * UI store — sidebar collapse, table density, command palette open.
 * Persistence is done via manual localStorage in hydrate/effects so SSR is
 * unaffected. Never read localStorage outside a try/catch.
 */

type Density = "compact" | "default" | "comfortable";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  density: Density;
  setDensity: (d: Density) => void;

  commandPaletteOpen: boolean;
  /** The firm ⌘K's "View workspace of {firm}" asks a support-view reason for (admin shell, docs/04 §14.1). */
  supportDialogFirm: { id: string; slug: string; name: string } | null;
  openSupportDialog: (firm: { id: string; slug: string; name: string }) => void;
  closeSupportDialog: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  hintSheetOpen: boolean;
  openHintSheet: () => void;
  closeHintSheet: () => void;

  hydrated: boolean;
  hydrate: () => void;
}

const KEY_SIDEBAR = "benchq:ui:sidebar-collapsed";
const KEY_DENSITY = "benchq:ui:density";

function safeGet(key: string): string | null {
  try {
    return typeof window !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* storage disabled */
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    safeSet(KEY_SIDEBAR, String(next));
  },
  setSidebarCollapsed: (v) => {
    set({ sidebarCollapsed: v });
    safeSet(KEY_SIDEBAR, String(v));
  },

  density: "default",
  setDensity: (d) => {
    set({ density: d });
    safeSet(KEY_DENSITY, d);
  },

  commandPaletteOpen: false,
  supportDialogFirm: null,
  openSupportDialog: (firm) => set({ supportDialogFirm: firm, commandPaletteOpen: false }),
  closeSupportDialog: () => set({ supportDialogFirm: null }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  hintSheetOpen: false,
  openHintSheet: () => set({ hintSheetOpen: true }),
  closeHintSheet: () => set({ hintSheetOpen: false }),

  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const collapsed = safeGet(KEY_SIDEBAR) === "true";
    const density = (safeGet(KEY_DENSITY) as Density | null) ?? "default";
    set({ sidebarCollapsed: collapsed, density, hydrated: true });
  },
}));
