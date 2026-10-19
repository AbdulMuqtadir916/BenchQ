"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Every admin confirm and edit dialog (docs/04 §14: destructive or hard-to-reverse actions confirm).
 * A native modal <dialog>: focus stays inside, Esc cancels (unless a write is in flight), and focus
 * starts on Cancel for a destructive dialog, or on the first field when there is one. The body is a
 * form, so Enter submits.
 */
export function AdminDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  tone = "primary",
  isPending = false,
  canConfirm = true,
  error,
  onConfirm,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  tone?: "primary" | "danger";
  isPending?: boolean;
  canConfirm?: boolean;
  /** The write's failure, shown above the buttons. */
  error?: string | null;
  onConfirm: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const field = dialog.querySelector<HTMLElement>("input, textarea, select");
      (tone === "danger" || !field ? cancelRef.current : field)?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, tone]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canConfirm && !isPending) onConfirm();
  }

  return (
    <dialog
      ref={ref}
      className={cn("bq-dialog", wide && "bq-dialog-wide")}
      aria-labelledby={titleId}
      aria-describedby={description ? bodyId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="text-h3 text-[var(--color-text)]">{title}</h2>
        {description ? <div id={bodyId} className="mt-2 space-y-2 text-sm text-[var(--color-text-2)]">{description}</div> : null}
        {children ? <div className="mt-4 space-y-4">{children}</div> : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--color-danger-fg)]">{error}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={!canConfirm || isPending}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * A modal <dialog> around a form that brings its own buttons (the support-view form): opens on mount,
 * Esc and the form's Cancel call `onClose`.
 */
export function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="bq-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="mb-4 text-h3 text-[var(--color-text)]">{title}</h2>
      {children}
    </dialog>
  );
}

/** A labelled field with its hint or error, wired for screen readers. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-label text-[var(--color-text-2)]">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-[var(--color-danger-fg)]">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-[var(--color-text-3)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** aria props for an input inside <Field>. */
export const fieldAria = (id: string, error?: string | null, hasHint = false) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
});

/** The message of a failed write, for the dialog. */
export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error && error.message ? error.message : "That didn't work. Try again.";
}
