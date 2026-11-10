/** Reducing a form's label or a bank question to the words that carry its meaning. */

const COUNTRY = /\b(united states of america|united states|u s a|u s|usa|america)\b/g;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as", "is", "are", "am",
  "be", "was", "were", "will", "would", "can", "could", "shall", "should", "may", "might", "do", "does", "did", "you",
  "your", "yours", "i", "im", "ive", "me", "my", "we", "our", "it", "its", "this", "that", "these", "those", "there",
  "here", "have", "has", "had", "having", "please", "kindly", "enter", "provide", "select", "choose", "indicate",
  "specify", "tell", "what", "which", "how", "many", "much", "when", "where", "who", "whom", "if", "any",
  "currently", "presently", "legally", "lawfully", "optional", "mandatory", "answer", "question",
]);

/** Words that say the same thing in different forms. */
const FAMILIES: Record<string, string> = {
  authorised: "authorized", authorisation: "authorized", authorization: "authorized", authorize: "authorized",
  authorise: "authorized", sponsor: "sponsorship", sponsored: "sponsorship", sponsoring: "sponsorship",
  relocating: "relocate", relocation: "relocate", experienced: "experience", salarie: "salary",
  need: "require", needed: "require", required: "require", requiring: "require",
  desired: "expected", expecting: "expected", expectation: "expected",
  expiry: "expiration", expire: "expiration", expiring: "expiration", expired: "expiration",
};

/** Words two questions can differ by and still ask the same thing. Everything else has to match. "Employer" and "time"
 * aren't here: they name what's asked, so "Employer name" isn't "Name", and "Time in current role" isn't the role. */
const WEAK_WORDS = new Set([
  "date", "earliest", "available", "expected", "visa", "employment", "statu", "legal", "address", "number", "detail",
  "information", "work", "us",
]);

/** What a label says beside its question: examples, a note, a unit, "(optional)", "as on your passport". */
const EXAMPLE_ASIDE = /\(\s*(?:e\.?\s?g\b|i\.?\s?e\b|ex\b|for (?:example|instance)|such as|example|note|optional|required|if (?:applicable|any)|as (?:it )?(?:appears |written |shown |printed |listed )?(?:on|in|per)\b)[^)]*\)/gi;
const UNIT_WORD = String.raw`(?:usd|inr|us dollars?|dollars?|rupees?|per (?:hour|year|annum|month)|hourly|annual(?:ly)?|yearly|monthly|in years|years|lpa|ctc|\$|₹)`;
const UNIT_ASIDE = new RegExp(String.raw`\(\s*(?:in\s+)?${UNIT_WORD}(?:[\s/,]+(?:in\s+)?${UNIT_WORD})*\s*\)`, "gi");
const DOCUMENT_NOTE = /\bas (?:it )?(?:appears |written |shown |printed |listed )?(?:on|in|per) (?:your |the )?(?:passport|government id|id|visa|license|licence)\b/gi;
const NOTE = /(\S)\s*\(?\s*\b(?:note|please note|nb)\b\s*[:,-].*$/i;

/** The question a label asks, without what it says beside it: "How did you hear about us (e.g. LinkedIn)?" asks how
 * they heard, and "Will you require sponsorship? (Note: we don't sponsor H-1B)" asks about sponsorship. A second
 * question after the first, like "If yes, how many years?", is part of what's asked, so it stays. */
export function questionOf(label: string): string {
  const mark = label.indexOf("?");
  const after = mark >= 0 ? label.slice(mark + 1) : "";
  const asked = /[a-z]/i.test(after) && !after.includes("?") ? label.slice(0, mark + 1) : label;
  const plain = asked.replace(EXAMPLE_ASIDE, " ").replace(UNIT_ASIDE, " ").replace(DOCUMENT_NOTE, " ").replace(NOTE, "$1");
  return plain.replace(/\s+/g, " ").trim() || label;
}

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonical(text: string): string {
  return normalize(text).replace(COUNTRY, "us");
}

function stem(word: string): string {
  const singular = word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return FAMILIES[singular] ?? singular;
}

export function tokens(text: string): Set<string> {
  return new Set(canonical(text).split(" ").filter((word) => word && !STOP_WORDS.has(word)).map(stem));
}

export const isWeak = (word: string) => WEAK_WORDS.has(word);

export function strongTokens(all: Set<string>): Set<string> {
  return new Set([...all].filter((word) => !isWeak(word)));
}

export function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((word) => right.has(word));
}

/** Both sides normalised: `phrase` appears in `text` as whole words. */
export function hasPhrase(text: string, phrase: string): boolean {
  return Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
}
