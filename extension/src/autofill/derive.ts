import type { EngineFieldType } from "../engine/field-types";
import { callingCodeIn, callingCodeOf, countryNamed, isCallingCode } from "./countries";
import { minimumYears } from "./match";
import { isUsState } from "./options";
import { canonical, normalize } from "./text";
import type { BankEntry, ScannedField } from "./types";

/** Answers the bank holds inside other answers: the city, state, ZIP code, country or street of a saved address or
 * location, a location from an address, the first, middle, last or preferred name in a full name, the full name from its
 * parts, a phone number's calling code, and a start date from a notice period. */

type Derived = { answer: string; source?: BankEntry };
type Saved = (type: EngineFieldType) => BankEntry | undefined;
type Asked = Pick<ScannedField, "label" | "kind"> & {
  clues?: Pick<ScannedField["clues"], "placeholder" | "className">;
  maxLength?: number | null;
};

/** A number written as international: "+44 …", "0044 …", "(+91) …". */
const INTERNATIONAL = /^\(?\s*(?:\+|00)/;
/** A first group of digits before a separator: "91" in "91 98765 43210". */
const FIRST_GROUP = /^(\d{1,3})[\s.\-/]/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A US ZIP code, with or without its four extra digits, or a six-digit PIN code, ending a part of an address. */
const POSTAL = /(?:^|\s)(\d{5}(?:-\d{4})?|\d{6})$/;
const ONLY_WORDS = /^[a-z .]*$/i;
/** A note a saved location carries: "Dallas, TX (open to relocate)". */
const ASIDE = /\([^)]*\)/g;
/** Saved locations that aren't a place. */
const NOT_A_PLACE = /\b(remote|anywhere|any where|open to|relocat\w*|flexible|nationwide|multiple|various|any location|work from home|wfh)\b/i;
/** A form that asks for the whole international number in so many words. */
const WANTS_CODE = /\b(country code|with code|international|incl\w* (the )?(country )?code|e 164)\b/;
/** A WhatsApp number is the international one, though the form may not say so. */
const WHATSAPP = /\bwhatsapp\b/;
const WITHOUT = /\b(without|excluding|exclude)\b/;
/** A phone widget that reads the country from the number it's given: intl-tel-input, react-phone-number-input. */
const PHONE_WIDGET = /\b(?:iti__tel-input|PhoneInputInput|intl-tel-input)\b/;
/** A form asking for the street alone: "Address line 1", "Street address". */
const STREET_ONLY = /\b(line 1|line one|address 1|street)\b/;
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

/** The country the last part of a place names: "India", "USA". */
const countryEnding = (parts: string[]) => (parts.length > 0 ? countryNamed(parts.at(-1)!) : null);

/** A saved location read as a place: "Dallas, TX", "Dallas, Texas", "Hyderabad, Telangana" or "Hyderabad, Telangana,
 * India". A country after the city, like "Hyderabad, India", is no state; one part alone could be a city, a state or a
 * country, so it gives nothing; and "Remote" or "Anywhere in US" is no place. */
function placeOf(location: string): Place | null {
  const text = withoutNotes(location);
  if (!text || NOT_A_PLACE.test(text)) return null;
  const parts = text.split(",").map((part) => withoutPostal(part.trim())).filter(Boolean);
  const hasCountry = parts.length > 1 && countryEnding(parts) !== null;
  const [city, region = ""] = hasCountry ? parts.slice(0, -1) : parts;
  if (!city || (!region && !hasCountry)) return null;
  return { city, region };
}

type AddressParts = Place & { street: string; postal: string; country: string };

/** A whole saved address read from its end: "Flat 302, Sai Residency, Hyderabad, Telangana 500081, India" is its
 * country (when the last part names one), the postal code (in the state's part, the city's, or a part of its own), the
 * state, the city, then the street. Fewer parts than a street, a city and a state make no address to read: "Dallas, TX"
 * is a location (`placeOf`). */
