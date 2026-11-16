import type { FieldKind, FieldOption, FrameRead, FrameScan, PageSignals, ScannedField } from "../autofill/types";
import {
  ariaChecked, ariaLabelOf, cleanLabel, collapse, fieldClues, groupLabel, hasOptionalMark, hasRequiredMark, isAriaChoice, isChoiceVisible, isFileInput,
  isOn, isUploadShown, isVisible, optionLabel, PLACEHOLDER_OPTION, rawLabel, shownFileName, shownValue, textOf,
} from "./labels";
import { hostOf, queryDeep } from "./shadow";

/** One field of a scan: what the panel sees, and the elements a later fill writes to. */
export type Entry = {
  field: ScannedField;
  controls: HTMLElement[];
  options: Map<string, HTMLElement>;
};

/** The controls a scan finds, in order, and how many options each has. */
type Shape = { control: HTMLElement; size: number }[];

export type Registry = { scanId: number; entries: Map<string, Entry>; shape: Shape };

const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const INPUT_KINDS: Record<string, FieldKind> = {
  "": "text", text: "text", search: "text", email: "email", tel: "tel", url: "url", number: "number", date: "date",
  password: "password", file: "file", radio: "radio", checkbox: "checkbox",
};
const QUIET_MS = 300;
const MAX_WAIT_MS = 2500;
// A challenge widget's frames hold its own controls, like hCaptcha's language menu, and nothing of the form.
const CAPTCHA_FRAME = /^https?:\/\/(?:[^/]+\.)?(?:hcaptcha\.com|recaptcha\.net|arkoselabs\.com|funcaptcha\.com)\/|^https?:\/\/(?:www\.)?google\.com\/recaptcha\/|^https?:\/\/challenges\.cloudflare\.com\//i;

type Choice = HTMLInputElement & { type: "radio" | "checkbox" };

/** Styled radios, checkboxes, switches and toggle buttons, which aren't <input>s. */
const ARIA_CHOICES = "[role='radio'], [role='checkbox'], [role='switch'], button[aria-pressed], [role='button'][aria-pressed]";
/** Where a form's questions sit: not a site's header, a menu, or a dropdown's list. */
const FORM_AREA = "form, [role='form'], main, [role='main'], [role='dialog'], [aria-modal='true']";
const NOT_A_QUESTION = "header, nav, footer, [role='banner'], [role='navigation'], [role='contentinfo'], [role='listbox'], [role='menu'], [role='tree'], [role='grid'], [role='tablist'], [role='toolbar']";

/** Styled choices that answer one question: a radio group, toggle buttons side by side, or checkboxes in one group. */
type AriaGroup = { aria: HTMLElement[]; kind: "radio" | "checkbox" };
type Slot = HTMLElement | HTMLInputElement[] | AriaGroup;

/** A control keeps its id for as long as the page does: a page load starts afresh, with its own prefix. */
const LOAD = Math.random().toString(36).slice(2, 8);
const stableIds = new WeakMap<Element, string>();
let nextStableId = 0;

function stableIdOf(element: Element): string {
  const found = stableIds.get(element);
  if (found) return found;
  nextStableId += 1;
  const id = `${LOAD}-${nextStableId}`;
  stableIds.set(element, id);
  return id;
}

const isInput = (element: Element): element is HTMLInputElement => element.tagName === "INPUT";
const isSelect = (element: Element): element is HTMLSelectElement => element.tagName === "SELECT";
const isChoice = (element: Element): element is Choice =>
  isInput(element) && (element.type === "radio" || element.type === "checkbox");

/** A form's fields often arrive after load, so a scan waits for the page to go quiet. */
export function waitForQuiet(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, QUIET_MS);
    });
    const finish = () => {
      clearTimeout(quiet);
      clearTimeout(limit);
      observer.disconnect();
      resolve();
    };
    let quiet = setTimeout(finish, QUIET_MS);
    const limit = setTimeout(finish, MAX_WAIT_MS);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  });
}

