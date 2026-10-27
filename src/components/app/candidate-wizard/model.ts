import { z } from "zod";
import { NEEDS_SPONSOR } from "@/components/app/work-auth-chip";
import type { CreateCandidate } from "@/lib/schemas/candidate";
import type { EmploymentType, FieldSource, RemoteMode, WorkAuth } from "@/lib/schemas/enums";
import type { ResumeDraft } from "@/lib/schemas/resume-draft";

/**
 * The new-candidate flow's state and rules (docs/candidate-onboarding/04-wizard-steps.md): the values as the form
 * holds them (text fields as strings), which were drafted from the résumé, per-step validation, and the create
 * payload. Pure, so it is tested without rendering.
 */

export const STEPS = [
  { id: "resume", label: "Resume" },
  { id: "basic", label: "Basic details" },
  { id: "work", label: "Work & rate" },
  { id: "preferences", label: "Preferences" },
  { id: "assign", label: "Assign BDE" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];
export const StepIdSchema = z.enum(STEPS.map((step) => step.id) as [StepId, ...StepId[]]);

export interface WizardSkill {
  name: string;
  family: string | null;
  /** Where it came from: the résumé, or typed in (07 Q49: stored UNVERIFIED with this source). */
  source: Extract<FieldSource, "RESUME_UPLOAD" | "MANUAL">;
}

export interface WizardValues {
  resume: { parseId: string; fileName: string } | null;
  fullName: string;
  primaryRole: string;
  yearsExperience: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  city: string;
  state: string;
  skills: WizardSkill[];
  summary: string;
  workAuth: WorkAuth | null;
  /** The résumé's printed status when it matched none of the nine (shown under the cards). */
  workAuthText: string | null;
  workAuthExpiry: string;
  employmentTypes: EmploymentType[];
  rateTarget: string;
  rateMin: string;
  availableFrom: string;
  noticePeriodDays: string;
  targetRoles: string[];
  workSettings: RemoteMode[];
  preferredLocations: string[];
  willingToRelocate: boolean;
  preferredIndustries: string[];
  dealBreakers: string[];
  contactNotes: string;
  /** Step 5 (07 Q41): the candidate's manager, its BDE (null = the manager's "Needs a BDE" queue) and the handoff note. */
  managerId: string;
  bdeId: string | null;
  handoffNote: string;
}

/** The fields the parser can fill, and so can carry the "Drafted from résumé" marker. */
export const DRAFTABLE = ["fullName", "primaryRole", "yearsExperience", "email", "phone", "linkedinUrl", "city", "state", "skills", "summary", "workAuth"] as const;
export type DraftableField = (typeof DRAFTABLE)[number];

export const EMPTY_VALUES: WizardValues = {
  resume: null, fullName: "", primaryRole: "", yearsExperience: "", email: "", phone: "", linkedinUrl: "", city: "", state: "",
  skills: [], summary: "", workAuth: null, workAuthText: null, workAuthExpiry: "", employmentTypes: ["C2C"], rateTarget: "",
  rateMin: "", availableFrom: "", noticePeriodDays: "", targetRoles: [], workSettings: [], preferredLocations: [],
  willingToRelocate: false, preferredIndustries: [], dealBreakers: [], contactNotes: "", managerId: "", bdeId: null,
  handoffNote: "",
};

const isBlank = (value: unknown) => value === "" || value === null || (Array.isArray(value) && value.length === 0);

/**
 * Fill the form from a résumé draft. Only empty fields are filled, so nothing typed is overwritten; the filled ones
 * are returned as drafted. Skills are merged (new names only).
 */
export function applyDraft(values: WizardValues, draft: ResumeDraft): { values: WizardValues; drafted: DraftableField[] } {
  const next: WizardValues = { ...values, resume: { parseId: draft.parseId, fileName: draft.fileName } };
  const drafted: DraftableField[] = [];
  const fill = <K extends Exclude<DraftableField, "skills">>(field: K, value: WizardValues[K] | null) => {
    if (value === null || isBlank(value) || !isBlank(values[field])) return;
    next[field] = value;
    drafted.push(field);
  };
  fill("fullName", draft.fullName);
  fill("primaryRole", draft.primaryRole);
  fill("yearsExperience", draft.yearsExperience === null ? null : String(draft.yearsExperience));
  fill("email", draft.email);
  fill("phone", draft.phone);
  fill("linkedinUrl", draft.linkedinUrl);
  fill("city", draft.city);
  fill("state", draft.state);
  fill("summary", draft.summary);
  fill("workAuth", draft.workAuth);
  if (values.workAuth === null) next.workAuthText = draft.workAuthText;
  const known = new Set(values.skills.map((skill) => skill.name.toLowerCase()));
  const added = draft.skills.filter((skill) => !known.has(skill.name.toLowerCase())).map((skill): WizardSkill => ({ ...skill, source: "RESUME_UPLOAD" }));
  if (added.length > 0) {
    next.skills = [...values.skills, ...added];
    drafted.push("skills");
  }
  return { values: next, drafted };
}

export type Errors = Partial<Record<keyof WizardValues, string>>;

const asNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));
const isWhole = (value: number | null, min: number, max: number) => value === null || (Number.isInteger(value) && value >= min && value <= max);

