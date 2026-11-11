"use client";

import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { useStudio } from "../studio-store";

interface BuilderSectionProps {
  id: ResumeSectionKey;
  title: string;
  icon: LucideIcon;
  count?: number;
  children: ReactNode;
}

/** One collapsible section card in Builder mode. Open state lives in the store. */
export function BuilderSection({ id, title, icon: Icon, count, children }: BuilderSectionProps) {
  const isOpen = useStudio((s) => !!s.openSections[id]);
  const toggle = useStudio((s) => s.toggleSection);
  const reduce = useReducedMotion() ?? false;
  const bodyId = `builder-section-${id}`;

  return (
    <section
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--color-surface)] transition-shadow duration-[var(--duration-base)]",
        isOpen ? "border-[var(--color-border-strong)] shadow-[var(--shadow-sm)]" : "border-[var(--color-border)] shadow-[var(--shadow-xs)] hover:border-[var(--color-border-strong)]",
      )}
    >
      <h3>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => toggle(id)}
          className="flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-lg)] px-4 text-left"
        >
          <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-[var(--color-text-3)] transition-transform duration-[var(--duration-base)]", isOpen && "rotate-90")} />
          <Icon size={15} aria-hidden className="shrink-0 text-[var(--color-text-3)]" />
          <span className="text-h3 text-[var(--color-text)]">{title}</span>
          {count !== undefined ? <span className="tabular text-sm text-[var(--color-text-3)]">({count})</span> : null}
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={bodyId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-[var(--color-border)] px-4 pb-4 pt-3.5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
