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

/** ADP keeps only what is typed into its page while the page has the focus: through the browser's editor, never a set
 * value. An empty value is typed as a delete. */
export function typeOnAdp(control: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  const doc = control.ownerDocument;
  if (control.value === value) return true;
  control.focus({ preventScroll: true });
  if (doc.activeElement !== control && !control.matches(":focus")) return false;
  control.select();
  if (!doc.execCommand(value ? "insertText" : "delete", false, value)) return false;
  // ADP formats a phone number as it's typed ("+1 704 555 0299"): the same digits are the same number.
  const digits = value.replace(/\D/g, "");
  if (control.value !== value && !(digits.length >= 7 && control.value.replace(/\D/g, "").endsWith(digits))) return false;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.blur();
  return true;
}

/** ADP's text fields, which keep only what is typed into them while the page has the focus. */
export function typesOnlyWithFocus(control: Element): boolean {
  const doc = control.ownerDocument;
  return /(?:^|\.)adp\.com$/.test(doc.location?.hostname ?? "") && typeof doc.execCommand === "function"
    && (control.tagName === "TEXTAREA" || (control.tagName === "INPUT" && /^(?:text|email|tel|search|url)$/.test((control as HTMLInputElement).type)));
}

/** The Autofill run whose wait last ran out: the BDE isn't clicking the form, so that run's next field doesn't wait
 * again. Another run, or a Retry, does (CodeRabbit's review of cf130dea). */
let gaveUp: { run: string; at: number } | null = null;
const GIVE_UP_FOR_MS = 60_000;

/** Whether the page has the focus, or gets it within `ms`: a click on BenchQ's panel takes it, and the BDE's click on
 * the form gives it back. */
export function focusArrives(doc: Document, ms: number, run?: string): Promise<boolean> {
  const win = doc.defaultView;
  if (doc.hasFocus() || !win) return Promise.resolve(doc.hasFocus());
  if (run !== undefined && gaveUp?.run === run && Date.now() - gaveUp.at < GIVE_UP_FOR_MS) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      win.removeEventListener("focus", done);
      const hasFocus = doc.hasFocus();
      if (!hasFocus && run !== undefined) gaveUp = { run, at: Date.now() };
      resolve(hasFocus);
    };
    const timer = setTimeout(done, ms);
    win.addEventListener("focus", done);
  });
}

export function setText(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  if (value && typesOnlyWithFocus(control) && control.ownerDocument.hasFocus() && typeOnAdp(control, value)) return;
  setNativeValue(control, value);
  fireEvents(control);
}

/** Typing into a dropdown's search box. Only `input`: a blur would close the list the text is searching. */
export function typeSearch(control: HTMLInputElement, value: string) {
  setNativeValue(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
