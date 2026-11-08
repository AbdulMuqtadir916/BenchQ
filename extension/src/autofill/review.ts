import { bankForType, closestBankEntry, indexBankByType } from "../engine/bank";
import { classifyField } from "../engine/classify";
import { manualOnlyReason, type EngineFieldType } from "../engine/field-types";
import { derivedAnswer, inTheUs, isoDate, shaped } from "./derive";
import { asksForSelfRating, fieldTypeFor, matchBank, sameAsk } from "./match";
import { neverFillReason, staysOutOfSavedForm } from "./never-fill";
import { authorizedIn, sponsorshipIn, sponsorshipWordsIn, statusAnswer, statusOptionFor } from "./authorization";
import { numberIn, optionFor, pickOneReason, polarity } from "./options";
import { payUnitClash } from "./pay";
import { racePartsFor, withHispanic } from "./race";
import { canonical, normalize, questionOf } from "./text";
import type { BankEntry, FieldKind, FieldOption, FieldWrite, JobSummary, ReviewRow, TabField } from "./types";

const CHECKED = "Checked";
const UNCHECKED = "Not checked";
const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;
const LIST_SEPARATOR = /\s*(?:[,;/]|\band\b)\s*/;
const NO_OPTION = "This answer doesn't match one option. Pick one yourself.";
const NO_ANSWER = "No answer in the bank.";
const TEXT_KINDS = new Set<FieldKind>(["text", "email", "tel", "url", "textarea"]);
const YES_OR_NO = /^(yes|no)\.?$/i;
/** A question that wants more than a yes or no, which a saved "Yes" can't answer: "How long is your commute?" */
const OPEN_TEXT = /^(how|what|which|where|when|why|who|whom|describe|explain|list|tell us|please (describe|explain|list|specify|provide|share))\b/;
/** Sections about someone else: a reference's, a referrer's or an emergency contact's name isn't the candidate's. */
const SOMEONE_ELSES_SECTION = /\b(emergency contact|next of kin|references?|referee|referred by|referrer|referral (details|information|contact)|(manager|supervisor)s? (name|contact|details|information)|spouse|guardian)\b/;
const PERSON_KINDS = new Set<EngineFieldType>([
  "full-name", "first-name", "last-name", "middle-name", "preferred-name", "email", "phone", "phone-country-code",
  "address-line1", "address-line2", "address-city", "address-region", "address-postal", "address-country", "city-state",
  "current-company", "current-title", "linkedin-url", "github-url", "portfolio-url", "website",
]);
/** A block of work or education history, where a start date is that entry's, not when the candidate can start. */
const HISTORY_SECTION = /\b(experience|education|employment|work history)\b/;

type Fit = { write: FieldWrite; proposed: string } | { reason: string };
type Base = Pick<ReviewRow, "key" | "field" | "isUnsaved">;
type Job = Pick<JobSummary, "title" | "company">;

const noOption = (answer: string, options: FieldOption[]): Fit => ({ reason: pickOneReason(answer, options) ?? NO_OPTION });

/** "Email and Text Message" in a group of checkboxes: the options it names, all of them or none. */
function checkboxOptions(value: string, options: FieldOption[]): string[] {
  const named = options.find(({ label }) => label === value);
  // A race list's options carry slashes ("Black / of African … descent"), so its answer splits on commas and "and".
  const parts = racePartsFor(value, options) ?? value.split(LIST_SEPARATOR).filter(Boolean);
  if (named || parts.length < 2) return [named?.id ?? optionFor(parts[0] ?? value, options)].filter((id) => id !== null);
  const ids = parts.map((part) => optionFor(part, options));
  return ids.every(Boolean) ? ids as string[] : [];
}

