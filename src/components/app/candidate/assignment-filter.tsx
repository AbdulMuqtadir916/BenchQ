"use client";

import { UserX } from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/tag";

/** The candidates list's `?assignment=` filter (docs/candidate-onboarding/05 §5), parsed with Zod. */
export const CandidateListQuery = z.object({ assignment: z.enum(["all", "needs-bde"]).catch("all") });
export type AssignmentFilter = z.infer<typeof CandidateListQuery>["assignment"];

/** "All · Needs a BDE (n)": the manager's queue (07 Q42). Not shown to a BDE, who has no queue. */
export function AssignmentToggle({ value, waiting, onChange }: { value: AssignmentFilter; waiting: number; onChange: (next: AssignmentFilter) => void }) {
  const options: [AssignmentFilter, string][] = [["all", "All"], ["needs-bde", `Needs a BDE (${waiting})`]];
  return (
    <div role="group" aria-label="Assignment" className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-0.5">
      {options.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-sm", value === id ? "bg-[var(--color-surface)] font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]")}>
          {id === "needs-bde" ? <UserX size={14} aria-hidden /> : null}{label}
        </button>
      ))}
    </div>
  );
}

/** The BDE column's value for a candidate in a manager's queue: icon and words, never colour alone. */
export function NeedsBdeTag() {
  return <Tag tone="amber"><UserX size={11} aria-hidden />Needs a BDE</Tag>;
}
