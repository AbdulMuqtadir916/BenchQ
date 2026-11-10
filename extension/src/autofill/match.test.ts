import { describe, expect, it } from "vitest";
import { fieldTypeFor, matchBank, minimumYears } from "./match";
import { tokens } from "./text";
import type { BankEntry, ScannedField } from "./types";

const entry = (question: string, answer = "Yes", category = "OTHER", id = question): BankEntry =>
  ({ id, question, answer, category });

const matched = (label: string, bank: BankEntry[]) => {
  const result = matchBank(label, bank);
  return result.status === "match" ? result.entry.answer : result.status;
};

describe("tokens", () => {
  it("reduces a question to the words that carry its meaning", () => {
    expect([...tokens("Are you legally authorised to work in the U.S.?")]).toEqual(["authorized", "work", "us"]);
    expect([...tokens("How many years of experience do you have?")]).toEqual(["year", "experience"]);
  });

  it("reads every spelling of the country the same way", () => {
    for (const country of ["USA", "U.S.A.", "United States", "the United States of America", "America"]) {
      expect(tokens(`Work in ${country}`)).toEqual(tokens("Work in the US"));
    }
  });
});

describe("matchBank", () => {
  it("takes the same question however it's typed", () => {
    expect(matched("WHAT IS YOUR NOTICE PERIOD?", [entry("Notice period", "Two weeks")])).toBe("Two weeks");
  });

  it.each([
    ["Are you legally authorized to work in the United States?", "Are you authorized to work in the US?"],
    ["Do you require visa sponsorship?", "Do you need sponsorship?"],
    ["Is sponsorship required?", "Do you need sponsorship?"],
    ["What are your salary expectations?", "Expected salary"],
    ["Desired salary", "Salary expectation"],
    ["When can you start?", "Earliest start date"],
  ])("matches %s with %s, which differ only by filler or weak words", (label, question) => {
    expect(matched(label, [entry(question, "saved")])).toBe("saved");
  });

  it.each([
    ["Years of experience with Java", "Years of experience with Python"],
    ["Years of experience with Java", "Years of experience"],
    ["Years of experience", "Years of experience with Java"],
    ["What is your current salary?", "What is your expected salary?"],
    ["Do you require sponsorship?", "Do you not require sponsorship?"],
    ["Do you have 5 years of Java?", "Do you have 3 years of Java?"],
    ["Will you require sponsorship now?", "Will you require sponsorship in the future?"],
    ["Are you authorized to work in Canada?", "Are you authorized to work in the US?"],
    ["Current company", "Current position"],
    ["First name", "Last name"],
    ["Why this city?", "City"],
  ])("never lets %s take the answer to %s", (label, question) => {
    expect(matchBank(label, [entry(question)])).toEqual({ status: "none" });
  });

  it("finds nothing for an empty label, or one of only filler", () => {
    expect(matchBank("", [entry("Notice period")]).status).toBe("none");
    expect(matchBank("Please enter your", [entry("Notice period")]).status).toBe("none");
  });

  it("prefers the closest wording when another entry is clearly further away", () => {
    const bank = [entry("Require sponsorship date time status detail", "far"), entry("Do you require visa sponsorship?", "near")];
    expect(matched("Do you require visa sponsorship", bank)).toBe("near");
  });

  it("uses one answer when two entries agree", () => {
    const bank = [entry("Notice period", "Two weeks", "OTHER", "a"), entry("Your notice period", "two weeks", "OTHER", "b")];
    expect(matchBank("Notice period", bank).status).toBe("match");
  });

  it("leaves a tie to the BDE when two entries disagree", () => {
    const bank = [entry("Notice period", "Two weeks", "OTHER", "a"), entry("Your notice period", "One month", "OTHER", "b")];
    expect(matchBank("Notice period", bank)).toEqual({ status: "tie", entries: bank });
  });

  it("breaks a tie with the entry's category", () => {
    const bank = [entry("Notice period", "Two weeks", "AVAILABILITY", "a"), entry("Your notice period", "One month", "OTHER", "b")];
    expect(matched("Notice period", bank)).toBe("Two weeks");
  });
});

const field = (label: string, autocomplete = ""): ScannedField => ({
  id: "f0", kind: "text", label, hints: "", autocomplete, required: false, current: "", options: [], maxLength: null,
  inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});

