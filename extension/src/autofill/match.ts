import { asksOtherDetail, SOMEONE_ELSE } from "../engine/classify";
import type { EngineFieldType } from "../engine/field-types";
import { US_STATES } from "./options";
import type { BankEntry, FieldKind, ScannedField } from "./types";
import { canonical, hasPhrase, isWeak, normalize, questionOf, sameSet, strongTokens, tokens } from "./text";

type BankMatch =
  | { status: "match"; entry: BankEntry }
  | { status: "tie"; entries: BankEntry[] }
  | { status: "none" };

const CATEGORY_HINTS: [string, RegExp][] = [
  ["WORK_AUTH", /\b(authorized|sponsorship|visa|citizen|permit|green card)\b/],
  ["COMPENSATION", /\b(salary|compensation|pay|rate|ctc)\b/],
  ["AVAILABILITY", /\b(start|notice|available|availability|join)\b/],
  ["RELOCATION", /\b(relocate|commute|onsite|hybrid|remote)\b/],
  ["EXPERIENCE", /\b(experience|year)\b/],
];

const LEAD = 0.1;

function categoryOf(wanted: Set<string>): string | null {
  const text = [...wanted].join(" ");
  return CATEGORY_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function overlap(left: Set<string>, right: Set<string>): number {
  const shared = [...left].filter((word) => right.has(word)).length;
  return (2 * shared) / (left.size + right.size);
}

/** Two questions ask the same thing when every meaningful word matches. A weak word may be missing from one of them, but
 * when each has weak words the other lacks, they name different things: "Employment type" isn't "Visa type". */
function sameQuestion(wanted: Set<string>, words: Set<string>): boolean {
  if (!sameSet(strongTokens(words), strongTokens(wanted))) return false;
  const formOnly = [...wanted].some((word) => !words.has(word));
  const bankOnly = [...words].some((word) => !wanted.has(word));
  return !(formOnly && bankOnly);
}

/** A form question finds a bank entry when both ask about the same things: every meaningful word matches, and only
 * filler or weak words differ. "Years of experience with Java" never takes the answer to "Years of experience". A
 * clear best match wins, the entry's category breaks a close call, and anything still tied stays with the BDE. */
export function matchBank(label: string, bank: BankEntry[]): BankMatch {
  const wanted = tokens(label);
  const strong = strongTokens(wanted);
  if (strong.size === 0) return { status: "none" };
  const scored = bank
    .map((entry) => ({ entry, words: tokens(questionOf(entry.question)) }))
    .filter(({ words }) => sameQuestion(wanted, words))
    .map(({ entry, words }) => ({ entry, score: overlap(wanted, words) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best) return { status: "none" };
  const close = scored.filter(({ score }) => best.score - score < LEAD).map(({ entry }) => entry);
  if (new Set(close.map((entry) => normalize(entry.answer))).size === 1) return { status: "match", entry: best.entry };
  const category = categoryOf(wanted);
  const inCategory = close.filter((entry) => entry.category === category);
  return inCategory.length === 1 ? { status: "match", entry: inCategory[0]! } : { status: "tie", entries: close };
}

/** What a field can ask for, and the labels that ask it. */
const LABELS: [EngineFieldType, string[]][] = [
  ["first-name", ["first name", "given name"]],
  ["last-name", ["last name", "surname", "family name"]],
  ["full-name", ["name", "full name", "your name", "legal name"]],
  ["preferred-name", ["preferred name", "preferred first name", "preferred full name", "preferred first and last name",
    "chosen name", "nickname", "name you go by"]],
  ["email", ["email", "e mail"]],
  ["phone", ["phone", "mobile", "cell", "telephone"]],
  ["phone-country-code", ["country code", "phone country code", "dial code"]],
  ["address-city", ["city"]],
  ["address-region", ["state", "province", "state reside", "state province live"]],
  ["address-postal", ["zip", "zip code", "postal code", "zip postal code", "pin code", "pincode"]],
  ["city-state", ["city state", "location", "current location", "location city state", "located", "live"]],
  ["address-country", ["country", "country reside", "country located", "country based", "current country of residence"]],
  ["portfolio-url", ["portfolio", "personal website", "website"]],
  ["current-company", ["company", "current company", "current employer", "most recent employer", "current or previous employer",
    "name of your current or most recent company", "employer", "employer name", "name of employer", "current employer name"]],
  ["current-title", ["title", "job title", "current title", "current job title", "current or previous job title",
    "current or most recent job title", "current role", "current position"]],
  ["job-applied", ["position applied for", "job applied for", "role applied for", "job title applied for",
    "position you are applying for", "role you are applying for", "job you are applying for", "job title you are applying for",
    "position of interest", "job of interest", "role of interest", "desired position", "desired role", "desired job title",
    "desired title"]],
  ["years-experience", ["years of experience", "total experience", "total years of experience"]],
  ["salary-expectation", ["desired salary", "salary expectation", "expected salary", "compensation expectation", "salary",
    "expected compensation", "desired compensation", "salary requirement", "annual salary", "annual salary expectation",
    "expected annual salary", "desired annual salary", "yearly salary", "expected pay", "desired pay", "pay expectation",
    "expected ctc"]],
  ["current-pay", ["current salary", "current compensation", "current ctc", "ctc", "current pay", "current rate",
    "current hourly rate", "current base salary", "present salary", "current annual salary", "current package",
    "last drawn salary"]],
  ["pay-rate", ["rate", "hourly rate", "pay rate", "bill rate", "expected rate", "desired rate", "expected hourly rate",
    "desired hourly rate", "expected pay rate", "desired pay rate", "hourly pay", "rate per hour", "c2c rate", "w2 rate",
    "1099 rate", "rate expectation", "hourly rate expectation", "rate on c2c", "rate on w2"]],
  // The lowest rate the candidate takes (2026-11-12): never the expected rate.
  ["floor-rate", ["floor rate", "rate floor", "minimum rate", "minimum acceptable rate", "lowest acceptable rate",
    "lowest rate", "minimum hourly rate", "lowest hourly rate", "minimum pay rate", "walk away rate", "walkaway rate"]],
  ["start-date", ["start", "start date", "start day", "earliest start date", "available to start", "available from",
    "date available", "availability", "availability date", "joining date", "start a new role"]],
  ["notice-period", ["notice period"]],
  ["todays-date", ["todays date", "current date"]],
  ["work-authorization", ["authorized to work", "legally authorized", "eligible to work", "right to work"]],
  ["visa-sponsorship", ["sponsorship", "require sponsorship", "immigration sponsorship", "visa sponsorship",
    "future sponsorship", "now or in the future require sponsorship", "continue working"]],
  ["citizenship", ["us citizen", "us citizen or lawful permanent resident"]],
  ["visa-type", ["visa type", "visa status", "immigration status", "type of visa", "current work authorization",
    "work authorization status"]],
  ["work-auth-expiry", ["visa expiration date", "visa expiry date", "work authorization expiration date"]],
  ["relocation-willing", ["relocate", "willing to relocate", "open to relocate"]],
  ["remote-preference", ["remote", "remote work", "work remotely", "willing to work remotely", "open to remote"]],
  ["preferred-locations", ["preferred location", "location preference", "preferred work location"]],
  ["education-school", ["school", "college", "university", "college university attend"]],
  ["education-degree", ["degree", "highest degree", "most advanced degree", "highest level of education", "highest level of education completed"]],
  ["graduation-year", ["graduation", "graduation date", "graduation year", "expected graduation date"]],
];

const KNOWN = LABELS.map(([type, labels]) => {
  const asked = labels.map(tokens);
  return { type, asked, vocabulary: new Set(asked.flatMap((words) => [...words])) };
});

/** Words a label can add without changing what it asks. */
const FILLER = new Set(["url", "link", "profile", "id", "contact", "primary", "total", "professional", "overall", "applicable"]);

const CHOICE_KINDS = new Set<FieldKind>(["select", "radio", "combobox"]);
/** The candidate judging themselves, which no saved answer can speak for. "Hourly rate" isn't one of these. */
const SELF_RATING = /\b(rate (your|yourself)|would you rate|self rating|scale of|proficien\w*|expertise|how (strong|good|comfortable|confident|familiar)|familiarity|level of (experience|knowledge|skill)|(experience|skill) level)\b/;
const FOLLOW_UP = /^if (you )?(selected|answered|chose|heard|yes|no|so|other|not)\b/;
const MAX_WORDS_IN_A_TEXTAREA_QUESTION = 6;
const WILL_YOU = /^(do|will|would) you\b/;
const ARE_YOU = /^(are|do) you\b/;
/** A Yes to these isn't the candidate's usual answer: "Can you work without sponsorship?", "...for any employer?" */
const TURNED_AROUND = /\b(without|not|dont|doesnt|wont|cant|cannot|never|unless|any employer)\b/;
/** The place a question names after "in": capitals are what mark one, so this reads the original label. */
const PLACE_AFTER_IN = /\b[Ii]n (?:[Tt]he )?([A-Z][\w.'-]*(?: [A-Z][\w.'-]*)*)/g;
const LIVES_IN_US = /^(do you|are you)( currently)? (live|reside|located|based)( and work)? in (the )?(north )?us\b/;
const MINIMUM_YEARS = /^do you have (?:at least |over |more than |a minimum of |minimum )?(\d+) years? of (?:work |professional )?experience$/;
const FORMER_EMPLOYEE = /\b[Hh]ave you\b[^?]*\b(?:worked|employed|engaged)\b[^?]*\b(?:by|for|at)\s+(?:[A-Z]|this company|our company|the company\b|us\b)|\b[Ff]ormer employee\b|\b[Dd]o you currently work (?:for|at)\s+[A-Z]/;
/** Questions forms word many ways, so any saved wording answers all the others. Only the bank answers them: nothing here
 * is ever worked out. From the EEOC's and OFCCP's self-ID forms, and 32 employers' application forms. */
const TOPICS: [RegExp, EngineFieldType][] = [
  [/\bpronouns?\b/, "pronouns"],
  [/\bgender\b/, "eeo-gender"],
  [/\b(race|racial|ethnicit\w+)\b/, "eeo-race"],
  [/\b(hispanic|latino|latina|latinx)\b/, "eeo-hispanic"],
  [/\bveteran\b/, "eeo-veteran"],
  [/\b(sexual orientation|lgbt\w*)\b/, "eeo-orientation"],
  [/\btransgender\b/, "eeo-transgender"],
  [/\bessential functions?\b|\bwith or without\b/, "essential-functions"],
  [/\baccommodat\w+\b/, "accommodations"],
  [/\bdisabilit\w+\b/, "eeo-disability"],
  [/\blinkedin\b/, "linkedin-url"],
  [/\bgithub\b/, "github-url"],
  [/\b(hear|heard|learn\w*) (about|of)\b/, "referral-source"],
  [/(?<!under )\b18\b.*\b(age|older|above)\b|\b(over|least|above) 18\b|(?<!under the )\bage of 18\b|^are you 18\b/, "over-18"],
  [/\b(convicted|conviction|felony|criminal)\b/, "criminal-history"],
  [/\bbackground (check|investigation|screening)\b/, "background-check"],
  [/\bdrug (test|screen)/, "drug-test"],
  [/\bsecurity clearance\b/, "security-clearance"],
  [/\b(non ?compete|non solicitation|post employment restrictions?)\b/, "non-compete"],
  [/\bgovernment (official|employee|entity|agency)\b/, "government-work"],
  // "Experience related to healthcare" isn't about family.
  [/\b(relatives?|family members?|related to (?:any|some)(?:one|body)|related to an? (?:current |present )?(?:employee|member|person|individual)s?)\b/, "relative-at-company"],
  [/\bcommut\w+\b/, "commute"],
  [/\b(willing|open|able|prepared)\b.*\b(on ?site|hybrid|office|in person)\b/, "onsite-work"],
  [/\b(willing|open|able)\b.*\btravel\b/, "willing-to-travel"],
  [/\blanguages? (do )?you speak\b|\b(spoken languages?|language skills?)\b/, "languages"],
];

type Asked = Pick<ScannedField, "label" | "kind" | "autocomplete">;

export const asksForSelfRating = (label: string) => SELF_RATING.test(normalize(label));

/** The years a screening question asks for: "Do you have at least 5 years of experience as a Salesforce Engineer?" */
export function minimumYears(label: string): number | null {
  const years = MINIMUM_YEARS.exec(canonical(label))?.[1];
  return years ? Number(years) : null;
}

/** The US, a US state, or North America. */
function isInTheUs(place: string): boolean {
  const name = canonical(place);
  return name === "us" || name === "north us" || name in US_STATES || Object.values(US_STATES).includes(name);
}

/** "Are you authorized to work in Canada?" isn't the candidate's to answer: their answers are about the US. "In Texas"
 * still is, and so is "In The United States" on a form written in title case. */
function namesAnotherCountry(label: string): boolean {
  return [...label.matchAll(PLACE_AFTER_IN)].some(([, place]) => !isInTheUs(place!));
}

/** Forms word these questions too many ways to list: "...require immigration sponsorship to work at Reddit?", "Are you
 * authorized to work in the country where the job is located?". Each is one choice, so it's read by its shape. Free
 * text stays out, because there it asks which kind. */
function askedByShape({ label, kind }: Asked): EngineFieldType | null {
  const text = canonical(label);
  // Free text and "If you answered Yes, ..." can mention a topic in passing.
  const inPassing = FOLLOW_UP.test(text) || (kind === "textarea" && text.split(" ").length > MAX_WORDS_IN_A_TEXTAREA_QUESTION);
  if (!inPassing) {
    const topic = TOPICS.find(([pattern]) => pattern.test(text));
    if (topic) return topic[1];
    if (FORMER_EMPLOYEE.test(label)) return "former-employee";
  }
  if (!CHOICE_KINDS.has(kind)) return null;
  if (minimumYears(label) !== null) return "minimum-experience";
  if (TURNED_AROUND.test(text) || SOMEONE_ELSE.test(text) || namesAnotherCountry(label)) return null;
  if (LIVES_IN_US.test(text)) return "lives-in-us";
  const words = tokens(label);
  if (words.has("require")) return WILL_YOU.test(text) && words.has("sponsorship") ? "visa-sponsorship" : null;
  const entitled = words.has("authorized") || words.has("eligible") || hasPhrase(text, "right to work");
  return ARE_YOU.test(text) && words.has("work") && entitled ? "work-authorization" : null;
}

/** The kind whose labels cover the field's whole label. When two do, the one with the longer wording wins: "Desired job
 * title" is the job applied for, not the job held. */
function knownKind(label: string): EngineFieldType | null {
  const wanted = tokens(label);
  const fits = KNOWN.flatMap(({ type, asked, vocabulary }) => {
    if (![...wanted].every((word) => vocabulary.has(word) || FILLER.has(word) || isWeak(word))) return [];
    const covered = Math.max(0, ...asked.filter((words) => [...words].every((word) => wanted.has(word))).map((words) => words.size));
    return covered > 0 ? [{ type, covered }] : [];
  });
  const most = Math.max(0, ...fits.map(({ covered }) => covered));
  const best = fits.filter(({ covered }) => covered === most);
  return best.length === 1 ? best[0]!.type : null;
}

/** What a field or a bank question asks for, only when its whole label is about that and nothing else, so "Referrer
 * email", "State your reason" and "Years of experience with Java" stay out. The browser's autocomplete hints are the
 * engine's to read (`classifyField`), bar the one it lacks. */
export function fieldTypeFor(field: Asked): EngineFieldType | null {
  const shaped = askedByShape(field);
  if (shaped) return shaped;
  const known = knownKind(field.label);
  if (known) return asksOtherDetail(known, field.label) ? null : known;
  return /\btel-country-code$/i.test(field.autocomplete.trim()) ? "phone-country-code" : null;
}

/** Screening questions: one kind gathers a subject, but a stance, a number or a place can make it another question.
 * Self-ID and contact kinds aren't here: their wordings never change the answer. */
const SCREENING = new Set<EngineFieldType>([
  "accommodations", "essential-functions", "criminal-history", "background-check", "drug-test", "security-clearance",
  "non-compete", "government-work", "relative-at-company", "former-employee", "commute", "onsite-work", "willing-to-travel",
  "minimum-experience", "over-18",
]);
/** The company is the employer's own: a named one counts only when it's the job's company. */
const ABOUT_THE_COMPANY = new Set<EngineFieldType>(["former-employee", "relative-at-company"]);
/** Where a question stands on its subject. Checked in order, so "Have you ever failed..." is the past, not a stance on
 * the present. */
const STANCES: [string, RegExp][] = [
  // "Current or former" asks about the past too: it's answered by "Have you ever…", never by "Are you now…".
  ["past", /\b(ever|previously|in the past|before|failed|fail|been (?:convicted|charged|terminated|fired|dismissed|employed|engaged|a)|convicted|conviction|record|worked|used to|former)\b/],
  ["need", /\b(require|requires|required|need|needs|needed)\b/],
  ["willing", /\b(willing|open|able|comfortable|prepared|agree|okay|ok|eligible|consent|can|could|would|plan|pass)\b/],
  ["now", /\b(have|has|hold|holds|possess|active|current|currently|bound|subject|working)\b/],
];
/** A question that wants more than a yes or no: "How long is your commute?", "Is there anything in your background...". */
const OPEN_QUESTION = /^(how|what|which|where|when|why|who|whom|describe|explain|list|tell us)\b|\b(anything|explain|describe|details?|specify|disclose|elaborate)\b/;
/** A name after "in", "to", "at"…: "commute to Seattle", "worked for Figma", "travel to our London office". */
const PLACE = /\b(?:in|at|to|for|by|near|from)\s+(?:(?:the|our|your|a|an)\s+)?([A-Z][\w&.'-]*(?:,?\s+[A-Z][\w&.'-]*)*)/g;
const COMPANY_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|group|holdings|plc|the)\b/g;

