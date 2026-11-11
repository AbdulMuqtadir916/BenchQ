import { describe, expect, it } from "vitest";
import { AutofillVersionDto, toAutofillChangeBody, toVersionAutofill } from "./resume-autofill";

describe("the Autofill screen's DTO (docs/02 §8.3)", () => {
  it("maps the read, leaving the version's other fields out", () => {
    const version = AutofillVersionDto.parse({
      id: "v1", candidate_id: "c1", full_name: "Ravi Teja",
      autofill: [
        { question: "What is your expected rate?", answer: 95, kind: "EDITED", key: "pay-rate", type: "number", built: 85 },
        { question: "Which state do you live in?", answer: "TX", kind: "FIXED", key: "address-region", type: "text", replaced: "Texas" },
        { question: "What is your GitHub profile URL?", answer: null, kind: "FIXED", key: "github-url", type: "text" },
        { question: "Why us?", answer: "Payments.", kind: "CUSTOM", also: ["What draws you to us?"] },
      ],
    });
    expect(toVersionAutofill("v1", version)).toEqual({
      versionId: "v1", candidateId: "c1",
      entries: [
        { question: "What is your expected rate?", answer: 95, kind: "EDITED", key: "pay-rate", type: "number", built: 85, also: [] },
        { question: "Which state do you live in?", answer: "TX", kind: "FIXED", key: "address-region", type: "text", replaced: "Texas", also: [] },
        { question: "What is your GitHub profile URL?", answer: null, kind: "FIXED", key: "github-url", type: "text", also: [] },
        { question: "Why us?", answer: "Payments.", kind: "CUSTOM", key: null, type: null, also: ["What draws you to us?"] },
      ],
    });
  });

  it("sends a save in the backend's words", () => {
    expect(toAutofillChangeBody({ edit: { "pay-rate": 90 }, built: { "pay-rate": 85 }, reset: [], add: {}, remove: [], onlyThis: true }))
      .toEqual({ edit: { "pay-rate": 90 }, built: { "pay-rate": 85 }, reset: [], add: {}, remove: [], only_this: true });
  });
});
