import { describe, expect, it } from "vitest";
import { authorizedIn, sponsorshipIn } from "./authorization";
import { optionFor, pickOneReason } from "./options";
import { buildReview } from "./review";
import type { BankEntry, FieldOption, TabField } from "./types";

/** Choosing options the way real forms word them: race and ethnicity lists, work-authorization status sentences, and
 * short answers. The lists are copied from employers' forms. */

const options = (...labels: string[]): FieldOption[] => labels.map((label, index) => ({ id: `o${index}`, label }));
const picked = (answer: string, list: FieldOption[]) => list.find(({ id }) => id === optionFor(answer, list))?.label ?? null;
const entry = (question: string, answer: string): BankEntry => ({ id: question, question, answer, category: "OTHER" });
const field = (label: string, kind: TabField["kind"], list: FieldOption[] = []): TabField => ({
  id: "f0", frameId: 0, pageUrl: "https://jobs.example.test/apply", kind, label, hints: "", autocomplete: "", required: true,
  current: "", options: list, maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});
const review = (one: TabField, bank: BankEntry[]) => buildReview([one], bank)[0]!;

const DETAILED = options(
  "Alaskan Native / American Indian / Indigenous American / Native American",
  "Black / of African or African-American descent",
  "East Asian (inclusive of Chinese, Japanese, Korean, Mongolian, Tibetan, and Taiwanese)",
  "Latino/a/x/Hispanic (inclusive of the United States of America, South America, Central America, and the Caribbean)",
  "Latino/a/x/Hispanic (inclusive of Canada, South America, Central America, and the Caribbean)",
  "Middle Eastern",
  "Pacific Islander or Native Hawaiian",
  "South Asian (inclusive of Afghani, Bangladeshi, Bhutanese, Indian, Nepali, Pakistani, and Sri Lankan)",
  "Southeast Asian (inclusive of Burmese, Cambodian, Filipino, Hmong, Indonesian, Laotian, Malaysian, Mien, Singaporean, Thai, and Vietnamese)",
  "White", "I prefer to self-describe", "I don't wish to answer",
);
const EEOC = options("American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "White",
  "Native Hawaiian or Other Pacific Islander", "Two or More Races", "Decline To Self Identify");
const EEO_1 = options("Hispanic or Latino", "White (Not Hispanic or Latino)", "Black or African American (Not Hispanic or Latino)",
  "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)",
  "American Indian or Alaska Native (Not Hispanic or Latino)", "Two or More Races (Not Hispanic or Latino)", "I don't wish to answer");

describe("race and ethnicity lists, however a form words them", () => {
  it.each([
    ["South Asian", "South Asian (inclusive of"], ["Indian", "South Asian (inclusive of"], ["Asian (Indian)", "South Asian (inclusive of"],
    ["East Asian", "East Asian (inclusive of"], ["African American", "Black / of African"], ["Caucasian", "White"],
    ["Native American", "Alaskan Native / American Indian"], ["Native Hawaiian", "Pacific Islander or Native Hawaiian"],
    ["Arab", "Middle Eastern"], ["Prefer not to say", "I don't wish to answer"],
  ])("reads %s on a detailed list", (answer, start) => {
    expect(picked(answer, DETAILED)).toMatch(new RegExp(`^${start.replace(/[()/]/g, "\\$&")}`));
  });

  it("won't narrow a broad answer, or choose between two near-identical options", () => {
    expect(picked("Asian", DETAILED)).toBeNull();
    expect(pickOneReason("Asian", DETAILED)).toContain("East Asian");
    expect(picked("Hispanic", DETAILED)).toBeNull();
  });

  it.each([
    ["Indian", EEOC, "Asian"], ["Asian Indian", EEO_1, "Asian (Not Hispanic or Latino)"], ["Caucasian", EEOC, "White"],
    ["South Asian, White", EEOC, "Two or More Races"], ["South Asian, White", EEO_1, "Two or More Races (Not Hispanic or Latino)"],
  ])("reads %s on a standard list", (answer, list, option) => {
    expect(picked(answer, list)).toBe(option);
  });

  it("never picks one of several saved races, and leaves what a list doesn't offer", () => {
    expect(picked("South Asian, White", DETAILED)).toBeNull();
    expect(picked("Middle Eastern", EEOC)).toBeNull();
  });

  it("leaves lists that aren't about race to the usual matching", () => {
    expect(picked("Mandarin Chinese", options("English", "Chinese", "Japanese", "Hindi"))).toBe("Chinese");
  });
});

