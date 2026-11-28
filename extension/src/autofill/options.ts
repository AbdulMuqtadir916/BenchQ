import { statusOptionFor } from "./authorization";
import { CANADA_REGIONS, countryNamed, INDIA_REGIONS } from "./countries";
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

const STATE_CODES = new Map(Object.entries(US_STATES).map(([code, name]) => [name, code]));

/** The US state a canonical name or code names, as its code: "texas" and "tx" are both "tx". */
export const usStateCode = (name: string): string | null =>
  (Object.prototype.hasOwnProperty.call(US_STATES, name) ? name : STATE_CODES.get(name) ?? null);

/** A state written the way it ends a place: its code in capitals ("TX", so "in" and "or" stay words) or its name. */
const isStateWord = (text: string) => usStateCode(canonical(text)) !== null && (canonical(text).length > 2 || /^[A-Z]{2}$/.test(text));

/** "Dallas TX" is "Dallas, TX": a US state that ends a place's last part (the one before its country), written without
 * the comma before it. A ZIP code after it stays with it ("Dallas TX 75201" is "Dallas, TX 75201"). A part that's only a
 * state ("West Virginia") or ends in none ("Kansas City", "Virginia Beach") stays as it is. */
export function withStateComma(place: string): string {
  const parts = place.split(",");
  const at = parts.length > 1 && countryNamed(parts.at(-1)!.trim()) ? parts.length - 2 : parts.length - 1;
  const [, before = "", zip = ""] = /^(.*?)(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(parts[at]!.trim()) ?? [];
  const words = before.split(/\s+/).filter(Boolean);
  if (words.length < 2 || isStateWord(words.join(" "))) return place;
  for (let size = Math.min(3, words.length - 1); size >= 1; size -= 1) {
    const state = words.slice(-size).join(" ");
    if (!isStateWord(state)) continue;
    parts.splice(at, 1, words.slice(0, -size).join(" "), [state, zip].filter(Boolean).join(" "));
    return parts.map((part) => part.trim()).join(", ");
  }
  return place;
}

/** City names as lookups spell them out: "St. Louis" is "Saint Louis", "Ft. Lauderdale" "Fort Lauderdale". */
const CITY_WORDS: Record<string, string> = { st: "saint", ste: "sainte", ft: "fort", mt: "mount" };
const cityOf = (part: string) => canonical(part).split(" ").map((word) => CITY_WORDS[word] ?? word).join(" ");

/** The option that is the US state the answer names, however the list writes it: "TX", "Texas", "TX - Texas",
 * "Texas (TX)", "Texas, US". "Virginia" is never "WV - West Virginia", nor "Washington" "Washington DC". */
function stateFor(wanted: string, options: FieldOption[]): string | null {
  const code = usStateCode(wanted);
  if (!code) return null;
  const name = US_STATES[code]!;
  return only(options.filter((option) => {
    const label = ` ${canonical(option.label)} `;
    const isNamed = label.includes(` ${name} `) || label.includes(` ${code} `);
    const rest = label.replace(` ${name} `, " ").replace(` ${code} `, " ").replace(/ (?:united states(?: of america)?|usa|us) /, " ");
    return isNamed && rest.trim() === "";
  }));
}

/** The option that is the country the answer names, under any of its names: "United States" is "US" or "U.S.A.". */
function countryFor(answer: string, options: FieldOption[]): string | null {
  const country = countryNamed(answer.trim());
  return country ? only(options.filter((option) => countryNamed(option.label.trim()) === country)) : null;
}

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
  // A country at the end is the option's country however each writes it: "Baltimore, MD, USA" is Lever's "Baltimore,
  // Maryland, United States". A state code there ("Dallas, TX") is the state, never a country with the same code.
  const parts = withStateComma(answer).split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const country = parts.length > 1 && !isUsState(canonical(last)) ? countryNamed(last) : null;
  // An option ending in a US state is in the United States: "Hyderabad, Texas" is never "Hyderabad, India".
  const countryOf = (place: string) => {
    const end = place.split(",").pop()!.trim();
    return isUsState(canonical(end)) ? countryNamed("United States") : countryNamed(end);
  };
  const head = country ? parts.slice(0, -1) : parts;
  const wanted = canonical(head.join(", "));
  // A state code as the address's own country writes it: "TS" is Telangana in India, "ON" Ontario in Canada, "OR"
  // Oregon in the US. Without a country, a US code first, then India's or Canada's. Only after the city: "La Jolla" and
  // "De Pere" keep their words.
  const regions = country === "India" ? INDIA_REGIONS : country === "Canada" ? CANADA_REGIONS : US_STATES;
  const region = (word: string) => regions[word] ?? (country ? null : INDIA_REGIONS[word] ?? CANADA_REGIONS[word]) ?? word;
  const words = head.flatMap((part, index) => (index === 0 ? cityOf(part).split(" ") : canonical(part).split(" ").map(region)));
  if (!country && words.length < 2 && words[0] === wanted) return null;
  // An option in the US writes its state either way too: "Dallas, TX, USA" is in Texas.
  const placeText = (label: string) => {
    const inUs = [null, "United States"].includes(countryOf(label));
    return label.split(",").map((part, index) => (index === 0 ? cityOf(part)
      : canonical(part).split(" ").map((word) => (inUs ? US_STATES[word] ?? word : word)).join(" "))).join(" ");
  };
  const named = options.filter((option) => words.every((word) => hasPhrase(placeText(option.label), word))
    && (!country || [null, country].includes(countryOf(option.label))));
  // The state written another way, or not at all ("Hyderabad, IND"): the city alone, when just one option names it in
  // the address's own country. Two such cities still need the state to tell them apart.
  const city = cityOf(parts[0] ?? "");
  if (named.length === 0 && country) {
    const sameCity = options.filter((option) => cityOf(option.label.split(",")[0]!) === city && countryOf(option.label) === country);
    return sameCity.length === 1 ? sameCity[0]!.id : null;
  }
  if (named.length < 2) return named[0]?.id ?? null;
  const plain = named.filter((option) => cityOf(option.label.split(",")[0]!) === city);
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
  const place = stateFor(wanted, options) ?? countryFor(answer, options);
  if (place) return place;
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
