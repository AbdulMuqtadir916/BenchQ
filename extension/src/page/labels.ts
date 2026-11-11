import type { FieldClues } from "../autofill/types";

/** Reading what a form calls its fields. Everything here only reads: nothing is cloned, marked or moved. */

const SKIPPED_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "OPTION", "SCRIPT", "STYLE", "SVG", "NOSCRIPT",
  "TEMPLATE", "UL"]);
const CONTROLS = "input, select, textarea";
export const PLACEHOLDER_OPTION = /^(select|choose|please select|please choose|--|—|none selected)/i;
const MAX_LABEL = 300;
const MAX_DEPTH = 4;
const MAX_HEADING_DEPTH = 6;
const MAX_DATA_ATTRS = 200;
const HEADINGS = "h1, h2, h3, h4, h5, h6, legend";
const UPLOAD_BUTTON = /^(attach|upload|browse|choose|select|add)( a| your)?( files?)?$/i;

export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Status messages wait in the page with `display: none`, and a person never reads those as part of a label. */
function isShown(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return true;
  return (node as Element).ownerDocument.defaultView?.getComputedStyle(node as Element).display !== "none";
}

export function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (SKIPPED_TAGS.has(element.tagName.toUpperCase()) || element.getAttribute("aria-hidden") === "true") return "";
  const nodes = Array.from(element.childNodes).filter((node) => node.nodeType !== Node.COMMENT_NODE && isShown(node));
  // Text nodes side by side are one run of text: React writes "+1" as "+" and "1". Elements are separate words.
  const joint = (index: number) => (index > 0 && (nodes[index]!.nodeType !== Node.TEXT_NODE
    || nodes[index - 1]!.nodeType !== Node.TEXT_NODE) ? " " : "");
  return nodes.map((node, index) => joint(index) + textOf(node)).join("");
}

/** A question's own last word isn't a mark: "Is visa sponsorship required" asks whether it's required. */
const ASKS = /^(is|are|do|does|did|will|would|can|could|should|has|have|was|were)\b/i;

export function hasRequiredMark(text: string): boolean {
  const label = collapse(text);
  return /[*✱∗]|\(required\)/i.test(label) || (!ASKS.test(label) && /\brequired\s*$/i.test(label));
}

export function hasOptionalMark(text: string): boolean {
  const label = collapse(text);
  return /\(optional\)/i.test(label) || (!ASKS.test(label) && /\boptional\s*$/i.test(label));
}

export function cleanLabel(text: string): string {
  const marked = collapse(text)
    .replace(/[*✱∗]/g, " ")
    .replace(/\((required|optional)\)/gi, " ");
  const label = ASKS.test(collapse(marked)) ? marked : marked.replace(/\b(required|optional)\s*$/i, " ");
  return collapse(label).replace(/[:\s]+$/, "");
}

function labelledBy(element: Element): string {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  return ids.map((id) => {
    const target = element.ownerDocument.getElementById(id);
    return target ? textOf(target) : "";
  }).join(" ");
}

/** A <label> can wrap a whole question: its wording, then the part holding the control, with the control's button and
 * status messages. The wording is whatever comes before that part. */
function wordingBefore(control: Element, label: Element): string {
  let level: Node | undefined = label;
  while (level && level !== control) {
    const children: Node[] = Array.from(level.childNodes);
    const branch: Node | undefined = children.find((child) => child.contains(control));
    const before = branch ? children.slice(0, children.indexOf(branch)) : [];
    const text = collapse(before.filter(isShown).map(textOf).join(" "));
    if (text) return text;
    level = branch;
  }
  return "";
}

function ownLabel(element: HTMLElement): string {
  const labelled = labelledBy(element);
  if (collapse(labelled)) return labelled;
  const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
  // A checkbox's or radio's label comes after it.
  const wordingFirst = !/^(checkbox|radio)$/.test((element as HTMLInputElement).type);
  for (const label of Array.from(labels ?? [])) {
    const text = (wordingFirst && wordingBefore(element, label)) || textOf(label);
    if (collapse(text)) return text;
  }
  return element.getAttribute("aria-label") ?? "";
}

