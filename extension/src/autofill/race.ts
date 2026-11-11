import { canonical, hasPhrase } from "./text";
import type { FieldOption } from "./types";

/** Race and ethnicity as forms list it. Forms name the same groups many ways ("Black / of African or African-American
 * descent", "East Asian (inclusive of Chinese, Japanese, …)"), so options and saved answers are both read as groups.
 * Only what the candidate saved is used: a broad "Asian" never becomes one of Asia's regions, and race is never worked
 * out from nationality or location. */

type Group = "american-indian" | "asian" | "black" | "hispanic" | "middle-eastern" | "pacific-islander" | "white" | "two-or-more";
type Region = "east-asian" | "south-asian" | "southeast-asian";
type Kind = { group: Group; region?: Region };

/** The words that name each group, longest first so "American Indian" isn't read as "Indian". */
const NAMES: [string, Group, Region?][] = ([
  ["american indian", "american-indian"], ["alaska native", "american-indian"], ["alaskan native", "american-indian"],
  ["native american", "american-indian"], ["indigenous american", "american-indian"], ["indigenous", "american-indian"],
  ["first nations", "american-indian"],
  ["black", "black"], ["african american", "black"], ["african", "black"], ["afro caribbean", "black"],
  ["white", "white"], ["caucasian", "white"], ["european", "white"],
  ["hispanic", "hispanic"], ["latino", "hispanic"], ["latina", "hispanic"], ["latinx", "hispanic"], ["latine", "hispanic"],
  ["spanish origin", "hispanic"],
  ["middle eastern", "middle-eastern"], ["middle east", "middle-eastern"], ["north african", "middle-eastern"], ["mena", "middle-eastern"],
  ["arab", "middle-eastern"],
  ["pacific islander", "pacific-islander"], ["native hawaiian", "pacific-islander"], ["hawaiian", "pacific-islander"],
  ["samoan", "pacific-islander"], ["guamanian", "pacific-islander"], ["chamorro", "pacific-islander"], ["fijian", "pacific-islander"],
  ["tongan", "pacific-islander"], ["polynesian", "pacific-islander"], ["micronesian", "pacific-islander"], ["melanesian", "pacific-islander"],
  ["two or more", "two-or-more"], ["multiracial", "two-or-more"], ["multi racial", "two-or-more"], ["mixed race", "two-or-more"],
  ["biracial", "two-or-more"], ["more than one race", "two-or-more"],
  ["south asian", "asian", "south-asian"], ["asian indian", "asian", "south-asian"], ["indian", "asian", "south-asian"],
  ["pakistani", "asian", "south-asian"], ["bangladeshi", "asian", "south-asian"], ["sri lankan", "asian", "south-asian"],
  ["nepali", "asian", "south-asian"], ["nepalese", "asian", "south-asian"], ["bhutanese", "asian", "south-asian"],
  ["afghan", "asian", "south-asian"], ["afghani", "asian", "south-asian"], ["maldivian", "asian", "south-asian"],
  ["southeast asian", "asian", "southeast-asian"], ["south east asian", "asian", "southeast-asian"], ["filipino", "asian", "southeast-asian"],
  ["filipina", "asian", "southeast-asian"], ["vietnamese", "asian", "southeast-asian"], ["thai", "asian", "southeast-asian"],
  ["cambodian", "asian", "southeast-asian"], ["laotian", "asian", "southeast-asian"], ["hmong", "asian", "southeast-asian"],
  ["burmese", "asian", "southeast-asian"], ["indonesian", "asian", "southeast-asian"], ["malaysian", "asian", "southeast-asian"],
  ["singaporean", "asian", "southeast-asian"], ["mien", "asian", "southeast-asian"],
  ["east asian", "asian", "east-asian"], ["chinese", "asian", "east-asian"], ["japanese", "asian", "east-asian"],
  ["korean", "asian", "east-asian"], ["mongolian", "asian", "east-asian"], ["tibetan", "asian", "east-asian"],
  ["taiwanese", "asian", "east-asian"],
  ["asian", "asian"],
] as [string, Group, Region?][]).sort(([left], [right]) => right.length - left.length);

/** A list that names peoples or places in a group: "(inclusive of Chinese, Japanese, …)". */
const MEMBERS = /^(inclusive of|including|includes|incl|e g|eg|such as|for example|i e)\b/;
const NOT_HISPANIC = /\b(not|non) hispanic\b/;
const ANSWER_PARTS = /\s*(?:[,;&+]|\band\b)\s*/;

/** The groups a text names, each once, the most specific wording first. */
function kindsIn(text: string): Kind[] {
  let rest = ` ${canonical(text)} `;
  const kinds: Kind[] = [];
  for (const [name, group, region] of NAMES) {
    if (!hasPhrase(rest.trim(), name)) continue;
    rest = rest.replace(` ${name} `, " ");
    if (!kinds.some((kind) => kind.group === group && kind.region === region)) kinds.push({ group, region });
  }
  // "South Asian" says Asian as well: the region is the answer.
  return kinds.filter((kind) => kind.region || !kinds.some((other) => other.group === kind.group && other.region));
}

type ReadOption = { option: FieldOption; kinds: Kind[]; members: Kind[]; notHispanic: boolean };