function isPlaceholder(option: HTMLOptionElement): boolean {
  return option.value === "" || PLACEHOLDER_OPTION.test(collapse(option.text));
}

function kindOf(element: HTMLElement): FieldKind {
  if (isAriaChoice(element)) return element.getAttribute("role") === "radio" ? "radio" : "checkbox";
  if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup") === "listbox") return "combobox";
  const custom = element.hasAttribute("aria-autocomplete") || element.hasAttribute("aria-haspopup")
    || (element as HTMLInputElement).readOnly === true;
  if (custom) return "custom";
  if (element.tagName === "TEXTAREA") return "textarea";
  if (isSelect(element)) return element.multiple ? "custom" : "select";
  return isInput(element) ? INPUT_KINDS[element.type] ?? "custom" : "custom";
}

/** A sign-in or sign-up form, whose email is the BDE's account, never the candidate's: a form the field sits in, out
 * through the components around it, that holds a password field anywhere, a component's own too (the PR 129 review,
 * finding 2: `closest` and `querySelector` stop at a component's edge). */
function accountForm(element: HTMLElement): boolean {
  for (let node: Element | null = element; node; node = node.parentElement ?? hostOf(node)) {
    if (node.tagName !== "FORM") continue;
    // Each form is searched once a scan, not once per field: a large form was searched again for every field
    // (PR #140's review).
    let hasPassword = formsWithPassword.get(node);
    if (hasPassword === undefined) {
      hasPassword = queryDeep(node, "input[type='password']").length > 0;
      formsWithPassword.set(node, hasPassword);
    }
    if (hasPassword) return true;
  }
  return false;
}

/** Whether each form holds a password field, for the scan running now: set anew by every scan, since a form can gain
 * one later (a sign-up step). */
let formsWithPassword = new WeakMap<Element, boolean>();

/** What the BDE reads on the form comes first: a label saying "(optional)" beats whatever its markup says. */
function isRequired(elements: HTMLElement[], label: string): boolean {
  if (hasOptionalMark(label)) return false;
  return hasRequiredMark(label) || elements.some((element) => (element as HTMLInputElement).required === true
    || element.closest("[aria-required='true']") !== null);
}

function common(element: HTMLElement, id: string, kind: FieldKind, label: string): ScannedField {
  return {
    id, kind, label: cleanLabel(label), required: isRequired([element], label), current: "", options: [],
    hints: collapse(`${element.getAttribute("name") ?? ""} ${element.id}`), clues: fieldClues(element),
    autocomplete: element.getAttribute("autocomplete") ?? "",
    maxLength: null, inAccountForm: accountForm(element),
  };
}

/** What a field holds now, as the review list shows it. A password is never read, and an upload is its file name. */
export function readCurrent(entry: Entry): string {
  const [control] = entry.controls;
  if (!control) return "";
  if (entry.field.kind === "password") return "";
  if (entry.field.kind === "file") {
    const input = control as HTMLInputElement;
    return Array.from(input.files ?? [], ({ name }) => name).join(", ") || shownFileName(input);
  }
  if (entry.field.kind === "combobox") return shownValue(control);
  if (isSelect(control)) {
    const selected = control.selectedOptions[0];
    return selected && !isPlaceholder(selected) ? collapse(selected.text) : "";
  }
  if (entry.field.options.length > 0) {
    return entry.field.options
      .filter(({ id }) => isOn(entry.options.get(id)))
      .map(({ label }) => label).join(", ");
  }
  if (isAriaChoice(control)) return ariaChecked(control) ? "Checked" : "";
  if (isChoice(control)) return control.checked ? "Checked" : "";
  if (isInput(control) || control.tagName === "TEXTAREA") return (control as HTMLInputElement).value;
  return collapse(textOf(control));
}