describe("fieldTypeFor", () => {
  it.each([
    ["First Name", "first-name"], ["Given name", "first-name"], ["Legal first name", "first-name"],
    ["Last Name", "last-name"], ["Surname", "last-name"], ["Family name", "last-name"],
    ["Name", "full-name"], ["Full name", "full-name"], ["Legal name", "full-name"], ["Your name", "full-name"],
    ["Preferred name", "preferred-name"], ["Preferred First Name", "preferred-name"], ["Nickname", "preferred-name"],
    ["Email", "email"], ["Email address", "email"], ["E-mail", "email"], ["Your email address", "email"],
    ["Phone", "phone"], ["Phone number", "phone"], ["Mobile number", "phone"], ["Cell phone", "phone"],
    ["Country code", "phone-country-code"], ["Dial code", "phone-country-code"],
    ["City", "address-city"], ["Current location", "city-state"], ["Location", "city-state"], ["Location (City)", "city-state"],
    ["State", "address-region"],
    ["State / Province", "address-region"], ["City, State", "city-state"], ["Country", "address-country"],
    ["LinkedIn", "linkedin-url"], ["LinkedIn Profile", "linkedin-url"], ["LinkedIn URL", "linkedin-url"],
    ["Current title", "current-title"], ["Job title", "current-title"],
    ["Years of experience", "years-experience"], ["Total years of experience", "years-experience"],
    ["Start date", "start-date"], ["Earliest start date", "start-date"], ["When can you start?", "start-date"],
    ["Date available", "start-date"], ["Notice period", "notice-period"], ["Today's date", "todays-date"],
    ["Are you legally authorized to work in the United States?", "work-authorization"],
    ["Are you eligible to work in the US?", "work-authorization"],
    ["Will you now or in the future require sponsorship for employment visa status?", "visa-sponsorship"],
    ["Do you require visa sponsorship?", "visa-sponsorship"], ["Will you require sponsorship in the future?", "visa-sponsorship"],
    ["Are you a US citizen?", "citizenship"], ["Visa type", "visa-type"], ["Visa status", "visa-type"],
    ["Are you willing to relocate?", "relocation-willing"], ["Preferred location", "preferred-locations"],
    ["Company name", "current-company"], ["Current employer", "current-company"],
    ["Please provide the name of your current (or most recent) company", "current-company"],
    ["Professional Profile (LinkedIn, Github, Website, etc)", "linkedin-url"], ["GitHub", "github-url"],
    ["Expected salary", "salary-expectation"], ["What are your salary expectations?", "salary-expectation"],
    ["How did you hear about this job?", "referral-source"], ["How did you first hear about this role?", "referral-source"],
    ["Are you at least 18 years of age?", "over-18"], ["Are you 18 years of age or older?", "over-18"],
    ["What is your current work authorization?", "visa-type"], ["Phone country code", "phone-country-code"],
  ])("reads %s as %s", (label, type) => {
    expect(fieldTypeFor(field(label))).toBe(type);
  });

  it.each([
    "Referrer email", "Manager's phone number", "Emergency contact first name", "State your reason for leaving",
    "Country of citizenship", "City of birth", "School name", "Why this city?",
    "Years of experience with Java",
  ])("leaves %s alone", (label) => {
    expect(fieldTypeFor(field(label))).toBeNull();
  });

  it("reads the one autocomplete hint the engine lacks", () => {
    expect(fieldTypeFor(field("Code", "tel-country-code"))).toBe("phone-country-code");
  });
});

describe("the sponsorship question", () => {
  const choice = (label: string, kind: ScannedField["kind"] = "combobox"): ScannedField => ({ ...field(label), kind });

  /** Word for word from employers' application forms. */
  it.each([
    "Do you now, or will you in the future, require immigration sponsorship to work at Reddit?",
    "Will you require Elastic's sponsorship to continue or extend your work authorization status?",
    "Will you require Stripe to sponsor you for a work permit now or in the future for the location(s) you selected in your previous response?",
    "Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?",
    "Will you now (or in the future) require visa sponsorship in order to work in the US?",
    "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?",
    "Will you now, or in the future, require sponsorship (i.e. H-1B visa, etc.) to legally work in the U.S.?",
    "Do you require immigration sponsorship to work for Affirm in the United States?",
    "Will you now or in the future require Samsara to commence (“sponsor”) an immigration case in order to employ you?",
    "Do you now or will you in the future need sponsorship for employment visa status in the country in which you are applying?",
    "Will you now or in the future require employment sponsorship? (e.g. H1B, OPT, J1, TN)?",
    "Do you now or in the future require immigration support or visa sponsorship to continue working in the United States?",
    "Will you now or in the future require Visa Sponsorship?",
  ])("reads %s", (label) => {
    expect(fieldTypeFor(choice(label))).toBe("visa-sponsorship");
  });

  it.each(["text", "textarea"] as const)("leaves a %s alone, where it asks which kind", (kind) => {
    expect(fieldTypeFor(choice("Will you require sponsorship to work at Reddit?", kind))).toBeNull();
  });

  it.each([
    "Will you be able to work in the US without sponsorship?",
    "Do you have a visa that doesn't require sponsorship?",
    "Do you not require sponsorship?",
    "Do you require sponsorship to work in Canada?",
    "Will you need sponsorship to work in the UK?",
    "Do you have a spouse who will require sponsorship?",
    "If you require sponsorship, please say for which visa.",
    "Are you authorised to work in the country in which this role is located? (Fin sponsors immigration for some roles so we encourage you to still apply if you require sponsorship.)",
  ])("leaves %s alone", (label) => {
    expect(fieldTypeFor(choice(label))).toBeNull();
  });
});