/**
 * The step's problems, by field; empty when it may continue. Steps without required fields never block. On step 5 a
 * MANAGER must pick a BDE (`requiresBde`, 07 Q41); the OWNER may leave the candidate in the manager's queue.
 */
export function validateStep(step: StepId, values: WizardValues, context: { requiresBde?: boolean } = {}): Errors {
  const errors: Errors = {};
  if (step === "assign") {
    if (!values.managerId) errors.managerId = "Choose the manager.";
    else if (context.requiresBde && values.bdeId === null) errors.bdeId = "Choose the BDE who will work this candidate.";
  }
  if (step === "basic") {
    if (!values.fullName.trim()) errors.fullName = "Enter the candidate's name.";
    if (!values.primaryRole.trim()) errors.primaryRole = "Enter the title they're marketed as.";
    if (!values.email.trim()) errors.email = "Enter their email.";
    else if (!z.string().email().safeParse(values.email.trim()).success) errors.email = "Enter a valid email, like name@example.com.";
    if (!isWhole(asNumber(values.yearsExperience), 0, 60)) errors.yearsExperience = "Years of experience is a whole number from 0 to 60.";
    if (values.linkedinUrl.trim() && !z.string().url().safeParse(values.linkedinUrl.trim()).success) errors.linkedinUrl = "Enter the full link, starting with https://.";
  }
  if (step === "work") {
    if (values.workAuth === null) errors.workAuth = "Choose their work authorization.";
    if (values.employmentTypes.length === 0) errors.employmentTypes = "Choose at least one engagement type.";
    const target = asNumber(values.rateTarget);
    const floor = asNumber(values.rateMin);
    if (target !== null && !(target > 0)) errors.rateTarget = "Enter an hourly rate in US dollars.";
    if (floor !== null && !(floor > 0)) errors.rateMin = "Enter an hourly rate in US dollars.";
    else if (target !== null && floor !== null && floor > target) errors.rateMin = "The floor can't be above the target rate.";
    if (!isWhole(asNumber(values.noticePeriodDays), 0, 365)) errors.noticePeriodDays = "Notice is a whole number of days, 0 to 365.";
  }
  return errors;
}

/** The first step that can't be passed yet, at or before `requested` (a reload starts empty: no drafts, Q48). */
export function firstOpenStep(requested: StepId, values: WizardValues): StepId {
  // Nothing entered (a reload, or just after creating one): start where the flow starts.
  if (!isDirty(values)) return "resume";
  for (const step of STEPS) {
    if (step.id === requested) return requested;
    if (Object.keys(validateStep(step.id, values)).length > 0) return step.id;
  }
  return requested;
}

/** The assignment is chosen on step 5, not typed in, so picking one alone doesn't make the flow dirty. */
const CHOSEN: readonly (keyof WizardValues)[] = ["managerId", "bdeId"];

/** Anything entered at all, so closing asks first (Q48). */
export function isDirty(values: WizardValues): boolean {
  return (Object.keys(EMPTY_VALUES) as (keyof WizardValues)[]).some((field) => !CHOSEN.includes(field) && JSON.stringify(values[field]) !== JSON.stringify(EMPTY_VALUES[field]));
}

const toIsoDate = (value: string): string | null => (value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null);
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** The create payload (docs/02 §4), once every step is valid. Sponsorship and transfer follow the work authorization (README A3). */
export function toCreateCandidate(values: WizardValues): CreateCandidate {
  const workAuth = values.workAuth ?? "OTHER";
  return {
    fullName: values.fullName.trim(),
    primaryRole: values.primaryRole.trim(),
    email: values.email.trim(),
    phone: orNull(values.phone),
    linkedinUrl: orNull(values.linkedinUrl),
    city: orNull(values.city),
    state: orNull(values.state),
    yearsExperience: asNumber(values.yearsExperience),
    workAuth,
    workAuthExpiry: toIsoDate(values.workAuthExpiry),
    needsSponsorship: NEEDS_SPONSOR.includes(workAuth),
    needsTransfer: workAuth === "H1B",
    employmentTypes: values.employmentTypes,
    rateTarget: asNumber(values.rateTarget),
    rateMin: asNumber(values.rateMin),
    availableFrom: toIsoDate(values.availableFrom),
    noticePeriodDays: asNumber(values.noticePeriodDays),
    targetRoles: values.targetRoles,
    willingToRelocate: values.willingToRelocate,
    workSettings: values.workSettings,
    preferredLocations: values.preferredLocations,
    contactNotes: orNull(values.contactNotes),
    summary: orNull(values.summary),
    skills: values.skills,
    preferredIndustries: values.preferredIndustries,
    dealBreakers: values.dealBreakers,
    resumeParseId: values.resume?.parseId ?? null,
    managerId: values.managerId,
    bdeId: values.bdeId,
    handoffNote: orNull(values.handoffNote),
  };
}
