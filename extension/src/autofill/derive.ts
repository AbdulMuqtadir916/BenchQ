import type { EngineFieldType } from "../engine/field-types";
import { minimumYears } from "./match";
import { isUsState } from "./options";
import { canonical, normalize } from "./text";
import type { BankEntry, ScannedField } from "./types";

/** Answers the bank holds inside other answers: the city in "Dallas, TX", the first name in a two-part full name, the
 * full name from its parts, the ZIP code at the end of an address, a start date from a notice period. */

type Derived = { answer: string; source?: BankEntry };
type Saved = (type: EngineFieldType) => BankEntry | undefined;
type Asked = Pick<ScannedField, "label" | "kind">;

const SPACED_DIAL = /^\+(\d{1,3})(?:[\s.-]+|(?=\())(.+)$/;
const JOINED_DIAL = /^\+?(1|91)(\d{10})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A US ZIP code, with or without its four extra digits, or a six-digit PIN code, ending a part of an address. */
const POSTAL = /(?:^|\s)(\d{5}(?:-\d{4})?|\d{6})$/;
const ONLY_WORDS = /^[a-z .]*$/i;
/** A note a saved location carries: "Dallas, TX (open to relocate)". */
const ASIDE = /\([^)]*\)/g;
/** Saved locations that aren't a place. */
const NOT_A_PLACE = /\b(remote|anywhere|any where|open to|relocat\w*|flexible|nationwide|multiple|various|any location|work from home|wfh)\b/i;
/** A form that wants the whole international number. */
const WANTS_CODE = /\b(country code|with code|international|incl\w* (the )?(country )?code|e 164)\b/;
const WITHOUT = /\b(without|excluding|exclude)\b/;
/** A form asking for a profile's user name, not its address. */
const HANDLE = /\b(user ?name|handle|user id)\b/;
const PROFILE_URL = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}\/\S+$/i;
const IMMEDIATE = /^(immediate(ly)?|asap|right away|now|available now)\b/i;
const NOTICE = /\b(\d+|one|two|three|four|five|six|eight|ten|twelve|fifteen|thirty|sixty|ninety)\s*(day|week|month)s?\b/i;
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12, fifteen: 15, thirty: 30, sixty: 60, ninety: 90,
};
const DAYS_IN: Record<string, number> = { day: 1, week: 7, month: 30 };

/** A part of a place without the postal code after it: "OH 43215" is "OH". */
const withoutPostal = (part: string) => part.replace(POSTAL, "").trim();

const withoutNotes = (text: string) => text.replace(ASIDE, " ").replace(/\s+/g, " ").trim();

/** A place without its postal code, which has a field of its own, or a note: "Columbus, OH 43215" is "Columbus, OH". */
const placeWithoutPostal = (place: string) => withoutNotes(place).split(",").map((part) => withoutPostal(part.trim())).filter(Boolean).join(", ");

type Place = { city: string; region: string };

/** A saved location read as a place: "Dallas, TX", "Dallas, Texas" or "Hyderabad, Telangana, India". A second part
 * that isn't a US state may be a country, like "Hyderabad, India", so it isn't a state; one part alone could be a city,
 * a state or a country, so it gives nothing; and "Remote" or "Anywhere in US" is no place. */
function placeOf(location: string): Place | null {
  const text = withoutNotes(location);
  if (!text || NOT_A_PLACE.test(text)) return null;
  const [city, second, third] = text.split(",").map((part) => withoutPostal(part.trim())).filter(Boolean);
  if (!city || !second) return null;
  if (third) return { city, region: second };
  return { city, region: isUsState(canonical(second)) ? second : "" };
}

/** The postal code an address or a location ends a part with: "OH 43215", "43215-1234", "Telangana 500081". Never from
 * the first part, where a street number like "12345 Main St" could pass for one, and only alone or after a state. */
function postalCodeIn(text: string): string | null {
  for (const part of withoutNotes(text).split(",").slice(1).map((piece) => piece.trim()).reverse()) {
    const found = POSTAL.exec(part);
    if (found && ONLY_WORDS.test(part.slice(0, found.index))) return found[1]!;
  }
  return null;
}

/** "+1 (214) 555-0167" is a dialling code and a number, which forms want apart. */
function splitPhone(phone: string): { dial: string; number: string } {
  const value = phone.trim();
  const [, dial = "", number = value] = SPACED_DIAL.exec(value) ?? JOINED_DIAL.exec(value) ?? [];
  return { dial, number };
}

/** A date as a date control takes it. */
export function isoDate(value: string): string | null {
  if (ISO_DATE.test(value)) return value;
  const [, month, day, year] = SLASH_DATE.exec(value) ?? [];
  return year ? `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}` : null;
}

/** The date `days` from today, the way US forms write it. */
function dateIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

const today = () => dateIn(0);

/** The days a notice period runs: "2 weeks" is 14, "Immediately" is none. */
function noticeDays(notice: string): number | null {
  if (IMMEDIATE.test(notice.trim())) return 0;
  const [, count, unit] = NOTICE.exec(notice) ?? [];
  if (!count || !unit) return null;
  return (WORD_NUMBERS[count.toLowerCase()] ?? Number(count)) * DAYS_IN[unit.toLowerCase()]!;
}

