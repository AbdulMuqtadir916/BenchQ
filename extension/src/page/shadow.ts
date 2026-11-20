/** Fields inside a component's own DOM (a shadow root), which `querySelectorAll` and `getElementById` don't reach: open
 * roots, and closed ones through the extension's own `chrome.dom`. A page without such components reads as before. */

type ExtensionDom = { dom?: { openOrClosedShadowRoot?: (element: HTMLElement) => ShadowRoot | null } };

/** The shadow root an element hosts. A closed one is asked for only on a custom element (a name with a dash), the kind
 * that builds one, so a page's plain elements cost nothing. */
export function shadowOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  if (!element.localName.includes("-")) return null;
  try {
    return (globalThis as { chrome?: ExtensionDom }).chrome?.dom?.openOrClosedShadowRoot?.(element as HTMLElement) ?? null;
  } catch {
    return null;
  }
}

/** Every element matching `selector` in page order, a component's own elements right after the component. `root` may be
 * an element too (a form): what's inside it, never the element itself. */
export function queryDeep<T extends Element>(root: Document | ShadowRoot | Element, selector: string): T[] {
  const all = Array.from(root.querySelectorAll("*"));
  if (!all.some((element) => shadowOf(element))) return Array.from(root.querySelectorAll<T>(selector));
  return all.flatMap((element) => {
    const shadow = shadowOf(element);
    return [...(element.matches(selector) ? [element as T] : []), ...(shadow ? queryDeep<T>(shadow, selector) : [])];
  });
}

/** The component an element sits inside, if it sits in one. */
export const hostOf = (element: Element): HTMLElement | null =>
  ((element.getRootNode() as Partial<ShadowRoot>).host as HTMLElement | undefined) ?? null;

/** The element with this id: a component's ids are its own, so its own tree first, then the page. */
export function byId(element: Element, id: string): HTMLElement | null {
  return (hostOf(element) ? (element.getRootNode() as ShadowRoot).getElementById(id) : null) ?? element.ownerDocument.getElementById(id);
}