/** A phone number's own "Country" dropdown holds a dialling code, not where the candidate lives. */
function labelOf(element: HTMLElement): string {
  if (isAriaChoice(element)) return ariaLabelOf(element);
  const label = rawLabel(element);
  const legend = element.closest("fieldset")?.querySelector(":scope > legend");
  return legend && /^country\b/i.test(label) && /\bphone\b/i.test(textOf(legend)) ? "Phone country code" : label;
}

function singleEntry(element: HTMLElement, id: string): Entry {
  const kind = kindOf(element);
  const field = common(element, id, kind, labelOf(element));
  const options: Entry["options"] = new Map();
  if (isSelect(element) && kind === "select") {
    Array.from(element.options).filter((option) => !isPlaceholder(option) && !option.disabled).forEach((option) => {
      const optionId = `o${option.index}`;
      options.set(optionId, option);
      field.options.push({ id: optionId, label: collapse(option.text) });
    });
  }
  const limit = (element as HTMLInputElement).maxLength;
  if (typeof limit === "number" && limit > 0) field.maxLength = limit;
  return { field, controls: [element], options };
}

function groupEntry(inputs: HTMLInputElement[], id: string): Entry {
  const first = inputs[0]!;
  const label = groupLabel(inputs);
  const field = common(first, id, first.type === "radio" ? "radio" : "checkbox", label);
  field.required = isRequired(inputs, label);
  const options: Entry["options"] = new Map();
  const list: FieldOption[] = inputs.map((input, index) => {
    const optionId = `o${index}`;
    options.set(optionId, input);
    return { id: optionId, label: optionLabel(input) };
  });
  field.options = list;
  return { field, controls: inputs, options };
}

/** A list box that keeps several choices, read like a group of checkboxes: its options are the boxes. */
function multiSelectEntry(select: HTMLSelectElement, id: string): Entry {
  const field = common(select, id, "checkbox", labelOf(select));
  const choices = Array.from(select.options).filter((option) => !isPlaceholder(option) && !option.disabled);
  const options: Entry["options"] = new Map();
  field.options = choices.map((option, index) => {
    options.set(`o${index}`, option);
    return { id: `o${index}`, label: collapse(option.text) };
  });
  return { field, controls: choices.length > 0 ? choices : [select], options };
}

/** A styled group's question and its options, which are its choices' own words. */
function ariaGroupEntry({ aria, kind }: AriaGroup, id: string): Entry {
  const label = groupLabel(aria);
  const field = common(aria[0]!, id, kind, label);
  field.required = isRequired(aria, label);
  const options: Entry["options"] = new Map();
  field.options = aria.map((element, index) => {
    options.set(`o${index}`, element);
    return { id: `o${index}`, label: collapse(element.getAttribute("aria-label") ?? "") || collapse(element.textContent ?? "") };
  });
  return { field, controls: aria, options };
}

/** A styled choice that's part of a form: shown, enabled, and not a control inside a menu or a site's header. One
 * that wraps a real input is that input's look, and the input stands for it. */
function isAriaQuestion(element: HTMLElement): boolean {
  return isVisible(element) && element.getAttribute("aria-disabled") !== "true" && !element.querySelector("input, select, textarea")
    && closestThrough(element, FORM_AREA) !== null && closestThrough(element, NOT_A_QUESTION) === null;
}

/** `closest()` through the components an element sits in: a choice inside a component under a form is in that form,
 * and one inside a component in a menu is in that menu. */
function closestThrough(element: Element, selector: string): Element | null {
  for (let at: Element | null = element; at; at = hostOf(at)) {
    const found = at.closest(selector);
    if (found) return found;
  }
  return null;
}

/** The group a styled choice answers with: its radio group, the toggle buttons beside it, or the checkboxes in its
 * group. Null when it stands alone. */
