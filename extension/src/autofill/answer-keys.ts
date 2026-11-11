import type { EngineFieldType } from "../engine/field-types";

/** What each fixed question of a résumé's autofill asks, by its key (docs/02 §8.1; the questions are
 * backend/candidates/autofill.py `QUESTIONS`). An answer with a key finds a form's field by what it asks, however the
 * question is worded, so a new question on the backend needs no new pattern here: only a line in this table.
 *
 * - A key mapped to a field kind answers the fields of that kind.
 * - A key mapped to null is matched by its wording only, like a saved question: no field kind says the same thing, and
 *   reading its wording as one would misread it ("What is your professional title?" isn't the job held).
 * - A key missing here (one the backend adds later) is read by its wording too, until a line is added; a test
 *   (`answer-keys.test.ts`) fails until it is.
 * - Lists of jobs, schools, projects and awards answer no one field, so they never get this far; they're listed, as
 *   null, so the table names every key. */

/** Worked out in the extension from a résumé's answers (`resume-answers.ts`) or the job (`job-site.ts`); the backend
 * never sends these keys. */
export const WORK_AUTHORIZED = "benchq:work-authorized";
export const LOCATION = "benchq:location";
export const REFERRAL = "benchq:referral-source";

export const KEY_TYPES: Record<string, EngineFieldType | null> = {
  "full-name": "full-name",
  email: "email",
  phone: "phone",
  "linkedin-url": "linkedin-url",
  "github-url": "github-url",
  "address-city": "address-city",
  "address-region": "address-region",
  "address-country": "address-country",
  // The résumé's headline. "Current job title" is the job held, `current-title`.
  "professional-title": null,
  summary: null,
  // "H-1B" says which status, so it answers "Visa status". "Are you authorized to work?" takes WORK_AUTHORIZED.
  "work-auth-status": "visa-type",
  skills: null,
  "current-company": "current-company",
  "current-title": "current-title",
  // Lists of objects: `resume-answers.ts` leaves them out.
  "work-history": null,
  "education-history": null,
  projects: null,
  awards: null,
  "education-degree": "education-degree",
  // No field kind of their own: "Field of study", "Major", "GPA"… are the backend's wordings for them (`also`, 07 Q35).
  "education-field": null,
  "education-school": "education-school",
  "graduation-year": "graduation-year",
  "education-grade": null,
  certifications: null,
  languages: "languages",
  "work-auth-expiry": "work-auth-expiry",
  "visa-sponsorship": "visa-sponsorship",
  "visa-transfer": null,
  "years-experience": "years-experience",
  "primary-role": null,
  "target-roles": null,
  "pay-rate": "pay-rate",
  "start-date": "start-date",
  "notice-period-days": "notice-period",
  "relocation-willing": "relocation-willing",
  "employment-types": null,
  "work-settings": null,
  "preferred-locations": "preferred-locations",
  "preferred-industries": null,
  // Personal and screening questions the BDE answers on the Autofill screen (decided 2026-11-11), each the kind of field
  // the extension already knows.
  "preferred-name": "preferred-name",
  "middle-name": "middle-name",
  "address-line1": "address-line1",
  "address-line2": "address-line2",
  "address-postal": "address-postal",
  "portfolio-url": "portfolio-url",
  citizenship: "citizenship",
  nationality: "nationality",
  "current-pay": "current-pay",
  "salary-expectation": "salary-expectation",
  "onsite-work": "onsite-work",
  "willing-to-travel": "willing-to-travel",
  commute: "commute",
  "over-18": "over-18",
  "criminal-history": "criminal-history",
  "background-check": "background-check",
  "drug-test": "drug-test",
  "security-clearance": "security-clearance",
  "non-compete": "non-compete",
  "government-work": "government-work",
  "relative-at-company": "relative-at-company",
  "former-employee": "former-employee",
  accommodations: "accommodations",
  "essential-functions": "essential-functions",
  // Voluntary self-identification: kept out of the form saved with an application, like every self-ID answer.
  gender: "eeo-gender",
  pronouns: "pronouns",
  race: "eeo-race",
  "hispanic-latino": "eeo-hispanic",
  "veteran-status": "eeo-veteran",
  "disability-status": "eeo-disability",
  "sexual-orientation": "eeo-orientation",
  transgender: "eeo-transgender",
  [WORK_AUTHORIZED]: "work-authorization",
  [LOCATION]: "city-state",
  [REFERRAL]: "referral-source",
};

/** The field kind a key answers: undefined when the key isn't in the table, so its wording decides. */
export const typeOfKey = (key: string): EngineFieldType | null | undefined =>
  Object.prototype.hasOwnProperty.call(KEY_TYPES, key) ? KEY_TYPES[key] : undefined;