/** The user name a profile's address ends with: "https://github.com/tarun" is "tarun". */
function profileHandle(url: string): string {
  try {
    const parts = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

/** A bank answer as this field wants it: the number without its code unless the form asks for the code, a location
 * without its ZIP code or a note (a city lookup wouldn't find it), a profile's user name where one is asked for, and a
 * start date that hasn't passed. A date box can't take "Immediately", so it takes today. */
export function shaped(type: EngineFieldType | null, answer: string, { label, kind }: Asked): string {
  const asks = normalize(label);
  if (type === "phone") return WANTS_CODE.test(asks) && !WITHOUT.test(asks) ? answer : splitPhone(answer).number;
  if (type === "city-state") return placeWithoutPostal(answer);
  if (HANDLE.test(asks) && PROFILE_URL.test(answer.trim())) return profileHandle(answer.trim());
  if (type !== "start-date") return answer;
  // "Immediately" or "2 weeks notice" in a date box: the date it comes to.
  const notice = kind === "date" && !isoDate(answer.trim()) ? noticeDays(answer) : null;
  if (notice !== null) return dateIn(notice);
  const date = isoDate(answer);
  return date && date < isoDate(today())! ? today() : answer;
}

export function inTheUs(location: string): boolean {
  const [, region = "", country] = withoutNotes(location).split(",").map((part) => canonical(withoutPostal(part)));
  if (country) return country === "us";
  return region === "us" || isUsState(region);
}

function phoneCountry(saved: Saved): Derived | null {
  const phone = saved("phone");
  const location = saved("city-state");
  const { dial } = splitPhone(phone?.answer ?? "");
  if (dial && dial !== "1") return { answer: `+${dial}`, source: phone! };
  if (dial) return { answer: "United States +1", source: phone! };
  return location && inTheUs(location.answer) ? { answer: "United States +1", source: location } : null;
}

/** "Do you have at least 5 years of experience?" Experience in a line of work is the BDE's to judge, so it never gets here. */
function minimumExperience(label: string, saved: Saved): Derived | null {
  const years = saved("years-experience");
  const held = Number.parseFloat(years?.answer ?? "");
  if (!years || !Number.isFinite(held)) return null;
  return { answer: held >= minimumYears(label)! ? "Yes" : "No", source: years };
}

/** A first or last name from a saved full name: "Meera Krishnan", or "Krishnan, Meera" with the last name first. A
 * longer name could split more than one way, so it's left. */
function namePart(type: "first-name" | "last-name", saved: Saved): Derived | null {
  const full = saved("full-name");
  if (!full) return null;
  const answer = full.answer.trim();
  const [last, first, ...rest] = answer.split(",").map((part) => part.trim());
  const names = answer.includes(",") ? (rest.length === 0 ? [first ?? "", last ?? ""] : []) : answer.split(/\s+/);
  if (names.length !== 2 || names.some((name) => !name || /\s/.test(name))) return null;
  return { answer: names[type === "first-name" ? 0 : 1]!, source: full };
}

/** The whole name from its saved parts, when no whole name is saved: "Tarun" and "Bose" make "Tarun Bose". */
function fullName(saved: Saved): Derived | null {
  const first = saved("first-name");
  const last = saved("last-name");
  if (!first || !last) return null;
  const parts = [first, saved("middle-name"), last].map((part) => part?.answer.trim() ?? "").filter(Boolean);
  return { answer: parts.join(" "), source: first };
}

/** The ZIP or PIN code a saved street address or location ends with, when none is saved on its own. */
function postalCode(saved: Saved): Derived | null {
  for (const source of [saved("address-line1"), saved("city-state")]) {
    if (!source) continue;
    const code = postalCodeIn(source.answer);
    if (code) return { answer: code, source };
  }
  return null;
}

/** A date box asking when the candidate can start, from their notice period: today plus the notice. */
function startFromNotice(saved: Saved): Derived | null {
  const notice = saved("notice-period");
  const days = noticeDays(notice?.answer ?? "");
  return notice && days !== null ? { answer: dateIn(days), source: notice } : null;
}

export function derivedAnswer(type: EngineFieldType, { label, kind }: Asked, saved: Saved): Derived | null {
  const location = saved("city-state");
  const place = location ? placeOf(location.answer) : null;
  const fromLocation = (answer: string) => (location && answer ? { answer, source: location } : null);
  switch (type) {
    case "first-name":
    case "last-name": return namePart(type, saved);
    case "full-name": return fullName(saved);
    // A city lookup lists every Springfield: the state is what picks one.
    case "address-city": return place && location ? fromLocation(kind === "combobox" ? placeWithoutPostal(location.answer) : place.city) : null;
    case "address-region": return fromLocation(place?.region ?? "");
    case "address-postal": return postalCode(saved);
    case "address-country": return fromLocation(location && inTheUs(location.answer) ? "United States" : "");
    case "lives-in-us": return fromLocation(location && inTheUs(location.answer) ? "Yes" : "");
    case "phone-country-code": return phoneCountry(saved);
    case "minimum-experience": return minimumExperience(label, saved);
    case "start-date": return kind === "date" ? startFromNotice(saved) : null;
    case "todays-date": return { answer: today() };
    default: return null;
  }
}