function ariaGroupOf(element: HTMLElement): { key: Element; kind: AriaGroup["kind"] } | null {
  if (element.getAttribute("role") === "radio") return { key: element.closest("[role='radiogroup']") ?? element.parentElement ?? element, kind: "radio" };
  if (element.hasAttribute("aria-pressed")) {
    const parent = element.parentElement;
    const toggles = parent ? Array.from(parent.children).filter((child) => child.hasAttribute("aria-pressed")) : [];
    return parent && toggles.length > 1 ? { key: parent, kind: "radio" } : null;
  }
  const group = element.closest("[role='group']");
  return group && group.querySelectorAll("[role='checkbox']").length > 1 ? { key: group, kind: "checkbox" } : null;
}

/** The form's controls in page order, radios and same-named checkboxes gathered where the first of them stands. */
function collectSlots(doc: Document): Slot[] {
  const slots: Slot[] = [];
  const groups = new Map<string, HTMLInputElement[]>();
  const ariaGroups = new Map<Element, AriaGroup>();
  // Each form by itself, one in a component too (doc.forms lists only the page's own).
  const formIds = new Map<HTMLFormElement, number>();
  const formOf = (form: HTMLFormElement | null) => {
    if (!form) return -1;
    if (!formIds.has(form)) formIds.set(form, formIds.size);
    return formIds.get(form)!;
  };
  // Radios of one name in two components are two groups: a component's names are its own.
  const trees = new Map<Node, number>();
  const treeOf = (element: Element) => {
    const tree = element.getRootNode();
    if (tree === doc) return "";
    if (!trees.has(tree)) trees.set(tree, trees.size);
    return `${trees.get(tree)}/`;
  };
  for (const element of queryDeep<HTMLElement>(doc, `input, textarea, select, ${ARIA_CHOICES}`)) {
    if (isAriaChoice(element)) {
      if (!isAriaQuestion(element)) continue;
      const grouping = ariaGroupOf(element);
      const found = grouping && ariaGroups.get(grouping.key);
      if (found) found.aria.push(element);
      else if (grouping) {
        const fresh = { aria: [element], kind: grouping.kind };
        ariaGroups.set(grouping.key, fresh);
        slots.push(fresh);
      } else slots.push(element);
      continue;
    }
    if (isInput(element) && IGNORED_TYPES.has(element.type)) continue;
    // A control hidden from people is the page's own plumbing, like the input a custom dropdown keeps beside it.
    if (element.matches(":disabled") || element.getAttribute("aria-hidden") === "true") continue;
    if (isChoice(element)) {
      if (!isChoiceVisible(element)) continue;
      if (!element.name) {
        // A box with its own value but no name is an option of the group around it, like Lever's "Custom" pronoun.
        const value = element.getAttribute("value");
        if (!value || value === "on") slots.push(element);
        continue;
      }
      const key = `${treeOf(element)}${formOf(element.form)}:${element.type}:${element.name}`;
      const group = groups.get(key);
      if (group) group.push(element);
      else {
        const fresh = [element];
        groups.set(key, fresh);
        slots.push(fresh);
      }
    } else if (isVisible(element) || (isFileInput(element) && isUploadShown(element))) slots.push(element);
  }
  return slots;
}

/** Dropdowns built from <div>s or buttons, which `input, textarea, select` can't find. */
function customControls(doc: Document): HTMLElement[] {
  return queryDeep<HTMLElement>(doc, "[role='combobox'], [aria-haspopup='listbox']").filter((element) =>
    !element.matches("input, select, textarea") && !element.querySelector("input, select, textarea") && isVisible(element));
}

/** What a scan reads: the form's controls, then its dropdowns built from other elements. */
function formControls(doc: Document) {
  if (CAPTCHA_FRAME.test(doc.URL)) return { slots: [], custom: [] };
  const slots = collectSlots(doc);
  // A dropdown component whose own input the scan already has (inside its shadow root) is that input: one field. One
  // whose input is hidden or left out stays the field.
  const controls = slots.flat().flatMap((slot) => (slot instanceof Node ? [slot] : slot.aria));
  const custom = customControls(doc).filter((host) => !host.shadowRoot || !controls.some((control) => host.shadowRoot!.contains(control)));
  return { slots, custom };
}

