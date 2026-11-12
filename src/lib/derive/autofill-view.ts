import type { AutofillAnswer, AutofillEntry } from "@/lib/schemas/resume-autofill";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";

/**
 * How the Autofill tab lays out a version's answers (docs/04): by topic, in the order the backend asks them, with what
 * the extension writes on a form for each answer, how many are answered, and the filters. Pure, so the rules are tested
 * without rendering the tab. A question of the user's own (CUSTOM) is in "Your questions"; an edit the résumé or the
 * profile replaced (07 Q15) is in "Needs a look", first.
 */

export type AutofillTopicId =
  | "review" | "contact" | "location" | "authorization" | "experience" | "education" | "skills" | "preferences" | "screening"
  | "self-id" | "other" | "custom";

export const AUTOFILL_TOPICS: ReadonlyArray<{ id: AutofillTopicId; title: string }> = [
  { id: "review", title: "Needs a look" },
  { id: "contact", title: "Contact" },
  { id: "location", title: "Location" },
  { id: "authorization", title: "Work authorization" },
  { id: "experience", title: "Experience" },
  { id: "education", title: "Education" },
  { id: "skills", title: "Skills and languages" },
  { id: "preferences", title: "Rate and preferences" },
  { id: "screening", title: "Background and screening" },
  { id: "self-id", title: "Self-identification (voluntary)" },
  { id: "other", title: "Other questions" },
  { id: "custom", title: "Your questions" },
];

/** Each of BenchQ's questions by its key (docs/02 §8.1). A key added later shows under "Other questions". */
const TOPIC_OF_KEY: Record<string, AutofillTopicId> = {
  "full-name": "contact", email: "contact", phone: "contact", "linkedin-url": "contact", "github-url": "contact",
  "address-city": "location", "address-region": "location", "address-country": "location",
  "work-auth-status": "authorization", "work-auth-expiry": "authorization", "visa-sponsorship": "authorization",
  "visa-transfer": "authorization",
  "professional-title": "experience", "current-title": "experience", "current-company": "experience",
  "years-experience": "experience", "primary-role": "experience", summary: "experience", "work-history": "experience",
  "education-degree": "education", "education-field": "education", "education-school": "education",
  "graduation-year": "education", "education-grade": "education", "education-history": "education",
  certifications: "education",
  skills: "skills", languages: "skills", projects: "skills", awards: "skills",
  "pay-rate": "preferences", "start-date": "preferences", "notice-period-days": "preferences",
  "relocation-willing": "preferences", "employment-types": "preferences", "work-settings": "preferences",
  "preferred-locations": "preferences", "preferred-industries": "preferences", "target-roles": "preferences",
  "preferred-name": "contact", "middle-name": "contact", "portfolio-url": "contact",
  "address-line1": "location", "address-line2": "location", "address-postal": "location",
  citizenship: "authorization", nationality: "authorization",
  "current-pay": "preferences", "salary-expectation": "preferences", "floor-rate": "preferences", "onsite-work": "preferences",
  "willing-to-travel": "preferences", commute: "preferences",
  "over-18": "screening", "criminal-history": "screening", "background-check": "screening", "drug-test": "screening",
  "security-clearance": "screening", "non-compete": "screening", "government-work": "screening",
  "relative-at-company": "screening", "former-employee": "screening", accommodations: "screening",
  "essential-functions": "screening",
  gender: "self-id", pronouns: "self-id", race: "self-id", "hispanic-latino": "self-id", "veteran-status": "self-id",
  "disability-status": "self-id", "sexual-orientation": "self-id", transgender: "self-id",
};

/** The personal and screening questions nothing holds (decided 2026-11-11): never built, the BDE adds the candidate's
 * answer for this version. */
const ASKED = new Set([
  "preferred-name", "middle-name", "portfolio-url", "address-line1", "address-line2", "address-postal", "nationality",
  "current-pay", "salary-expectation", "floor-rate", "onsite-work", "willing-to-travel", "commute", "over-18", "criminal-history",
  "background-check", "drug-test", "security-clearance", "non-compete", "government-work", "relative-at-company",
  "former-employee", "accommodations", "essential-functions",
]);

/** Voluntary self-identification (decided 2026-11-11): never in the profile, never built; the BDE adds the candidate's
 * own answer. With the wordings forms commonly offer, as suggestions in the editor: any answer can be typed. */