/** How an answer goes into this kind of control, or why the BDE has to do it. Nothing is cut to fit. */
function fit(field: TabField, answer: string): Fit {
  const value = answer.trim();
  switch (field.kind) {
    case "select":
    case "radio": {
      const optionId = optionFor(value, field.options);
      const option = field.options.find(({ id }) => id === optionId);
      return option ? { write: { type: "option", optionId: option.id }, proposed: option.label } : noOption(value, field.options);
    }
    case "checkbox": {
      if (field.options.length === 0) {
        const sign = polarity(value);
        if (!sign) return { reason: "This answer isn't a yes or no." };
        return { write: { type: "check", checked: sign === "yes" }, proposed: sign === "yes" ? CHECKED : UNCHECKED };
      }
      const optionIds = checkboxOptions(value, field.options);
      if (optionIds.length === 0) return noOption(value, field.options);
      const proposed = field.options.filter(({ id }) => optionIds.includes(id)).map(({ label }) => label).join(", ");
      return { write: { type: "check", checked: true, optionIds }, proposed };
    }
    case "number": {
      const number = numberIn(value);
      return number === null ? { reason: "This form wants a number." } : { write: { type: "text", value: number }, proposed: number };
    }
    case "date": {
      const date = isoDate(value);
      return date ? { write: { type: "text", value: date }, proposed: date } : { reason: "This form wants a date." };
    }
    case "combobox":
      return { write: { type: "choice", value }, proposed: value };
    case "text":
    case "email":
    case "tel":
    case "url":
    case "textarea":
      if (field.maxLength !== null && value.length > field.maxLength) {
        return { reason: `The answer is ${value.length} characters; this field allows ${field.maxLength}.` };
      }
      return { write: { type: "text", value }, proposed: value };
    default:
      return { reason: "BenchQ can't fill this kind of control yet." };
  }
}

/** A form's mask can reformat a number or put a country code in front of it: it's the same number. */
function samePhone(left: string, right: string): boolean {
  const a = left.replace(/\D/g, "");
  const b = right.replace(/\D/g, "");
  return a.length >= 7 && b.length >= 7 && (a.endsWith(b) || b.endsWith(a));
}

/** A dropdown shows its own wording, like "Dallas, Texas, United States" for "Dallas, TX", or "+1" for its country. */
function dropdownHolds(current: string, proposed: string): boolean {
  if (current.startsWith("+")) return proposed.endsWith(current);
  return optionFor(proposed, [{ id: "shown", label: current }]) !== null;
}

function holdsAnswer({ current, kind }: TabField, proposed: string): boolean {
  if (kind === "combobox" && current && dropdownHolds(current, proposed)) return true;
  return current.trim() === proposed.trim() || (proposed === UNCHECKED && current === "")
    || (PHONE_LIKE.test(proposed) && samePhone(current, proposed));
}

function rowFor(base: Base, answer: string, source?: BankEntry): ReviewRow {
  const fitted = fit(base.field, answer);
  if ("reason" in fitted) return { ...base, status: "manual", reason: fitted.reason, proposed: answer, source };
  const status = holdsAnswer(base.field, fitted.proposed) ? "same" : "ready";
  return { ...base, status, write: fitted.write, proposed: fitted.proposed, source };
}

function fromBank(base: Base, entry: BankEntry, type: EngineFieldType | null, answer = entry.answer): ReviewRow {
  const row = rowFor(base, shaped(type, answer, base.field), entry);
  // A "location" dropdown can be a list of countries.
  const isCountryList = type === "city-state" && row.status === "manual" && base.field.options.length > 0 && inTheUs(entry.answer);
  return isCountryList ? rowFor(base, "United States", entry) : row;
}

/** Saved answers that disagree. A dropdown can still settle it: when the answers that fit its options all fit the same
 * one, like "Asian" on a form whose options mix race with Hispanic origin, that's the answer. */
function tied(base: Base, entries: BankEntry[], type: EngineFieldType | null, answerOf = (entry: BankEntry) => entry.answer): ReviewRow {
  const { field } = base;
  if (field.options.length > 0 && field.kind !== "checkbox") {
    const fitting = entries.map((entry) => ({ entry, id: optionFor(shaped(type, answerOf(entry), field), field.options) }))
      .filter(({ id }) => id !== null);
    if (fitting.length > 0 && new Set(fitting.map(({ id }) => id)).size === 1) return fromBank(base, fitting[0]!.entry, type, answerOf(fitting[0]!.entry));
  }
  const alternatives = [...new Set(entries.map((entry) => entry.answer.trim()))];
  return { ...base, status: "manual", reason: "More than one saved answer fits.", alternatives };
}