function addressParts(address: string): AddressParts | null {
  const parts = withoutNotes(address).split(",").map((part) => part.trim()).filter(Boolean);
  const country = parts.length > 1 ? countryNamed(withoutPostal(parts.at(-1)!)) ?? "" : "";
  if (country) parts.pop();
  const ownPostal = parts.length > 3 && /^(?:\d{5}(?:-\d{4})?|\d{6})$/.test(parts.at(-1)!) ? parts.pop()! : "";
  if (parts.length < 3) return null;
  const regionPart = parts.pop()!;
  const cityPart = parts.pop()!;
  const region = withoutPostal(regionPart);
  const city = withoutPostal(cityPart);
  // A city with digits in it is more of the street: the address doesn't say its city apart.
  if (!region || !city || /\d/.test(city)) return null;
  const postal = ownPostal || POSTAL.exec(regionPart)?.[1] || POSTAL.exec(cityPart)?.[1] || "";
  return { street: parts.join(", "), city, region, postal, country };
}

/** The country a saved location or address is in, as a form's country list names it: the country its last part names,
 * else "United States" for a US state. */
function countryIn(text: string): string | null {
  const address = addressParts(text);
  if (address) return address.country || (isUsState(canonical(address.region)) ? "United States" : null);
  const parts = withoutNotes(text).split(",").map((part) => withoutPostal(part.trim())).filter(Boolean);
  return countryEnding(parts) ?? (inTheUs(text) ? "United States" : null);
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

/** What follows the first `count` digits of `text`: the separators or bracket after them go, and a "(0)" trunk prefix. */
function afterDigits(text: string, count: number): string {
  let at = 0;
  for (let seen = 0; at < text.length && seen < count; at += 1) {
    if (/\d/.test(text[at]!)) seen += 1;
  }
  return text.slice(at).replace(/^[\s).\-/]+/, "").replace(/^\(0\)\s*/, "").trim();
}

/** A phone number as résumés write it, in any country's way, split into its calling code and the number, which forms
 * often want apart: "+1 (214) 555-0167", "+447946095800", "0044 20 7946 0958", "(+91) 98765-43210", "+44 (0)20 7946
 * 0958". Written with "+" or "00", the digits after it start with the code. Written without, the number is only taken
 * for one with a code when it's longer than a country's own (more than ten digits) and its first group is a code, as in
 * "91 98765 43210", or it's all one run starting with one, as in "919876543210"; so "212 555 0167" stays a New York
 * number. Exported for its tests. */
export function splitPhone(phone: string): { dial: string; number: string } {
  const value = phone.trim();
  const international = INTERNATIONAL.exec(value);
  if (international) {
    const rest = value.slice(international[0].length);
    const code = callingCodeOf(rest.replace(/\D/g, ""));
    return code ? { dial: code, number: afterDigits(rest, code.length) } : { dial: "", number: value };
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length > 10 && !digits.startsWith("0")) {
    const group = FIRST_GROUP.exec(value)?.[1];
    const code = group ? (isCallingCode(group) ? group : null) : callingCodeOf(digits);
    if (code) return { dial: code, number: afterDigits(value, code.length) };
  }
  return { dial: "", number: value };
}

/** Whether a form wants the whole international number: by its words, or, in a box that takes text, by being a WhatsApp
 * number, by a placeholder that starts with "+", or by a phone widget that reads the country from the number. A box that
 * takes only a number wants the code only when it says so: such boxes are mostly a country's own ten digits. */
function wantsCode({ label, kind, clues }: Asked): boolean {
  const asks = normalize(label);
  if (WITHOUT.test(asks)) return false;
  if (WANTS_CODE.test(asks)) return true;
  return kind !== "number" && (WHATSAPP.test(asks) || (clues?.placeholder ?? "").trim().startsWith("+")
    || PHONE_WIDGET.test(clues?.className ?? ""));
}