export const SELF_ID_SUGGESTIONS: Record<string, readonly string[]> = {
  gender: ["Male", "Female", "Non-binary", "Decline to self-identify"],
  pronouns: ["He/him", "She/her", "They/them", "Decline to self-identify"],
  race: ["American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander",
    "White", "Two or More Races", "Decline to self-identify"],
  "hispanic-latino": ["Yes", "No", "Decline to self-identify"],
  "veteran-status": ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran",
    "I don't wish to answer"],
  "disability-status": ["No, I don't have a disability", "Yes, I have a disability (or previously had a disability)",
    "I don't wish to answer"],
  "sexual-orientation": ["Heterosexual", "Gay or Lesbian", "Bisexual", "Decline to self-identify"],
  transgender: ["Yes", "No", "Decline to self-identify"],
};
const isSelfId = (key: string | null) => key !== null && key in SELF_ID_SUGGESTIONS;

/** Common answers the editor offers for a question, self-identification's and a few screening ones'; any answer can be
 * typed. */
export const ANSWER_SUGGESTIONS: Record<string, readonly string[]> = {
  ...SELF_ID_SUGGESTIONS,
  "security-clearance": ["No", "Public Trust", "Secret", "Top Secret", "TS/SCI"],
  "willing-to-travel": ["No", "Up to 25%", "Up to 50%", "Up to 75%", "Yes, 100%"],
};

/** The answers BenchQ takes from the candidate's profile (07 Q56); the rest come from the résumé. Years of experience
 * are counted from the work history, and the profile's figure only when the résumé has no dated job. */
const FROM_PROFILE = new Set([
  "citizenship", "work-auth-status", "work-auth-expiry", "visa-sponsorship", "visa-transfer", "primary-role", "target-roles", "pay-rate",
  "start-date", "notice-period-days", "relocation-willing", "employment-types", "work-settings", "preferred-locations",
  "preferred-industries",
]);

/** Where a list of records is changed: its section in the Builder (07 Q42). */
const SECTION_OF_LIST: Record<string, ResumeSectionKey> = {
  "work-history": "experience", "education-history": "education", projects: "projects", awards: "awards",
};

/** The details of a record that name it (its first line), then the ones that place it (its second). */
const RECORD_LINES: Record<string, [string[], string[]]> = {
  "work-history": [["title", "company"], ["location", "dates"]],
  "education-history": [["degree", "school"], ["graduation_date", "grade"]],
  projects: [["name"], ["technologies", "dates"]],
  awards: [["name"], ["issuer", "date"]],
};

export type AutofillStatus = "answered" | "missing" | "review" | "edited" | "custom";

export function statusOf(entry: AutofillEntry): AutofillStatus {
  if (entry.kind === "CUSTOM") return "custom";
  if (entry.kind === "EDITED") return "edited";
  if (entry.replaced !== undefined) return "review";
  return entry.answer === null ? "missing" : "answered";
}

export function topicOf(entry: AutofillEntry): AutofillTopicId {
  if (entry.kind === "CUSTOM") return "custom";
  if (statusOf(entry) === "review") return "review";
  return (entry.key && TOPIC_OF_KEY[entry.key]) || "other";
}

/** Where BenchQ's answer comes from, for the line under it. Years are counted from the work history when a job in it
 * has a start date, else they're the profile's (`entries`: the version's whole list). */
export function sourceOf(entry: AutofillEntry, entries: readonly AutofillEntry[] = []): "profile" | "resume" | "work-history" | "self-id" | "ask" | null {
  if (entry.kind === "CUSTOM" || !entry.key) return null;
  if (isSelfId(entry.key)) return "self-id";
  if (ASKED.has(entry.key)) return "ask";
  if (entry.key === "years-experience") {
    const jobs = entries.find(({ key }) => key === "work-history")?.answer;
    const isDated = Array.isArray(jobs) && jobs.some((job) => typeof job === "object" && job !== null && detail(job, "start") !== "");
    return isDated ? "work-history" : "profile";
  }
  return FROM_PROFILE.has(entry.key) ? "profile" : "resume";
}

export const builderSectionOf = (entry: AutofillEntry): ResumeSectionKey | null => (entry.key && SECTION_OF_LIST[entry.key]) || null;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A single answer as the extension writes it on a form (extension/src/autofill/resume-answers.ts): Yes or No, a date the
 * US way, the hourly rate as "$85/hr", a notice period in days or "Immediately". Null when there is none. */