/** Whether a saved answer found by kind or by close wording answers this field: a screening question asks the same
 * thing (`sameAsk`), pay comes in the unit the field wants, and a bare yes or no doesn't go into an open question. */
function answersField(type: EngineFieldType | null, field: TabField, question: string, entry: BankEntry, job: Job | null): boolean {
  if (type && !sameAsk(type, question, entry.question, job?.company ?? null)) return false;
  // The whole label, which says the unit: "Expected salary (USD per year)".
  if (payUnitClash(type, field.label, entry.answer)) return false;
  return !(TEXT_KINDS.has(field.kind) && YES_OR_NO.test(entry.answer.trim()) && OPEN_TEXT.test(canonical(question)));
}

type Review = { bank: BankEntry[]; byType: Map<EngineFieldType, BankEntry[]>; job: Job | null };
type Saved = (wanted: EngineFieldType) => BankEntry | undefined;

const STATUS_TYPES = new Set<EngineFieldType>(["work-authorization", "visa-sponsorship", "visa-type"]);

/** A race answer with the saved Hispanic answer added, when the form can ask both in one list: one that offers a
 * Hispanic option, or a dropdown whose options show only when it opens. */
function raceAnswer(field: TabField, race: string, saved: Saved): string {
  const asksBoth = field.kind === "combobox" || field.options.some(({ label }) => /\b(hispanic|latin[oaxe])\b/.test(canonical(label)));
  return asksBoth ? withHispanic(race, saved("eeo-hispanic")?.answer) : race;
}

/** The status the candidate's saved authorization and sponsorship answers come to, however they're worded. */
function workStatus(saved: Saved): { answer: string; source: BankEntry } | null {
  const auth = saved("work-authorization");
  if (!auth) return null;
  const sponsor = saved("visa-sponsorship");
  const answer = statusAnswer({
    authorized: authorizedIn(auth.answer),
    needsSponsorship: sponsor ? sponsorshipIn(sponsor.answer) : sponsorshipWordsIn(auth.answer),
  });
  return answer ? { answer, source: auth } : null;
}

/** A status list ("I am authorized … but will require sponsorship") the saved answer didn't settle gets the status the
 * candidate's answers come to; a dropdown asking about status tries it when its options show. */
function withStatus(row: ReviewRow, type: EngineFieldType | null, status: ReturnType<typeof workStatus>): ReviewRow {
  if (!status) return row;
  const { field } = row;
  if (field.kind === "combobox" && row.write?.type === "choice" && type && STATUS_TYPES.has(type)) {
    return { ...row, write: { ...row.write, also: [status.answer] } };
  }
  if (row.status !== "manual" || row.alternatives || field.options.length === 0 || !statusOptionFor(status.answer, field.options)) return row;
  const fitted = rowFor({ key: row.key, field, isUnsaved: row.isUnsaved }, status.answer, status.source);
  return fitted.status === "manual" ? row : fitted;
}

/** The bank's exact question first, then entries the engine says ask for the same thing, then what those entries hold
 * inside them, then a close wording. Matching reads the question without its examples and notes; the row keeps the
 * form's whole label. */
function reviewField(scanned: Base, repeated: boolean, review: Review): ReviewRow {
  const saved: Saved = (wanted) => {
    const entries = bankForType(review.byType, wanted);
    return entries.length === 1 ? entries[0] : undefined;
  };
  const row = reviewCore(scanned, repeated, review, saved);
  return row.status === "blocked" ? row : withStatus(row, typeOf(scanned.field), workStatus(saved));
}

const typeOf = (field: TabField) => {
  const asked = { ...field, label: questionOf(field.label) };
  return fieldTypeFor(asked) ?? classifyField(asked);
};

