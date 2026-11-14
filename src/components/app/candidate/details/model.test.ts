import { describe, expect, it } from "vitest";
import { UpdateCandidateSchema, type Candidate } from "@/lib/schemas/candidate";
import { detailsValues, isChanged, toUpdate, validateDetails } from "./model";

/** A made-up candidate: only the fields the details tab reads matter. */
const candidate: Candidate = {
  id: "cand_1", firmId: "firm_1", fullName: "Candidate", email: null, phone: null, linkedinUrl: null,
  city: "Austin", state: "TX", country: "US", willingToRelocate: false, workAuth: "H1B",
  workAuthExpiry: "2027-03-01T00:00:00.000Z", needsSponsorship: true, needsTransfer: true, employmentTypes: ["C2C"],
  rateMin: 70, rateTarget: 85, status: "ON_BENCH", benchStartDate: null, availableFrom: null, noticePeriodDays: 14,
  yearsExperience: 9, primaryRole: "Java Developer", targetRoles: ["Java Developer", "Backend Engineer"],
  managerId: "user_m", bdeId: "user_b", workSettings: ["REMOTE"], preferredLocations: ["Dallas, TX"],
  contactNotes: null, preferredIndustries: [], dealBreakers: [], qaBank: [],
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("the details tab's form (decided 2026-11-14, Q18–Q20, Q24)", () => {
  it("starts from the candidate: one target role box with the first role, dates as their stored day", () => {
    const values = detailsValues(candidate);
    expect(values).toMatchObject({ primaryRole: "Java Developer", yearsExperience: "9", targetRole: "Java Developer", workAuthExpiry: "2027-03-01", rateTarget: "85", noticePeriodDays: "14", city: "Austin", state: "TX" });
    expect(validateDetails(values)).toEqual({});
  });

  it("an untouched form sends what is stored, with only the first target role (Q24)", () => {
    const update = toUpdate(candidate, detailsValues(candidate));
    expect(UpdateCandidateSchema.parse(update)).toEqual(update);
    expect(update).toMatchObject({ targetRoles: ["Java Developer"], workAuthExpiry: "2027-03-01T00:00:00.000Z", rateTarget: 85, contactNotes: null });
    expect(update).not.toHaveProperty("workAuth");                         // the same status sends nothing
    expect(isChanged(candidate, detailsValues(candidate))).toBe(false);
  });

  it("a changed work authorization carries its sponsorship and transfer; a picked day is saved at noon UTC", () => {
    const update = toUpdate(candidate, { ...detailsValues(candidate), workAuth: "GC", workAuthExpiry: "2028-01-15", contactNotes: "  Calls after 6. " });
    expect(update).toMatchObject({ workAuth: "GC", needsSponsorship: false, needsTransfer: false, workAuthExpiry: "2028-01-15T12:00:00.000Z", contactNotes: "Calls after 6." });
  });

  it("follows onboarding's rules: the role, years, a target role, and a place named as the résumé's", () => {
    const values = detailsValues(candidate);
    expect(validateDetails({ ...values, primaryRole: " ", yearsExperience: "61", targetRole: "" })).toEqual({
      primaryRole: "Enter the title they're marketed as.",
      yearsExperience: "Years of experience is a whole number from 0 to 60.",
      targetRole: "Enter the role they are looking for.",
    });
    expect(validateDetails({ ...values, state: "", preferredLocations: [] })).toEqual({
      preferredLocations: "Add a preferred location, or a city and state on the résumé: the job search needs a place.",
    });
    expect(validateDetails({ ...values, city: "", state: "" })).toEqual({});   // the preferred location is enough
  });
});
