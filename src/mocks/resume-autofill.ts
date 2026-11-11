import { ApiError } from "@/lib/api/client";
import { WORK_AUTH_LABEL } from "@/lib/constants/work-auth";
import type { Candidate } from "@/lib/schemas/candidate";
import type { EmploymentType, RemoteMode } from "@/lib/schemas/enums";
import type { AutofillAnswer, AutofillAnswerType, AutofillChange, AutofillEntry } from "@/lib/schemas/resume-autofill";
import type { ResumeDocument } from "@/lib/schemas/resume-document";

/**
 * The mock's Autofill screen (docs/02 §8.3): the backend's fixed questions in its order (backend/candidates/autofill.py
 * `QUESTIONS`, `ANSWER_TYPES`), answered from the version's text and the candidate's profile as the backend answers
 * them, and the user's entries held in memory by version. A save changes the open version only; the backend also reaches the rest of the
 * résumé (07 Q30).
 */
export const MOCK_QUESTIONS: readonly (readonly [key: string, question: string, type: AutofillAnswerType])[] = [
  ["full-name", "What is your full name?", "text"],
  ["email", "What is your email address?", "text"],
  ["phone", "What is your phone number?", "text"],
  ["linkedin-url", "What is your LinkedIn profile URL?", "text"],
  ["github-url", "What is your GitHub profile URL?", "text"],
  ["address-city", "Which city do you live in?", "text"],
  ["address-region", "Which state do you live in?", "text"],
  ["address-country", "Which country do you live in?", "text"],
  ["professional-title", "What is your professional title?", "text"],
  ["summary", "Give a short professional summary.", "text"],
  ["work-auth-status", "What is your work authorization?", "text"],
  ["skills", "What are your skills?", "texts"],
  ["current-company", "Who is your current or most recent employer?", "text"],
  ["current-title", "What is your current or most recent job title?", "text"],
  ["work-history", "List your work experience.", "entries"],
  ["education-degree", "What is your highest degree?", "text"],
  ["education-field", "What did you study?", "text"],
  ["education-school", "Which school did you attend?", "text"],
  ["graduation-year", "What year did you graduate?", "number"],
  ["education-grade", "What was your GPA?", "text"],
  ["education-history", "List your education.", "entries"],
  ["projects", "List your projects.", "entries"],
  ["awards", "Which awards have you received?", "entries"],
  ["certifications", "Which certifications do you have?", "texts"],
  ["languages", "Which languages do you speak?", "texts"],
  ["work-auth-expiry", "When does your work authorization expire?", "date"],
  ["visa-sponsorship", "Will you now or in the future require visa sponsorship?", "boolean"],
  ["visa-transfer", "Do you need a visa transfer?", "boolean"],
  ["years-experience", "How many years of experience do you have?", "number"],
  ["primary-role", "What is your primary role?", "text"],
  ["target-roles", "What roles are you looking for?", "texts"],
  ["pay-rate", "What is your expected rate?", "number"],
  ["start-date", "When can you start?", "date"],
  ["notice-period-days", "What is your notice period in days?", "number"],
  ["relocation-willing", "Are you willing to relocate?", "boolean"],
  ["employment-types", "Which employment types are you open to?", "texts"],
  ["work-settings", "Do you prefer remote, hybrid or on-site work?", "texts"],
  ["preferred-locations", "Which locations do you prefer?", "texts"],
  ["preferred-industries", "Which industries do you prefer?", "texts"],
  // Personal and screening questions: never built, as on the backend (citizenship aside); the BDE adds the answer.
  ["preferred-name", "What is your preferred name?", "text"],
  ["middle-name", "What is your middle name?", "text"],
  ["address-line1", "What is your street address?", "text"],
  ["address-line2", "What is your apartment, suite or unit?", "text"],
  ["address-postal", "What is your ZIP or postal code?", "text"],
  ["portfolio-url", "What is your portfolio or personal website?", "text"],
  ["citizenship", "Are you a US citizen?", "boolean"],
  ["nationality", "What is your nationality?", "text"],
  ["current-pay", "What is your current pay rate?", "text"],
  ["salary-expectation", "What is your expected annual salary?", "number"],
  ["onsite-work", "Are you willing to work on-site?", "boolean"],
  ["willing-to-travel", "Are you willing to travel for work?", "text"],
  ["commute", "Can you commute to the job's location?", "boolean"],
  ["over-18", "Are you at least 18 years old?", "boolean"],
  ["criminal-history", "Have you ever been convicted of a crime?", "boolean"],
  ["background-check", "Are you willing to undergo a background check?", "boolean"],
  ["drug-test", "Are you willing to take a drug test?", "boolean"],
  ["security-clearance", "Do you hold an active security clearance?", "text"],
  ["non-compete", "Are you bound by a non-compete agreement?", "boolean"],
  ["government-work", "Have you ever worked for a government agency?", "boolean"],
  ["relative-at-company", "Do you have relatives who work at the company?", "boolean"],
  ["former-employee", "Have you worked for the company before?", "boolean"],
  ["accommodations", "Do you need accommodations during the hiring process?", "boolean"],
  ["essential-functions", "Can you perform the job's essential functions, with or without reasonable accommodation?", "boolean"],
  // Voluntary self-identification: never built, as on the backend; the BDE adds the candidate's answer.
  ["gender", "What is your gender?", "text"],
  ["pronouns", "What are your pronouns?", "text"],
  ["race", "What is your race or ethnicity?", "text"],
  ["hispanic-latino", "Are you Hispanic or Latino?", "text"],
  ["veteran-status", "What is your veteran status?", "text"],
  ["disability-status", "Do you have a disability?", "text"],
  ["sexual-orientation", "What is your sexual orientation?", "text"],
  ["transgender", "Do you identify as transgender?", "text"],
];