const stanceOf = (text: string) => STANCES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
const numbersIn = (text: string) => new Set(text.match(/\d+/g) ?? []);
const placesIn = (label: string) => new Set([...label.matchAll(PLACE)].map(([, name]) => canonical(name!)).filter(Boolean));
const bareCompany = (name: string) => canonical(name).replace(COMPANY_WORDS, " ").replace(/\s+/g, " ").trim();

function isTheCompany(name: string, company: string | null): boolean {
  const [named, own] = [bareCompany(name), bareCompany(company ?? "")];
  return Boolean(named && own) && (named === own || named.startsWith(`${own} `) || own.startsWith(`${named} `));
}

/** Whether a saved screening answer answers this form's question, which shares its subject: both stand the same way on
 * it, name the same numbers and places, and the form doesn't ask for more than a yes or no. "Have you ever failed a
 * background check?" isn't "Are you willing to undergo one?", and "travel up to 75%" isn't "up to 25%". */
export function sameAsk(type: EngineFieldType, label: string, question: string, company: string | null): boolean {
  if (!SCREENING.has(type)) return true;
  const [form, saved] = [canonical(label), canonical(questionOf(question))];
  if (OPEN_QUESTION.test(form)) return false;
  const [formStance, savedStance] = [stanceOf(form), stanceOf(saved)];
  if (formStance && savedStance && formStance !== savedStance) return false;
  if (!sameSet(numbersIn(form), numbersIn(saved))) return false;
  const [formPlaces, savedPlaces] = [placesIn(label), placesIn(questionOf(question))];
  if (ABOUT_THE_COMPANY.has(type)) return [...formPlaces, ...savedPlaces].every((name) => isTheCompany(name, company));
  return sameSet(formPlaces, savedPlaces);
}
