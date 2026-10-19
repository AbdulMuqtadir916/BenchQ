"use client";

import { useState } from "react";
import { format } from "date-fns";
import { LoaderCircle, Pencil } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import { EmploymentType, WorkAuth } from "@/lib/schemas/enums";
import { useUpdateCandidate } from "@/lib/hooks/use-candidates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { WORK_AUTH_LABEL, WorkAuthChip } from "@/components/app/work-auth-chip";

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { C2C: "C2C", W2: "W2", TEEN99: "1099", FTE: "Full-time" };
const toDate = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd") : "");
const fromDate = (value: string) => (value ? new Date(`${value}T12:00:00Z`).toISOString() : null);
const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-sm text-[var(--color-text-3)]">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

/** The facts a BDE quotes to a vendor — visa, rate, availability — editable where he reads them. */
export function SubmissionFacts({ candidate, canEdit, onSaved }: { candidate: Candidate; canEdit: boolean; onSaved: () => void }) {
  const [isEditing, setEditing] = useState(false);
  const isAvailable = !candidate.availableFrom || new Date(candidate.availableFrom) <= new Date();

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-h3 text-[var(--color-text)]">Submission facts</h2>
        {canEdit && !isEditing ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden />Edit</Button> : null}
      </div>
      {isEditing ? (
        <FactsForm candidate={candidate} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />
      ) : (
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
              <dt className="mb-1.5 text-sm text-[var(--color-text-3)]">Target roles</dt>
              <dd className="flex flex-wrap gap-1.5">{candidate.targetRoles.map((r) => <Tag key={r}>{r}</Tag>)}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </Card>
  );
}

function FactsForm({ candidate, onCancel, onSaved }: { candidate: Candidate; onCancel: () => void; onSaved: () => void }) {
  const update = useUpdateCandidate(candidate.id);
  const [form, setForm] = useState({
    workAuth: candidate.workAuth,
    workAuthExpiry: toDate(candidate.workAuthExpiry),
    rateTarget: candidate.rateTarget?.toString() ?? "",
    rateMin: candidate.rateMin?.toString() ?? "",
    availableFrom: toDate(candidate.availableFrom),
    noticePeriodDays: candidate.noticePeriodDays?.toString() ?? "",
    willingToRelocate: candidate.willingToRelocate,
    employmentTypes: candidate.employmentTypes,
  });
  const target = toNumber(form.rateTarget);
  const floor = toNumber(form.rateMin);
  const error = target !== null && floor !== null && floor > target ? "The rate floor can't be above the target rate." : null;
  const label = "mb-1 block text-label text-[var(--color-text-2)]";

  function save() {
    if (error) return;
    update.mutate(
      { workAuth: form.workAuth, workAuthExpiry: fromDate(form.workAuthExpiry), rateTarget: target, rateMin: floor, availableFrom: fromDate(form.availableFrom), noticePeriodDays: toNumber(form.noticePeriodDays), willingToRelocate: form.willingToRelocate, employmentTypes: form.employmentTypes },
      { onSuccess: onSaved },
    );
  }

  return (
    <form className="space-y-3 pt-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={label}>Work authorization</span><Select aria-label="Work authorization" value={form.workAuth} onValueChange={(v) => setForm({ ...form, workAuth: v as WorkAuth })} options={WorkAuth.options.map((w) => ({ value: w, label: WORK_AUTH_LABEL[w] }))} /></div>
        <label><span className={label}>Valid until</span><Input type="date" value={form.workAuthExpiry} onChange={(e) => setForm({ ...form, workAuthExpiry: e.target.value })} /></label>
        <label><span className={label}>Target rate ($/hr)</span><Input inputMode="numeric" value={form.rateTarget} onChange={(e) => setForm({ ...form, rateTarget: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={!!error} /></label>
        <label><span className={label}>Rate floor ($/hr)</span><Input inputMode="numeric" value={form.rateMin} onChange={(e) => setForm({ ...form, rateMin: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={!!error} /></label>
        <label><span className={label}>Available from</span><Input type="date" value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} /></label>
        <label><span className={label}>Notice (days)</span><Input inputMode="numeric" value={form.noticePeriodDays} onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value.replace(/[^\d]/g, "") })} /></label>
      </div>
      <fieldset>
        <legend className={label}>Employment</legend>
        <div className="flex flex-wrap gap-1.5">
          {EmploymentType.options.map((t) => {
            const isOn = form.employmentTypes.includes(t);
            return (
              <button key={t} type="button" aria-pressed={isOn} onClick={() => setForm({ ...form, employmentTypes: isOn ? form.employmentTypes.filter((x) => x !== t) : [...form.employmentTypes, t] })} className={isOn ? "rounded-[var(--radius-full)] border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-2.5 py-0.5 text-sm text-[var(--color-primary-subtle-fg)]" : "rounded-[var(--radius-full)] border border-[var(--color-border)] px-2.5 py-0.5 text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]"}>
                {EMPLOYMENT_LABEL[t]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--color-text-2)]" id="relocate-label">Open to relocate</span>
        <button type="button" role="switch" aria-checked={form.willingToRelocate} aria-labelledby="relocate-label" onClick={() => setForm({ ...form, willingToRelocate: !form.willingToRelocate })} className="bq-switch"><span /></button>
      </div>
      {error || update.error ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{error ?? update.error?.message}</p> : null}
      <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!!error || update.isPending}>
          {update.isPending ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}Save
        </Button>
      </div>
    </form>
  );
}
