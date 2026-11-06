import { describe, expect, it } from "vitest";
import { CreateCandidateSchema } from "@/lib/schemas/candidate";
import type { WorkAuth } from "@/lib/schemas/enums";
import type { ResumeDraft } from "@/lib/schemas/resume-draft";
import { applyDraft, EMPTY_VALUES, firstOpenStep, isDirty, toCreateCandidate, validateStep, type WizardValues } from "./model";

const draft: ResumeDraft = {
  parseId: "parse_1", fileName: "Ravi.pdf", fullName: "Ravi Teja", primaryRole: "Java Developer", email: "ravi@example.com",
  phone: null, linkedinUrl: null, city: "Irving", state: "TX", country: null, yearsExperience: 9, workAuth: "H1B", workAuthText: null,
  summary: "Nine years of Java.", skills: [{ name: "Java", family: "Languages" }, { name: "AWS", family: "Cloud" }],
};
const valid: WizardValues = { ...EMPTY_VALUES, resume: { parseId: "parse_1", fileName: "Ravi.pdf" }, fullName: "Ravi Teja", primaryRole: "Java Developer", email: "ravi@example.com", phone: "(469) 555-0182", yearsExperience: "9", workAuth: "H1B", employmentTypes: ["C2C"], targetRoles: ["Java Developer"] };

describe("applyDraft (07 Q49)", () => {
  it("fills empty fields and marks them drafted; null fields stay empty", () => {
    const { values, drafted } = applyDraft(EMPTY_VALUES, draft);
    expect(values).toMatchObject({ resume: { parseId: "parse_1", fileName: "Ravi.pdf" }, fullName: "Ravi Teja", yearsExperience: "9", city: "Irving", phone: "", workAuth: "H1B" });
    expect(values.skills).toEqual([{ name: "Java", family: "Languages", source: "RESUME_UPLOAD" }, { name: "AWS", family: "Cloud", source: "RESUME_UPLOAD" }]);
    expect(drafted.sort()).toEqual(["city", "email", "fullName", "primaryRole", "skills", "state", "summary", "workAuth", "yearsExperience"]);
  });

  it("never overwrites what was typed, and merges skills by name", () => {
    const typed = { ...EMPTY_VALUES, fullName: "R. Teja", skills: [{ name: "java", family: null, source: "MANUAL" as const }] };
    const { values, drafted } = applyDraft(typed, draft);
    expect(values.fullName).toBe("R. Teja");
    expect(values.skills.map((skill) => `${skill.name}:${skill.source}`)).toEqual(["java:MANUAL", "AWS:RESUME_UPLOAD"]);
    expect(drafted).not.toContain("fullName");
  });

  it("a second résumé replaces every résumé field, edited or not, and keeps the rest", () => {
    const first = applyDraft(EMPTY_VALUES, { ...draft, country: "Canada" });
    // The owner edits the city, adds a skill by hand and sets a rate; then uploads the right file.
    const edited = { ...first.values, city: "Plano", rateTarget: "80", skills: [...first.values.skills, { name: "Kafka", family: null, source: "MANUAL" as const }] };
    const second = applyDraft(edited, { ...draft, parseId: "parse_2", fileName: "Right.pdf", fullName: "Asha Rao", email: "asha@example.com",
      city: "Dallas", country: null, summary: "", workAuth: "GC", skills: [{ name: "Python", family: "Languages" }] });
    expect(second.values).toMatchObject({ resume: { parseId: "parse_2", fileName: "Right.pdf" }, fullName: "Asha Rao", email: "asha@example.com",
      city: "Dallas", country: "US", summary: "", workAuth: "GC", rateTarget: "80" });
    expect(second.values.skills.map((skill) => `${skill.name}:${skill.source}`)).toEqual(["Python:RESUME_UPLOAD"]);
  });

  it("keeps the printed work authorization when it matched nothing", () => {
    expect(applyDraft(EMPTY_VALUES, { ...draft, workAuth: null, workAuthText: "Authorized to work" }).values).toMatchObject({ workAuth: null, workAuthText: "Authorized to work" });
  });

  it("takes the résumé's country over the default US, but never over one that was typed", () => {
    expect(EMPTY_VALUES.country).toBe("US");
    const canada = applyDraft(EMPTY_VALUES, { ...draft, country: "Canada" });
    expect(canada.values.country).toBe("Canada");
    expect(canada.drafted).toContain("country");
    expect(applyDraft(EMPTY_VALUES, { ...draft, country: "USA" }).values.country).toBe("US");
    expect(applyDraft({ ...EMPTY_VALUES, country: "Mexico" }, { ...draft, country: "Canada" }).values.country).toBe("Mexico");
  });
});

describe("the country sent", () => {
  it("is what the person entered, any country; every way of writing the US is sent as US", () => {
    const sent = (country: string) => toCreateCandidate({ ...valid, country, managerId: "m" }).country;
    expect(sent("Canada")).toBe("Canada");
    expect(sent(" Mexico ")).toBe("Mexico");
    expect(sent("United States")).toBe("US");
    expect(sent("U.S.A.")).toBe("US");
  });

  it("is required", () => {
    expect(validateStep("basic", { ...valid, country: " " })).toEqual({ country: "Enter their country." });
  });
});

