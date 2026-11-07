"use client";

import { useRef, useState } from "react";
import { ChevronRight, EyeOff } from "lucide-react";
import type { TreeCandidate } from "@/lib/derive/resume-tree";
import { cn } from "@/lib/cn";
import { BaseFolder, type TreeActions, type TreeLabels } from "./base-folder";

interface ResumeTreeProps {
  tree: TreeCandidate[];
  labels: TreeLabels;
  /** Resume Builder: one heading per candidate. A candidate's own tab: none. */
  candidateHeading?: (candidateId: string) => { name: string; role: string | null } | null;
  showTailored?: boolean;
  /** The assigned BDE sees the hidden bases, to show them again (07 Q55). */
  canSeeHidden?: (candidateId: string) => boolean;
  /** A candidate's tab opens the active base; the library starts closed. */
  openActive?: boolean;
  actions?: TreeActions;
}

function HiddenBases({ candidate, labels, showTailored, actions }: { candidate: TreeCandidate; labels: TreeLabels; showTailored: boolean; actions?: TreeActions }) {
  const [isOpen, setOpen] = useState(false);
  const bodyId = `hidden-${candidate.candidateId}`;
  return (
    <li>
      <button type="button" data-tree-nav="" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setOpen(!isOpen)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]">
        <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-[var(--color-text-3)] transition-transform duration-[var(--duration-base)]", isOpen && "rotate-90")} />
        <EyeOff size={14} aria-hidden className="text-[var(--color-text-3)]" />
        Hidden ({candidate.hidden.length})
      </button>
      {isOpen ? (
        <ul id={bodyId} className="mt-2 space-y-2">
          {candidate.hidden.map((node) => <BaseFolder key={node.base.id} node={node} labels={labels} showTailored={showTailored} actions={actions} />)}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The résumé tree (docs/05 §3): base → versions and tailored copies by job, one shared component for the Resume
 * Builder library and a candidate's Résumés tab. `J` / `K` move between rows; `Enter` opens or expands.
 */
export function ResumeTree({ tree, labels, candidateHeading, showTailored = true, canSeeHidden = () => false, openActive = false, actions }: ResumeTreeProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "j" && e.key !== "k")) return;
    const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-tree-nav]") ?? []);
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
    rows[next]?.focus();
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="space-y-6">
      {tree.map((candidate) => {
        const heading = candidateHeading?.(candidate.candidateId);
        const hidden = canSeeHidden(candidate.candidateId) && candidate.hidden.length > 0;
        return (
          <section key={candidate.candidateId} aria-label={heading ? `${heading.name}'s résumés` : "Résumés"}>
            {heading ? (
              <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-h3 text-[var(--color-text)]">
                {heading.name}
                {heading.role ? <span className="text-sm font-normal text-[var(--color-text-3)]">{heading.role}</span> : null}
              </h2>
            ) : null}
            <ul className="space-y-2">
              {candidate.bases.map((node) => (
                <BaseFolder key={node.base.id} node={node} labels={labels} showTailored={showTailored} defaultOpen={openActive && node.base.isActive} actions={actions} />
              ))}
              {hidden ? <HiddenBases candidate={candidate} labels={labels} showTailored={showTailored} actions={actions} /> : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
