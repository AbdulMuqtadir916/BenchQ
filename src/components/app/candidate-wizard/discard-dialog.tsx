"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Discard this candidate?" (07 Q48: no drafts, so closing loses what was entered). A native modal <dialog>: focus
 * starts on "Keep editing", Esc keeps editing, and focus returns to what opened it.
 */
export function DiscardDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      keepRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="bq-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
    >
      <h2 id={titleId} className="text-h3 text-[var(--color-text)]">Discard this candidate?</h2>
      <p id={bodyId} className="mt-2 text-sm text-[var(--color-text-2)]">What you entered is lost. Nothing has been saved.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button ref={keepRef} variant="secondary" onClick={onKeep}>Keep editing</Button>
        <Button variant="danger" onClick={onDiscard}>Discard</Button>
      </div>
    </dialog>
  );
}
