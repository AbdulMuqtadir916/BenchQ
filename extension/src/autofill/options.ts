import { statusOptionFor } from "./authorization";
import { polarity } from "./polarity";
import { raceOptionFor } from "./race";
import type { FieldOption } from "./types";
import { canonical, hasPhrase } from "./text";

export { polarity } from "./polarity";

/** An option that says no, or not: "Not Hispanic or Latino", "None of these apply". */
const NEGATED = /\b(not|no|non|none|never|dont)\b/;
/** Short answers, spelled out the way forms list them. */
const SHORT_FORMS: Record<string, string> = { m: "male", f: "female", gc: "green card", "gc holder": "green card holder", usc: "us citizen" };
/** Job boards, which a "How did you hear about us?" list may only offer as "Job board (Indeed, LinkedIn, etc.)". */
const JOB_BOARDS = /\b(linkedin|indeed|dice|monster|ziprecruiter|glassdoor|careerbuilder|simplyhired|naukri|wellfound|angellist|hired|builtin|built in|jobright|jooble)\b/;
const BOARD_OPTION = /\b(job (board|site|website|posting|portal|search)s?|online job|job listing)\b/;

export const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

/** A US state by its code or its name, already canonical: "tx", "texas". */
export const isUsState = (name: string) =>
  Object.prototype.hasOwnProperty.call(US_STATES, name) || Object.values(US_STATES).includes(name);

/** Words forms use for the same answer. */
const SAME_THING = [
  ["permanent resident", "green card"], ["us citizen", "citizen"], ["male", "man"], ["female", "woman"],
  ["non binary", "nonbinary"], ["decline", "prefer not", "dont wish", "do not wish", "do not want", "choose not", "rather not"],
  ["black", "african american"], ["native american", "alaska native", "alaskan native", "american indian"],
  ["pacific islander", "native hawaiian"], ["two or more", "multiracial", "mixed race"],
  ["hispanic", "latino", "latinx", "latine"], ["no", "none of these", "none of the above"],
];

/** Degree levels, so "B.Tech" finds "Bachelor's Degree" and "MCA" finds "Master's Degree". Checked in order. */
const DEGREE_LEVELS: [string, RegExp][] = [
  ["doctorate", /\b(ph ?d|doctorate|doctoral|doctor of|d ?phil|ed ?d)\b/],
  ["master", /\b(masters?|master of|m ?tech|m e|m ?eng|m ?sc|ms|m s|ma|m a|mba|mca|m ?com|mfa|mph|pgdm|post ?graduate)\b/],
  ["bachelor", /\b(bachelors?|bachelor of|b ?tech|b e|be|b ?eng|b ?sc|bs|b s|ba|b a|bba|bca|b ?com|undergraduate)\b/],
  ["associate", /\b(associates?|associate of)\b/],
  ["high school", /\b(high school|secondary school|ged|12th|hsc|intermediate)\b/],
];
/** An option that names the level itself, rather than one degree of it like "MBA". */
const LEVEL_NAME = /\b(bachelors?|masters?|doctorate|doctoral|phd|associates?|high school)\b/;

/** "TX" and "Texas", "H-1B" and "H1B": the same answer written two ways. */
function sameAnswer(left: string, right: string): boolean {
  const compact = (text: string) => text.replace(/ /g, "");
  return compact(left) === compact(right) || US_STATES[left] === right || US_STATES[right] === left;
}

const MOST_NAMED = 4;
const ASIAN_SUBGROUP = /\b(east|south|southeast) asian\b/;
const NUMBER_ANSWER = /^(\d+(?:\.\d+)?)\s*(k)?\s*\+?\s*(?:years?|yrs?|\/\s*(?:hr|hour|yr|year)|per (?:hour|year|annum)|hourly|annually|annual|yearly)?\s*\+?\s*\.?$/;

function only(options: FieldOption[]): string | null {
  return options.length === 1 ? options[0]!.id : null;
}

/** The one number an answer gives, as a number box takes it: "8+" and "8 years" are 8, "$95,000" and "95k" are 95000,
 * "$85/hr" is 85. "About eight" and "85-95" give none. */
export function numberIn(answer: string): string | null {
  const text = answer.trim().toLowerCase().replace(/[$₹€£]|\b(?:usd|inr|rs)\b/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").trim();
  const [, digits, thousands] = NUMBER_ANSWER.exec(text) ?? [];
  if (!digits) return null;
  const value = Number(digits) * (thousands ? 1000 : 1);
  return Number.isFinite(value) ? String(value) : null;
}

/** "Dallas, TX" in a city lookup: what names both, and of those the city itself, not "Dallas County, Texas". */
function placeFor(answer: string, options: FieldOption[]): string | null {
  const wanted = canonical(answer);
  const words = wanted.split(" ").map((word) => US_STATES[word] ?? word);
  if (words.length < 2 && words[0] === wanted) return null;
  const named = options.filter((option) => words.every((word) => hasPhrase(canonical(option.label), word)));
  if (named.length < 2) return named[0]?.id ?? null;
  const city = canonical(answer.split(",")[0]!);
  const plain = named.filter((option) => canonical(option.label.split(",")[0]!) === city);
  return plain.sort((left, right) => left.label.length - right.label.length)[0]?.id ?? null;
}

/** What an option's number covers: "6-8 years", "9+", "Less than 1 year", "More than 10 years", "10 or more",
 * "$80,000 - $100,000". Years count whole, so 8.5 years is in "6-8". */
function rangeOf(label: string): ((value: number) => boolean) | null {
  const text = label.toLowerCase().replace(/[$₹€£,]/g, "").replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n: string) => String(Number(n) * 1000)).trim();
  const between = /^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/.exec(text);
  if (between) return (value) => Math.floor(value) >= Number(between[1]) && Math.floor(value) <= Number(between[2]);
  const andUp = /^(\d+(?:\.\d+)?)\s*(?:\+|(?:years?|yrs?)?\s*(?:or more|and above|and up|or above|plus|or over))/.exec(text);
  if (andUp) return (value) => value >= Number(andUp[1]);
  const over = /^(?:more than|over|above|greater than|>)\s*(\d+(?:\.\d+)?)/.exec(text);
  if (over) return (value) => value > Number(over[1]);
  const under = /^(?:less than|under|below|fewer than|<)\s*(\d+(?:\.\d+)?)/.exec(text);
  if (under) return (value) => value < Number(under[1]);
  const exactly = /^(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?$/.exec(text);
  return exactly ? (value) => Math.floor(value) === Number(exactly[1]) : null;
}