type Stored = { edited: Map<string, { answer: AutofillAnswer; over: AutofillAnswer }>; custom: { question: string; also: string[]; answer: string }[] };

const stored = new Map<string, Stored>();
function storeOf(versionId: string): Stored {
  const found = stored.get(versionId);
  if (found) return found;
  const fresh: Stored = { edited: new Map(), custom: [] };
  stored.set(versionId, fresh);
  return fresh;
}

const text = (value: string | null | undefined) => value?.trim() || null;
/** The subject a degree line names after the degree, as the backend reads it ("B.Tech in CSE" is "CSE"); none guessed. */
const fieldOf = (degree: string | null | undefined) => text(degree?.split(/\s+in\s+|\s*,\s+|\s+[-–—:]\s+/i).slice(1).join(" ").replace(/\s*\([^)]*\)\s*$/, ""));
const texts = (values: (string | null | undefined)[]) => {
  const kept = values.map((value) => value?.trim() ?? "").filter(Boolean);
  return kept.length ? kept : null;
};
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** How the backend writes the profile's lists (backend/candidates/autofill.py `EMPLOYMENT_LABEL`, `WORK_SETTING_LABEL`). */
const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { C2C: "C2C", W2: "W2", TEEN99: "1099", FTE: "Full-time" };
const WORK_SETTING_LABEL: Record<RemoteMode, string> = { REMOTE: "Remote", HYBRID: "Hybrid", ONSITE: "On-site" };
/** A stored moment as the day it names in UTC, "YYYY-MM-DD", as the backend writes a date answer. */
const day = (value: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/** The profile's answers, as the backend builds them from the candidate (backend/candidates/autofill.py `_answers`).
 * One difference: the backend counts the years from the résumé's jobs first, and the mock takes the profile's. */
function profileAnswers(candidate: Candidate): Record<string, AutofillAnswer> {
  return {
    "work-auth-status": WORK_AUTH_LABEL[candidate.workAuth],
    "work-auth-expiry": day(candidate.workAuthExpiry),
    "visa-sponsorship": candidate.needsSponsorship,
    "visa-transfer": candidate.needsTransfer,
    "years-experience": candidate.yearsExperience,
    "primary-role": text(candidate.primaryRole),
    "target-roles": texts(candidate.targetRoles),
    "pay-rate": candidate.rateTarget,
    "start-date": day(candidate.availableFrom),
    "notice-period-days": candidate.noticePeriodDays,
    "relocation-willing": candidate.willingToRelocate,
    "employment-types": texts(candidate.employmentTypes.map((type) => EMPLOYMENT_LABEL[type])),
    "work-settings": texts(candidate.workSettings.map((setting) => WORK_SETTING_LABEL[setting])),
    "preferred-locations": texts(candidate.preferredLocations),
    "preferred-industries": texts(candidate.preferredIndustries),
  };
}

function builtAnswers(doc: ResumeDocument, candidate: Candidate | undefined): Record<string, AutofillAnswer> {
  const latest = doc.experience.find((job) => job.current) ?? doc.experience[0];
  const school = doc.education[0];
  const records = <T,>(rows: T[], pick: (row: T) => Record<string, string>) => (rows.length ? rows.map(pick) : null);
  return {
    "full-name": text(doc.fullName), email: text(doc.header.email), phone: text(doc.header.phone),
    "linkedin-url": text(doc.header.linkedin), "github-url": text(doc.header.github), "address-city": text(doc.header.city),
    "address-region": text(doc.header.state), "address-country": text(doc.header.country), "professional-title": text(doc.title),
    summary: text(plain(doc.summary.html)),
    skills: texts(doc.skills.flatMap((row) => row.items.split(","))), "current-company": text(latest?.company),
    "current-title": text(latest?.title),
    "work-history": records(doc.experience, ({ company, title, dates }) => ({ company, title, dates })),
    "education-degree": text(school?.degree), "education-field": fieldOf(school?.degree), "education-school": text(school?.school),
    "education-grade": text(school?.grade),
    "education-history": records(doc.education, ({ degree, school: name, graduationDate }) => ({ degree, school: name, graduationDate })),
    projects: records(doc.projects, ({ name }) => ({ name })),
    awards: records(doc.awards, ({ name, issuer }) => ({ name, issuer })),
    certifications: texts(doc.certifications.map(({ name }) => name)),
    ...(candidate ? profileAnswers(candidate) : {}),
  };
}

const same = (left: AutofillAnswer | undefined, right: AutofillAnswer | undefined) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
/** As the backend compares questions (07 Q43): without capitals, spacing or punctuation. */
export const wordingOf = (question: string) => question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");

export function mockAutofill(versionId: string, doc: ResumeDocument, candidate: Candidate | undefined): AutofillEntry[] {
  const answers = builtAnswers(doc, candidate);
  const { edited, custom } = storeOf(versionId);
  const fixed = MOCK_QUESTIONS.map(([key, question, type]): AutofillEntry => {
    const answer = answers[key] ?? null;
    const edit = edited.get(key);
    if (edit && same(edit.over, answer)) return { question, answer: edit.answer, kind: "EDITED", key, type, built: answer, also: [] };
    return { question, answer, kind: "FIXED", key, type, also: [], ...(edit ? { replaced: edit.answer } : {}) };
  });
  const shown = new Set(fixed.filter(({ answer }) => answer !== null).map(({ question }) => question));
  const own = custom.filter(({ question }) => !shown.has(question))
    .map(({ question, also, answer }): AutofillEntry => ({ question, answer, kind: "CUSTOM", key: null, type: null, also }));
  return [...fixed, ...own];
}

const refused = (message: string) => new ApiError(message, "VALIDATION", 400);

/** The mock's save, with the backend's main refusals: an unknown key, a list answer, a question in a fixed one's words,
 * and an edit over a built answer the user wasn't shown (409). */
export function applyMockChange(versionId: string, doc: ResumeDocument, candidate: Candidate | undefined, change: AutofillChange): void {
  const answers = builtAnswers(doc, candidate);
  const types = new Map(MOCK_QUESTIONS.map(([key, , type]) => [key, type]));
  const fixed = new Set(MOCK_QUESTIONS.map(([, question]) => wordingOf(question)));
  const store = storeOf(versionId);
  for (const key of Object.keys(change.edit)) {
    const type = types.get(key);
    if (!type) throw refused(`No question has the key '${key}'.`);
    if (type === "entries") throw refused("Change it in the résumé itself.");
    if (!same(change.built[key], answers[key] ?? null)) throw new ApiError("An answer changed since you opened this page. Reload it and make your change again.", "CONFLICT", 409);
  }
  for (const question of Object.keys(change.add)) {
    if (fixed.has(wordingOf(question))) throw refused(`'${question}' is one of BenchQ's own questions: change its answer instead.`);
  }
  for (const [key, answer] of Object.entries(change.edit)) {
    if (same(answer, answers[key] ?? null)) store.edited.delete(key);
    else store.edited.set(key, { answer, over: answers[key] ?? null });
  }
  for (const key of change.reset) store.edited.delete(key);
  for (const [question, answer] of Object.entries(change.add)) {
    const found = store.custom.find((entry) => [entry.question, ...entry.also].some((asked) => wordingOf(asked) === wordingOf(question)));
    if (found) found.answer = answer;
    else store.custom.push({ question: question.trim(), also: [], answer: answer.trim() });
  }
  store.custom = store.custom.filter((entry) => !change.remove.some((question) => wordingOf(question) === wordingOf(entry.question)));
}
