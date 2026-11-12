import { holdsSensitiveNumber } from "./never-fill";
import { KEY_TYPES } from "./answer-keys";
import { fieldLabel } from "./form-memory";
import { matchBank } from "./match";
import { typeOf } from "./review";
import { normalize, questionOf } from "./text";
import type { BankEntry, ReviewRow } from "./types";

/**
 * What an answer the BDE typed saves as, for next time (07 Q18–Q22, Q58), as phase 3's save route takes it (docs/02
 * §8.3): a field of one of BenchQ's own questions is an edit of that question's key, sent with the built answer the BDE
 * was shown; any other field is a question of their own, in the form's words, or the saved one it matched. A field
 * BenchQ works out (authorized to work, where they live, a first name from the full one) can't be saved: those facts
 * are changed in BenchQ. A saved answer that's the same isn't offered; a different one offers to update it.
 */

export type SaveChange =
  | { edit: Record<string, unknown>; built: Record<string, unknown>; answered?: Record<string, unknown> }
  | { add: Record<string, string> };
export type SaveOffer = { label: string; change: SaveChange };

type Kind = "text" | "number" | "boolean" | "date";

/** BenchQ's own questions a typed value can stand for, by key, and what each takes. */
const SAVABLE: Record<string, Kind> = {
  "full-name": "text", email: "text", phone: "text", "linkedin-url": "text", "github-url": "text", "address-city": "text",
  "address-region": "text", "address-country": "text", "current-company": "text", "current-title": "text",
  "education-degree": "text", "education-school": "text", "graduation-year": "number", "years-experience": "number",
  "pay-rate": "number", "notice-period-days": "number", "relocation-willing": "boolean", "start-date": "date",
  "work-auth-expiry": "date", "professional-title": "text",
  // The personal and screening questions the BDE answers (decided 2026-11-11, the floor rate 2026-11-12), as the
  // backend types them (`ANSWER_TYPES`). Not citizenship (the profile's status says it) or self-identification (never
  // kept from a form).
  "preferred-name": "text", "middle-name": "text", "address-line1": "text", "address-line2": "text",
  "address-postal": "text", "portfolio-url": "text", nationality: "text", "current-pay": "text",
  "salary-expectation": "number", "floor-rate": "number", "onsite-work": "boolean", "willing-to-travel": "text",
  commute: "boolean", "over-18": "boolean", "criminal-history": "boolean", "background-check": "boolean",
  "drug-test": "boolean", "security-clearance": "text", "non-compete": "boolean", "government-work": "boolean",
  "relative-at-company": "boolean", "former-employee": "boolean", accommodations: "boolean",
  "essential-functions": "boolean",
};
const KEY_OF_TYPE = new Map(Object.entries(KEY_TYPES).flatMap(([key, type]) => (type && key in SAVABLE ? [[type, key] as const] : [])));
const MAX_ANSWER = 4000;
const NUMBERS = /\d[\d,]*(?:\.\d+)?/g;
/** A number as people write one: 1200, 1,200 or 95.50, never 9,5,0. */
const WRITTEN_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
/** A pay that isn't hourly: BenchQ keeps the rate per hour. */
const NOT_HOURLY = /\b(?:year|yearly|yr|annual|annually|annum|month|monthly|week|weekly|salary)\b/i;
/** A pay given per hour, which a salary isn't. */
const HOURLY = /\b(?:hour|hourly|hr)\b|\/\s*h\b/i;
/** A number shortened with k ("$95k"): read as it is, it would be 95. */
const THOUSANDS = /\d\s*k\b/i;
/** The rates BenchQ keeps per hour: one over MAX_RATE is a salary or a slip, and a salary under MIN_SALARY is too. */
const RATES = new Set(["pay-rate", "floor-rate"]);
const MAX_RATE = 1000;
const MIN_SALARY = 1000;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `typed` as the question with `key` keeps it, or null when it can't say: a rate per year, a notice in weeks, a date
 * BenchQ can't read, a number shortened or given as a range. */
