import type { EngineFieldType } from "../engine/field-types";
import { normalize } from "./text";

/** Pay comes hourly or yearly, and BenchQ never converts one into the other: a C2C rate isn't a salary. */

type Unit = "hourly" | "yearly";

const PAY = new Set<EngineFieldType>(["salary-expectation", "current-pay", "pay-rate"]);
const HOURLY = /\b(per hour|hourly|an hour|hr|hrs|ph|p h)\b/;
const YEARLY = /\b(per year|per annum|annual|annually|yearly|yr|pa|p a|lpa|ctc|package)\b/;
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i;

function unitIn(text: string): Unit | null {
  if (HOURLY.test(text)) return "hourly";
  return YEARLY.test(text) ? "yearly" : null;
}

/** What a saved answer says, else its size: an hourly rate never runs to thousands. */
function answerUnit(answer: string): Unit | null {
  const said = unitIn(normalize(answer));
  if (said) return said;
  const [, digits, thousands] = AMOUNT.exec(answer) ?? [];
  if (!digits) return null;
  const amount = Number(digits.replace(/,/g, "")) * (thousands ? 1000 : 1);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount >= 1000 ? "yearly" : "hourly";
}

/** What a field's label says, else what its kind usually means: a rate is hourly, a salary yearly. */
function fieldUnit(type: EngineFieldType, label: string, statedOnly: boolean): Unit | null {
  const words = normalize(label);
  const said = unitIn(words);
  if (said || statedOnly) return said;
  if (type === "pay-rate") return "hourly";
  return /\b(salary|ctc|package)\b/.test(words) ? "yearly" : null;
}

/** Why a saved pay answer can't go into this field, or null when it can. `statedOnly` goes by a unit the label states,
 * for an answer saved for this very question: the BDE's "$85/hr" for "Expected salary" is what they meant to give. */
export function payUnitClash(type: EngineFieldType | null, label: string, answer: string, statedOnly = false): string | null {
  if (!type || !PAY.has(type)) return null;
  const [wanted, saved] = [fieldUnit(type, label, statedOnly), answerUnit(answer)];
  return wanted && saved && wanted !== saved ? `This field asks for ${wanted} pay, and the saved answer is ${saved}.` : null;
}
