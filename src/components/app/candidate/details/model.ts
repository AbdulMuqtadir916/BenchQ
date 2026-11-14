import { EMPTY_VALUES, validateStep, type Errors, type WizardValues } from "@/components/app/candidate-wizard/model";
import { workAuthChange } from "@/lib/constants/work-auth";
import type { Candidate, UpdateCandidate } from "@/lib/schemas/candidate";

/**
 * The "Additional candidate details" tab's form (decided 2026-11-14, Q15–Q20, Q24): every onboarding answer that isn't
 * on the résumé, held as the new-candidate flow holds it (text fields as strings) so the flow's steps 3 and 4 edit it.
 * The résumé's city and state come along read-only: with a preferred location they are the job search's places. Pure,
 * so it is tested without rendering.
 */

/** A stored date as a date box shows it: its UTC day (what was picked), whatever the viewer's timezone. */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
/** A picked day saved at noon UTC, so it reads as the same day in every timezone (as the Submission facts did); the
 *  stored value itself when the day wasn't changed, so an untouched date isn't an edit. */
const fromDateInput = (value: string, stored: string | null) =>
  value === toDateInput(stored) ? stored : value ? `${value}T12:00:00.000Z` : null;
const toText = (value: number | null) => (value === null ? "" : String(value));
const asNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));

export function detailsValues(candidate: Candidate): WizardValues {
  return {
    ...EMPTY_VALUES,
    primaryRole: candidate.primaryRole ?? "",
    yearsExperience: toText(candidate.yearsExperience),
    city: candidate.city ?? "",
    state: candidate.state ?? "",
    country: candidate.country ?? "",
    workAuth: candidate.workAuth,
    workAuthExpiry: toDateInput(candidate.workAuthExpiry),
    employmentTypes: candidate.employmentTypes,
    rateTarget: toText(candidate.rateTarget),
    rateMin: toText(candidate.rateMin),
    availableFrom: toDateInput(candidate.availableFrom),
    noticePeriodDays: toText(candidate.noticePeriodDays),
    // One box (Q24): a candidate from before with several roles shows the first; saving keeps only that one.
    targetRole: candidate.targetRoles[0] ?? "",
    workSettings: candidate.workSettings,
    preferredLocations: candidate.preferredLocations,
    willingToRelocate: candidate.willingToRelocate,
    preferredIndustries: candidate.preferredIndustries,
    dealBreakers: candidate.dealBreakers,
    contactNotes: candidate.contactNotes ?? "",
  };
}

/** The form's problems, by field: onboarding's own rules (Q20) for these fields, the place named as the résumé's. */
export function validateDetails(values: WizardValues): Errors {
  const basic = validateStep("basic", values);
  const errors: Errors = { ...validateStep("work", values), ...validateStep("preferences", values, { homeFrom: "resume" }) };
  if (basic.primaryRole) errors.primaryRole = basic.primaryRole;
  if (basic.yearsExperience) errors.yearsExperience = basic.yearsExperience;
  return errors;
}

/** The edit to send: every field of the form (the backend records only what changed), once `validateDetails` is empty. */
export function toUpdate(candidate: Candidate, values: WizardValues): UpdateCandidate {
  const workAuth = values.workAuth ?? candidate.workAuth;
  return {
    primaryRole: values.primaryRole.trim(),
    targetRoles: [values.targetRole.trim()],
    yearsExperience: asNumber(values.yearsExperience) ?? 0,
    // A changed status carries the sponsorship and transfer it implies, as in the flow; the same one sends nothing.
    ...workAuthChange(candidate.workAuth, workAuth),
    workAuthExpiry: fromDateInput(values.workAuthExpiry, candidate.workAuthExpiry),
    employmentTypes: values.employmentTypes,
    rateTarget: asNumber(values.rateTarget),
    rateMin: asNumber(values.rateMin),
    availableFrom: fromDateInput(values.availableFrom, candidate.availableFrom),
    noticePeriodDays: asNumber(values.noticePeriodDays),
    workSettings: values.workSettings,
    preferredLocations: values.preferredLocations,
    willingToRelocate: values.willingToRelocate,
    preferredIndustries: values.preferredIndustries,
    dealBreakers: values.dealBreakers,
    contactNotes: values.contactNotes.trim() === "" ? null : values.contactNotes.trim(),
  };
}

/** Anything changed since the form was filled from the candidate. */
export function isChanged(candidate: Candidate, values: WizardValues): boolean {
  return JSON.stringify(values) !== JSON.stringify(detailsValues(candidate));
}