function shapeOf(doc: Document): Shape {
  const { slots, custom } = formControls(doc);
  const sized = slots.map((slot) => {
    if (Array.isArray(slot)) return { control: slot[0]! as HTMLElement, size: slot.length };
    if ("aria" in slot) return { control: slot.aria[0]!, size: slot.aria.length };
    return { control: slot, size: isSelect(slot) ? slot.options.length : 1 };
  });
  return [...sized, ...custom.map((control) => ({ control, size: 1 }))];
}

const sameShape = (left: Shape, right: Shape) => left.length === right.length
  && left.every(({ control, size }, index) => control === right[index]!.control && size === right[index]!.size);

/** The panel's regular look at a scanned form: what each field holds now, and whether it takes a new scan to see the
 * rest, because fields came or went or a dropdown got new options. */
export function readFields(doc: Document, { scanId, entries, shape }: Registry): FrameRead {
  const values = Object.fromEntries(Array.from(entries, ([id, entry]) => [id, readCurrent(entry)]));
  return { scanId, values, moved: !sameShape(shape, shapeOf(doc)) };
}

function postingIn(node: unknown): PageSignals["posting"] {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = postingIn(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  const record = node as Record<string, unknown>;
  if (record["@graph"]) return postingIn(record["@graph"]);
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (!types.includes("JobPosting")) return null;
  const organisation = record.hiringOrganization;
  const company = typeof organisation === "string" ? organisation
    : String((organisation as Record<string, unknown> | undefined)?.name ?? "");
  return { title: String(record.title ?? ""), company };
}

function findPosting(doc: Document): PageSignals["posting"] {
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const found = postingIn(JSON.parse(script.textContent ?? ""));
      if (found) return found;
    } catch {
      // A page's broken structured data just gives no signal.
    }
  }
  return null;
}

function pageSignals(doc: Document): PageSignals {
  const meta = (property: string) => doc.querySelector(`meta[property='${property}']`)?.getAttribute("content") ?? "";
  const heading = doc.querySelector("h1");
  return {
    url: doc.URL,
    title: collapse(`${doc.title} ${meta("og:title")}`),
    heading: heading ? collapse(textOf(heading)).slice(0, 200) : "",
    siteName: meta("og:site_name"),
    posting: findPosting(doc),
  };
}

export function scanDocument(doc: Document, scanId: number, isTop: boolean): { registry: Registry; scan: FrameScan } {
  formsWithPassword = new WeakMap();
  const entries = new Map<string, Entry>();
  const add = (build: (id: string) => Entry) => {
    const id = `f${entries.size}`;
    const entry = build(id);
    entry.field.current = readCurrent(entry);
    entry.field.stableId = stableIdOf(entry.controls[0]!);
    entries.set(id, entry);
  };
  const { slots, custom } = formControls(doc);
  for (const slot of slots) {
    if (!Array.isArray(slot) && "aria" in slot) add((id) => ariaGroupEntry(slot, id));
    else if (!Array.isArray(slot) && isSelect(slot) && slot.multiple) add((id) => multiSelectEntry(slot, id));
    else if (!Array.isArray(slot)) add((id) => singleEntry(slot, id));
    else if (slot.length > 1 || slot[0]!.type === "radio") add((id) => groupEntry(slot, id));
    else add((id) => singleEntry(slot[0]!, id));
  }
  for (const control of custom) add((id) => singleEntry(control, id));
  const fields = Array.from(entries.values(), ({ field }) => field);
  const registry = { scanId, entries, shape: shapeOf(doc) };
  return { registry, scan: { scanId, url: doc.URL, fields, signals: isTop ? pageSignals(doc) : null } };
}