/** Every way to write a saved phone number, in the order this field most likely takes them: with its "+" and code first
 * where the form wants the whole number, else the number without its code (the form asks the code apart, or it's the
 * form's own country's); digits alone first where the box takes only a number, as a number box drops a "+" or a space
 * and with it the whole value. A box with a length limit keeps only the ways that fit it, down to the number's own
 * digits: an Indian form's mobile box often takes ten. The first is what's written; the page tries the rest in turn
 * when the form refuses it, as some take only digits, with or without the code (#148). */
export function phoneWays(answer: string, asked: Asked): string[] {
  const { dial, number } = splitPhone(answer);
  const digits = number.replace(/\D/g, "");
  const whole = dial ? [`+${dial} ${number}`, `+${dial}${digits}`, `${dial}${digits}`] : [];
  const local = [number, digits];
  const wanted = wantsCode(asked);
  const ways = asked.kind === "number"
    ? (wanted && dial ? [`${dial}${digits}`, digits] : [digits, ...whole.slice(2)])
    : wanted ? (dial ? [...whole, ...local] : [answer.trim(), digits]) : [...local, ...whole];
  const unique = [...new Set(ways.filter(Boolean))];
  const limit = asked.maxLength ?? null;
  const fitting = unique.filter((way) => limit === null || way.length <= limit);
  return fitting.length > 0 ? fitting : unique.slice(0, 1);
}

const phoneFor = (answer: string, asked: Asked) => phoneWays(answer, asked)[0] ?? answer;

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

/** A bank answer as this field wants it: a phone number as `phoneFor` writes it, a location without its ZIP code or a
 * note (a city lookup wouldn't find it), the street alone where a form asks the street of a whole saved address, a
 * profile's user name where one is asked for, and a start date that hasn't passed. A date box can't take "Immediately",
 * so it takes today. */
