import type { AutofillAnswer, AutofillAnswerType, AutofillChange, AutofillEntry } from "@/lib/schemas/resume-autofill";

/**
 * The Autofill tab's editing of a version's autofill (docs/02 §8.3, docs/04): the editor's draft and what it saves. How
 * the tab lays the answers out is `autofill-view.ts`. Pure, so the rules are tested without rendering the tab.
 */

/** Whether the user may change an answer here: never a list of records such as the work history (07 Q42). */
export const isEditable = (entry: AutofillEntry) => entry.type !== "entries";

/** The editor's text for an answer: a list one item per line, yes/no as the choice's value. */
export function draftOf(answer: AutofillAnswer | undefined): string {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  if (Array.isArray(answer)) return answer.filter((item): item is string => typeof item === "string").join("\n");
  return String(answer);
}

export type Parsed = { answer: AutofillAnswer } | { error: string };

const MAX_TEXT = 4000;
const isRealDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The editor's text as the question's type takes it (docs/02 §8.3), or what's wrong with it. A custom question's
 * answer is text. */
export function parseDraft(draft: string, type: AutofillAnswerType | null): Parsed {
  const value = draft.trim();
  switch (type ?? "text") {
    case "texts": {
      const items = draft.split("\n").map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return { error: "Add at least one, one per line." };
      return items.length <= 100 && items.every((item) => item.length <= 300) ? { answer: items } : { error: "Up to 100 lines of up to 300 characters." };
    }
    case "number": {
      const number = Number(value);
      return value !== "" && Number.isFinite(number) && number >= 0 && number < 1e7 ? { answer: number } : { error: "Enter a number." };
    }
    case "boolean":
      return value === "yes" ? { answer: true } : value === "no" ? { answer: false } : { error: "Choose yes or no." };
    case "date":
      return isRealDate(value) ? { answer: value } : { error: "Enter a date." };
    case "entries":
      return { error: "Change this in the résumé itself." };
    default:
      if (!value) return { error: "Write an answer." };
      return value.length <= MAX_TEXT ? { answer: value } : { error: `Keep it to ${MAX_TEXT} characters.` };
  }
}

const nothing = (onlyThis: boolean): AutofillChange => ({ edit: {}, built: {}, reset: [], add: {}, remove: [], onlyThis });

/** The user's answer to one of BenchQ's questions, sent with the built answer and the answer they were shown (07 Q14):
 * the route refuses a save over one changed since. */
export function editChange(entry: AutofillEntry, answer: AutofillAnswer, onlyThis: boolean): AutofillChange {
  const key = entry.key ?? "";
  const shown = entry.kind === "EDITED" ? (entry.built ?? null) : entry.answer;
  return { ...nothing(onlyThis), edit: { [key]: answer }, built: { [key]: shown }, answered: { [key]: entry.answer ?? null } };
}

/** Back to BenchQ's answer: the user's edit goes. Also "Use the new one" for an edit that stopped applying (07 Q15). */
export const resetChange = (entry: AutofillEntry, onlyThis: boolean): AutofillChange =>
  ({ ...nothing(onlyThis), reset: [entry.key ?? ""], answered: { [entry.key ?? ""]: entry.answer ?? null } });

/** "Keep mine" (07 Q15): the user's earlier answer again, over the built answer that replaced it. */
export const keepMineChange = (entry: AutofillEntry, onlyThis: boolean): AutofillChange => editChange(entry, entry.replaced ?? null, onlyThis);

/** A question of the user's own, new or answered again (the same words find it, 07 Q43). */
export const addChange = (question: string, answer: string, onlyThis: boolean): AutofillChange => ({ ...nothing(onlyThis), add: { [question.trim()]: answer.trim() } });

export const removeChange = (entry: AutofillEntry, onlyThis: boolean): AutofillChange => ({ ...nothing(onlyThis), remove: [entry.question] });

/** A question the user may add: not blank, not too long, and not in the words of one of BenchQ's (`asked`). */
export function questionError(question: string, asked: readonly AutofillEntry[]): string | null {
  const wording = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
  const value = question.trim();
  if (!value) return "Write the question.";
  if (value.length > 300) return "Keep the question to 300 characters.";
  const fixed = asked.find((entry) => entry.kind !== "CUSTOM" && wording(entry.question) === wording(value));
  return fixed ? "That's one of BenchQ's questions: change its answer above." : null;
}