/** The text just before a control, for forms that don't use a <label>. It stops at another control, because text
 * past one belongs to that control. */
function nearbyText(element: Element): string {
  let node: Element | null = element;
  for (let depth = 0; node && depth < MAX_DEPTH && !node.matches("form, body"); depth += 1) {
    for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {
      if (previous.matches(CONTROLS) || previous.querySelector(CONTROLS)) return "";
      const text = collapse(textOf(previous));
      if (text) return text.length <= MAX_LABEL ? text : "";
    }
    node = node.parentElement;
  }
  return "";
}

/** What an upload is for, when its own label doesn't say: the group around it, or a heading in the block that holds it. */
function uploadPurpose(input: Element): string {
  const group = input.closest("fieldset, [role='group']");
  const legend = group?.querySelector(":scope > legend");
  const named = collapse(legend ? textOf(legend) : group ? labelledBy(group) || group.getAttribute("aria-label") || "" : "");
  if (named) return named;
  let node = input.parentElement;
  for (let depth = 0; node && depth < MAX_DEPTH && !node.matches("form, body"); depth += 1) {
    const heading = node.querySelector(HEADINGS);
    if (heading) return collapse(textOf(heading));
    node = node.parentElement;
  }
  return "";
}

export function rawLabel(element: HTMLElement): string {
  const own = collapse(ownLabel(element));
  // An upload's own label is often just its button: "Attach".
  const isVague = (element as HTMLInputElement).type === "file" && (!own || UPLOAD_BUTTON.test(own));
  return (isVague && uploadPurpose(element))
    || own
    || nearbyText(element)
    || element.getAttribute("placeholder")
    || element.getAttribute("title")
    || "";
}

/** The nearest heading or legend above a field: the section it sits in. */
function sectionHeading(element: Element): string {
  let node: Element | null = element;
  for (let depth = 0; node && depth < MAX_HEADING_DEPTH && !node.matches("body"); depth += 1) {
    for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {
      const heading = previous.matches(HEADINGS) ? previous : previous.querySelector(HEADINGS);
      if (heading) return collapse(textOf(heading));
    }
    node = node.parentElement;
  }
  return "";
}

/** Everything else a field says about itself, for the engine. */
export function fieldClues(element: HTMLElement): FieldClues {
  const dataAttrs = Array.from(element.attributes)
    .filter(({ name }) => name.startsWith("data-"))
    .map(({ name, value }) => `${name} ${value}`).join(" ");
  return {
    name: element.getAttribute("name") ?? "", id: element.id, placeholder: element.getAttribute("placeholder") ?? "",
    ariaLabel: element.getAttribute("aria-label") ?? "", nearbyText: nearbyText(element),
    sectionHeading: sectionHeading(element), className: element.getAttribute("class") ?? "",
    dataAttrs: dataAttrs.slice(0, MAX_DATA_ATTRS),
  };
}

function commonAncestor(elements: Element[]): Element {
  let ancestor = elements[0]!.parentElement ?? elements[0]!;
  while (!elements.every((element) => ancestor.contains(element)) && ancestor.parentElement) {
    ancestor = ancestor.parentElement;
  }
  return ancestor;
}

/** A styled control that isn't an <input>: a `role="radio"`, `"checkbox"` or `"switch"`, or a toggle button. */
export const isAriaChoice = (element: Element) => element.tagName !== "INPUT"
  && (/^(radio|checkbox|switch)$/.test(element.getAttribute("role") ?? "") || element.hasAttribute("aria-pressed"));

export const ariaChecked = (element: Element) =>
  ["aria-checked", "aria-pressed", "aria-selected"].some((name) => element.getAttribute(name) === "true");

