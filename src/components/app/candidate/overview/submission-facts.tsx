"use client";

import { format } from "date-fns";
import { Pencil } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { EmploymentType } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { WorkAuthChip } from "@/components/app/work-auth-chip";

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { C2C: "C2C", W2: "W2", TEEN99: "1099", FTE: "Full-time" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-sm text-[var(--color-text-3)]">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

/**
 * The facts a BDE quotes to a vendor — visa, rate, availability — read-only here: they are edited with the rest of the
 * onboarding answers on the "Additional candidate details" tab (decided 2026-11-14, Q19), which "Edit" opens for whoever
 * may edit them (`canEditProfile`).
 */
export function SubmissionFacts({ candidate, onEdit }: { candidate: Candidate; onEdit?: () => void }) {
  const isAvailable = !candidate.availableFrom || new Date(candidate.availableFrom) <= new Date();

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-h3 text-[var(--color-text)]">Submission facts</h2>
        {onEdit ? <Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={13} aria-hidden />Edit</Button> : null}
      </div>
      <dl className="divide-y divide-[var(--color-border)]">
        <Fact label="Work authorization">
          <span className="inline-flex flex-col items-end gap-0.5">
            <WorkAuthChip workAuth={candidate.workAuth} expiry={candidate.workAuthExpiry} />
            {candidate.workAuthExpiry ? <span className="text-caption text-[var(--color-text-3)]">valid to {format(new Date(candidate.workAuthExpiry), "MMM yyyy")}</span> : null}
          </span>
        </Fact>
        <Fact label="Rate">
          <span className="tabular">{candidate.rateTarget ? `$${candidate.rateTarget}/hr` : "—"}</span>
          {candidate.rateMin ? <span className="tabular block text-caption text-[var(--color-text-3)]">floor ${candidate.rateMin}/hr</span> : null}
        </Fact>
        <Fact label="Availability">
          {isAvailable ? "Immediately" : format(new Date(candidate.availableFrom!), "MMM d")}
          {candidate.noticePeriodDays ? <span className="block text-caption text-[var(--color-text-3)]">{candidate.noticePeriodDays}-day notice</span> : null}
        </Fact>
        <Fact label="Employment">{candidate.employmentTypes.map((t) => EMPLOYMENT_LABEL[t]).join(" · ") || "—"}</Fact>
        <Fact label="Relocation">{candidate.willingToRelocate ? "Open to relocate" : "Current location only"}</Fact>
        {candidate.targetRoles.length ? (
          <div className="py-2.5">
            <dt className="mb-1.5 text-sm text-[var(--color-text-3)]">{candidate.targetRoles.length > 1 ? "Target roles" : "Target role"}</dt>
            <dd className="flex flex-wrap gap-1.5">{candidate.targetRoles.map((r) => <Tag key={r}>{r}</Tag>)}</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
