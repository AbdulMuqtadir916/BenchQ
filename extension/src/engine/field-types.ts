import type { FieldType } from "./ats-autofill-engine/core/taxonomy/field-type";
import type { FieldKind } from "./universal-ai-autofill/taxonomy";

/** One name for every field the merged engine knows: ats-autofill-engine's taxonomy plus what it lacks and
 * universal-ai-autofill or the QA bank add. */
export type EngineFieldType =
  | FieldType
  | "phone-country-code" | "city-state" | "notice-period" | "todays-date" | "citizenship" | "visa-type"
  | "work-auth-expiry" | "preferred-locations" | "education-school" | "education-degree" | "graduation-year"
  | "date-of-birth" | "nationality" | "pronouns" | "references" | "password" | "username"
  | "eeo-hispanic" | "eeo-orientation" | "eeo-transgender" | "referral-source" | "over-18" | "lives-in-us"
  | "minimum-experience" | "accommodations" | "essential-functions" | "criminal-history" | "background-check" | "drug-test"
  | "security-clearance" | "non-compete" | "government-work" | "relative-at-company" | "former-employee" | "onsite-work"
  | "willing-to-travel" | "commute" | "languages" | "current-pay" | "pay-rate" | "job-applied";

/** universal-ai-autofill's field kinds, in the merged names. */
export const KIND_TO_TYPE: Partial<Record<FieldKind, EngineFieldType>> = {
  fullName: "full-name", firstName: "first-name", lastName: "last-name", middleName: "middle-name", email: "email",
  phone: "phone", addressLine1: "address-line1", addressLine2: "address-line2", city: "address-city",
  state: "address-region", country: "address-country", zip: "address-postal", linkedin: "linkedin-url",
  github: "github-url", portfolio: "portfolio-url", website: "website", company: "current-company",
  jobTitle: "current-title", college: "education-school", degree: "education-degree",
  graduationYear: "graduation-year", dateOfBirth: "date-of-birth", nationality: "nationality", gender: "eeo-gender",
  password: "password", username: "username", salary: "salary-expectation", coverLetter: "cover-letter",
  yearsExperience: "years-experience", pronouns: "pronouns", location: "city-state",
  workAuthorization: "work-authorization", sponsorship: "visa-sponsorship", noticePeriod: "notice-period",
  startDate: "start-date", relocate: "relocation-willing", references: "references", veteranStatus: "eeo-veteran",
  disabilityStatus: "eeo-disability", ethnicity: "eeo-race",
};

const CONSENT = "Consent or legal statement";
const UPLOAD = "File upload";

/** Fields that stay manual however sure the engine is. autofill/never-fill.ts is the first line; this catches what
 * only the classifier recognises. */
const MANUAL_ONLY: Partial<Record<EngineFieldType, string>> = {
  "consent-privacy": CONSENT, "consent-marketing": CONSENT,
  "resume-upload": UPLOAD, "portfolio-upload": UPLOAD, "transcript-upload": UPLOAD,
  "date-of-birth": "Date of birth or age", password: "Password", username: "Account details",
};

export const manualOnlyReason = (type: EngineFieldType): string | null => MANUAL_ONLY[type] ?? null;
