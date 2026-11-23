"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { CONTENT_EXIT, POPOVER_TRANSITION } from "@/lib/motion";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown under the option above it (a batch under its Day). */
  indent?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
}

/** Compact listbox select with visible selection state, not browser chrome. */
export function Select({ value, options, onValueChange, className, disabled = false, "aria-label": ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function dismiss(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    optionRefs.current[selectedIndex]?.focus();
  }, [open, options, value]);

  function moveFocus(index: number, direction: 1 | -1) {
    let next = index;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        optionRefs.current[next]?.focus();
        return;
      }
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listboxId : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }} className="bq-select-trigger inline-flex h-[var(--control-height)] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50">
        <span className="flex min-w-0 items-center gap-2">{selected?.icon ? <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{selected.icon}</span> : null}<span className="truncate">{selected?.label}</span></span><ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-[var(--color-text-3)] transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
      {open ? <motion.ul id={listboxId} role="listbox" aria-label={ariaLabel} initial={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.985, filter: reduceMotion ? "none" : "blur(3px)" }} animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: reduceMotion ? 1 : 0.99, filter: reduceMotion ? "none" : "blur(2px)", transition: CONTENT_EXIT }} transition={POPOVER_TRANSITION} style={{ transformOrigin: "top left" }} className="absolute left-0 z-40 mt-1.5 max-h-[50vh] min-w-full overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-md)]">
        {options.map((option, index) => {
          const isSelected = option.value === value;
          return <li key={option.value} role="none"><button ref={(node) => { optionRefs.current[index] = node; }} type="button" role="option" aria-selected={isSelected} disabled={option.disabled} onClick={() => { if (!option.disabled) { onValueChange(option.value); setOpen(false); } }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); moveFocus(index, event.key === "ArrowDown" ? 1 : -1); } if (event.key === "Home" || event.key === "End") { event.preventDefault(); const target = event.key === "Home" ? options.findIndex((item) => !item.disabled) : options.findLastIndex((item) => !item.disabled); optionRefs.current[target]?.focus(); } }} className={cn("flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1.5 text-left text-sm transition-colors", option.indent && "pl-6", isSelected ? "border-[color-mix(in_srgb,var(--color-primary)_22%,transparent)] bg-[var(--color-primary-subtle)] font-[550] text-[var(--color-primary-subtle-fg)]" : "border-transparent text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]", option.disabled && "cursor-not-allowed opacity-50")}>
            {option.icon ? <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{option.icon}</span> : null}
            <span className="min-w-0 flex-1"><span className="block truncate leading-4">{option.label}</span>{option.description ? <span className="mt-0.5 block truncate text-caption font-normal text-[var(--color-text-3)]">{option.description}</span> : null}</span>
            {isSelected ? <Check size={13} aria-hidden="true" className="shrink-0" /> : null}
          </button></li>;
        })}
      </motion.ul> : null}
      </AnimatePresence>
    </div>
  );
}
