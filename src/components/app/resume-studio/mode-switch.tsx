"use client";

import { Eye, LayoutPanelLeft } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { SPRING_LAYOUT } from "@/lib/motion";
import { useStudio, type StudioMode } from "./studio-store";

const MODES: Array<{ id: StudioMode; label: string; hint: string; Icon: typeof Eye }> = [
  { id: "build", label: "Builder", hint: "Edit section by section in forms", Icon: LayoutPanelLeft },
  { id: "view", label: "Viewer", hint: "Read the page and edit any text in place", Icon: Eye },
];

/** Builder ⇄ Viewer. A tablist, so arrow keys switch modes. */
export function ModeSwitch() {
  const mode = useStudio((s) => s.mode);
  const setMode = useStudio((s) => s.setMode);
  const reduce = useReducedMotion() ?? false;

  return (
    <div
      role="tablist"
      aria-label="Editing mode"
      className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-0.5"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = mode === "build" ? "view" : "build";
        setMode(next);
        requestAnimationFrame(() => document.getElementById(`studio-mode-${next}`)?.focus());
      }}
    >
      {MODES.map(({ id, label, hint, Icon }) => {
        const isActive = mode === id;
        return (
          <button
            key={id}
            id={`studio-mode-${id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={hint}
            onClick={() => setMode(id)}
            className={cn("relative inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-sm", isActive ? "font-[550] text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)]")}
          >
            {isActive ? (
              <motion.span
                layoutId="studio-mode-pill"
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className="absolute inset-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-control)]"
                aria-hidden
              />
            ) : null}
            <Icon size={14} aria-hidden className="relative" />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