/** An option's group, the peoples its "inclusive of" list names, and whether it says it's not Hispanic. */
function readOption(option: FieldOption): ReadOption {
  const asides = [...option.label.matchAll(/\(([^)]*)\)/g)].map(([, aside]) => canonical(aside!));
  const main = option.label.replace(/\([^)]*\)/g, " ");
  return {
    option, kinds: kindsIn(main),
    members: asides.filter((aside) => MEMBERS.test(aside)).flatMap((aside) => kindsIn(aside.replace(MEMBERS, " "))),
    notHispanic: asides.some((aside) => NOT_HISPANIC.test(aside)) || NOT_HISPANIC.test(canonical(main)),
  };
}

/** The words a race option leads with. Peoples like "Chinese" aren't here: a list of languages names those too. */
const RACE_WORDS = /\b(american indian|alaskan? native|native american|indigenous|black|african american|white|caucasian|hispanic|latin[oaxe]|middle eastern|pacific islander|native hawaiian|two or more|multiracial|asian)\b/;

const only = (found: ReadOption[]) => (found.length === 1 ? found[0]!.option.id : null);
const names = (read: ReadOption, kind: Kind) => read.kinds.some((own) => own.group === kind.group && own.region === kind.region);

/** The options that stand for the candidate's group: its own option, else, for a region of Asia, an option listing it
 * ("Indian" in "Asian (inclusive of Indian, Chinese, …)"), then plain "Asian", unless the form splits Asia into
 * regions and none is this one. */
function optionsFor(kind: Kind, read: ReadOption[]): ReadOption[] {
  const exact = read.filter((item) => names(item, kind));
  if (exact.length > 0 || !kind.region) return exact;
  const listing = read.filter((item) => item.members.some((member) => member.region === kind.region));
  if (listing.length > 0) return listing;
  if (read.some((item) => item.kinds.some((own) => own.group === "asian" && own.region))) return [];
  return read.filter((item) => item.kinds.some((own) => own.group === "asian" && !own.region));
}

/** Whether a list is a race list: two or more of its options lead with a race. */
export function isRaceList(options: FieldOption[]): boolean {
  return options.filter((option) => RACE_WORDS.test(canonical(option.label.replace(/\([^)]*\)/g, " ")))).length >= 2;
}

/** The option a saved race answer means in a race list, null when it isn't clear (the BDE picks), or undefined when the
 * list or the answer isn't about race. Several races saved pick "Two or More Races", or none. A saved Hispanic answer
 * picks the Hispanic option, as these forms ask; with none on the list, the race decides. */
export function raceOptionFor(answer: string, options: FieldOption[]): string | null | undefined {
  if (!isRaceList(options)) return undefined;
  const parts = answer.split(ANSWER_PARTS).map((part) => part.trim()).filter(Boolean);
  const said = parts.flatMap((part) => (NOT_HISPANIC.test(canonical(part)) ? [] : kindsIn(part)));
  if (said.length === 0) return undefined;
  const read = options.map(readOption);
  if (said.some(({ group }) => group === "hispanic")) {
    const hispanic = read.filter((item) => item.kinds.some(({ group }) => group === "hispanic") && !item.notHispanic);
    if (hispanic.length > 0) return only(hispanic);
  }
  const races = said.filter(({ group }) => group !== "hispanic");
  const groups = new Set(races.map(({ group }) => group));
  if (groups.size === 0) return undefined;
  if (groups.size > 1 || races.some(({ group }) => group === "two-or-more")) {
    return only(read.filter((item) => item.kinds.some(({ group }) => group === "two-or-more")));
  }
  // One group, maybe said more than one way ("Asian (Indian)"): the most specific wording.
  return only(optionsFor(races.find(({ region }) => region) ?? races[0]!, read));
}

/** The parts of a saved race answer a multi-choice list should tick: each must find its option, else none are ticked.
 * A Hispanic part is dropped when the list has no Hispanic option, since the form asks that elsewhere. */
export function racePartsFor(answer: string, options: FieldOption[]): string[] | undefined {
  if (!isRaceList(options)) return undefined;
  const parts = answer.split(ANSWER_PARTS).map((part) => part.trim()).filter(Boolean);
  const read = options.map(readOption);
  const hasHispanic = read.some((item) => item.kinds.some(({ group }) => group === "hispanic") && !item.notHispanic);
  return parts.filter((part) => hasHispanic || !kindsIn(part).every(({ group }) => group === "hispanic") || kindsIn(part).length === 0);
}

/** Whether a saved answer to "Are you Hispanic or Latino?" says yes. */
export function saysHispanic(answer: string): boolean {
  const text = canonical(answer);
  if (NOT_HISPANIC.test(text) || /^(no|n)\b/.test(text)) return false;
  return /^(yes|y)\b/.test(text) || kindsIn(text).some(({ group }) => group === "hispanic");
}

/** A race answer with the candidate's Hispanic answer added, for forms that ask both in one list. */
export function withHispanic(race: string, hispanic: string | undefined): string {
  if (!hispanic || !saysHispanic(hispanic) || kindsIn(race).some(({ group }) => group === "hispanic")) return race;
  return `${race}, Hispanic or Latino`;
}
