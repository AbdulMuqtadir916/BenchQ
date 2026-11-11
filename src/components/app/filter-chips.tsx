"use client";

import { X } from "lucide-react";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * The filters a link opened the list with, each removable, and a way back to everything. Nothing renders without
 * filters, so the plain list looks as it always did.
 */
export function FilterChips({ chips, onClear }: { chips: FilterChip[]; onClear: () => void }) {
  if (chips.length === 0) return null;
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
  return (
    <div role="group" aria-label="Filters" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-caption text-[var(--color-text-3)]">Showing</span>
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] py-0.5 pl-2.5 pr-1 text-[var(--color-text)]">
          {chip.label}
          <button type="button" onClick={chip.onRemove} aria-label={`Remove filter: ${chip.label}`}
            className={`rounded-full p-0.5 text-[var(--color-text-3)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] ${focus}`}>
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className={`rounded-[var(--radius-sm)] px-1 text-[var(--color-primary)] hover:underline ${focus}`}>Clear all</button>
    </div>
  );
}
