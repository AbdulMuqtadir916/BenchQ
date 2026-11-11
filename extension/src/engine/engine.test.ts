import { describe, expect, it } from "vitest";
import type { BankEntry, FieldClues, FieldKind } from "../autofill/types";
import { bankForType, closestBankEntry, indexBankByType } from "./bank";
import { classifyField, classifyQuestion } from "./classify";
import { KIND_TO_TYPE } from "./field-types";
import { TAXONOMY } from "./universal-ai-autofill/taxonomy";

const NONE: FieldClues = { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" };

const field = (label: string, overrides: { kind?: FieldKind; autocomplete?: string; pageUrl?: string; clues?: Partial<FieldClues> } = {}) => ({
  label, kind: overrides.kind ?? "text" as FieldKind, autocomplete: overrides.autocomplete ?? "", pageUrl: overrides.pageUrl,
  clues: { ...NONE, ...overrides.clues },
});

const entry = (question: string, answer = "saved"): BankEntry => ({ id: question, question, answer, category: "OTHER" });

describe("classifyField", () => {
  it("trusts the site's own field names first", () => {
    expect(classifyField(field("Anything", { pageUrl: "https://boards.greenhouse.io/acme/jobs/1", clues: { name: "job_application[first_name]" } }))).toBe("first-name");
    expect(classifyField(field("Link", { pageUrl: "https://jobs.lever.co/acme/1/apply", clues: { name: "urls[LinkedIn]" } }))).toBe("linkedin-url");
  });

  it("doesn't treat a site's open question as a known field", () => {
    expect(classifyField(field("Tell us a story", { pageUrl: "https://jobs.lever.co/acme/1/apply", clues: { name: "cards[0][answer]" } }))).toBeNull();
  });

  it("reads the browser's autocomplete hint, section prefix or not", () => {
    expect(classifyField(field("Your details", { autocomplete: "postal-code" }))).toBe("address-postal");
    expect(classifyField(field("Who are you?", { autocomplete: "section-a given-name" }))).toBe("first-name");
  });

  it("reads the control's own type", () => {
    expect(classifyField(field("Reach you at", { kind: "email" }))).toBe("email");
    expect(classifyField(field("Call you at", { kind: "tel" }))).toBe("phone");
  });

  it.each([
    ["Zip Code", "address-postal"], ["Street address", "address-line1"], ["Middle name", "middle-name"], ["Mail ID", "email"],
    ["GitHub", "github-url"], ["Expected salary", "salary-expectation"],
  ])("recognises %s as %s", (label, type) => {
    expect(classifyField(field(label))).toBe(type);
  });

  it("uses a field's name when it has no label", () => {
    expect(classifyField(field("", { clues: { name: "email_address" } }))).toBe("email");
  });

  it.each(["Name Pronunciation", "Start date month", "End date year"])("gives %s no reading: it wants something else", (label) => {
    expect(classifyField(field(label))).toBeNull();
  });

  it.each(["Referrer email", "Manager's name"])("gives %s no reading: it's about someone else", (label) => {
    expect(classifyField(field(label))).toBeNull();
    expect(classifyField(field(label, { kind: "tel" }))).toBeNull();
    expect(classifyField(field(label, { autocomplete: "email" }))).toBeNull();
  });

  it.each(["State your reason for leaving", "Why this city?", "What city do you want to work in and why?"])("gives %s no reading: it's a free-form question", (label) => {
    expect(classifyField(field(label))).toBeNull();
  });

  it("judges a labelled field on its label, not its attribute names", () => {
    expect(classifyField(field("Cover note", { clues: { name: "email_body", id: "email_body" } }))).not.toBe("email");
  });
});

describe("classifyQuestion", () => {
  it("reads a plain bank label", () => {
    expect(classifyQuestion("ZIP code")).toBe("address-postal");
  });

  it.each(["Why are you interested in this role?", "Are you open to onsite or hybrid work?", "CPQ experience?"])(
    "has no type for %s: a word in it isn't what it asks", (question) => {
      expect(classifyQuestion(question)).toBeNull();
    });
});

describe("the QA bank by type", () => {
  it("reads a bank question phrased as a question, and leaves a free-form one", () => {
    const index = indexBankByType([entry("What is your expected salary?"), entry("Do you require immigration sponsorship to work at Reddit?"), entry("Why are you a great fit?")]);
    expect([...index.keys()]).toEqual(["salary-expectation", "visa-sponsorship"]);
  });

  it("gives one entry when entries of a type agree, and every entry when they don't", () => {
    expect(bankForType(indexBankByType([entry("ZIP code", "75001"), entry("Postcode", "75001")]), "address-postal")).toHaveLength(1);
    expect(bankForType(indexBankByType([entry("ZIP code", "75001"), entry("Postcode", "75002")]), "address-postal")).toHaveLength(2);
  });
});

describe("closestBankEntry", () => {
  it("finds a question worded a little differently", () => {
    const bank = [entry("Why do you want to join our company today", "Great team")];
    expect(closestBankEntry("Why do you want to join our company", bank)?.answer).toBe("Great team");
  });

  it.each([
    ["How many years of software development experience do you have with Java", "How many years of software development experience do you have"],
    ["How many years of software development experience do you have with Java", "How many years of software development experience do you have with Python"],
    ["Are you able to work in our office five days each week", "Are you not able to work in our office five days each week"],
    ["Are you able to work in our office for 5 days each week", "Are you able to work in our office for 3 days each week"],
  ])("won't let %s take the answer to %s", (label, question) => {
    expect(closestBankEntry(label, [entry(question)])).toBeNull();
  });

  it("leaves a close call between different answers", () => {
    const bank = [entry("Why do you want to join our company today", "A"), entry("Why do you want to join our company again", "B")];
    expect(closestBankEntry("Why do you want to join our company", bank)).toBeNull();
  });
});

describe("KIND_TO_TYPE", () => {
  it("covers every kind universal-ai-autofill can return", () => {
    expect(TAXONOMY.map(({ kind }) => kind).filter((kind) => !KIND_TO_TYPE[kind])).toEqual([]);
  });
});
