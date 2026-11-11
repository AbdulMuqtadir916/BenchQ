import { normalize, strongTokens, tokens } from "../autofill/text";
import type { FieldClues, FieldKind } from "../autofill/types";
import { classifyFieldAts } from "./ats-autofill-engine/core/classifier/classify-field-vendor";
import { classifyFieldMozilla } from "./ats-autofill-engine/core/heuristics/mozilla/classifier";
import type { FormField, HtmlType } from "./ats-autofill-engine/core/types/form-field";
import { KIND_TO_TYPE, type EngineFieldType } from "./field-types";
import { mapField } from "./universal-ai-autofill/mapper";

/** What the classifier reads about a form field. */
type ClassifiableField = {
  label: string;
  kind: FieldKind;
  autocomplete: string;
  clues: FieldClues;
  pageUrl?: string;
};

type Reading = { type: EngineFieldType; confidence: number };

/** Mozilla's tiers: autocomplete, HTML type and a whole-label match are 0.8 or more; a word inside a label is 0.6. */
const MOZILLA_SURE = 0.8;
/** On a field with no label, a match on its name or id is the best evidence there is. */
const MOZILLA_ATTRIBUTE = 0.4;
const SEMANTIC_SURE = 0.7;
/** Two readings closer than this are a coin toss, and a coin toss stays with the BDE. */
const TIE = 0.05;
const MAX_MEANINGFUL_WORDS = 2;

/** A field about another person: their email is not the candidate's. */
export const SOMEONE_ELSE = /\b(referr\w*|references?|managers?|supervisors?|emergency|spouses?|parents?|guardians?|recruiters?)\b/;

/** An employer's own phone, email or address, which isn't the candidate's either. */
const EMPLOYERS_CONTACT = /\b(employers?|company|companys)\b.*\b(phone|telephone|email|e mail|address|fax|contact)\b/;

/** Words that make a label ask for another detail than the kind it names: a company's size isn't its name, the city
 * someone was born in isn't where they live, and the job being applied for isn't the one they hold. */
const OTHER_DETAIL: Partial<Record<EngineFieldType, RegExp>> = {
  "current-company": /\b(size|website|site|url|industry|type|sector|revenue|address|phone|email|e mail|location|city|state|country|employees|headcount|domain|linkedin|fax|zip)\b/,
  "current-title": /\b(applied|applying|desired|target|seeking|interest)\b/,
  "address-city": /\b(birth|born|issue\w*|licen[cs]e|registration|permit|citizenship)\b/,
  "address-region": /\b(birth|born|issue\w*|licen[cs]e|registration|permit|citizenship)\b/,
  "address-country": /\b(birth|born|issue\w*|licen[cs]e|registration|permit|citizenship|nationality|origin)\b/,
  "address-postal": /\b(birth|born|issue\w*|licen[cs]e|registration|permit)\b/,
};

export const asksOtherDetail = (type: EngineFieldType, label: string) => OTHER_DETAIL[type]?.test(normalize(label)) ?? false;

/** A date box reads as a date of birth to the fuzzy matcher. Only a label or a name that says so makes it one. */
const BIRTH = /\b(birth\w*|born|dob|bday|age)\b/;

/** Labels that name a detail but want something else: how to say a name, one part of a past date, or experience in
 * something that isn't a number of years. */
const NOT_THE_DETAIL = /\bpronunciation\b|\b(start|end)\b.*\b(month|year)\b|^(?!.*\byears?\b).*\bexperience\b/i;

const OPEN_QUESTION = /^(why|how|what|describe|explain|tell|please|do you|did you|are you|have you|will you|can you|would you)\b/i;

const HTML_TYPES: Partial<Record<FieldKind, HtmlType>> = {
  text: "text", email: "email", tel: "tel", url: "url", number: "number", date: "date", textarea: "textarea",
  select: "select-one", radio: "radio", checkbox: "checkbox", file: "file", combobox: "text",
};

const NO_CLUES: FieldClues = {
  name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "",
};

const isOpenQuestion = (label: string) => label.includes("?") || OPEN_QUESTION.test(label);

/** Workday names its fields in `data-automation-id`, which is what ats-autofill-engine's Workday rules read as the id. */
const AUTOMATION_ID = /\bdata-automation-id (\S+)/;

function formField({ label, kind, autocomplete, clues }: ClassifiableField): FormField {
  return {
    htmlType: HTML_TYPES[kind] ?? "text", label, placeholder: clues.placeholder, ariaLabel: clues.ariaLabel,
    autocomplete: autocomplete.trim().split(/\s+/).pop(), name: clues.name,
    id: AUTOMATION_ID.exec(clues.dataAttrs)?.[1] ?? clues.id,
  };
}

/** The fuzzy reading is the loosest of the three, so a labelled field is judged on what it says to a person, not on
 * attribute names like `email_body` that can say something else. */
function semanticReading({ label, autocomplete, kind, clues }: ClassifiableField): Reading | null {
  const signals = label
    ? { ...NO_CLUES, label, placeholder: clues.placeholder, ariaLabel: clues.ariaLabel }
    : { label, ...clues };
  const { kind: mapped, confidence } = mapField({ ...signals, autocomplete, inputType: kind });
  const type = KIND_TO_TYPE[mapped];
  return type && confidence >= SEMANTIC_SURE ? { type, confidence } : null;
}

function mozillaReading(field: ClassifiableField): Reading | null {
  const { fieldType, confidence } = classifyFieldMozilla(formField(field));
  return fieldType && confidence >= (field.label ? MOZILLA_SURE : MOZILLA_ATTRIBUTE) ? { type: fieldType, confidence } : null;
}

/** ats-autofill-engine's rules for the site, then Mozilla's heuristics, then universal-ai-autofill's fuzzy matcher.
 * Each is held to a bar it can clear honestly, and a field that's about someone else or is a free-form question gets
 * no reading at all: those go to the QA bank or the BDE. */
export function classifyField(field: ClassifiableField): EngineFieldType | null {
  const label = field.label.trim();
  const words = normalize(label);
  if (SOMEONE_ELSE.test(words) || EMPLOYERS_CONTACT.test(words) || NOT_THE_DETAIL.test(label)) return null;
  const ruled = field.pageUrl ? classifyFieldAts(formField(field), field.pageUrl) : null;
  if (ruled && ruled !== "open-ended-question") return asksOtherDetail(ruled, label) ? null : ruled;
  const readings = [mozillaReading(field)];
  if (!isOpenQuestion(label) && strongTokens(tokens(label)).size <= MAX_MEANINGFUL_WORDS) readings.push(semanticReading(field));
  const [best, next] = readings.filter((reading) => reading !== null).sort((a, b) => b.confidence - a.confidence);
  if (!best) return null;
  if (next && next.type !== best.type && best.confidence - next.confidence < TIE) return null;
  const said = normalize(`${label} ${field.autocomplete} ${field.clues.name} ${field.clues.id}`);
  if (best.type === "date-of-birth" && !BIRTH.test(said)) return null;
  return asksOtherDetail(best.type, label) ? null : best.type;
}

/** What a QA bank question asks for, so "Postal code" in the bank can answer "ZIP" on a form. */
export const classifyQuestion = (question: string) =>
  classifyField({ label: question, kind: "text", autocomplete: "", clues: NO_CLUES });
