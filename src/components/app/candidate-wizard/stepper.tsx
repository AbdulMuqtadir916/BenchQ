"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { STEPS, type StepId } from "./model";

/**
 * The five steps. Steps before the current one are done (a check) and are buttons back to them; later steps are plain
 * text, not clickable. `horizontal` is the header; `vertical` the list under the summary card. Below the `xl`
 * breakpoint the header shows "Step 2 of 5 · Basic details" instead of all five (the list under the card has them).
 */
export function Stepper({ current, onGo, orientation }: { current: StepId; onGo: (step: StepId) => void; orientation: "horizontal" | "vertical" }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  const isVertical = orientation === "vertical";

  return (
    <nav aria-label={isVertical ? "Steps, summary" : "Steps"}>
      {!isVertical ? (
        <p className="text-sm text-[var(--color-text-2)] xl:hidden">
          Step {currentIndex + 1} of {STEPS.length} · <span className="text-body-strong text-[var(--color-text)]">{STEPS[currentIndex]!.label}</span>
        </p>
      ) : null}
      <ol className={cn(isVertical ? "space-y-1" : "hidden items-center gap-2 xl:flex")}>
        {STEPS.map((step, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
          const marker = (
            <span
              aria-hidden
              className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-full)] border text-caption tabular",
                state === "done" && "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]",
                state === "current" && "border-[var(--color-primary)] text-[var(--color-primary-subtle-fg)]",
                state === "todo" && "border-[var(--color-border-strong)] text-[var(--color-text-3)]",
              )}
            >
              {state === "done" ? <Check size={11} /> : isVertical ? null : index + 1}
            </span>
          );
          const label = (
            <span className={cn("whitespace-nowrap text-sm", state === "current" ? "text-[var(--color-primary-subtle-fg)]" : state === "done" ? "text-[var(--color-text)]" : "text-[var(--color-text-3)]")}>
              {step.label}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : ""}</span>
            </span>
          );
          const body = state === "done" ? (
            <button type="button" onClick={() => onGo(step.id)} className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]">
              {marker}
              {label}
            </button>
          ) : (
            <span className={cn("flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1", state === "current" && "bg-[var(--color-primary-subtle)]")}>
              {marker}
              {label}
            </span>
          );
          return (
            <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2">
              {body}
              {!isVertical && index < STEPS.length - 1 ? <span aria-hidden className={cn("h-px w-6", index < currentIndex ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]")} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
