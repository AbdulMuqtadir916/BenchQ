"use client";

import { MapPin } from "lucide-react";
import { CandidateAvatar } from "@/components/app/candidate-avatar";
import { EMPLOYMENT_LABEL } from "@/components/app/candidate/overview/submission-facts";
import { WORK_AUTH_LABEL } from "@/components/app/work-auth-chip";
import { Tag } from "@/components/ui/tag";
import type { WizardValues } from "./model";

/**
 * The candidate as they are being filled in (the right-hand card on every step). "Assigned BDE" is the screens'
 * "Owner" row, renamed (07 Q48): OWNER is the firm's owner. Filled from step 5: the BDE, or "{manager} picks".
 */
export function SummaryCard({ values, assignedBdeName = null }: { values: WizardValues; assignedBdeName?: string | null }) {
  const name = values.fullName.trim() || "New candidate";
  const location = [values.city.trim(), values.state.trim()].filter(Boolean).join(", ");
  const years = values.yearsExperience.trim();

  return (
    <section aria-label="Candidate summary" className="bq-card p-4">
      <div className="flex items-center gap-3">
        <CandidateAvatar name={name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-body-strong text-[var(--color-text)]">{name}</p>
          <p className="truncate text-caption text-[var(--color-text-3)]">{values.primaryRole.trim() || "Role not set"}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {values.workAuth ? <Tag tone="blue">{WORK_AUTH_LABEL[values.workAuth]}</Tag> : null}
        {values.employmentTypes.map((type) => <Tag key={type}>{EMPLOYMENT_LABEL[type]}</Tag>)}
        {years ? <Tag>{years} yrs</Tag> : null}
      </div>
      <dl className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3 text-sm">
        <Row label="Location">{location ? <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden />{location}</span> : null}</Row>
        <Row label="Email">{values.email.trim() || null}</Row>
        <Row label="Resume">{values.resume?.fileName ?? null}</Row>
        <Row label="Assigned BDE">{assignedBdeName}</Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--color-text-3)]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[var(--color-text)]">
        {children ?? <><span aria-hidden>—</span><span className="sr-only">not set</span></>}
      </dd>
    </div>
  );
}
