// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://workforcenow.adp.com/"}
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFiller } from "./fill";
import { scanDocument, type Registry } from "./scan";

/** The browser's editor, as ADP needs it: what is typed goes into the focused, selected input. */
function typingEditor() {
  const exec = vi.fn((command: string, _ui: boolean, value: string) => {
    (document.activeElement as HTMLInputElement).value = command === "delete" ? "" : value;
    return true;
  });
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  return exec;
}

function form(value = "") {
  document.body.innerHTML = `<label for="f">First Name</label><input id="f" type="text" value="${value}">`;
  const registry = scanDocument(document, 1, true).registry;
  return { registry, fieldId: [...registry.entries.keys()][0]!, input: document.getElementById("f") as HTMLInputElement };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "execCommand");
  document.body.replaceChildren();
});

it("writes nothing when the scan was replaced while the fill waited for ADP's form", async () => {
  const { registry: first, fieldId, input } = form();
  let registry: Registry = first;
  const filler = createFiller(() => registry);
  typingEditor();
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const filling = filler.fill({ scanId: 1, fieldId, current: "", write: { type: "text", value: "Manoj" }, runId: "1" });
  // The BDE disconnected and picked another candidate: the page was scanned again.
  registry = scanDocument(document, 2, true).registry;
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  expect((await filling).status).toBe("stale");
  expect(input.value).toBe("");
});

it("types the old value back on Undo once ADP's page has the focus, and counts it restored", async () => {
  const { registry, fieldId, input } = form("Old");
  const filler = createFiller(() => registry);
  const exec = typingEditor();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  expect((await filler.fill({ scanId: 1, fieldId, current: "Old", write: { type: "text", value: "Manoj" }, runId: "1" })).status).toBe("filled");
  expect(input.value).toBe("Manoj");
  expect(await filler.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(input.value).toBe("Old");
  expect(exec).toHaveBeenLastCalledWith("insertText", false, "Old");
});

it("keeps a value edited on ADP while switching resumes waits for focus", async () => {
  const { registry, fieldId, input } = form("Old");
  const filler = createFiller(() => registry);
  typingEditor();
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  await filler.fill({ scanId: 1, fieldId, current: "Old", write: { type: "text", value: "Manoj" } });
  hasFocus.mockReturnValue(false);
  const restoring = filler.takeBack({ scanId: 1, fieldId });
  input.value = "Manual correction";
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  expect(await restoring).toBe(false);
  expect(input.value).toBe("Manual correction");
});

it("counts an ADP field skipped on Undo when its page never gets the focus", async () => {
  const { registry, fieldId, input } = form("Old");
  const filler = createFiller(() => registry);
  typingEditor();
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  await filler.fill({ scanId: 1, fieldId, current: "Old", write: { type: "text", value: "Manoj" }, runId: "1" });
  hasFocus.mockReturnValue(false);
  vi.useFakeTimers();
  const undoing = filler.undo();
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await undoing).toMatchObject({ restored: 0, skipped: 1 });
  expect(input.value).toBe("Manoj");
});