/** Whether a box, a radio, a styled one, or an option of a list box that keeps several choices is on. */
export function isOn(element: Element | undefined): boolean {
  if (element === undefined) return false;
  if (element.tagName === "OPTION") return (element as HTMLOptionElement).selected;
  return isAriaChoice(element) ? ariaChecked(element) : (element as HTMLInputElement).checked === true;
}

/** What a styled choice says: its own label, its words, else the text beside it. */
export function ariaLabelOf(element: HTMLElement): string {
  const named = collapse(labelledBy(element)) || collapse(element.getAttribute("aria-label") ?? "");
  const own = collapse(element.textContent ?? "");
  const beside = element.nextElementSibling ? collapse(textOf(element.nextElementSibling)) : "";
  return named || own || beside || nearbyText(element);
}

/** A radio or checkbox group's question: its legend or group label, else the text before the group. */
export function groupLabel(inputs: HTMLElement[]): string {
  const group = inputs[0]!.closest("fieldset, [role='radiogroup'], [role='group']");
  if (group && inputs.every((input) => group.contains(input))) {
    const legend = group.querySelector(":scope > legend");
    const named = legend ? textOf(legend) : labelledBy(group) || group.getAttribute("aria-label") || "";
    if (collapse(named)) return named;
    const before = nearbyText(group);
    if (before) return before;
  }
  return nearbyText(commonAncestor(inputs));
}

/** The text right beside a box comes first: a label can wrap a question or a long description as well as the option. */
export function optionLabel(input: HTMLInputElement): string {
  const beside = input.nextElementSibling ? collapse(textOf(input.nextElementSibling)) : "";
  const after = input.nextSibling ? collapse(textOf(input.nextSibling)) : "";
  return beside || collapse(ownLabel(input)) || after || input.value;
}

/** What a custom dropdown shows. Its value sits beside the input, which only holds search text. */
export function shownValue(control: HTMLElement): string {
  const plain = (text: string) => (PLACEHOLDER_OPTION.test(text) ? "" : text);
  if (control.tagName !== "INPUT") return plain(collapse(textOf(control)));
  const typed = (control as HTMLInputElement).value.trim();
  if (typed) return typed;
  const box = control.closest("[class*='__control'], [class*='-control']");
  return box && !box.querySelector("[class*='placeholder']") ? plain(collapse(textOf(box))) : "";
}

export function isVisible(element: Element): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return Boolean(style) && style?.visibility !== "hidden" && style?.display !== "none";
}

/** Styled radios and checkboxes often hide the input and show its label. */
export function isChoiceVisible(input: HTMLInputElement): boolean {
  return isVisible(input) || Array.from(input.labels ?? []).some(isVisible);
}

export const isFileInput = (element: Element): element is HTMLInputElement =>
  element.tagName === "INPUT" && (element as HTMLInputElement).type === "file";

/** The boxes an upload sits in, nearest first: its button, drop zone and chip live there. */
export function* uploadBoxes(input: HTMLInputElement) {
  let box = input.parentElement;
  for (let depth = 0; box && depth < 3; depth += 1, box = box.parentElement) yield box;
}

/** A styled upload hides its file input behind a button or a drop zone (07 Q53): the upload is on the form while the
 * input's label, or a box it sits in, shows. */
export function isUploadShown(input: HTMLInputElement): boolean {
  return Array.from(input.labels ?? []).some(isVisible) || [...uploadBoxes(input)].some(isVisible);
}

/** A file name as an upload's chip shows it: a name before the extension, so "Accepted: .pdf" isn't one. */
const FILE_NAME = /\S\.(?:pdf|docx?|rtf|odt|txt)$/i;

/** The file an upload shows when the page keeps it beside an emptied input, as a chip after the upload (07 Q53). */
export function shownFileName(input: HTMLInputElement): string {
  for (const box of uploadBoxes(input)) {
    const walker = box.ownerDocument.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = collapse(node.textContent ?? "");
      if (text.length <= 255 && FILE_NAME.test(text)) return text;
    }
  }
  return "";
}
