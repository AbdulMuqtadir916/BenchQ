// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { focusArrives } from "./events";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("waits for ADP's page to get the focus back, and stops waiting within one run once nobody clicks", async () => {
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const clicked = focusArrives(document, 5000, "run-1");
  hasFocus.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  expect(await clicked).toBe(true);
  hasFocus.mockReturnValue(false);
  vi.useFakeTimers();
  const ignored = focusArrives(document, 50, "run-1");
  vi.advanceTimersByTime(60);
  expect(await ignored).toBe(false);
  // The same run's next field doesn't wait again; another run (or a Retry) does.
  expect(await focusArrives(document, 50, "run-1")).toBe(false);
  let isSettled = false;
  const next = focusArrives(document, 50, "run-2").then((value) => { isSettled = true; return value; });
  await Promise.resolve();
  expect(isSettled).toBe(false);
  vi.advanceTimersByTime(60);
  expect(await next).toBe(false);
});
