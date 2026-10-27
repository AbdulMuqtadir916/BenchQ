"use client";

import { Input } from "@/components/ui/input";
import { WORK_AUTH_LABEL } from "@/components/app/work-auth-chip";
import { EMPLOYMENT_LABEL } from "@/components/app/candidate/overview/submission-facts";
import { EmploymentType, WorkAuth } from "@/lib/schemas/enums";
import { ChoicePill, DraftedMarker, fieldAria, StepSection, WizardField } from "./field";
import { PrefixedInput, ReviewStrip } from "./parts";
import type { Errors } from "./model";
import type { Wizard } from "./use-wizard";

/** The line under each work authorization card (the screens' copy). */
const WORK_AUTH_DETAIL: Record<WorkAuth, string> = {
  H1B: "Transfer needed",
  H4_EAD: "EAD on file",
  OPT: "STEM / initial",
  CPT: "School-sponsored",
  GC: "No sponsorship",
  GC_EAD: "Pending GC",
  USC: "No sponsorship",
  TN: "Canada / Mexico",
  OTHER: "Explain in notes",
};

const digits = (value: string) => value.replace(/[^\d]/g, "");

/** Step 3 (04-wizard-steps.md §3): what filters jobs out before a BDE sees them, so it must be right. */
export function StepWorkRate({ wizard, errors }: { wizard: Wizard; errors: Errors }) {
  const { values, drafted, set } = wizard;
  const workAuthDrafted = drafted.has("workAuth");

  return (
    <div className="space-y-8">
      <ReviewStrip count={workAuthDrafted ? 1 : 0} onReviewed={() => wizard.markReviewed(["workAuth"])} />

      <fieldset className="space-y-3" aria-describedby={errors.workAuth ? "cw-workauth-error" : values.workAuthText ? "cw-workauth-printed" : undefined}>
        <legend className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-h3 text-[var(--color-text)]">Work authorization<span aria-hidden className="text-[var(--color-danger-fg)]"> *</span><span className="sr-only"> (required)</span></span>
          {workAuthDrafted ? <DraftedMarker /> : null}
        </legend>
        <div role="radiogroup" aria-label="Work authorization" aria-invalid={errors.workAuth ? true : undefined} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {WorkAuth.options.map((option) => (
            <label key={option} className="bq-choice flex-col gap-0.5 px-3 py-2">
              <span className="flex items-center gap-2">
                <input type="radio" name="cw-workauth" value={option} checked={values.workAuth === option} onChange={() => set("workAuth", option)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                <span className="text-body-strong">{WORK_AUTH_LABEL[option]}</span>
              </span>
              <span className="pl-5 text-caption text-[var(--color-text-3)]">{WORK_AUTH_DETAIL[option]}</span>
            </label>
          ))}
        </div>
        {errors.workAuth ? <p id="cw-workauth-error" className="text-caption text-[var(--color-danger-fg)]">{errors.workAuth}</p> : null}
        {values.workAuthText && values.workAuth === null ? (
          <p id="cw-workauth-printed" className="text-caption text-[var(--color-text-2)]">The résumé says: “{values.workAuthText}”</p>
        ) : null}
        <div className="max-w-xs">
          <WizardField id="cw-workauth-expiry" label="Authorization valid until" hint="BenchQ warns 90 days before it lapses.">
            <Input {...fieldAria("cw-workauth-expiry", undefined, true)} type="date" value={values.workAuthExpiry} onChange={(event) => set("workAuthExpiry", event.target.value)} />
          </WizardField>
        </div>
      </fieldset>

      <StepSection title="Engagement & rate" description="Hourly, in USD. The floor is never shown to vendors.">
        <fieldset aria-describedby={errors.employmentTypes ? "cw-engagement-error" : undefined}>
          <legend className="sr-only">Engagement types (at least one)</legend>
          <div className="flex flex-wrap gap-2">
            {EmploymentType.options.map((type) => (
              <ChoicePill key={type} label={EMPLOYMENT_LABEL[type]} checked={values.employmentTypes.includes(type)} onChange={(isOn) => set("employmentTypes", isOn ? [...values.employmentTypes, type] : values.employmentTypes.filter((item) => item !== type))} />
            ))}
          </div>
          {errors.employmentTypes ? <p id="cw-engagement-error" className="mt-1.5 text-caption text-[var(--color-danger-fg)]">{errors.employmentTypes}</p> : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <WizardField id="cw-rate-target" label="Target rate" hint="What BDEs quote first." error={errors.rateTarget}>
            <PrefixedInput prefix="$"><input {...fieldAria("cw-rate-target", errors.rateTarget, true)} inputMode="numeric" value={values.rateTarget} onChange={(event) => set("rateTarget", digits(event.target.value))} placeholder="85" className="w-full bg-transparent outline-none" /></PrefixedInput>
          </WizardField>
          <WizardField id="cw-rate-floor" label="Walk-away floor" hint="Lowest rate the candidate accepts." error={errors.rateMin}>
            <PrefixedInput prefix="$"><input {...fieldAria("cw-rate-floor", errors.rateMin, true)} inputMode="numeric" value={values.rateMin} onChange={(event) => set("rateMin", digits(event.target.value))} placeholder="70" className="w-full bg-transparent outline-none" /></PrefixedInput>
          </WizardField>
        </div>
      </StepSection>

      <StepSection title="Availability">
        <div className="grid gap-4 sm:grid-cols-2">
          <WizardField id="cw-available" label="Available from">
            <Input {...fieldAria("cw-available")} type="date" value={values.availableFrom} onChange={(event) => set("availableFrom", event.target.value)} />
          </WizardField>
          <WizardField id="cw-notice" label="Notice period (days)" hint="0 if they're on the bench now." error={errors.noticePeriodDays}>
            <Input {...fieldAria("cw-notice", errors.noticePeriodDays, true)} inputMode="numeric" value={values.noticePeriodDays} onChange={(event) => set("noticePeriodDays", digits(event.target.value))} placeholder="0" />
          </WizardField>
        </div>
      </StepSection>
    </div>
  );
}
