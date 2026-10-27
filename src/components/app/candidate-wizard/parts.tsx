"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** An input with a leading icon or text ("$"): the wrapper is the field's frame, so the focus ring wraps both. */
export function PrefixedInput({ icon: Icon, prefix, children }: { icon?: LucideIcon; prefix?: string; children: ReactNode }) {
  return (
    <div className="bq-input flex items-center gap-2 text-body">
      {Icon ? <Icon size={14} aria-hidden className="shrink-0 text-[var(--color-text-3)]" /> : null}
      {prefix ? <span aria-hidden className="shrink-0 text-[var(--color-text-3)]">{prefix}</span> : null}
      {children}
    </div>
  );
}

/**
 * "{n} fields drafted from the résumé — review them" (07 Q49), with "Mark as reviewed", which clears this step's
 * markers. Nothing here verifies anything: reviewing only says a person looked.
 */
export function ReviewStrip({ count, onReviewed }: { count: number; onReviewed: () => void }) {
  if (count === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-violet-bg)] p-3">
      <Sparkles size={14} aria-hidden className="text-[var(--color-violet-fg)]" />
      <p className="flex-1 text-sm text-[var(--color-text)]">
        {count} {count === 1 ? "field" : "fields"} on this step {count === 1 ? "was" : "were"} drafted from the résumé. Review them before you create the candidate.
      </p>
      <Button size="sm" variant="secondary" onClick={onReviewed}>Mark as reviewed</Button>
    </div>
  );
}

/** An on/off setting with its label and description; the whole row is the switch's label. */
export function SwitchRow({ id, label, description, checked, onChange }: { id: string; label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div>
        <p id={`${id}-label`} className="text-body-strong text-[var(--color-text)]">{label}</p>
        {description ? <p id={`${id}-description`} className="text-caption text-[var(--color-text-3)]">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onClick={() => onChange(!checked)}
        className="bq-switch focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
      >
        <span />
      </button>
    </div>
  );
}
