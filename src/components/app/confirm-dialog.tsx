"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no question in a native modal <dialog> (the same pattern as the wizard's discard dialog): focus starts on the
 * safe choice, Esc cancels, focus returns to what opened it.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Cancel", tone = "primary", isBusy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="bq-dialog" aria-labelledby={titleId} aria-describedby={children ? bodyId : undefined}
      onCancel={(event) => { event.preventDefault(); if (!isBusy) onCancel(); }}>
      <h2 id={titleId} className="text-h3 text-[var(--color-text)]">{title}</h2>
      {children ? <div id={bodyId} className="mt-2 space-y-2 text-sm text-[var(--color-text-2)]">{children}</div> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={isBusy}>{cancelLabel}</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={isBusy}>{isBusy ? "Working…" : confirmLabel}</Button>
      </div>
    </dialog>
  );
}
