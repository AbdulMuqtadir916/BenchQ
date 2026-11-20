"use client";

import { useEffect, type KeyboardEvent } from "react";
import { Eye, LayoutPanelLeft, ListChecks } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { SPRING_LAYOUT } from "@/lib/motion";
import type { StudioTab } from "./studio-store";

const TABS: Array<{ id: StudioTab; label: string; short: string; hint: string; Icon: typeof Eye }> = [
  { id: "build", label: "Builder", short: "Builder", hint: "Edit section by section in forms", Icon: LayoutPanelLeft },
  { id: "view", label: "Viewer", short: "Viewer", hint: "Read the page and edit any text in place", Icon: Eye },
  { id: "autofill", label: "Autofill answers", short: "Autofill", hint: "What the extension fills on application forms from this resume", Icon: ListChecks },
];

/** The Autofill tab is another page: a tab chosen with the arrow keys keeps the focus once that page is up. */
let focusOnMount: StudioTab | null = null;
const keepFocusOn = (id: StudioTab | null) => {
  focusOnMount = id;
};
/** The tab to focus on this mount, once. */
const takeFocus = (tab: StudioTab): boolean => {
  if (focusOnMount !== tab) return false;
  focusOnMount = null;
  return true;
};
const focusTab = (id: StudioTab) => document.getElementById(`studio-tab-${id}`)?.focus();

/**
 * Builder ⇄ Viewer ⇄ Autofill answers (docs/04, 07 Q6). A tablist: the arrow keys, Home and End switch tabs. Builder and
 * Viewer are two ways of editing the open document; Autofill answers is its own page, and a switch to or from it replaces
 * the URL, so the history keeps one entry for the studio and its close goes back to where it was opened. An unsaved draft
 * has no Autofill tab. Below `md` the tabs show their icons only; their names stay their accessible names.
 */
export function StudioTabs({ tab, onTab, hasAutofill }: { tab: StudioTab; onTab: (tab: StudioTab) => void; hasAutofill: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const tabs = hasAutofill ? TABS : TABS.filter(({ id }) => id !== "autofill");

  useEffect(() => {
    if (takeFocus(tab)) focusTab(tab);
  }, [tab]);

  const onKeyDown = (event: KeyboardEvent) => {
    const at = tabs.findIndex(({ id }) => id === tab);
    const next = event.key === "ArrowRight" ? tabs[(at + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(at - 1 + tabs.length) % tabs.length]
      : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    if (next.id === tab) return;
    keepFocusOn(next.id);
    onTab(next.id);
    // Builder and Viewer are one page: the tab is there next frame. To or from Autofill, the next page's tabs take it.
    if (next.id !== "autofill" && tab !== "autofill") {
      requestAnimationFrame(() => {
        if (takeFocus(next.id)) focusTab(next.id);
      });
    }
  };

  return (
    <div role="tablist" aria-label="Resume views" onKeyDown={onKeyDown}
      className="inline-flex shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-0.5">
      {tabs.map(({ id, label, short, hint, Icon }) => {
        const isActive = tab === id;
        return (
          <button key={id} id={`studio-tab-${id}`} type="button" role="tab" aria-selected={isActive} aria-label={label}
            tabIndex={isActive ? 0 : -1} title={hint} onClick={() => (isActive ? undefined : onTab(id))}
            className={cn("relative inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-sm md:px-3",
              isActive ? "font-[550] text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)]")}>
            {isActive ? (
              <motion.span layoutId="studio-tab-pill" transition={reduce ? { duration: 0 } : SPRING_LAYOUT} aria-hidden
                className="absolute inset-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-control)]" />
            ) : null}
            <Icon size={14} aria-hidden className="relative" />
            <span className="relative hidden md:inline xl:hidden">{short}</span>
            <span className="relative hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
