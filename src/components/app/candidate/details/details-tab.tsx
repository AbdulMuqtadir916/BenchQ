"use client";

import { useCallback, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import { useUpdateCandidate } from "@/lib/hooks/use-candidates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { WORK_AUTH_LABEL } from "@/components/app/work-auth-chip";
import { EMPLOYMENT_LABEL } from "@/components/app/candidate/overview/submission-facts";
import { fieldAria, StepSection, WizardField } from "@/components/app/candidate-wizard/field";
import { StepPreferences } from "@/components/app/candidate-wizard/step-preferences";
import { StepWorkRate } from "@/components/app/candidate-wizard/step-work-rate";
import type { Errors, WizardValues } from "@/components/app/candidate-wizard/model";
import type { WizardForm } from "@/components/app/candidate-wizard/use-wizard";
import { detailsValues, isChanged, toUpdate, validateDetails } from "./model";

const NOTHING_DRAFTED: ReadonlySet<never> = new Set();
const SETTING_LABEL = { REMOTE: "Remote", HYBRID: "Hybrid", ONSITE: "On-site" } as const;

/**
 * "Additional candidate details" (decided 2026-11-14, Q15–Q20): every onboarding answer that isn't on the résumé, in the
 * new-candidate flow's own fields. Edited by the candidate's BDE once one is assigned, and by the OWNER and a MANAGER
 * only before that (`canEditProfile`, the résumé rule); everyone else reads it.
 */
export function CandidateDetailsTab({ candidate, canEdit, onSaved }: { candidate: Candidate; canEdit: boolean; onSaved: () => void }) {
  // A saved edit comes back as a newer candidate: the form starts again from it.
  return canEdit ? <DetailsForm key={candidate.updatedAt} candidate={candidate} onSaved={onSaved} /> : <DetailsView candidate={candidate} />;
}

function DetailsForm({ candidate, onSaved }: { candidate: Candidate; onSaved: () => void }) {
  const update = useUpdateCandidate(candidate.id);
  const [values, setValues] = useState<WizardValues>(() => detailsValues(candidate));
  const [errors, setErrors] = useState<Errors>({});
  const set = useCallback(<K extends keyof WizardValues>(field: K, value: WizardValues[K]) => setValues((current) => ({ ...current, [field]: value })), []);
  const form: WizardForm = useMemo(() => ({ values, drafted: NOTHING_DRAFTED, set }), [values, set]);
  const changed = isChanged(candidate, values);

  function save() {
    const found = validateDetails(values);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    update.mutate(toUpdate(candidate, values), { onSuccess: onSaved });
  }

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
      <Card className="space-y-8">
        <StepSection title="Role" description="What they're marketed as. The target role is under Candidate preferences.">
          <div className="grid gap-4 sm:grid-cols-2">
            <WizardField id="cw-role" label="Marketed as" required hint="The headline title BDEs submit under." error={errors.primaryRole}>
              <Input {...fieldAria("cw-role", errors.primaryRole, true)} value={values.primaryRole} onChange={(event) => set("primaryRole", event.target.value)} maxLength={200} />
            </WizardField>
            <WizardField id="cw-years" label="Years of experience" required error={errors.yearsExperience}>
              <Input {...fieldAria("cw-years", errors.yearsExperience)} value={values.yearsExperience} onChange={(event) => set("yearsExperience", event.target.value)} inputMode="numeric" />
            </WizardField>
          </div>
        </StepSection>
        <StepWorkRate wizard={form} errors={errors} />
      </Card>
      <Card>
        <StepPreferences wizard={form} errors={errors} homeFrom="resume" />
      </Card>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        {update.error ? <p role="alert" className="mr-auto text-sm text-[var(--color-danger-fg)]">{update.error.message}</p> : null}
        <Button type="button" variant="ghost" size="sm" disabled={!changed || update.isPending} onClick={() => { setValues(detailsValues(candidate)); setErrors({}); update.reset(); }}>Discard changes</Button>
        <Button type="submit" size="sm" disabled={!changed || update.isPending}>
          {update.isPending ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}Save details
        </Button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-sm text-[var(--color-text-3)]">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

/** The stored day (its UTC date, what was picked), whatever the viewer's timezone. */
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");
const tags = (items: string[]) => (items.length ? <span className="flex flex-wrap gap-1.5">{items.map((item) => <Tag key={item}>{item}</Tag>)}</span> : "—");

/** For whoever can't edit them: the same details, read-only, and who edits them. */
function DetailsView({ candidate }: { candidate: Candidate }) {
  return (
    <Card>
      <p className="mb-2 text-caption text-[var(--color-text-3)]">
        {candidate.bdeId ? "The candidate's BDE edits these details." : "The owner or the candidate's manager edits these details until a BDE is assigned."}
      </p>
      <dl className="divide-y divide-[var(--color-border)]">
        <Row label="Marketed as">{candidate.primaryRole ?? "—"}</Row>
        <Row label={candidate.targetRoles.length > 1 ? "Target roles" : "Target role"}>{tags(candidate.targetRoles)}</Row>
        <Row label="Years of experience">{candidate.yearsExperience ?? "—"}</Row>
        <Row label="Work authorization">{WORK_AUTH_LABEL[candidate.workAuth]}{candidate.workAuthExpiry ? `, valid until ${day(candidate.workAuthExpiry)}` : ""}</Row>
        <Row label="Engagement">{candidate.employmentTypes.map((type) => EMPLOYMENT_LABEL[type]).join(" · ") || "—"}</Row>
        <Row label="Rate">{candidate.rateTarget ? `$${candidate.rateTarget}/hr` : "—"}{candidate.rateMin ? ` (floor $${candidate.rateMin}/hr)` : ""}</Row>
        <Row label="Available from">{day(candidate.availableFrom)}</Row>
        <Row label="Notice period">{candidate.noticePeriodDays === null ? "—" : `${candidate.noticePeriodDays} days`}</Row>
        <Row label="Work setting">{candidate.workSettings.map((setting) => SETTING_LABEL[setting]).join(" · ") || "—"}</Row>
        <Row label="Preferred locations">{tags(candidate.preferredLocations)}</Row>
        <Row label="Willing to relocate">{candidate.willingToRelocate ? "Yes" : "No"}</Row>
        <Row label="Preferred industries">{tags(candidate.preferredIndustries)}</Row>
        <Row label="Deal breakers">{tags(candidate.dealBreakers)}</Row>
        <Row label="Notes for the BDE"><span className="whitespace-pre-line">{candidate.contactNotes ?? "—"}</span></Row>
      </dl>
    </Card>
  );
}
