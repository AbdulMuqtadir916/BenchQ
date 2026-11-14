import { describe, expect, it } from "vitest";
import { builtAnswers, saveOffer, shownAnswers } from "./save-answer";
import type { BankEntry, FieldKind, ReviewRow, TabField } from "./types";

const field = (label: string, current: string, kind: FieldKind = "text"): TabField => ({
  id: label, frameId: 0, pageUrl: "https://jobs.acme.test/1", kind, label, hints: "", autocomplete: "", required: false, current,
  options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});
const typed = (label: string, current: string, extra: Partial<ReviewRow> = {}): ReviewRow =>
  ({ key: label, status: "same", field: field(label, current), ...extra });
const fixed = (key: string, answer: string): BankEntry => ({ id: `key:${key}`, question: key, answer, category: "OTHER", key });
const own = (question: string, answer: string): BankEntry => ({ id: `custom:${question}`, question, answer, category: "OTHER" });
const none = new Map<string, unknown>();

describe("saving a typed answer for next time (07 Q58)", () => {
  it("keeps a question BenchQ has no kind for in the form's own words", () => {
    expect(saveOffer(typed("Why do you want to work here?", "Their payments work."), [], none)).toEqual({
      label: "Save for next time", change: { add: { "Why do you want to work here?": "Their payments work." } },
    });
  });

  it("offers to update a different saved answer to the same question, never a second one (Q21)", () => {
    const bank = [own("Why do you want to work here?", "Payments.")];
    expect(saveOffer(typed("Why do you want to work here?", "Fintech."), bank, none)).toEqual({
      label: "Update the saved answer (Payments. → Fintech.)", change: { add: { "Why do you want to work here?": "Fintech." } },
    });
    expect(saveOffer(typed("Why do you want to work here?", "payments"), bank, none)).toBeNull();
  });

  it("saves a field asking one of BenchQ's questions word for word as that question (CodeRabbit #129)", () => {
    const bank: BankEntry[] = [{ id: "p", question: "What is your professional title?", answer: "Engineer", category: "OTHER", key: "professional-title" }];
    const offer = saveOffer(typed("What is your professional title?", "Staff Engineer"), bank, new Map(), new Map([["professional-title", "Engineer"]]));
    expect(offer?.change).toEqual({ edit: { "professional-title": "Staff Engineer" }, built: { "professional-title": null },
      answered: { "professional-title": "Engineer" } });
    expect(shownAnswers([{ key: "pay-rate", answer: 95, built: 85 }, { question: "Own?", answer: "Yes" }])).toEqual(new Map([["pay-rate", 95]]));
  });

  it("saves the newer questions and never a shortened, ranged or unlikely pay (CodeRabbit #129)", () => {
    const rate = (current: string) => saveOffer(typed("What is your expected rate?", current), [fixed("pay-rate", "85")], new Map());
    expect(rate("$95/hr")?.change).toMatchObject({ edit: { "pay-rate": 95 } });
    for (const current of ["$95k", "$90-100/hr", "95000", "$120,000 per year"]) expect(rate(current), current).toBeNull();
    const floor = saveOffer(typed("What is your floor rate?", "$80/hr"), [fixed("floor-rate", "75")], new Map());
    expect(floor?.change).toMatchObject({ edit: { "floor-rate": 80 } });
  });

  it("saves a field of one of BenchQ's questions as an edit of its key, with the built answer shown (Q20)", () => {
    const bank = [fixed("email", "ravi@old.test")];
    expect(saveOffer(typed("Email", "ravi@new.test"), bank, new Map([["email", "ravi@old.test"]]))).toEqual({
      label: "Update the saved answer (ravi@old.test → ravi@new.test)",
      change: { edit: { email: "ravi@new.test" }, built: { email: "ravi@old.test" } },
    });
    expect(saveOffer(typed("Email", "ravi@new.test"), [], none)).toMatchObject({ change: { built: { email: null } } });
  });

  it("offers nothing for what BenchQ works out, keeps away from, or can't read", () => {
    expect(saveOffer(typed("First name", "Ravi"), [], none)).toBeNull();
    expect(saveOffer(typed("Gender", "Male", { isUnsaved: true }), [], none)).toBeNull();
    expect(saveOffer(typed("Password", "secret", { status: "blocked" }), [], none)).toBeNull();
    expect(saveOffer({ ...typed("Resume", "cv.pdf"), field: field("Resume", "cv.pdf", "file") }, [], none)).toBeNull();
    expect(saveOffer(typed("Why us?", "  "), [], none)).toBeNull();
  });

  it("reads each built answer by key, an edit's from what it replaced", () => {
    const built = builtAnswers([
      { question: "What is your expected rate?", answer: 95, kind: "EDITED", key: "pay-rate", built: 85 },
      { question: "Which city do you live in?", answer: "Irving", kind: "FIXED", key: "address-city" },
      { question: "Why us?", answer: "Payments.", kind: "CUSTOM" },
    ]);
    expect([...built]).toEqual([["pay-rate", 85], ["address-city", "Irving"]]);
  });
});
