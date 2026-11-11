import { describe, expect, it } from "vitest";
import { optionFor, pickOneReason, polarity } from "./options";
import type { FieldOption } from "./types";

const options = (...labels: string[]): FieldOption[] => labels.map((label, index) => ({ id: `o${index}`, label }));

describe("polarity", () => {
  it.each(["Yes", "yes", "Y", "true", "Yes.", "Yes, I am authorized", "Yes - on my H1B", "Yes (H1B)", "Yes I am", "I am authorized", "I do"])(
    "reads %s as yes", (text) => { expect(polarity(text)).toBe("yes"); });

  it.each(["No", "no", "N", "false", "No.", "No, thanks", "No, I will not", "I am not authorized", "I do not", "I don't", "I will not need it"])(
    "reads %s as no", (text) => { expect(polarity(text)).toBe("no"); });

  it.each(["N/A", "Not applicable", "No preference", "Yesterday", "Maybe", "Norway", "H1B", "Two weeks", "", "I don't wish to answer", "I do not want to answer", "Decline to self identify"])(
    "reads %s as neither", (text) => { expect(polarity(text)).toBeNull(); });
});

describe("optionFor", () => {
  it("picks the option the answer names", () => {
    expect(optionFor("Two weeks", options("One week", "Two weeks"))).toBe("o1");
  });

  it("ignores case, punctuation and spacing", () => {
    expect(optionFor("Full-time", options("Part time", "Full time"))).toBe("o1");
    expect(optionFor("H-1B", options("OPT", "H1B"))).toBe("o1");
  });

  it("reads every spelling of the country the same way", () => {
    expect(optionFor("US", options("Canada", "United States of America"))).toBe("o1");
    expect(optionFor("United States", options("USA", "Mexico"))).toBe("o0");
  });

  it("reads a US state's code and name as the same answer", () => {
    expect(optionFor("TX", options("California", "Texas"))).toBe("o1");
    expect(optionFor("Texas", options("CA", "TX"))).toBe("o1");
  });

  it("maps a yes or no answer to the option that says the same", () => {
    expect(optionFor("Yes, I am authorized to work in the US", options("Yes", "No"))).toBe("o0");
    expect(optionFor("No", options("Yes, I need sponsorship", "No, I do not need sponsorship"))).toBe("o1");
  });

  it("won't guess between two options that say the same", () => {
    expect(optionFor("Yes", options("Yes, now", "Yes, later", "No"))).toBeNull();
    expect(optionFor("Same", options("Same", "same"))).toBeNull();
    expect(optionFor("h-1b", options("OPT", "H1B", "H 1B."))).toBeNull();
  });

  it("won't force a yes or no onto options that don't have one", () => {
    expect(optionFor("Yes", options("Red", "Blue"))).toBeNull();
  });

  it("knows answers that say the same thing in other words", () => {
    expect(optionFor("Green card holder", options("US Citizen", "Permanent Resident"))).toBe("o1");
    expect(optionFor("Female", options("Man", "Woman"))).toBe("o1");
    expect(optionFor("Male", options("Woman", "Man"))).toBe("o1");
    expect(optionFor("Black", options("White", "Black or African American"))).toBe("o1");
    expect(optionFor("Prefer not to say", options("Yes", "No", "I don't wish to answer"))).toBe("o2");
  });

  it("finds a number in a list of ranges", () => {
    const ranges = options("1-2 years", "3-5 years", "6-8 years", "9+");
    expect(optionFor("4", ranges)).toBe("o1");
    expect(optionFor("12", ranges)).toBe("o3");
    expect(optionFor("Plenty", ranges)).toBeNull();
  });

  it("takes the plain word over a qualified one", () => {
    expect(optionFor("Female", options("Cis-woman", "Woman", "Transgender woman"))).toBe("o1");
    expect(optionFor("Male", options("Trans man", "Man, male or masculine"))).toBe("o1");
  });

  it("reads other ways of saying yes and no", () => {
    expect(optionFor("Yes", options("I am not a veteran", "I identify as a veteran", "I don't wish to answer"))).toBe("o1");
    expect(optionFor("No", options("Blindness", "None of these apply"))).toBe("o1");
  });

  it("doesn't take declining for a no", () => {
    expect(optionFor("No", options("I don't wish to answer", "I am not a protected veteran"))).toBe("o1");
    expect(optionFor("No", options("I do not want to answer", "No, I do not have a disability"))).toBe("o1");
  });

  it("picks a country from a list with dial codes", () => {
    const countries = options("Uruguay +598", "United States +1", "U.S. Virgin Islands +1340", "Canada +1");
    expect(optionFor("US", countries)).toBe("o1");
    expect(optionFor("Canada", countries)).toBe("o3");
  });

  it("uses the state to pick a city from a lookup", () => {
    const cities = options("Phoenix, Arizona, United States", "Phoenix, Oregon, United States");
    expect(optionFor("Phoenix, AZ", cities)).toBe("o0");
    expect(optionFor("Phoenix", cities)).toBeNull();
  });

  it("picks the city itself when a lookup lists places around it", () => {
    const cities = options("Dallas County, Texas, United States", "Dallas, Dallas County, Texas, United States", "Dallas, Texas, United States", "Dallas, Oregon, United States");
    expect(optionFor("Dallas, TX", cities)).toBe("o2");
  });

  it("leaves a lookup where nothing is the city itself", () => {
    expect(optionFor("Dallas, TX", options("Dallas County, Texas", "North Dallas, Texas"))).toBeNull();
  });

  it("picks a state however a list dresses it", () => {
    expect(optionFor("TX", options("(US) Alabama", "(US) Texas"))).toBe("o1");
  });

  it("matches an answer inside an option, or an option inside an answer", () => {
    expect(optionFor("H1B", options("H1B visa holder", "OPT"))).toBe("o0");
    expect(optionFor("I hold an H1B visa", options("H1B", "OPT"))).toBe("o0");
  });

  it("gives up when nothing fits", () => {
    expect(optionFor("Purple", options("Red", "Blue"))).toBeNull();
    expect(optionFor("Anything", [])).toBeNull();
  });
});

