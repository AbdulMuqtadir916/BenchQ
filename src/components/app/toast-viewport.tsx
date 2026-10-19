"use client";

import { CircleCheck, X } from "lucide-react";
import { useToastStore } from "@/lib/stores/toast-store";

/** Bottom-right stack of toasts; a polite live region, each dismissible. */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96">
      {toasts.map((toast) => (
        <div key={toast.id} className="bq-card pointer-events-auto flex items-start gap-2 p-3 shadow-[var(--shadow-md)]">
          <CircleCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-success-fg)]" />
          <p className="flex-1 text-sm text-[var(--color-text)]">{toast.message}</p>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-3)] hover:text-[var(--color-text)]">
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
