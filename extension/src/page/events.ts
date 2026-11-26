/** Writing to a control the way a person would, so the page's own framework sees the change. */

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function fireEvents(control: HTMLElement) {
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new FocusEvent("blur"));
  control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/** Through the prototype's setter, so a framework that wraps `value` on the element still sees a real change. */
function setNativeValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
}

/** ADP keeps only what is typed into its page while the page has focus: through the browser's editor, never a set value. */
function typeOnAdp(control: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  const doc = control.ownerDocument;
  control.focus({ preventScroll: true });
  if (doc.activeElement !== control && !control.matches(":focus")) return false;
  control.select();
  if (!doc.execCommand("insertText", false, value)) return false;
  // ADP formats a phone number as it's typed ("+1 704 555 0299"): the same digits are the same number.
  const digits = value.replace(/\D/g, "");
  if (control.value !== value && !(digits.length >= 7 && control.value.replace(/\D/g, "").endsWith(digits))) return false;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.blur();
  return true;
}

/** Values waiting for ADP's page to get the focus back: a click in BenchQ's panel takes it, and ADP drops anything
 * written without it. They're typed in once the BDE clicks the form. */
const waiting = new Map<HTMLInputElement | HTMLTextAreaElement, string>();

function typeWhenFocused(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const win = control.ownerDocument.defaultView;
  if (!win) return;
  if (waiting.size === 0) {
    win.addEventListener("focus", () => {
      for (const [field, text] of waiting) if (field.isConnected && field.value !== text) typeOnAdp(field, text);
      waiting.clear();
    }, { once: true });
  }
  // A phone is tried in several ways in a row: the first, the form's likeliest, is the one typed in.
  if (!waiting.has(control)) waiting.set(control, value);
}

export function setText(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const doc = control.ownerDocument;
  if (value && /(?:^|\.)adp\.com$/.test(doc.location?.hostname ?? "") && typeof doc.execCommand === "function"
    && (control.tagName === "TEXTAREA" || /^(?:text|email|tel|search|url)$/.test(control.type))) {
    if (!doc.hasFocus()) return typeWhenFocused(control, value);
    if (typeOnAdp(control, value)) return;
  }
  setNativeValue(control, value);
  fireEvents(control);
}

/** Typing into a dropdown's search box. Only `input`: a blur would close the list the text is searching. */
export function typeSearch(control: HTMLInputElement, value: string) {
  setNativeValue(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
