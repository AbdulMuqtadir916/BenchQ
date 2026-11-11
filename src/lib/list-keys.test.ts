import { describe, expect, it } from "vitest";
import { isEscapeBackKey, isNewItemKey, listKeyAction, type ListKeyInput } from "./list-keys";

/**
 * BUG-003: `J`/`K`, `/` and `x` only worked once focus was inside the table, so on a freshly loaded list `J` did nothing.
 * `listKeyAction` decides what a key pressed anywhere on the page does to the list that the screen marks as primary. Only
 * the letter keys, only when focus is OUTSIDE the table (inside it the table's own handler already did the work, together
 * with Enter, Space and the arrows, which are never taken over here).
 */
const outside: ListKeyInput = {
  key: "j", metaKey: false, ctrlKey: false, altKey: false,
  defaultPrevented: false, isTyping: false, overlayOpen: false, insideTable: false, afterG: false,
};
const press = (over: Partial<ListKeyInput>) => listKeyAction({ ...outside, ...over });

describe("listKeyAction", () => {
  it("J, K and X on a page with focus outside the table enter the list; / goes to the search box", () => {
    for (const key of ["j", "k", "x", "J", "K", "X"]) expect(press({ key }), key).toBe("enter");
    expect(press({ key: "/" })).toBe("filter");
  });

  it("does nothing for any other key: Enter, Space and the arrows stay with the buttons, links and scrolling of the page", () => {
    for (const key of ["Enter", " ", "ArrowDown", "ArrowUp", "a", "g", "n", "?", "Escape", "Tab"]) expect(press({ key }), key).toBeNull();
  });

  it("does nothing when focus is already inside the table: its own handler owns the key, so one press never moves two rows", () => {
    for (const key of ["j", "k", "x", "/"]) expect(press({ key, insideTable: true }), key).toBeNull();
  });

  it("does nothing for a key the table (or anything else) already handled", () => {
    expect(press({ defaultPrevented: true })).toBeNull();
  });

  it("does nothing while someone types in a field, or with a dialog, the palette, the shortcut sheet or a menu open", () => {
    expect(press({ isTyping: true })).toBeNull();
    expect(press({ key: "/", isTyping: true })).toBeNull();
    expect(press({ overlayOpen: true })).toBeNull();
  });

  it("leaves modifier combinations alone (⌘K, Ctrl+J, Alt+X …)", () => {
    expect(press({ metaKey: true })).toBeNull();
    expect(press({ ctrlKey: true })).toBeNull();
    expect(press({ altKey: true })).toBeNull();
  });

  it("stays out of the way of `g` then `j` (go to Jobs, docs/04 §1.3)", () => {
    expect(press({ key: "j", afterG: true })).toBeNull();
  });
});

/**
 * BUG-017: `n` is "New" on a list (docs/04 §1.3). Unlike J/K/X it works from anywhere on the page, inside the table too (the
 * table has no `n` of its own), but under the same guards: never in a field, with an overlay open, with a modifier held, right
 * after `g`, or for a key something else already handled. Whether this person may add a candidate at all is the screen's call.
 */
describe("isNewItemKey", () => {
  const n = (over: Partial<ListKeyInput> = {}) => isNewItemKey({ ...outside, key: "n", ...over });

  it("n and N are the New key, with focus outside or inside the table", () => {
    expect(n()).toBe(true);
    expect(n({ key: "N" })).toBe(true);
    expect(n({ insideTable: true })).toBe(true);
  });

  it("no other key is", () => {
    for (const key of ["j", "k", "x", "/", "m", "Enter", " ", "g"]) expect(n({ key }), key).toBe(false);
  });

  it("is inert in a field, with an overlay open, with a modifier held, after `g`, or when already handled", () => {
    expect(n({ isTyping: true })).toBe(false);
    expect(n({ overlayOpen: true })).toBe(false);
    expect(n({ metaKey: true })).toBe(false);
    expect(n({ ctrlKey: true })).toBe(false);
    expect(n({ altKey: true })).toBe(false);
    expect(n({ afterG: true })).toBe(false);
    expect(n({ defaultPrevented: true })).toBe(false);
  });
});

/**
 * BUG-004: Esc does nothing on the candidate page, though the spec says Esc "closes the panel, clears the selection, or goes
 * back" (docs/04 §1.3). `isEscapeBackKey` decides whether a press is a "go back": only a plain Esc, and only when nothing else
 * wants it. A drawer, dialog, the palette or the shortcut sheet close themselves on Esc, a field uses it to leave itself, and
 * going back on that same press would throw the person off the page they were using.
 */
describe("isEscapeBackKey", () => {
  const esc = (over: Partial<ListKeyInput> = {}) => isEscapeBackKey({ ...outside, key: "Escape", ...over });

  it("a plain Escape with nothing open is a go-back", () => {
    expect(esc()).toBe(true);
  });

  it("no other key is", () => {
    for (const key of ["Enter", "Backspace", "q", "Tab", "ArrowLeft", " "]) expect(esc({ key }), key).toBe(false);
  });

  it("is not, while a drawer, dialog, the palette, the shortcut sheet or a menu is open", () => {
    expect(esc({ overlayOpen: true })).toBe(false);
  });

  it("is not, while someone is in a field (Esc is theirs there)", () => {
    expect(esc({ isTyping: true })).toBe(false);
  });

  it("is not with a modifier held, or when something already handled the key", () => {
    expect(esc({ metaKey: true })).toBe(false);
    expect(esc({ ctrlKey: true })).toBe(false);
    expect(esc({ altKey: true })).toBe(false);
    expect(esc({ defaultPrevented: true })).toBe(false);
  });

  it("is a go-back even right after `g` (the g prefix only matters for letters)", () => {
    expect(esc({ afterG: true })).toBe(true);
  });
});
