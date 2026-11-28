import type { FieldWrite, TabField } from "./types";

/** A single box ("I agree…", "Are you 18 or over?") answered in the panel: tick it, or leave it unticked. */
export const TICK_IT = "Yes";
export const LEAVE_IT = "No";

/** What a question that shows its answers offers in the panel, read with the page: a select's options, a radio group's
 * or a box group's, or Yes and No for a single box. Null for any other field, a dropdown whose options load only once
 * it's opened among them. */
export function ownOptions(field: Pick<TabField, "kind" | "options">): string[] | null {
  if (field.kind !== "select" && field.kind !== "radio" && field.kind !== "checkbox") return null;
  if (field.options.length > 0) return field.options.map(({ label }) => label);
  return field.kind === "checkbox" ? [TICK_IT, LEAVE_IT] : null;
}

/** The write that puts the answer the BDE picked in the panel on such a question; null for an answer it doesn't offer. */
export function writeFor(field: Pick<TabField, "kind" | "options">, label: string): FieldWrite | null {
  if (field.kind === "checkbox" && field.options.length === 0) return label === TICK_IT || label === LEAVE_IT ? { type: "check", checked: label === TICK_IT } : null;
  const option = field.options.find((item) => item.label === label);
  if (!option) return null;
  return field.kind === "checkbox" ? { type: "check", checked: true, optionIds: [option.id] } : { type: "option", optionId: option.id };
}

/** What BenchQ leaves to the page even when the BDE picks: a CAPTCHA, and account and payment details. */
const PICKED_ON_THE_PAGE = new Set(["CAPTCHA", "Password", "Account details", "Payment details", "File upload"]);

/** Whether the BDE can answer this row from the panel: a question whose answers the form shows, yes or no among them and
 * the sensitive ones BenchQ never fills by itself, or a dropdown (Greenhouse's Yes or No "Select…"), whose options the
 * panel reads from the page when the BDE opens it. */
export function isChoosable(row: { status: string; reason?: string; canChoose?: boolean; field: Pick<TabField, "kind" | "options"> }): boolean {
  if (row.status !== "manual" && row.status !== "blocked") return false;
  if (row.status === "blocked" && PICKED_ON_THE_PAGE.has(row.reason ?? "")) return false;
  return Boolean(row.canChoose) || row.field.kind === "combobox" || ownOptions(row.field) !== null;
}