describe("validateStep", () => {
  it("basic: name, 'Marketed as' and a valid email are required (Q48); years 0–60; LinkedIn a full link", () => {
    expect(Object.keys(validateStep("basic", EMPTY_VALUES)).sort()).toEqual(["email", "fullName", "phone", "primaryRole", "yearsExperience"]);
    expect(validateStep("basic", { ...valid, email: "ravi[at]example.com" }).email).toMatch(/valid email/);
    expect(validateStep("basic", { ...valid, yearsExperience: "212" }).yearsExperience).toMatch(/0 to 60/);
    expect(validateStep("basic", { ...valid, yearsExperience: "2.5" }).yearsExperience).toBeDefined();
    expect(validateStep("basic", { ...valid, linkedinUrl: "linkedin.com/in/x" }).linkedinUrl).toBeDefined();
    expect(validateStep("basic", valid)).toEqual({});
  });

  it("work: a work authorization, one engagement type, the floor not above the target", () => {
    expect(validateStep("work", { ...valid, workAuth: null, employmentTypes: [] })).toMatchObject({ workAuth: expect.any(String), employmentTypes: expect.any(String) });
    expect(validateStep("work", { ...valid, rateTarget: "85", rateMin: "90" }).rateMin).toBe("The floor can't be above the target rate.");
    expect(validateStep("work", { ...valid, rateTarget: "0" }).rateTarget).toBeDefined();
    expect(validateStep("work", { ...valid, noticePeriodDays: "-1" }).noticePeriodDays).toBeDefined();
    expect(validateStep("work", { ...valid, rateTarget: "85", rateMin: "70", noticePeriodDays: "0" })).toEqual({});
  });

  it("assign: a manager always; a BDE when the person is a MANAGER (07 Q41)", () => {
    expect(validateStep("assign", valid)).toEqual({ managerId: "Choose the manager." });
    expect(validateStep("assign", { ...valid, managerId: "m" })).toEqual({});
    expect(validateStep("assign", { ...valid, managerId: "m" }, { requiresBde: true })).toHaveProperty("bdeId");
    expect(validateStep("assign", { ...valid, managerId: "m", bdeId: "b" }, { requiresBde: true })).toEqual({});
    expect(isDirty({ ...EMPTY_VALUES, managerId: "m", bdeId: "b" })).toBe(false);
  });

  it("the résumé is required (07 Q58); preferences need one target role", () => {
    expect(validateStep("resume", EMPTY_VALUES)).toEqual({ resume: "Upload the candidate's résumé." });
    expect(validateStep("resume", valid)).toEqual({});
    expect(validateStep("preferences", EMPTY_VALUES)).toEqual({ targetRoles: "Add at least one role they are looking for." });
    expect(validateStep("preferences", valid)).toEqual({});
  });
});

describe("the flow", () => {
  it("a reload lands on the first step that can't be passed yet", () => {
    expect(firstOpenStep("preferences", EMPTY_VALUES, false)).toBe("resume");
    // No résumé, no way past step 1 (07 Q58), whatever else was typed.
    expect(firstOpenStep("basic", EMPTY_VALUES, true)).toBe("resume");
    expect(firstOpenStep("preferences", { ...EMPTY_VALUES, city: "Irving" })).toBe("resume");
    expect(firstOpenStep("preferences", { ...valid, fullName: "" })).toBe("basic");
    expect(firstOpenStep("preferences", { ...valid, workAuth: null })).toBe("work");
    expect(firstOpenStep("preferences", valid)).toBe("preferences");
    expect(firstOpenStep("resume", EMPTY_VALUES)).toBe("resume");
  });

  it("is dirty once anything is entered; the default engagement (C2C) alone is not", () => {
    expect(isDirty(EMPTY_VALUES)).toBe(false);
    expect(isDirty({ ...EMPTY_VALUES, city: "Irving" })).toBe(true);
    expect(isDirty({ ...EMPTY_VALUES, employmentTypes: [] })).toBe(true);
  });
});

describe("toCreateCandidate", () => {
  it("builds a valid payload: trimmed text, numbers, ISO dates, sponsorship from the work authorization (A3)", () => {
    const values: WizardValues = {
      ...applyDraft(EMPTY_VALUES, draft).values, phone: " (469) 555-0182 ", targetRoles: ["Java Developer"], rateTarget: "85", rateMin: "70", workAuthExpiry: "2027-03-01",
      employmentTypes: ["C2C", "W2"], workSettings: ["REMOTE"], contactNotes: "Prefers WhatsApp.",
    };
    const body = toCreateCandidate({ ...values, managerId: "user_fatima", bdeId: "user_adnan", handoffNote: "  Push banking.  " });
    expect(CreateCandidateSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      phone: "(469) 555-0182", country: "US", needsSponsorship: true, needsTransfer: true, yearsExperience: 9, rateTarget: 85, rateMin: 70, workAuthExpiry: "2027-03-01T00:00:00.000Z",
      resumeParseId: "parse_1", managerId: "user_fatima", bdeId: "user_adnan",
      handoffNote: "Push banking.",
    });
    expect(toCreateCandidate({ ...valid, workAuth: "GC", managerId: "m" })).toMatchObject({ resumeParseId: "parse_1", bdeId: null, handoffNote: null });
    // The flow works sponsorship and transfer out from the work authorization and sends them (A3); the backend only checks they are there.
    const sent = (workAuth: WorkAuth) => toCreateCandidate({ ...valid, workAuth, managerId: "m" });
    expect(sent("H1B")).toMatchObject({ needsSponsorship: true, needsTransfer: true });
    expect(sent("OPT")).toMatchObject({ needsSponsorship: true, needsTransfer: false });
    expect(sent("GC")).toMatchObject({ needsSponsorship: false, needsTransfer: false });
    expect(sent("TN")).toMatchObject({ needsSponsorship: true, needsTransfer: false });
  });
});
