"use client";

import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { statusOf, type AutofillSection } from "@/lib/derive/autofill-view";
import { TOPIC_ICONS } from "./topic-icons";

/** The topics on the side of a wide Autofill tab, each with its count; a click scrolls to it. A topic with questions to
 * answer says how many. Hidden below `lg`, where the list stands alone. */
export function AutofillRail({ sections }: { sections: readonly AutofillSection[] }) {
  const reduce = useReducedMotion() ?? false;
  if (sections.length === 0) return null;
  return (
    <nav aria-label="Autofill topics" className="sticky top-5 hidden w-52 shrink-0 self-start lg:block">
      <p className="px-2 pb-1.5 text-label text-[var(--color-text-3)]">Topics</p>
      <ul className="space-y-0.5">
        {sections.map((section) => {
          const Icon = TOPIC_ICONS[section.id];
          const missing = section.entries.filter((entry) => statusOf(entry) === "missing").length;
          return (
            <li key={section.id}>
              <button type="button"
                onClick={() => document.getElementById(`autofill-${section.id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })}
                className={cn("flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                  section.id === "review" && "text-[var(--color-warning-fg)]")}>
                <Icon size={14} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                {missing > 0 ? <span className="size-1.5 shrink-0 rounded-[var(--radius-full)] bg-[var(--color-warning-fg)]" aria-label={`${missing} to answer`} role="img" /> : null}
                <span className="tabular text-caption text-[var(--color-text-3)]">{section.entries.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
