"use client";

import { UserRound } from "lucide-react";
import { DEAL_BREAKER_SUGGESTIONS, INDUSTRY_SUGGESTIONS, LOCATION_SUGGESTIONS, NOTE_MAX_LENGTH } from "@/lib/constants/candidate-intake";
import type { RemoteMode } from "@/lib/schemas/enums";
import { ChoicePill, fieldAria, WizardField } from "./field";
import { SwitchRow } from "./parts";
import { TagInput } from "./tag-input";
import type { Wizard } from "./use-wizard";

const WORK_SETTINGS: { value: RemoteMode; label: string }[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
];

/**
 * Step 4 (04-wizard-steps.md §3): what the candidate wants. Every field is optional ("Skip for now"). Work setting,
 * preferred locations and the notes are provisional fields (07 Q50).
 */
export function StepPreferences({ wizard }: { wizard: Wizard }) {
  const { values, set } = wizard;
  const roleSuggestions = [values.primaryRole.trim()].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] pb-4">
        <span className="bq-card inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--color-primary)]"><UserRound size={15} aria-hidden /></span>
        <div>
          <h3 className="text-h3 text-[var(--color-text)]">Candidate preferences</h3>
          <p className="text-caption text-[var(--color-text-3)]">What they told you on the intake call.</p>
        </div>
      </div>

      <WizardField id="cw-target-roles" label="Target roles" hint="Jobs are matched against every title here.">
        <TagInput id="cw-target-roles" label="target roles" describedBy="cw-target-roles-hint" values={values.targetRoles} onChange={(next) => set("targetRoles", next)} suggestions={roleSuggestions} placeholder="Senior Java Developer…" />
      </WizardField>

      <fieldset className="space-y-1.5">
        <legend className="text-label text-[var(--color-text-2)]">Work setting</legend>
        <div className="flex flex-wrap gap-2">
          {WORK_SETTINGS.map(({ value, label }) => (
            <ChoicePill key={value} label={label} checked={values.workSettings.includes(value)} onChange={(isOn) => set("workSettings", isOn ? [...values.workSettings, value] : values.workSettings.filter((item) => item !== value))} />
          ))}
        </div>
      </fieldset>

      <WizardField id="cw-locations" label="Preferred locations">
        <TagInput id="cw-locations" label="preferred locations" values={values.preferredLocations} onChange={(next) => set("preferredLocations", next)} suggestions={LOCATION_SUGGESTIONS} placeholder="City, state" />
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
