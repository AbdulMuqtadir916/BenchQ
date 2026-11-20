import { pickOption } from "./choice";
import { collapse, isVisible, sectionHeading } from "./labels";

/** What a form's "Add" button for a kind of history entry names, on itself or in the heading of its section. */
const KINDS = {
  education: /\b(education|school|degree|universit(y|ies)|college|qualification)/i,
  work: /\b(experience|employment|work|job|position|employer)/i,
};
const ADD = /^\s*(\+\s*)?add\b|\badd (another|more)\b/i;
const MAX_BUTTON = 60;

/** Clicks the form's "Add another" for a kind of history entry (#132): a button or link that says add, naming the kind
 * itself or sitting under a heading that does. Whether one was found. */
export function addEntry(doc: Document, kind: keyof typeof KINDS): boolean {
  const labelOf = (control: Element) => collapse(`${control.textContent ?? ""} ${control.getAttribute("aria-label") ?? ""}`);
  const adds = Array.from(doc.querySelectorAll<HTMLElement>("button, a, [role='button']"))
    .filter((control) => isVisible(control) && labelOf(control).length <= MAX_BUTTON && ADD.test(labelOf(control)));
  const target = adds.find((control) => KINDS[kind].test(labelOf(control)))
    ?? adds.find((control) => KINDS[kind].test(sectionHeading(control)));
  if (!target) return false;
  pickOption(target);
  return true;
}
