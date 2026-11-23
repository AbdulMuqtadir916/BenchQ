import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ERROR_TOASTS, dismissErrorToastOnEscape, hasErrorToast, useToastStore } from "./toast-store";

/** The toast stack (Uzair, 2026-11-21): no duplicates, at most three failures, Esc dismisses the newest failure. */

const state = () => useToastStore.getState();
const messages = () => state().toasts.map((toast) => toast.message);
const fail = (message: string, reference: string | null = null) => state().show(message, { tone: "danger", reference });

const esc = { key: "Escape", metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, isTyping: false, overlayOpen: false, afterG: false };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useRealTimers();
});

describe("the toast stack", () => {
  it("two identical failures don't stack: the second replaces the first", () => {
    fail("The résumé didn't save.");
    const first = state().toasts[0]?.id;
    fail("The résumé didn't save.");
    expect(messages()).toEqual(["The résumé didn't save."]);
    expect(state().toasts[0]?.id).not.toBe(first);
  });

  it("the replacement keeps its full lifetime: the first one's timer doesn't take it away", () => {
    fail("The résumé didn't save.");
    vi.advanceTimersByTime(5000);
    fail("The résumé didn't save.");
    vi.advanceTimersByTime(2000);
    expect(messages()).toEqual(["The résumé didn't save."]);
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  it("a 4th failure drops the oldest", () => {
    expect(MAX_ERROR_TOASTS).toBe(3);
    fail("One", "req-1");
    fail("Two", "req-2");
    fail("Three", "req-3");
    fail("Four", "req-4");
    expect(messages()).toEqual(["Two", "Three", "Four"]);
  });

  it("confirmations don't count against the failures, and aren't dropped by them", () => {
    state().show("Saved.");
    for (const message of ["One", "Two", "Three", "Four"]) fail(message);
    expect(messages()).toEqual(["Saved.", "Two", "Three", "Four"]);
  });

  it("the same words with another tone are another toast", () => {
    state().show("Done.");
    fail("Done.");
    expect(state().toasts.map((toast) => toast.tone)).toEqual(["success", "danger"]);
  });
});

describe("Esc", () => {
  it("dismisses the newest failure, then the next", () => {
    fail("One", "req-1");
    fail("Two", "req-2");
    state().show("Saved.");
    expect(dismissErrorToastOnEscape(esc)).toBe(true);
    expect(messages()).toEqual(["One", "Saved."]);
    expect(dismissErrorToastOnEscape(esc)).toBe(true);
    expect(messages()).toEqual(["Saved."]);
    expect(hasErrorToast()).toBe(false);
  });

  it("leaves the key alone with no failure showing (a confirmation isn't dismissed by it)", () => {
    state().show("Saved.");
    expect(dismissErrorToastOnEscape(esc)).toBe(false);
    expect(messages()).toEqual(["Saved."]);
  });

  it("never takes Esc from an open dialog or palette, a field, a modifier, or a key already handled", () => {
    fail("One", "req-1");
    for (const input of [{ ...esc, overlayOpen: true }, { ...esc, isTyping: true }, { ...esc, metaKey: true }, { ...esc, defaultPrevented: true }, { ...esc, key: "x" }]) {
      expect(dismissErrorToastOnEscape(input)).toBe(false);
    }
    expect(messages()).toEqual(["One"]);
  });
});
