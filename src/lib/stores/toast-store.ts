"use client";

import { create } from "zustand";

/**
 * Toasts (docs/05: the AppShell's toast viewport). A short confirmation after a write that navigates
 * away, e.g. "Firm created. Invite sent to …" (docs/04 §14.4). Announced politely; gone after a while.
 */
export interface Toast {
  id: number;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string) => void;
  dismiss: (id: number) => void;
}

const LIFETIME_MS = 6000;
let next = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message) => {
    const id = next++;
    set({ toasts: [...get().toasts, { id, message }] });
    setTimeout(() => get().dismiss(id), LIFETIME_MS);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));

export const useShowToast = () => useToastStore((state) => state.show);
