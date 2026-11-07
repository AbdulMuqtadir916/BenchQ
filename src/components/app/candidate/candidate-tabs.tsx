"use client";

import { forwardRef } from "react";
import { Activity, BriefcaseBusiness, FileText, FolderOpen, Inbox, LayoutDashboard, Send, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { SPRING_LAYOUT } from "@/lib/motion";

export type CandidateTabId = "overview" | "applications" | "inbox" | "jobs" | "resumes" | "documents" | "activity";

/**
 * Ordered by how often a BDE needs them on a working night:
 * what needs me → where every submission stands → what recruiters said →
 * where to submit next → what to submit → what vendors ask for → the audit trail.
 */
export const CANDIDATE_TABS: Array<{ id: CandidateTabId; label: string; Icon: LucideIcon }> = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "applications", label: "Applications", Icon: Send },
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "jobs", label: "Jobs", Icon: BriefcaseBusiness },
  { id: "resumes", label: "Resumes", Icon: FileText },
  { id: "documents", label: "Documents", Icon: FolderOpen },
  { id: "activity", label: "Activity", Icon: Activity },
];

export function isCandidateTab(value: string | null): value is CandidateTabId {
  return CANDIDATE_TABS.some((t) => t.id === value);
}

interface CandidateTabsProps {
  value: CandidateTabId;
  onChange: (tab: CandidateTabId) => void;
  counts: Partial<Record<CandidateTabId, number>>;
  /** Tabs with something new — a dot, not a number. */
  alerts: Partial<Record<CandidateTabId, boolean>>;
  /** The open tab's own action, on the tab bar's line at the right (e.g. Upload résumé on Résumés). */
  trailing?: React.ReactNode;
}

/** Sticky tab bar with a sliding selection and counts. Arrow keys move between tabs. */
export const CandidateTabs = forwardRef<HTMLDivElement, CandidateTabsProps>(function CandidateTabs({ value, onChange, counts, alerts, trailing }, ref) {
  const reduce = useReducedMotion() ?? false;

  function move(dir: 1 | -1) {
    const i = CANDIDATE_TABS.findIndex((t) => t.id === value);
    const next = CANDIDATE_TABS[(i + dir + CANDIDATE_TABS.length) % CANDIDATE_TABS.length]!;
    onChange(next.id);
    requestAnimationFrame(() => document.getElementById(`candidate-tab-${next.id}`)?.focus());
  }

  return (
    <div ref={ref} className="sticky top-[var(--topbar-height)] z-20 -mx-1 mb-5 flex scroll-mt-16 items-center gap-3 bg-[var(--color-surface)] px-1 py-2">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
      <div
        role="tablist"
        aria-label="Candidate sections"
        className="inline-flex gap-0.5 rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            move(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {CANDIDATE_TABS.map(({ id, label, Icon }) => {
          const isActive = value === id;
          const count = counts[id];
          return (
            <button
              key={id}
              id={`candidate-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="candidate-tabpanel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(id)}
              className={cn("relative inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-sm transition-colors", isActive ? "font-[550] text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)]")}
            >
              {isActive ? (
                <motion.span layoutId="candidate-tab-pill" transition={reduce ? { duration: 0 } : SPRING_LAYOUT} aria-hidden className="absolute inset-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-control)]" />
              ) : null}
              <Icon size={14} aria-hidden className="relative" />
              <span className="relative">{label}</span>
              {count !== undefined ? <span className="tabular relative rounded-[var(--radius-full)] bg-[var(--color-surface-3)] px-1.5 text-caption text-[var(--color-text-2)]">{count}</span> : null}
              {alerts[id] ? <span className="relative h-1.5 w-1.5 rounded-[var(--radius-full)] bg-[var(--color-primary)]" aria-label="New" /> : null}
            </button>
          );
        })}
      </div>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
});
