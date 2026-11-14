"use client";

import { Plus, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DEAL_BREAKER_SUGGESTIONS, INDUSTRY_SUGGESTIONS, LOCATION_SUGGESTIONS, NOTE_MAX_LENGTH } from "@/lib/constants/candidate-intake";
import type { RemoteMode } from "@/lib/schemas/enums";
import { ChoicePill, fieldAria, WizardField } from "./field";
import { SwitchRow } from "./parts";
import { TagInput } from "./tag-input";
import type { Errors } from "./model";
import type { Wizard } from "./use-wizard";

const WORK_SETTINGS: { value: RemoteMode; label: string }[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
];

/**
 * Step 4 (04-wizard-steps.md §3): what the candidate wants. One target role is required, and a place for the job search:
 * a preferred location, or the city and state from step 2 (decided 2026-11-14). Every other field is optional. Work
 * setting, preferred locations and the notes are provisional fields (07 Q50).
 */
export function StepPreferences({ wizard, errors }: { wizard: Wizard; errors: Errors }) {
  const { values, set } = wizard;
  const marketedAs = values.primaryRole.trim();
  const hasHome = values.city.trim() !== "" && values.state.trim() !== "";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] pb-4">
        <span className="bq-card inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--color-primary)]"><UserRound size={15} aria-hidden /></span>
        <div>
          <h3 className="text-h3 text-[var(--color-text)]">Candidate preferences</h3>
          <p className="text-caption text-[var(--color-text-3)]">What they told you on the intake call.</p>
        </div>
      </div>

      <WizardField id="cw-target-role" label="Target role" required error={errors.targetRole} hint="The job search looks for this title.">
        <Input {...fieldAria("cw-target-role", errors.targetRole, true)} value={values.targetRole} onChange={(event) => set("targetRole", event.target.value)} maxLength={200} placeholder="Senior Java Developer…" />
        {marketedAs && values.targetRole.trim() === "" ? (
          <button type="button" onClick={() => set("targetRole", marketedAs)} className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-1.5 py-0.5 text-caption text-[var(--color-text-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]">
            <Plus size={11} aria-hidden />{marketedAs}
          </button>
        ) : null}
      </WizardField>

      <fieldset className="space-y-1.5">
        <legend className="text-label text-[var(--color-text-2)]">Work setting</legend>
        <div className="flex flex-wrap gap-2">
          {WORK_SETTINGS.map(({ value, label }) => (
            <ChoicePill key={value} label={label} checked={values.workSettings.includes(value)} onChange={(isOn) => set("workSettings", isOn ? [...values.workSettings, value] : values.workSettings.filter((item) => item !== value))} />
          ))}
        </div>
      </fieldset>

      <WizardField id="cw-locations" label="Preferred locations" required={!hasHome} error={errors.preferredLocations}
        hint={hasHome ? `The job search looks in ${values.city.trim()}, ${values.state.trim()} and in each place here.` : "The job search needs a place: add one here, or their city and state on Basic details."}>
        <TagInput id="cw-locations" label="preferred locations" describedBy={errors.preferredLocations ? "cw-locations-error" : "cw-locations-hint"} values={values.preferredLocations} onChange={(next) => set("preferredLocations", next)} suggestions={LOCATION_SUGGESTIONS} placeholder="City, state" />
      </WizardField>

      <SwitchRow id="cw-relocate" label="Willing to relocate" description="Include on-site roles outside their preferred locations." checked={values.willingToRelocate} onChange={(next) => set("willingToRelocate", next)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <WizardField id="cw-industries" label="Preferred industries">
          <TagInput id="cw-industries" label="preferred industries" values={values.preferredIndustries} onChange={(next) => set("preferredIndustries", next)} suggestions={INDUSTRY_SUGGESTIONS} placeholder="Banking…" />
        </WizardField>
        <WizardField id="cw-dealbreakers" label="Deal breakers">
          <TagInput id="cw-dealbreakers" label="deal breakers" values={values.dealBreakers} onChange={(next) => set("dealBreakers", next)} suggestions={DEAL_BREAKER_SUGGESTIONS} placeholder="No onsite…" />
        </WizardField>
      </div>

      <WizardField id="cw-notes" label="Notes for the BDE" hint="How they like to be contacted, interview windows, anything personal.">
        <textarea {...fieldAria("cw-notes", undefined, true)} rows={3} maxLength={NOTE_MAX_LENGTH} value={values.contactNotes} onChange={(event) => set("contactNotes", event.target.value)} placeholder="Prefers WhatsApp. Not available for interviews before 9 AM CT." className="bq-input h-auto w-full py-2" />
      </WizardField>
    </div>
  );
}
