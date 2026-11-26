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

export function setText(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const doc = control.ownerDocument;
  if (value && /(?:^|\.)adp\.com$/.test(doc.location?.hostname ?? "") && typeof doc.execCommand === "function"
    && (control.tagName === "TEXTAREA" || /^(?:text|email|tel|search|url)$/.test(control.type))) {
    control.focus({ preventScroll: true });
    if (doc.activeElement === control || control.matches(":focus")) {
      control.select();
      if (doc.execCommand("insertText", false, value) && control.value === value) {
        control.dispatchEvent(new Event("change", { bubbles: true }));
        control.blur();
        return;
      }
    }
  }
  setNativeValue(control, value);
  fireEvents(control);
}

/** Typing into a dropdown's search box. Only `input`: a blur would close the list the text is searching. */
export function typeSearch(control: HTMLInputElement, value: string) {
  setNativeValue(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
