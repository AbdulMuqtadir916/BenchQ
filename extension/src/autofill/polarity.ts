import { canonical } from "./text";

const BARE = /^\s*(yes|no|y|n|true|false)\s*(?:$|[,.;:!()\-–—])/i;
const NO = /^(no i|not a|not hispanic|i am not|im not|i do not|i dont|i have not|i havent|i cannot|i cant|i will not|i wont)\b/;
const YES = /^(yes|i am|im|i do|i have|i can|i will|i identify as)\b/;
const DECLINED = /\b(wish|want|prefer|decline)\b/;

/** Whether an answer says yes or no. Only a real yes or no counts: "N/A", "No preference" and "I don't wish to answer"
 * are neither. */
export function polarity(text: string): "yes" | "no" | null {
  const bare = BARE.exec(text)?.[1]?.toLowerCase();
  if (bare) return ["yes", "y", "true"].includes(bare) ? "yes" : "no";
  const value = canonical(text);
  if (DECLINED.test(value)) return null;
  if (NO.test(value)) return "no";
  return YES.test(value) ? "yes" : null;
}
