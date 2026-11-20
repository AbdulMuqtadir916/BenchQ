import { describe, expect, it } from "vitest";
import { answersFromResume } from "./resume-answers";
import { buildReview } from "./review";
import type { TabField } from "./types";

/** A form's personal, screening and self-ID questions, filled from the answers the BDE added on the Autofill screen
 * (decided 2026-11-11): each comes as an edit of a fixed question, with its key (docs/02 §8.1). */

let next = 0;
const field = (label: string, overrides: Partial<TabField> = {}): TabField => ({
  id: `f${next++}`, frameId: 0, pageUrl: "https://jobs.example.test/apply", kind: "text", label, hints: "", autocomplete: "",
  required: false, current: "", options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
  ...overrides,
});
const options = (...labels: string[]) => labels.map((label, index) => ({ id: `o${index}`, label }));
const yesNo = options("Yes", "No");

const edited = (key: string, question: string, answer: unknown) => ({ question, answer, kind: "EDITED", key, built: null });
const answers = answersFromResume([
  edited("over-18", "Are you at least 18 years old?", true),
  edited("criminal-history", "Have you ever been convicted of a crime?", false),
  edited("background-check", "Are you willing to undergo a background check?", true),
  edited("security-clearance", "Do you hold an active security clearance?", "No"),
  edited("address-postal", "What is your ZIP or postal code?", "30301"),
  edited("gender", "What is your gender?", "Female"),
  edited("veteran-status", "What is your veteran status?", "I am not a protected veteran"),
  edited("disability-status", "Do you have a disability?", "No, I don't have a disability"),
]);

const filled = (fields: TabField[]) =>
  buildReview(fields, answers, { title: "QA Engineer", company: "Acme" }).map(({ field: { label }, status, proposed }) => [label, status, proposed]);

describe("a form's personal questions", () => {
  it("fill from the answers the BDE added: age, record, background check, clearance, postal code", () => {
    expect(filled([
      field("Are you 18 years of age or older?", { kind: "radio", options: yesNo }),
      field("Have you ever been convicted of a felony?", { kind: "radio", options: yesNo }),
      field("Are you willing to undergo a background check?", { kind: "select", options: yesNo }),
      field("Do you currently hold a security clearance?"),
      field("Zip code"),
    ])).toEqual([
      ["Are you 18 years of age or older?", "ready", "Yes"],
      ["Have you ever been convicted of a felony?", "ready", "No"],
      ["Are you willing to undergo a background check?", "ready", "Yes"],
      ["Do you currently hold a security clearance?", "ready", "No"],
      ["Zip code", "ready", "30301"],
    ]);
  });

  it("leave a question that asks something else to the BDE: a failed check isn't a willingness to take one", () => {
    expect(filled([field("Have you ever failed a background check?", { kind: "radio", options: yesNo })])[0]![1]).not.toBe("ready");
  });

  it("fill self-identification into the form's own options", () => {
    expect(filled([
      field("Gender", { kind: "select", options: options("Male", "Female", "Decline to self-identify") }),
      field("Veteran status", { kind: "select", options: options("I am a protected veteran", "I am not a protected veteran", "I don't wish to answer") }),
      field("Disability status", { kind: "radio", options: options("Yes, I have a disability", "No, I don't have a disability", "I don't wish to answer") }),
    ])).toEqual([
      ["Gender", "ready", "Female"],
      ["Veteran status", "ready", "I am not a protected veteran"],
      ["Disability status", "ready", "No, I don't have a disability"],
    ]);
  });
});
