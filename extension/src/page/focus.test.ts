// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { focusArrives } from "./events";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("waits for ADP's page to get the focus back, then gives up for a while once nobody clicks", async () => {
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const clicked = focusArrives(document, 5000);
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  expect(await clicked).toBe(true);
  hasFocus.mockReturnValue(false);
  vi.useFakeTimers();
  const ignored = focusArrives(document, 50);
  vi.advanceTimersByTime(60);
  expect(await ignored).toBe(false);
  // The next field doesn't wait again while the BDE isn't clicking.
  expect(await focusArrives(document, 50)).toBe(false);
});
