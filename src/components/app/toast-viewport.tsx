"use client";

import { useEffect } from "react";
import { AlertTriangle, CircleCheck, X } from "lucide-react";
import { dismissErrorToastOnEscape, useToastStore, type Toast } from "@/lib/stores/toast-store";
import { readKeyInput } from "@/lib/list-keys-dom";
import { cn } from "@/lib/cn";
import { ErrorReference } from "./error-reference";
import { TOAST_LAYER } from "./toast-layer";

/**
 * Bottom-right stack of toasts, each dismissible. Confirmations sit in a polite live region; a failure's words are an
 * alert of their own (read out at once) and show its reference to copy, outside that alert. No live region sits inside
 * another. Esc dismisses the newest failure when nothing else wants the key (`dismissErrorToastOnEscape`).
 */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const confirmations = toasts.filter((toast) => toast.tone === "success");
  const failures = toasts.filter((toast) => toast.tone === "danger");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (dismissErrorToastOnEscape(readKeyInput(event))) event.preventDefault();
    }
    // The capture phase, so it sees an open dialog or palette before they close themselves on the same press.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className={cn("pointer-events-none fixed bottom-4 left-4 right-4 sm:left-auto sm:w-96", TOAST_LAYER)}>
      {/* Always rendered, so a confirmation added later is announced. */}
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {confirmations.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />)}
      </div>
      {failures.length > 0 ? (
        <div className={cn("flex flex-col gap-2", confirmations.length > 0 && "mt-2")}>
          {failures.map((toast, index) => (
            <ToastCard key={toast.id} toast={toast} isEscTarget={index === failures.length - 1} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** `isEscTarget`: the newest failure, the one Esc dismisses. */
function ToastCard({ toast, isEscTarget = false, onDismiss }: { toast: Toast; isEscTarget?: boolean; onDismiss: () => void }) {
  const isFailure = toast.tone === "danger";
  const Icon = isFailure ? AlertTriangle : CircleCheck;
  return (
    <div className="bq-card pointer-events-auto flex items-start gap-2 p-3 shadow-[var(--shadow-md)]">
      <Icon size={16} aria-hidden className={cn("mt-0.5 shrink-0", isFailure ? "text-[var(--color-danger-fg)]" : "text-[var(--color-success-fg)]")} />
      <div className="flex-1 text-sm text-[var(--color-text)]">
        <p role={isFailure ? "alert" : undefined}>{toast.message}</p>
        {toast.reference ? <ErrorReference reference={toast.reference} className="mt-1 text-[var(--color-text-2)]" /> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        aria-keyshortcuts={isEscTarget ? "Escape" : undefined}
        className="rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-3)] hover:text-[var(--color-text)]"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