function valueFor(key: string, typed: string): unknown {
  switch (SAVABLE[key]) {
    case "number": {
      if (RATES.has(key) && NOT_HOURLY.test(typed)) return null;
      if (key === "salary-expectation" && HOURLY.test(typed)) return null;
      if (key === "notice-period-days" && !/^\s*\d+\s*(days?)?\s*$/i.test(typed)) return null;
      // One number, written out: "$95k", "90-100", "-5" or "9,5,0" can't be saved as one without a guess.
      const found = typed.match(NUMBERS) ?? [];
      if (found.length !== 1 || THOUSANDS.test(typed) || /-\s*\d/.test(typed) || !WRITTEN_NUMBER.test(found[0]!)) return null;
      const value = Number(found[0]!.replace(/,/g, ""));
      if ((RATES.has(key) && value > MAX_RATE) || (key === "salary-expectation" && value < MIN_SALARY)) return null;
      return value;
    }
    case "boolean": {
      const word = normalize(typed);
      return word === "yes" || word === "true" ? true : word === "no" || word === "false" ? false : null;
    }
    case "date": {
      const us = US_DATE.exec(typed.trim());
      const iso = us ? `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}` : typed.trim();
      return ISO_DATE.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
    }
    default:
      return typed;
  }
}

const label = (saved: string | undefined, typed: string) => (saved ? `Update the saved answer (${saved} → ${typed})` : "Save for next time");

/** What saving `row`'s typed value would do, or null when there's nothing to offer. `built` holds, by key, the built
 * answers the picked résumé gave, and `answered` (when given) the answers it gave, an edit or the built one: both go
 * with the save, so the route refuses one over an answer changed since (docs/02 §8.3). */
export function saveOffer(row: ReviewRow, bank: BankEntry[], built: ReadonlyMap<string, unknown>,
  answered?: ReadonlyMap<string, unknown>): SaveOffer | null {
  const typed = row.field.current.trim();
  if (!typed || typed.length > MAX_ANSWER || row.status === "blocked" || row.isUnsaved || row.field.kind === "file"
    || holdsSensitiveNumber(typed)) return null;
  const type = typeOf(row.field);
  // A form asking one of BenchQ's questions word for word asks that question, whatever kind of field it looks like:
  // "What is your professional title?" is the headline, not the job held.
  const asked = normalize(questionOf(fieldLabel(row.field)));
  const exact = new Set(bank.flatMap((entry) => (entry.key && normalize(questionOf(entry.question)) === asked ? [entry.key] : [])));
  if (exact.size === 1 || type) {
    const key = exact.size === 1 ? [...exact][0] : KEY_OF_TYPE.get(type!);
    const answer = key && key in SAVABLE ? valueFor(key, typed) : null;
    if (!key || answer === null) return null;
    const saved = bank.find((entry) => entry.key === key)?.answer;
    if (saved !== undefined && normalize(saved) === normalize(typed)) return null;
    const shown = answered ? { answered: { [key]: answered.get(key) ?? null } } : {};
    return { label: label(saved, typed), change: { edit: { [key]: answer }, built: { [key]: built.get(key) ?? null }, ...shown } };
  }
  const own = bank.filter((entry) => !entry.key);
  const match = matchBank(fieldLabel(row.field), own);
  const saved = match.status === "match" ? match.entry : undefined;
  if (saved && normalize(saved.answer) === normalize(typed)) return null;
  return { label: label(saved?.answer, typed), change: { add: { [saved?.question ?? fieldLabel(row.field)]: typed } } };
}

/** The built answer of each fixed question in a résumé's autofill (docs/02 §8.1): its answer, or what an edit replaced. */
export function builtAnswers(entries: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const entry of entries) {
    const { key, kind, answer, built } = (entry ?? {}) as { key?: unknown; kind?: unknown; answer?: unknown; built?: unknown };
    if (typeof key === "string" && key) out.set(key, kind === "EDITED" ? built ?? null : answer ?? null);
  }
  return out;
}

/** The answer of each fixed question in a résumé's autofill as the read gave it (an edit, else the built one); a
 * question the read left out had none. */
export function shownAnswers(entries: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const entry of entries) {
    const { key, answer } = (entry ?? {}) as { key?: unknown; answer?: unknown };
    if (typeof key === "string" && key) out.set(key, answer ?? null);
  }
  return out;
}
