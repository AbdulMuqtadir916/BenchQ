import { fieldTypeFor } from "../autofill/match";
import { normalize, questionOf, strongTokens, tokens } from "../autofill/text";
import type { BankEntry } from "../autofill/types";
import { classifyQuestion } from "./classify";
import type { EngineFieldType } from "./field-types";
import { similarity } from "./universal-ai-autofill/signals";

const CLOSE_ENOUGH = 0.85;
const LEAD = 0.03;
/** A word that flips or pins the answer can't be the one difference between two questions. */
const DECIDING = /^(\d.*|not|no|never|without|non|dont|cant|wont|doesnt|isnt|arent|now|future)$/;
/** A second phone or email the candidate keeps: the main one answers a form that asks for one. */
const ALTERNATE = /\b(alternate|alternative|secondary|second|other|additional|backup|work|office|home)\b/;
/** A saved "Ethnicity" can be the Hispanic question alone, which forms ask apart from race. */
const HISPANIC = /\b(hispanic|latin[oax]|latine)\b/;
const RACE = /\b(asian|white|black|african|native|pacific|islander|hawaiian|indian|alaska|two or more|multiracial|caucasian)\b/;

const agree = (entries: BankEntry[]) => new Set(entries.map(({ answer }) => normalize(answer))).size === 1;

/** What a bank question asks for. An "Ethnicity" that only says whether the candidate is Hispanic answers that
 * question, not the one about race. */
function typeOfQuestion(entry: BankEntry): EngineFieldType | null {
  const question = questionOf(entry.question);
  const type = fieldTypeFor({ label: question, kind: "select", autocomplete: "" }) ?? classifyQuestion(question);
  const answer = normalize(entry.answer);
  return type === "eeo-race" && HISPANIC.test(answer) && !RACE.test(answer) ? "eeo-hispanic" : type;
}

/** Entries by what their question asks for, so a form's field finds them however the question is worded. */
export function indexBankByType(bank: BankEntry[]): Map<EngineFieldType, BankEntry[]> {
  const index = new Map<EngineFieldType, BankEntry[]>();
  for (const entry of bank) {
    const type = typeOfQuestion(entry);
    if (type) index.set(type, [...(index.get(type) ?? []), entry]);
  }
  return index;
}

/** The entries for a type that `keep` lets answer this field, unless they disagree: then every one of them, for the BDE
 * to choose. A main phone or email outranks a second one. */
export function bankForType(index: Map<EngineFieldType, BankEntry[]>, type: EngineFieldType, keep: (entry: BankEntry) => boolean = () => true): BankEntry[] {
  const entries = (index.get(type) ?? []).filter(keep);
  if (agree(entries)) return entries.slice(0, 1);
  if (type !== "phone" && type !== "email") return entries;
  const main = entries.filter(({ question }) => !ALTERNATE.test(normalize(question)));
  return main.length > 0 && agree(main) ? main.slice(0, 1) : entries;
}

/** Whether a near-identical question really asks the same thing. The form may not ask for more than the bank entry
 * answers: "Years of experience with Java" is never answered by "Years of experience". */
function sameTopic(wanted: Set<string>, question: Set<string>): boolean {
  const formOnly = [...strongTokens(wanted)].filter((word) => !question.has(word));
  const bankOnly = [...strongTokens(question)].filter((word) => !wanted.has(word));
  return formOnly.length === 0 && bankOnly.length <= 1 && !bankOnly.some((word) => DECIDING.test(word));
}

/** universal-ai-autofill's bigram similarity, for questions worded a little differently. It rates long sentences that
 * differ by one word very highly, so `sameTopic` has the last say. `keep` can turn an entry down for this field. */
export function closestBankEntry(label: string, bank: BankEntry[], keep: (entry: BankEntry) => boolean = () => true): BankEntry | null {
  const wanted = tokens(label);
  if (strongTokens(wanted).size === 0) return null;
  const close = bank
    .filter((entry) => sameTopic(wanted, tokens(questionOf(entry.question))) && keep(entry))
    .map((entry) => ({ entry, score: similarity(label, questionOf(entry.question)) }))
    .filter(({ score }) => score >= CLOSE_ENOUGH)
    .sort((left, right) => right.score - left.score);
  const [best, next] = close;
  if (!best) return null;
  return next && best.score - next.score < LEAD && !agree([best.entry, next.entry]) ? null : best.entry;
}