export function displayAnswer(key: string | null, answer: AutofillAnswer | undefined): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  if (typeof answer === "number") {
    if (key === "pay-rate") return `$${answer}/hr`;
    if (key === "notice-period-days") return answer === 0 ? "Immediately" : `${answer} day${answer === 1 ? "" : "s"}`;
    return String(answer);
  }
  if (typeof answer === "string") {
    const date = ISO_DATE.exec(answer.trim());
    return date ? `${date[2]}/${date[3]}/${date[1]}` : answer.trim() || null;
  }
  const items = answer.flatMap((item) => (typeof item === "string" ? [item] : recordLines(key, item).slice(0, 1)));
  return items.filter(Boolean).join(key === "preferred-locations" ? "; " : ", ") || null;
}

const detail = (record: Record<string, unknown>, field: string) => {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
};

/** A record (a job, a school…) as two lines: what it is, then where and when. A record type the table doesn't know
 * shows its first details. */
export function recordLines(key: string | null, record: Record<string, unknown>): string[] {
  const lines = key ? RECORD_LINES[key] : undefined;
  if (!lines) {
    const values = Object.values(record).filter((value): value is string => typeof value === "string" && value.trim() !== "");
    return [values.slice(0, 2).join(" · "), values.slice(2, 4).join(" · ")].filter(Boolean);
  }
  const [first, second] = lines.map((fields) => fields.map((field) => detail(record, field)).filter(Boolean).join(" · "));
  // A current job with no printed dates still says it's current.
  const current = key === "work-history" && record.current === true && !detail(record, "dates") ? "Current" : "";
  return [first ?? "", [second, current].filter(Boolean).join(" · ")].filter(Boolean);
}

export type AutofillShow = "all" | "missing" | "review" | "yours";

const SHOWN: Record<AutofillShow, (status: AutofillStatus) => boolean> = {
  all: () => true,
  missing: (status) => status === "missing",
  review: (status) => status === "review",
  yours: (status) => status === "edited" || status === "custom",
};

export type AutofillSummary = { total: number; answered: number; missing: number; review: number; yours: number };

/** Counted from the entries, never stored. "Answered" is any question the extension has an answer to. */
export function summarize(entries: readonly AutofillEntry[]): AutofillSummary {
  const statuses = entries.map(statusOf);
  const count = (show: AutofillShow) => statuses.filter(SHOWN[show]).length;
  return { total: entries.length, answered: statuses.filter((status) => status !== "missing").length, missing: count("missing"), review: count("review"), yours: count("yours") };
}

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** A question matches a search when every word searched for starts a word of its question, its other wordings or its
 * answer: "spons" finds "Will you now or in the future require visa sponsorship?". */
export function matchesSearch(entry: AutofillEntry, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const haystack = words([entry.question, ...entry.also, displayAnswer(entry.key, entry.answer) ?? ""].join(" "));
  return wanted.every((word) => haystack.some((found) => found.startsWith(word)));
}

export type AutofillSection = { id: AutofillTopicId; title: string; entries: AutofillEntry[] };

/** The row an answer being written is on: the question's key, or the user's own question's words. */
export const draftRowOf = (entry: AutofillEntry) => entry.key ?? `own:${entry.question}`;
/** The row of a question being added (Add a question). */
export const ADD_ROW = "add";
const NO_DRAFTS: ReadonlySet<string> = new Set();

/** The sections shown for a filter and a search, in the topics' order; a section with nothing to show is left out,
 * except "Your questions" on the unfiltered list, which holds "Add a question". A row holding an answer being written
 * (`drafts`) stays whatever the filter or search, "Your questions" too while a question is being added, so changing
 * either never closes an editor and drops what it holds. */
export function autofillSections(entries: readonly AutofillEntry[], show: AutofillShow, query: string,
  drafts: ReadonlySet<string> = NO_DRAFTS): AutofillSection[] {
  const shown = entries.filter((entry) => drafts.has(draftRowOf(entry)) || (SHOWN[show](statusOf(entry)) && matchesSearch(entry, query)));
  const isOpenList = (show === "all" && words(query).length === 0) || drafts.has(ADD_ROW);
  return AUTOFILL_TOPICS
    .map(({ id, title }) => ({ id, title, entries: shown.filter((entry) => topicOf(entry) === id) }))
    .filter(({ id, entries: inTopic }) => inTopic.length > 0 || (id === "custom" && isOpenList));
}
