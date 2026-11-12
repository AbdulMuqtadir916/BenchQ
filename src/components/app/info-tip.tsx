"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A small "i" that explains something on hover or keyboard focus. Esc closes it (WCAG 1.4.13), whether it was opened by
 * focus or by hover; screen readers read the text as the button's description. No dependency: the project has no tooltip
 * primitive. While open it carries `data-open`, which page-level Esc handlers (Esc goes back, `readKeyInput`) treat as an
 * overlay, so Esc closes the tip and never leaves the page.
 */
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);

  // Bubble phase on window: the page's Esc-back listens in the capture phase, sees the open tip and stands aside; this
  // then closes the tip. Works when focus is elsewhere (opened by hover), too.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  return (
    <span className={cn("relative inline-flex align-middle", className)} onMouseEnter={() => setIsOpen(true)} onMouseLeave={() => setIsOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-3)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        <Info size={14} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        data-open={isOpen ? "" : undefined}
        className={cn(
          "absolute left-1/2 top-full z-20 mt-1.5 w-64 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-caption text-[var(--color-text-2)] shadow-[var(--shadow-sm)]",
          isOpen ? "block" : "hidden",
        )}
      >
        {children}
      </span>
    </span>
  );
}