describe("a saved Hispanic answer, for forms that ask it in the race list", () => {
  const hispanic = [entry("Race", "White"), entry("Are you Hispanic or Latino?", "Yes")];

  it("picks the Hispanic option on a list that asks both", () => {
    expect(review(field("Race/Ethnicity", "select", EEO_1), hispanic).proposed).toBe("Hispanic or Latino");
  });

  it("ticks it beside the race, or leaves it out of a list without it", () => {
    const withIt = options("Asian", "Hispanic or Latino", "White");
    expect(review(field("Race (mark all that apply)", "checkbox", withIt), hispanic).proposed).toBe("Hispanic or Latino, White");
    const without = options("Asian", "Black", "White");
    expect(review(field("Race (mark all that apply)", "checkbox", without), hispanic).proposed).toBe("White");
  });

  it("keeps picking the race option when no Hispanic answer is saved", () => {
    expect(review(field("Race/Ethnicity", "select", EEO_1), [entry("Race", "Asian")]).proposed).toBe("Asian (Not Hispanic or Latino)");
  });
});

describe("work authorization, however the saved answers word it", () => {
  it.each([
    ["Yes", true], ["Yes - H1B", true], ["Authorized", true], ["US Citizen", true], ["Green card holder", true], ["H-1B", true],
    ["I am authorized to work in the US", true], ["No", false], ["Not authorized", false], ["", null], ["Maybe", null],
  ])("reads %s as authorized: %s", (answer, authorized) => {
    expect(authorizedIn(answer)).toBe(authorized);
  });

  it.each([
    ["Yes", true], ["Yes, H-1B transfer", true], ["Transfer only", true], ["Will need sponsorship", true], ["No", false],
    ["No sponsorship required", false], ["Not needed", false], ["I do not require sponsorship", false], ["H-1B", null],
  ])("reads %s as needing sponsorship: %s", (answer, needs) => {
    expect(sponsorshipIn(answer)).toBe(needs);
  });

  const STATUS = options("I am authorized to work in the U.S. for any employer",
    "I am authorized to work in the U.S. but will require sponsorship now or in the future", "I am not authorized to work in the U.S.");
  const status = (bank: BankEntry[]) => review(field("Which best describes your work authorization?", "select", STATUS), bank).proposed;
  const auth = (answer: string) => entry("Are you legally authorized to work in the United States?", answer);
  const sponsor = (answer: string) => entry("Will you now or in the future require sponsorship?", answer);

  it("picks the status sentence the two saved answers come to", () => {
    expect(status([auth("Yes - H1B"), sponsor("Yes, H-1B transfer")])).toBe(STATUS[1]!.label);
    expect(status([auth("US Citizen"), sponsor("No sponsorship required")])).toBe(STATUS[0]!.label);
    expect(status([auth("No"), sponsor("Yes")])).toBe(STATUS[2]!.label);
  });

  it("leaves it to the BDE when sponsorship isn't saved, rather than reading it from a visa type", () => {
    expect(review(field("Which best describes your work authorization?", "select", STATUS), [auth("H-1B")]).status).toBe("manual");
  });

  it("gives a dropdown that opens on click the status to try when the saved answer has no option", () => {
    const row = review(field("Work authorization status", "combobox"), [entry("Visa status", "H-1B"), auth("Yes"), sponsor("Yes")]);
    expect(row.write).toEqual({ type: "choice", value: "H-1B", also: ["Authorized to work in the US, will require sponsorship"] });
  });
});

describe("short answers and job boards", () => {
  it("reads M and F, and GC", () => {
    expect(picked("M", options("Man", "Woman", "Non-binary"))).toBe("Man");
    expect(picked("F", options("Male", "Female"))).toBe("Female");
    expect(picked("GC", options("U.S. Citizen", "Green Card Holder", "H-1B"))).toBe("Green Card Holder");
  });

  it("takes a job board to the list's job-board option, never one board to another", () => {
    expect(picked("Dice", options("Job Board (Indeed, LinkedIn, etc.)", "Referral", "Other"))).toBe("Job Board (Indeed, LinkedIn, etc.)");
    expect(picked("LinkedIn", options("Dice", "Referral"))).toBeNull();
  });
});