/** "7 years" in a list of ranges like "6-8 years" and "9+". */
function rangeFor(answer: string, options: FieldOption[]): string | null {
  const value = Number(numberIn(answer) ?? Number.NaN);
  if (!Number.isFinite(value)) return null;
  return only(options.filter(({ label }) => rangeOf(label)?.(value) ?? false));
}

const degreeLevel = (text: string) => DEGREE_LEVELS.find(([, pattern]) => pattern.test(canonical(text)))?.[0] ?? null;

/** "B.Tech" in a list of degree levels: the option for its level, the level's own name over one degree of it. */
function degreeFor(answer: string, options: FieldOption[]): string | null {
  const level = degreeLevel(answer);
  const leveled = options.filter((option) => degreeLevel(option.label) !== null);
  if (!level || leveled.length < 2) return null;
  const same = leveled.filter((option) => degreeLevel(option.label) === level);
  const named = same.filter((option) => LEVEL_NAME.test(canonical(option.label)));
  return only(named.length > 0 ? named : same);
}

/** A saved "South Asian" is still "Asian" on a form that doesn't split it, like "Asian (Not Hispanic or Latino)". The
 * other way round is the BDE's call: see `pickOneReason`. */
function broaderOption(wanted: string, options: FieldOption[]): string | null {
  if (!ASIAN_SUBGROUP.test(wanted)) return null;
  return only(options.filter(({ label }) => {
    const text = canonical(label);
    return hasPhrase(text, "asian") && !ASIAN_SUBGROUP.test(text);
  }));
}

/** A job board the answer names, on a list that only offers job boards as one option. */
function boardFor(wanted: string, options: FieldOption[]): string | null {
  if (!JOB_BOARDS.test(wanted)) return null;
  return only(options.filter((option) => BOARD_OPTION.test(canonical(option.label))));
}

/** The one option a free-text answer means, or null when it isn't clear: the review list then shows the answer so the
 * BDE can pick. Race and work-authorization lists are read by what their options mean (`race.ts`, `authorization.ts`). */
export function optionFor(saved: string, options: FieldOption[]): string | null {
  const answer = SHORT_FORMS[canonical(saved)] ?? saved;
  const wanted = canonical(answer);
  const exact = options.filter((option) => sameAnswer(canonical(option.label), wanted));
  if (exact.length > 0) return only(exact);
  const race = raceOptionFor(answer, options);
  if (race !== undefined) return race;
  const status = statusOptionFor(answer, options);
  if (status !== undefined) return status;
  const sign = polarity(answer);
  const signed = sign ? options.filter((option) => polarity(option.label) === sign) : [];
  if (signed.length > 0) return only(signed);
  const alike = SAME_THING.filter((phrases) => phrases.some((phrase) => hasPhrase(wanted, phrase))).flat();
  // A no keeps to options that say no: "Not Hispanic or Latino" is never "Hispanic or Latino".
  const reworded = options.filter((option) => alike.some((phrase) => hasPhrase(canonical(option.label), phrase)))
    .filter((option) => !sign || NEGATED.test(canonical(option.label)) === (sign === "no"));
  // "Female" means "Woman", not "Cis-woman" or "Transgender woman".
  const plain = reworded.filter((option) => alike.some((phrase) => `${canonical(option.label)} `.startsWith(`${phrase} `)));
  if (reworded.length > 0) return only(plain.length > 0 ? plain : reworded);
  if (sign) return null;
  // A country list with dial codes: "US" means "United States +1", not "U.S. Virgin Islands +1".
  const dialled = options.filter((option) => {
    const label = canonical(option.label);
    return label.startsWith(`${wanted} `) && /^\d+$/.test(label.slice(wanted.length + 1));
  });
  if (dialled.length === 1) return dialled[0]!.id;
  const worked = placeFor(answer, options) ?? rangeFor(answer, options) ?? degreeFor(answer, options) ?? broaderOption(wanted, options)
    ?? boardFor(wanted, options);
  if (worked) return worked;
  return only(options.filter((option) => {
    const label = canonical(option.label);
    // "Indian" says nothing about "American Indian or Alaska Native".
    if (wanted === "indian" && hasPhrase(label, "american indian")) return false;
    return hasPhrase(wanted, label) || hasPhrase(label, wanted);
  }));
}

/** Why an answer that fits several options stays with the BDE: "Asian" on a form listing East Asian and South Asian.
 * BenchQ won't narrow it down, because for a question like race that would be a guess about the candidate. */
export function pickOneReason(answer: string, options: FieldOption[]): string | null {
  const wanted = canonical(answer);
  const fits = options.map(({ label }) => label).filter((label) => hasPhrase(canonical(label), wanted));
  if (fits.length < 2 || fits.length > MOST_NAMED) return null;
  return `This answer fits ${fits.slice(0, -1).join(", ")} and ${fits[fits.length - 1]}. Pick the right one yourself.`;
}