describe("work authorization", () => {
  const choice = (label: string, kind: ScannedField["kind"] = "combobox"): ScannedField => ({ ...field(label), kind });

  /** Word for word from employers' application forms. */
  it.each([
    "Are you currently authorized to work in this country?",
    "Are you legally authorized to work in the country where the job is located?",
    "Are you legally authorised to work full-time in the country where this job is based?",
    "Are you authorized to work in the location(s) you selected in your previous response?",
    "Are you legally authorized to work in the United States for our Company?",
    "Are you authorized to work lawfully in the United States for Duolingo?",
    "Are you currently legally authorized to work in the country in which this job is based (e.g. you are a citizen, you have a visa, etc.)?",
    "Are you currently eligible to work legally in the United States of America?",
    "Do you have the legal right to work in the country where you are applying to work?",
  ])("reads %s", (label) => {
    expect(fieldTypeFor(choice(label))).toBe("work-authorization");
  });

  it.each(["text", "textarea"] as const)("leaves a %s alone", (kind) => {
    expect(fieldTypeFor(choice("Are you authorized to work in this country?", kind))).toBeNull();
  });

  it.each([
    "Are you authorized to work in Canada?",
    "Are you authorized to work in the UK?",
    "Are you authorized to work without sponsorship?",
    "Are you not authorized to work in this country?",
    "Are you legally authorized to work in the country in which the job you are applying for is located, for any employer?",
    "Do you, now or in the future, require a work permit, visa, or additional right to work support for the country where you are applying to work?",
    "If so, are you eligible or currently in a period of Optional Practical Training (OPT)?",
  ])("leaves %s alone", (label) => {
    expect(fieldTypeFor(choice(label))).toBeNull();
  });
});

