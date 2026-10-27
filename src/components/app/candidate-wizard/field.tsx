"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

/** "Drafted from résumé" (07 Q49): icon and words, never colour alone. Goes when the field is edited or reviewed. */
export function DraftedMarker({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-caption text-[var(--color-violet-fg)]", className)}>
      <Sparkles size={12} aria-hidden />
      Drafted from résumé
    </span>
  );
}

/** A labelled field: required mark, the drafted marker, and its hint or error wired for screen readers. */
export function WizardField({
  id,
  label,
  required = false,
  hint,
  error,
  isDrafted = false,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  isDrafted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <label htmlFor={id} className="text-label text-[var(--color-text-2)]">
          {label}
          {required ? (
            <>
              <span aria-hidden className="text-[var(--color-danger-fg)]"> *</span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </label>
        {isDrafted ? <DraftedMarker /> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-[var(--color-danger-fg)]">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-[var(--color-text-3)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** aria props for the control inside a <WizardField>. */
export const fieldAria = (id: string, error?: string, hasHint = false) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
});

/** A section heading inside a step, with an optional line under it. */
export function StepSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-h3 text-[var(--color-text)]">{title}</h3>
        {description ? <p className="mt-0.5 text-caption text-[var(--color-text-3)]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One checkbox pill in a group (engagement types, work settings). */
export function ChoicePill({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="bq-choice h-[var(--control-height)] items-center gap-2 px-3 text-body">
      <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--color-primary)]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