export function shaped(type: EngineFieldType | null, answer: string, asked: Asked): string {
  const { label, kind } = asked;
  const asks = normalize(label);
  if (type === "phone") return phoneFor(answer, asked);
  if (type === "city-state") return placeWithoutPostal(answer);
  if (type === "address-line1" && STREET_ONLY.test(asks)) return addressParts(answer)?.street || answer;
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

/** A saved number with no calling code, given the code of the country the candidate lives in when the field wants the
 * whole number: "98765 43210" in a WhatsApp box, with "Hyderabad, Telangana, India" saved, is "+91 98765 43210". A trunk
 * 0 goes, as in any international number: "07946 095800" in the UK is "+44 7946 095800". Any other field gets the number
 * as saved. */
export function withHomeCode(answer: string, asked: Asked, saved: Saved): string {
  if (!wantsCode(asked) || splitPhone(answer).dial) return answer;
  const code = /\+(\d{1,3})$/.exec(phoneCountry(saved)?.answer ?? "")?.[1];
  return code ? `+${code} ${answer.trim().replace(/^0+/, "")}` : answer;
}

/** A phone's calling code: the number's own, in any country's (`splitPhone`), else that of the country a saved location
 * or address is in, for a number saved without one (Q8): "Hyderabad, Telangana, India" is +91. The countries sharing +1
 * are named, so the US isn't taken for Canada. */
function phoneCountry(saved: Saved): Derived | null {
  const phone = saved("phone");
  const { dial } = splitPhone(phone?.answer ?? "");
  if (dial && dial !== "1") return { answer: `+${dial}`, source: phone! };
  if (dial) return { answer: "United States +1", source: phone! };
  for (const source of [saved("city-state"), saved("address-line1")]) {
    const country = source ? countryIn(source.answer) : null;
    const code = country ? callingCodeIn(country) : null;
    if (code) return { answer: code === "1" ? `${country} +1` : `+${code}`, source: source! };
  }
  return null;
}

/** "Do you have at least 5 years of experience?" Experience in a line of work is the BDE's to judge, so it never gets here. */
function minimumExperience(label: string, saved: Saved): Derived | null {
  const years = saved("years-experience");
  const held = Number.parseFloat(years?.answer ?? "");
  if (!years || !Number.isFinite(held)) return null;
  return { answer: held >= minimumYears(label)! ? "Yes" : "No", source: years };
}

/** A name's suffix, which goes with the last name: "King Jr.". Not "V": a name can end with an initial ("Ravi Kumar V"). */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
/** A title before a name: "Dr. Meera Krishnan". */
const NAME_TITLE = /^(mr|mrs|ms|miss|mx|dr|prof|sir)\.?$/i;
/** Credentials after a name: "Meera Krishnan, PhD". */
const CREDENTIAL = /^(ph\.?\s?d|m\.?d|mba|msc|bsc|pmp|cpa|cfa|esq|dds|rn)\.?$/i;
/** Words that begin a last name of several: "van Beethoven", "de la Cruz", "bin Rashid". */
const NAME_PARTICLE = /^(de|del|della|da|das|dos|di|du|van|von|der|den|le|la|bin|binti|ibn|al|el)$/;

/** Where `part`'s words sit, in order, inside `words` (any case), else -1. */
function indexOfWords(words: string[], part: string[]): number {
  const [all, wanted] = [words.map((word) => word.toLowerCase()), part.map((word) => word.toLowerCase())];
  for (let at = 0; at + wanted.length <= all.length; at += 1) {
    if (wanted.every((word, index) => all[at + index] === word)) return at;
  }
  return -1;
}

/** A name's words without a title before them: "Dr. Meera Krishnan" is "Meera Krishnan". */
const withoutTitle = (words: string[]) => {
  const at = words.findIndex((word) => !NAME_TITLE.test(word));
  return at < 0 ? [] : words.slice(at);
};
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** A saved full name in the parts a form's First, Middle and Last name boxes take, however many words it has (Q6): the
 * first word and the last, the words between being the middle name, unless a saved middle name says where the first
 * name ends and the last begins ("Mohammed Arbazuddin Qureshi" with "Arbazuddin" saved). A last name keeps the particles
 * before it ("van Beethoven") and a suffix after it ("King Jr."); a title before the name and credentials after a comma
 * aren't the name ("Dr. Meera Krishnan, PhD"). With a comma, the last name comes first: "Krishnan, Meera Devi". One word
 * is a first name alone: a form's last name is then left to the BDE. */
function nameParts(saved: Saved): { first: string; middle: string; last: string; source: BankEntry } | null {
  const full = saved("full-name");
  if (!full) return null;
  const pieces = full.answer.split(",").map((part) => part.trim()).filter(Boolean);
  // After a comma: credentials go, a suffix joins the name ("Martin Luther King, Jr.").
  let suffix = "";
  while (pieces.length > 1 && wordsOf(pieces.at(-1)!).every((word) => CREDENTIAL.test(word) || NAME_SUFFIX.test(word))) {
    const suffixes = wordsOf(pieces.pop()!).filter((word) => NAME_SUFFIX.test(word));
    suffix = [...suffixes, suffix].filter(Boolean).join(" ");
  }
  if (pieces.length > 2 || pieces.length === 0) return null;
  if (pieces.length === 2) {
    const [last, rest] = [pieces[0]!, withoutTitle(wordsOf(pieces[1]!))];
    if (rest.length === 0) return null;
    return { first: rest[0]!, middle: rest.slice(1).join(" "), last: [last, suffix].filter(Boolean).join(" "), source: full };
  }
  const words = [...withoutTitle(wordsOf(pieces[0]!)), ...wordsOf(suffix)];
  if (words.length === 0) return null;
  if (words.length === 1) return { first: words[0]!, middle: "", last: "", source: full };
  const middle = wordsOf(saved("middle-name")?.answer ?? "");
  const at = middle.length > 0 ? indexOfWords(words, middle) : -1;
  if (at > 0 && at + middle.length < words.length) {
    return { first: words.slice(0, at).join(" "), middle: words.slice(at, at + middle.length).join(" "),
      last: words.slice(at + middle.length).join(" "), source: full };
  }
  let tail = words.length > 2 && NAME_SUFFIX.test(words.at(-1)!) ? 2 : 1;
  while (words.length - tail > 1 && NAME_PARTICLE.test(words[words.length - tail - 1]!)) tail += 1;
  return { first: words[0]!, middle: words.slice(1, -tail).join(" "), last: words.slice(-tail).join(" "), source: full };
}

/** A first or last name from a saved full name (`nameParts`), when it has one. */
function namePart(type: "first-name" | "last-name", saved: Saved): Derived | null {
  const parts = nameParts(saved);
  const answer = type === "first-name" ? parts?.first : parts?.last;
  return parts && answer ? { answer, source: parts.source } : null;
}

/** The middle name inside a saved full name of three words or more, when none is saved on its own (Q6). */
function middleName(saved: Saved): Derived | null {
  const parts = nameParts(saved);
  return parts?.middle ? { answer: parts.middle, source: parts.source } : null;
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

/** The city and state of the saved location, else of the saved address (`addressParts`). */
function placeIn(saved: Saved): { place: Place; source: BankEntry } | null {
  const location = saved("city-state");
  const fromLocation = location ? placeOf(location.answer) : null;
  if (fromLocation && location) return { place: fromLocation, source: location };
  const address = saved("address-line1");
  const fromAddress = address ? addressParts(address.answer) : null;
  return fromAddress && address ? { place: fromAddress, source: address } : null;
}

/** The country of the saved location, else of the saved address (`countryIn`). */
function countryOf(saved: Saved): { country: string; source: BankEntry } | null {
  for (const source of [saved("city-state"), saved("address-line1")]) {
    const country = source ? countryIn(source.answer) : null;
    if (country && source) return { country, source };
  }
  return null;
}

/** A preferred name, when none is saved: the first name, saved or in the full name. */
function preferredName(saved: Saved): Derived | null {
  const first = saved("first-name");
  return first ? { answer: first.answer.trim(), source: first } : namePart("first-name", saved);
}

export function derivedAnswer(type: EngineFieldType, { label, kind }: Asked, saved: Saved): Derived | null {
  const found = placeIn(saved);
  const fromPlace = (answer: string) => (found && answer ? { answer, source: found.source } : null);
  const country = countryOf(saved);
  switch (type) {
    case "first-name":
    case "last-name": return namePart(type, saved);
    case "middle-name": return middleName(saved);
    case "full-name": return fullName(saved);
    case "preferred-name": return preferredName(saved);
    // A city lookup lists every Springfield: the state is what picks one.
    case "address-city": return fromPlace(found && kind === "combobox" && found.place.region ? `${found.place.city}, ${found.place.region}` : found?.place.city ?? "");
    case "address-region": return fromPlace(found?.place.region ?? "");
    case "address-postal": return postalCode(saved);
    case "address-country": return country ? { answer: country.country, source: country.source } : null;
    // Where the candidate lives, from the saved address when no location is saved: "Hyderabad, Telangana".
    case "city-state": return fromPlace(found && found.place.region ? `${found.place.city}, ${found.place.region}` : "");
    // Only a yes: "Do you live and work in North America?" is the same question, and a Canadian's answer to it isn't no.
    case "lives-in-us": return country?.country === "United States" ? { answer: "Yes", source: country.source } : null;
    case "phone-country-code": return phoneCountry(saved);
    case "minimum-experience": return minimumExperience(label, saved);
    case "start-date": return kind === "date" ? startFromNotice(saved) : null;
    case "todays-date": return { answer: today() };
    default: return null;
  }
}
