import { holdsSensitiveNumber } from "./never-fill";
import { KEY_TYPES } from "./answer-keys";
import { fieldLabel } from "./form-memory";
import { matchBank } from "./match";
import { typeOf } from "./review";
import { normalize } from "./text";
import type { BankEntry, ReviewRow } from "./types";

/**
 * What an answer the BDE typed saves as, for next time (07 Q18–Q22, Q58), as phase 3's save route takes it (docs/02
 * §8.3): a field of one of BenchQ's own questions is an edit of that question's key, sent with the built answer the BDE
 * was shown; any other field is a question of their own, in the form's words, or the saved one it matched. A field
 * BenchQ works out (authorized to work, where they live, a first name from the full one) can't be saved: those facts
 * are changed in BenchQ. A saved answer that's the same isn't offered; a different one offers to update it.
 */

export type SaveChange =
  | { edit: Record<string, unknown>; built: Record<string, unknown> }
  | { add: Record<string, string> };
export type SaveOffer = { label: string; change: SaveChange };

type Kind = "text" | "number" | "boolean" | "date";

/** BenchQ's own questions a typed value can stand for, by key, and what each takes. */
const SAVABLE: Record<string, Kind> = {
  "full-name": "text", email: "text", phone: "text", "linkedin-url": "text", "github-url": "text", "address-city": "text",
  "address-region": "text", "address-country": "text", "current-company": "text", "current-title": "text",
  "education-degree": "text", "education-school": "text", "graduation-year": "number", "years-experience": "number",
  "pay-rate": "number", "notice-period-days": "number", "relocation-willing": "boolean", "start-date": "date",
  "work-auth-expiry": "date",
};
const KEY_OF_TYPE = new Map(Object.entries(KEY_TYPES).flatMap(([key, type]) => (type && key in SAVABLE ? [[type, key] as const] : [])));
const MAX_ANSWER = 4000;
const NUMBER = /\d[\d,]*(?:\.\d+)?/;
/** A pay that isn't hourly: BenchQ keeps the rate per hour. */
const NOT_HOURLY = /\b(year|yr|annual|annum|month|week|k)\b/i;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `typed` as the question with `key` keeps it, or null when it can't say: a rate per year, a notice in weeks, a date
 * BenchQ can't read. */
function valueFor(key: string, typed: string): unknown {
  switch (SAVABLE[key]) {
    case "number": {
      if (key === "pay-rate" && NOT_HOURLY.test(typed)) return null;
      if (key === "notice-period-days" && !/^\s*\d+\s*(days?)?\s*$/i.test(typed)) return null;
      const found = NUMBER.exec(typed);
      return found ? Number(found[0].replace(/,/g, "")) : null;
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
 * answers the picked résumé gave (the route checks the one shown hasn't changed since). */
export function saveOffer(row: ReviewRow, bank: BankEntry[], built: ReadonlyMap<string, unknown>): SaveOffer | null {
  const typed = row.field.current.trim();
  if (!typed || typed.length > MAX_ANSWER || row.status === "blocked" || row.isUnsaved || row.field.kind === "file"
    || holdsSensitiveNumber(typed)) return null;
  const type = typeOf(row.field);
  if (type) {
    const key = KEY_OF_TYPE.get(type);
    const answer = key ? valueFor(key, typed) : null;
    if (!key || answer === null) return null;
    const saved = bank.find((entry) => entry.key === key)?.answer;
    if (saved !== undefined && normalize(saved) === normalize(typed)) return null;
    return { label: label(saved, typed), change: { edit: { [key]: answer }, built: { [key]: built.get(key) ?? null } } };
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
