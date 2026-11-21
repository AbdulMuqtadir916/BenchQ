"use client";

import { create } from "zustand";
import type { ErrorText } from "@/lib/api/error-text";
import { isEscapeBackKey, type ListKeyInput } from "@/lib/list-keys";

/**
 * Toasts (docs/05: the AppShell's toast viewport). A short confirmation after a write that navigates
 * away, e.g. "Firm created. Invite sent to …" (docs/04 §14.4), or a write's failure. A confirmation is announced
 * politely, a failure as an alert. Gone after a while, except a failure with a reference to copy (an unexpected error):
 * it stays until dismissed (its button, or Esc for the newest failure).
 *
 * The stack stays short (Uzair, 2026-11-21): the same words again replace the earlier toast instead of stacking, and at
 * most `MAX_ERROR_TOASTS` failures stay, the oldest dropped first.
 */
export interface Toast {
  id: number;
  message: string;
  tone: "success" | "danger";
  /** The request id of an unexpected error, shown with a copy button. */
  reference: string | null;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, options?: { tone?: Toast["tone"]; reference?: string | null }) => void;
  dismiss: (id: number) => void;
  /** Dismisses the newest failure (Esc); false when there is none, so the key is left to whoever else wants it. */
  dismissNewestError: () => boolean;
}

const LIFETIME_MS = 6000;
export const MAX_ERROR_TOASTS = 3;
let next = 1;

/** The stack after `toast` arrives: an earlier toast with the same words and tone is replaced (the new one goes last,
 * with a fresh lifetime), and only the newest `MAX_ERROR_TOASTS` failures are kept. */
export function withToast(toasts: Toast[], toast: Toast): Toast[] {
  const stack = [...toasts.filter((t) => t.message !== toast.message || t.tone !== toast.tone), toast];
  const errorIds = stack.filter((t) => t.tone === "danger").map((t) => t.id);
  const dropped = new Set(errorIds.slice(0, Math.max(0, errorIds.length - MAX_ERROR_TOASTS)));
  return stack.filter((t) => !dropped.has(t.id));
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, options = {}) => {
    const id = next++;
    const reference = options.reference ?? null;
    set({ toasts: withToast(get().toasts, { id, message, tone: options.tone ?? "success", reference }) });
    if (!reference) setTimeout(() => get().dismiss(id), LIFETIME_MS);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  dismissNewestError: () => {
    const newest = get().toasts.findLast((toast) => toast.tone === "danger");
    if (!newest) return false;
    get().dismiss(newest.id);
    return true;
  },
}));

/** A failure toast is showing: Esc dismisses it first, so src/lib/hooks/use-escape-back.ts waits. */
export const hasErrorToast = (): boolean => useToastStore.getState().toasts.some((toast) => toast.tone === "danger");

/**
 * Esc dismisses the newest failure toast (docs/04 §1.3: Esc closes the topmost thing first). Under the same guards as Esc
 * going back: never while a dialog, the palette, the shortcut sheet, a menu or a tooltip is open (they close themselves on
 * it), never in a field, never with a modifier, never for a key something else took. True when it dismissed one: the
 * caller then prevents the default, so going back (or closing the page) doesn't also happen on that press.
 */
export function dismissErrorToastOnEscape(input: Omit<ListKeyInput, "insideTable">): boolean {
  if (!isEscapeBackKey(input)) return false;
  return useToastStore.getState().dismissNewestError();
}

export const useShowToast = () => useToastStore((state) => state.show);

/** A failed write as a toast: the words `describeError` picked, and the reference when there is one. */
export function useShowErrorToast() {
  const show = useShowToast();
  return (text: ErrorText) => show(text.message, { tone: "danger", reference: text.reference });
}
