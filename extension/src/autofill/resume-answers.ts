import { LOCATION, WORK_AUTHORIZED } from "./answer-keys";
import { authorizedIn } from "./authorization";
import { canonical } from "./text";
import type { BankEntry } from "./types";

/** A résumé version's autofill (docs/02 §8.1) as the answers the matcher reads: each one text, a fixed answer with its
 * key. Answers come typed; they're written here the way a form takes them:
 * - true and false are Yes and No;
 * - a date ("2026-12-01") is written the US way, 12/01/2026, which a date box still reads;
 * - the target rate is hourly in BenchQ ($/hr), so 85 is "$85/hr": no salary box takes it for a yearly figure;
 * - a notice period in days is "14 days", or "Immediately" for none, which a start-date box can count from;
 * - a list of words is one line, and a list of places parts them with semicolons ("Dallas, TX; Austin, TX");
 * - a list of jobs, schools, projects or awards answers no one field, so it's left out, as is an empty answer.
 *
 * A question the BDE saved with other wordings (`also`, docs/02 §8.1) answers each of them with the same answer.
 *
 * Two answers are worked out from the others: whether the candidate may work in the US, from their status (all eight
 * statuses BenchQ records may; a status typed in reads as it says), and where they live, from the city and state. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Lists whose items hold commas of their own. */
const PLACE_LISTS = new Set(["preferred-locations"]);
const CATEGORIES: Record<string, string> = {
  "work-auth-status": "WORK_AUTH", "work-auth-expiry": "WORK_AUTH", "visa-sponsorship": "WORK_AUTH", "visa-transfer": "WORK_AUTH",
  [WORK_AUTHORIZED]: "WORK_AUTH", "pay-rate": "COMPENSATION", "start-date": "AVAILABILITY", "notice-period-days": "AVAILABILITY",
  "relocation-willing": "RELOCATION", "work-settings": "RELOCATION", "preferred-locations": "RELOCATION", "years-experience": "EXPERIENCE",
};
const US = new Set(["us", "usa", "united states", "united states of america", "america"]);

function textOf(key: string | null, answer: unknown): string | null {
  if (typeof answer === "string") {
    const text = answer.trim();
    const date = ISO_DATE.exec(text);
    return date ? `${date[2]}/${date[3]}/${date[1]}` : text || null;
  }
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  if (typeof answer === "number") {
    if (!Number.isFinite(answer)) return null;
    if (key === "pay-rate") return `$${answer}/hr`;
    if (key === "notice-period-days") return answer === 0 ? "Immediately" : `${answer} day${answer === 1 ? "" : "s"}`;
    return String(answer);
  }
  if (!Array.isArray(answer)) return null;
  const items = answer.filter((item) => typeof item === "string" || typeof item === "number").map((item) => String(item).trim()).filter(Boolean);
  if (items.length === 0 || items.length !== answer.length) return null;
  return items.join(key !== null && PLACE_LISTS.has(key) ? "; " : ", ");
}

const entryOf = (question: string, answer: string, key: string | null): BankEntry => ({
  id: key ? `key:${key}` : `custom:${question}`, question, answer, category: (key && CATEGORIES[key]) || "OTHER",
  ...(key ? { key } : {}),
});

function workedOut(bank: BankEntry[]): BankEntry[] {
  const answerOf = (key: string) => bank.find((entry) => entry.key === key)?.answer ?? "";
  const out: BankEntry[] = [];
  const status = answerOf("work-auth-status");
  const authorized = status ? authorizedIn(status) : null;
  if (authorized !== null) out.push(entryOf("Are you authorized to work in the US?", authorized ? "Yes" : "No", WORK_AUTHORIZED));
  const [city, region, country] = [answerOf("address-city"), answerOf("address-region"), answerOf("address-country")];
  if (city && region) {
    const place = country && !US.has(canonical(country)) ? `${city}, ${region}, ${country}` : `${city}, ${region}`;
    out.push(entryOf("Where do you live?", place, LOCATION));
  }
  return out;
}

/** The answers in `entries`, as the network gave them: anything that isn't a question with an answer is skipped, and a
 * question is answered once. */
export function answersFromResume(entries: unknown): BankEntry[] {
  if (!Array.isArray(entries)) return [];
  const bank: BankEntry[] = [];
  const asked = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { question, answer, key, also } = entry as { question?: unknown; answer?: unknown; key?: unknown; also?: unknown };
    if (typeof question !== "string" || !question.trim() || asked.has(question.trim())) continue;
    const named = typeof key === "string" && key.trim() ? key.trim() : null;
    const text = textOf(named, answer);
    if (text === null) continue;
    asked.add(question.trim());
    bank.push(entryOf(question.trim(), text, named));
    for (const wording of Array.isArray(also) ? also : []) {
      if (typeof wording !== "string" || !wording.trim() || asked.has(wording.trim())) continue;
      asked.add(wording.trim());
      bank.push(entryOf(wording.trim(), text, null));
    }
  }
  return [...bank, ...workedOut(bank)];
}
