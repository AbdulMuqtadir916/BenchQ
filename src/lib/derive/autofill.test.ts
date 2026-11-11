import { describe, expect, it } from "vitest";
import type { AutofillEntry } from "@/lib/schemas/resume-autofill";
import {
  addChange, draftOf, editChange, isEditable, keepMineChange, parseDraft, questionError, removeChange, resetChange,
} from "./autofill";

const fixed = (key: string, question: string, answer: AutofillEntry["answer"], extra: Partial<AutofillEntry> = {}): AutofillEntry =>
  ({ question, answer, kind: "FIXED", key, type: "text", also: [], ...extra });
const city = fixed("address-city", "Which city do you live in?", "Irving");
const rate: AutofillEntry = { ...fixed("pay-rate", "What is your expected rate?", 95), kind: "EDITED", type: "number", built: 85 };
const region = fixed("address-region", "Which state do you live in?", "TX", { replaced: "Texas" });
const github = fixed("github-url", "What is your GitHub profile URL?", null);
const why: AutofillEntry = { question: "Why us?", answer: "Payments.", kind: "CUSTOM", key: null, type: null, also: ["What draws you to us?"] };

describe("what the Autofill tab edits (docs/04)", () => {
  it("never edits a list of records such as the work history (07 Q42)", () => {
    expect(isEditable({ ...city, type: "entries" })).toBe(false);
    expect(isEditable(why)).toBe(true);
  });
});

describe("an answer in the editor", () => {
  it("drafts and parses each type, saying what's wrong", () => {
    expect(draftOf(["Java", "Go"])).toBe("Java\nGo");
    expect(parseDraft(" Java\n\nGo ", "texts")).toEqual({ answer: ["Java", "Go"] });
    expect(parseDraft("Dallas, TX", "texts")).toEqual({ answer: ["Dallas, TX"] });
    expect(parseDraft("90", "number")).toEqual({ answer: 90 });
    expect(parseDraft("-1", "number")).toEqual({ error: "Enter a number." });
    expect(parseDraft("no", "boolean")).toEqual({ answer: false });
    expect(parseDraft("2026-02-30", "date")).toEqual({ error: "Enter a date." });
    expect(parseDraft("2026-02-28", "date")).toEqual({ answer: "2026-02-28" });
    expect(parseDraft("  ", null)).toEqual({ error: "Write an answer." });
    expect(parseDraft("x", "entries")).toEqual({ error: "Change this in the résumé itself." });
  });
});

describe("what a save sends (docs/02 §8.3)", () => {
  it("an edit carries the built answer the BDE was shown", () => {
    expect(editChange(city, "Dallas", false)).toEqual({ edit: { "address-city": "Dallas" }, built: { "address-city": "Irving" }, reset: [], add: {}, remove: [], onlyThis: false });
    expect(editChange(rate, 90, true)).toMatchObject({ edit: { "pay-rate": 90 }, built: { "pay-rate": 85 }, onlyThis: true });
    expect(editChange(github, "github.com/ravi", false)).toMatchObject({ built: { "github-url": null } });
  });

  it("keep mine and use the new one (07 Q15), reset, add and remove", () => {
    expect(keepMineChange(region, false)).toMatchObject({ edit: { "address-region": "Texas" }, built: { "address-region": "TX" } });
    expect(resetChange(region, false)).toMatchObject({ reset: ["address-region"], edit: {} });
    expect(addChange(" Why us? ", " Fintech. ", false)).toMatchObject({ add: { "Why us?": "Fintech." } });
    expect(removeChange(why, true)).toMatchObject({ remove: ["Why us?"], onlyThis: true });
  });

  it("refuses a question in the words of one of BenchQ's", () => {
    expect(questionError("which CITY do you live in", [city, why])).toBe("That's one of BenchQ's questions: change its answer above.");
    expect(questionError("Why us?", [city, why])).toBeNull();
    expect(questionError(" ", [])).toBe("Write the question.");
  });
});