describe("questions forms word many ways", () => {
  const choice = (label: string, kind: ScannedField["kind"] = "combobox"): ScannedField => ({ ...field(label), kind });

  it.each([
    ["Gender", "eeo-gender"], ["What gender identity do you most closely identify with?", "eeo-gender"],
    ["Race", "eeo-race"], ["Race/Ethnicity", "eeo-race"], ["Please select up to 2 ethnicities that you most closely identify with.", "eeo-race"],
    ["Are you Hispanic/Latino?", "eeo-hispanic"], ["Veteran Status", "eeo-veteran"],
    ["Are you a veteran/have you served in the military?", "eeo-veteran"], ["Disability Status", "eeo-disability"],
    ["Do you live with a disability (as outlined by the ADA)?", "eeo-disability"], ["Do you have a disability?", "eeo-disability"],
    ["What is your race or ethnicity?", "eeo-race"], ["What is your gender or gender identity?", "eeo-gender"],
    ["Are you Hispanic or Latino?", "eeo-hispanic"], ["Are you a protected veteran?", "eeo-veteran"],
    ["Do you require workplace accommodations?", "accommodations"],
    ["Please describe any need for a reasonable accommodation for this hiring process", "accommodations"],
    ["Are you able to perform the essential functions of this job, with or without reasonable accommodation?", "essential-functions"],
    ["What is your preferred pronoun?", "pronouns"], ["Please share your gender pronouns.", "pronouns"],
    ["How did you hear about this position?", "referral-source"], ["How did you learn about this job?", "referral-source"],
    ["How did you hear about Twilio?", "referral-source"], ["Where did you first hear about this role?", "referral-source"],
    ["At the time of application, are you 18+ years of age?", "over-18"], ["Are you at least 18?", "over-18"],
    ["Have you ever been convicted of a felony?", "criminal-history"], ["Do you have a criminal record?", "criminal-history"],
    ["Are you willing to undergo a background check?", "background-check"], ["Are you willing to take a drug test?", "drug-test"],
    ["Do you hold an active security clearance?", "security-clearance"],
    ["Are you currently subject to any non-compete or non-solicitation agreement?", "non-compete"],
    ["Are you subject to any post-employment restrictions?", "non-compete"], ["Are you a current government official?", "government-work"],
    ["Do you have any family members at Okta?", "relative-at-company"], ["Are you related to anyone at Acme?", "relative-at-company"],
    ["Have you ever worked for Figma before?", "former-employee"], ["Have you previously been employed by Coinbase in any capacity?", "former-employee"],
    ["Do you currently, or have you previously, worked at Capital One?", "former-employee"], ["Have you worked for this company?", "former-employee"],
    ["Are you willing to work from the office location of the job?", "onsite-work"], ["Are you open to onsite or hybrid work?", "onsite-work"],
    ["Are you willing to travel up to 25%?", "willing-to-travel"], ["Are you able to commute to our office?", "commute"],
    ["Please select all the languages you speak fluently.", "languages"], ["What is your highest level of education?", "education-degree"],
    ["What is your current country of residence?", "address-country"], ["What country are you based in?", "address-country"],
    ["Which state or province do you currently live in?", "address-region"], ["Who is your current or previous employer?", "current-company"],
    ["What is your current or most recent job title?", "current-title"], ["Chosen Name", "preferred-name"], ["Zip / postal code", "address-postal"],
    ["What sexual orientation do you most closely identify with?", "eeo-orientation"],
    ["I consider myself a member of the LGBTQ+ community. (optional)", "eeo-orientation"],
    ["Do you identify as a member of the LGBT2QIA+ community?", "eeo-orientation"],
    ["Would you like to include your LinkedIn profile, personal website or blog?", "linkedin-url"],
    ["Portfolio / Github URL", "github-url"], ["Personal Website, Github or Portfolio", "github-url"],
    ["If you have a portfolio, GitHub, or other project showcases, please share a link below.", "github-url"],
    ["Please tell us how you heard about this opportunity.", "referral-source"], ["Are you over the age of 18?", "over-18"],
    ["Are you able to come into the office four days per week?", "onsite-work"], ["Do you currently work for Gopuff?", "former-employee"],
    ["Where are you currently located?", "city-state"], ["When can you start a new role?", "start-date"],
    ["Preferred Name (if applicable)", "preferred-name"], ["What is your highest level of education completed?", "education-degree"],
    ["Language Skill(s) (Check all that apply)", "languages"],
    ["If you are based in the US, what is your veteran status?", "eeo-veteran"],
    ["Are you a person of transgender experience?", "eeo-transgender"],
  ])("reads %s as %s", (label, type) => {
    expect(fieldTypeFor(choice(label))).toBe(type);
  });
});

describe("what isn't one of those questions", () => {
  const choice = (label: string, kind: ScannedField["kind"] = "combobox"): ScannedField => ({ ...field(label), kind });

  it.each(["Have you worked at a startup?", "Are you under 18 years of age?", "Are you under the age of 18?", "Which programming languages do you use?", "Do you have experience with on-site visits?"])(
    "leaves %s alone", (label) => {
      expect(fieldTypeFor(choice(label))).toBeNull();
    });

  it("leaves free text and follow-ups alone, where a word can come up in passing", () => {
    expect(fieldTypeFor(choice("Tell us about a time you advanced gender equity.", "textarea"))).toBeNull();
    expect(fieldTypeFor(choice("If you selected Other, tell us how you learned about Samsara.", "text"))).toBeNull();
    expect(fieldTypeFor(choice("How did you hear about us?", "textarea"))).toBe("referral-source");
  });
});

describe("where the candidate lives", () => {
  const choice = (label: string): ScannedField => ({ ...field(label), kind: "combobox" });

  it.each([
    "Do you live and work in North America?", "Are you currently located in the US?", "Do you reside in the United States?",
    "Are you based in the US?", "Do you currently live in the USA?",
  ])("reads %s", (label) => {
    expect(fieldTypeFor(choice(label))).toBe("lives-in-us");
  });

  it.each(["Do you live in Canada?", "Do you live in the Bay Area?", "Do you not live in the US?"])("leaves %s alone", (label) => {
    expect(fieldTypeFor(choice(label))).not.toBe("lives-in-us");
  });
});

describe("minimumYears", () => {
  it.each([
    ["Do you have at least 5 years of experience?", 5], ["Do you have 4+ years of experience?", 4],
    ["Do you have a minimum of 3 years of work experience?", 3], ["Do you have over 10 years of experience?", 10],
    ["Do you have more than 1 year of experience?", 1],
  ])("reads %s", (label, years) => {
    expect(minimumYears(label)).toBe(years);
  });

  it.each(["How many years of experience do you have?", "Do you have 5 years of Java experience?", "Do you have at least 5 years of experience as a Salesforce Engineer?", "Do you have a car?"])("finds none in %s", (label) => {
    expect(minimumYears(label)).toBeNull();
  });
});