describe("a race a form splits into groups", () => {
  const split = options("Black or of African descent", "East Asian", "South Asian", "Southeast Asian", "White");

  it("fills the group the candidate saved", () => {
    expect(optionFor("South Asian", split)).toBe("o2");
  });

  it("won't narrow a broader answer down, because that would be a guess", () => {
    expect(optionFor("Asian", split)).toBeNull();
  });

  it("won't swap one group for another", () => {
    expect(optionFor("South Asian", options("East Asian", "Southeast Asian", "White"))).toBeNull();
  });

  it("fills the broader option when a form doesn't split it", () => {
    expect(optionFor("South Asian", options("Asian", "White"))).toBe("o0");
    expect(optionFor("Southeast Asian", options("White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)"))).toBe("o1");
  });

  it("isn't fooled by words that only look alike", () => {
    expect(optionFor("Asian", options("Caucasian", "Black"))).toBeNull();
    expect(optionFor("Indian", options("American Indian or Alaska Native", "White"))).toBeNull();
  });
});

describe("pickOneReason", () => {
  it("names the options an answer fits", () => {
    expect(pickOneReason("Asian", options("East Asian", "South Asian", "Southeast Asian", "White")))
      .toBe("This answer fits East Asian, South Asian and Southeast Asian. Pick the right one yourself.");
  });

  it("says nothing when one option fits, or none, or too many to read", () => {
    expect(pickOneReason("Asian", options("Asian", "White"))).toBeNull();
    expect(pickOneReason("Purple", options("Red", "Blue"))).toBeNull();
    expect(pickOneReason("Engineer", options("A Engineer", "B Engineer", "C Engineer", "D Engineer", "E Engineer"))).toBeNull();
  });
});