function reviewCore(scanned: Base, repeated: boolean, { bank, byType, job }: Review, saved: Saved): ReviewRow {
  const { field } = scanned;
  const asked: TabField = { ...field, label: questionOf(field.label) };
  const type = fieldTypeFor(asked) ?? classifyField(asked);
  const blocked = neverFillReason(field) ?? (type && manualOnlyReason(type));
  if (blocked) return { ...scanned, status: "blocked", reason: blocked, isUnsaved: staysOutOfSavedForm(blocked) };
  const base = type?.startsWith("eeo-") ? { ...scanned, isUnsaved: true } : scanned;
  const manual = (reason: string): ReviewRow => ({ ...base, status: "manual", reason });
  if (asksForSelfRating(asked.label)) return manual("This asks for a self-rating, so it's yours to answer.");
  if (field.kind === "custom") return manual("BenchQ can't fill this kind of control yet.");
  if (!field.label && !type) return manual("This field has no label.");
  // Forms often ask a self-ID question twice, in their own survey and the EEO section. The answer is the same.
  if (repeated && !type?.startsWith("eeo-")) return manual("This question appears more than once on the form.");
  const section = normalize(field.clues.sectionHeading);
  if (type && PERSON_KINDS.has(type) && SOMEONE_ELSES_SECTION.test(section)) return manual("This section asks about someone else, so it's yours to fill.");
  if (type === "start-date" && HISTORY_SECTION.test(section)) return manual("This date belongs to an entry in the candidate's history.");
  // The job applied for is the linked job, whatever the bank says.
  if (type === "job-applied") return job?.title ? rowFor(base, job.title) : manual(NO_ANSWER);

  const answers = (entry: BankEntry) => answersField(type, field, asked.label, entry, job);
  // A race answer brings the saved Hispanic one along, for forms that ask both in one list.
  const answerOf = (entry: BankEntry) => (type === "eeo-race" ? raceAnswer(field, entry.answer, saved) : entry.answer);
  const fromSaved = (entry: BankEntry) => fromBank(base, entry, type, answerOf(entry));
  const match = matchBank(asked.label, bank);
  // The same words can still want another kind of answer: "Do you live in the US?" isn't "Where do you live?". Then the
  // other ways get their turn, and the saved answer shows only if none of them has one.
  let fallback: ReviewRow | null = null;
  if (match.status === "match") {
    const clash = payUnitClash(type, field.label, match.entry.answer, true);
    const row = clash ? { ...manual(clash), proposed: match.entry.answer, source: match.entry } : fromSaved(match.entry);
    if (row.status !== "manual" || !type) return row;
    fallback = row;
  }
  if (match.status === "tie") return tied(base, match.entries, type, answerOf);
  const sameType = type ? bankForType(byType, type, answers) : [];
  if (sameType.length > 1) return tied(base, sameType, type, answerOf);
  if (sameType[0]) return fromSaved(sameType[0]);
  const derived = type ? derivedAnswer(type, asked, saved) : null;
  if (derived) return rowFor(base, derived.answer, derived.source);
  const entry = closestBankEntry(asked.label, bank, answers);
  if (entry) return fromSaved(entry);
  if (fallback) return fallback;
  // Pay saved in another unit: shown, but never converted.
  const otherUnit = type ? (byType.get(type) ?? []).find((saved) => payUnitClash(type, field.label, saved.answer)) : undefined;
  if (otherUnit) return { ...manual(payUnitClash(type, field.label, otherUnit.answer)!), proposed: otherUnit.answer, source: otherUnit };
  return manual(NO_ANSWER);
}

/** One row per scanned field, in the form's order. `key` survives a rescan, so what a tab remembers about a field does.
 * `job` is the linked job, which answers "Position applied for" and names the company a question is about. */
export function buildReview(fields: TabField[], bank: BankEntry[], job: Job | null = null): ReviewRow[] {
  const review: Review = { bank, byType: indexBankByType(bank), job };
  const counts = new Map<string, number>();
  for (const field of fields) {
    const label = normalize(field.label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return fields.map((field) => {
    const label = normalize(field.label);
    const index = seen.get(label) ?? 0;
    seen.set(label, index + 1);
    const key = `${field.frameId}:${field.kind}:${label}:${index}`;
    return reviewField({ key, field }, Boolean(label) && (counts.get(label) ?? 0) > 1, review);
  });
}
