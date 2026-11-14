import { pause, typeSearch } from "./events";
import { isVisible } from "./labels";
import { byId } from "./shadow";

/** Dropdowns built from <div>s, like Greenhouse's. Their options don't exist until the list opens, so this runs at fill
 * time, never during a scan, which only reads. */

const OPTION = "[role='option'], [class*='__option']";
const CLEAR_BUTTON = "[class*='clear-indicator'], [aria-label*='clear' i]";
const STEP_MS = 40;
const OPEN_WAIT_MS = 700;
const SEARCH_WAIT_MS = 5000;
/** A search that still shows nothing this long after typing has found nothing. */
const NOTHING_FOUND_MS = 2000;

function press(control: HTMLElement, key: string, keyCode: number) {
  control.dispatchEvent(new KeyboardEvent("keydown", {
    key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true,
  }));
}

function clickLike(element: HTMLElement) {
  for (const type of ["mousedown", "mouseup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }));
  }
}

function controlBox(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>("[class*='__control'], [class*='-control']") ?? control;
}

/** The open list's options: the list the control names, else the menu rendered beside it. */
function optionElements(control: HTMLElement): HTMLElement[] {
  const listId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const list = listId ? byId(control, listId) : null;
  const scope = list ?? controlBox(control).parentElement ?? control.ownerDocument;
  return Array.from(scope.querySelectorAll<HTMLElement>(OPTION)).filter(isVisible);
}

async function waitForOptions(control: HTMLElement, limitMs: number): Promise<HTMLElement[]> {
  for (let waited = 0; waited < limitMs; waited += STEP_MS) {
    const found = optionElements(control);
    if (found.length > 0) return found;
    await pause(STEP_MS);
  }
  return [];
}

const listText = (options: HTMLElement[]) => options.map((option) => option.textContent).join("|");

/** Types into the list's search box. A lookup answers slowly, and until it does the list on show is the old one. */
export async function searchList(control: HTMLElement, search: string): Promise<HTMLElement[]> {
  // A dropdown you can't type into has no search.
  if (control.tagName !== "INPUT" || !search || (control as HTMLInputElement).readOnly) return [];
  const before = listText(optionElements(control));
  typeSearch(control as HTMLInputElement, search);
  for (let waited = 0; waited < SEARCH_WAIT_MS; waited += STEP_MS) {
    const found = optionElements(control);
    if (found.length > 0 && listText(found) !== before) return found;
    if (found.length === 0 && waited >= NOTHING_FOUND_MS && control.getAttribute("aria-busy") !== "true") return [];
    await pause(STEP_MS);
  }
  return optionElements(control);
}

/** Opens the list and returns its options. The keyboard works even while the side panel has focus, so it goes first.
 * A list that opens empty is a search box, like a city lookup: typing `search` is what brings its options. */
export async function openList(control: HTMLElement, search: string): Promise<HTMLElement[]> {
  control.focus({ preventScroll: true });
  const attempts = [() => press(control, "ArrowDown", 40), () => clickLike(controlBox(control))];
  for (const attempt of attempts) {
    attempt();
    const found = await waitForOptions(control, OPEN_WAIT_MS);
    if (found.length > 0) return found;
    if (control.getAttribute("aria-expanded") === "true") break;
  }
  return searchList(control, search);
}

export function closeList(control: HTMLElement) {
  if (control.tagName === "INPUT" && (control as HTMLInputElement).value) typeSearch(control as HTMLInputElement, "");
  press(control, "Escape", 27);
}

/** Empties a dropdown the way a person would: with its own clear button, else Backspace in its search box. */
export function clearList(control: HTMLElement) {
  const button = controlBox(control).querySelector<HTMLElement>(CLEAR_BUTTON);
  if (button) clickLike(button);
  else press(control, "Backspace", 8);
}

export const pickOption = clickLike;

/** Whether a dropdown keeps several choices: its list says so, or it shows its picks as chips. */
export function isMultiple(control: HTMLElement): boolean {
  const listId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const list = listId ? byId(control, listId) : null;
  return list?.getAttribute("aria-multiselectable") === "true" || control.getAttribute("aria-multiselectable") === "true"
    || controlBox(control).querySelector("[class*='--is-multi'], [class*='multi-value'], [class*='multiValue']") !== null;
}
