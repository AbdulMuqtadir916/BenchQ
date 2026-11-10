import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReview } from "./review";
import type { BankEntry, ReviewRow, TabField } from "./types";

const field = (label: string, overrides: Partial<TabField> = {}): TabField => ({
  id: "f0", frameId: 0, pageUrl: "https://jobs.example.test/apply", kind: "text", label, hints: "", autocomplete: "",
  required: false, current: "", options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
  ...overrides,
});

const entry = (question: string, answer: string): BankEntry => ({ id: question, question, answer, category: "OTHER" });

const review = (one: TabField, bank: BankEntry[] = []): ReviewRow => buildReview([one], bank)[0]!;

const yesNo = [{ id: "o0", label: "Yes" }, { id: "o1", label: "No" }];
const location = entry("Current location", "Dallas, TX");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("where an answer comes from", () => {
  it("proposes a bank answer and says where it came from", () => {
    const row = review(field("Notice period"), [entry("Notice period", " Two weeks ")]);
    expect(row).toMatchObject({ status: "ready", proposed: "Two weeks", write: { type: "text", value: "Two weeks" }, source: { question: "Notice period" } });
  });

  it("finds a bank entry by what it asks for, however it's worded", () => {
    expect(review(field("Postal code"), [entry("ZIP code", "75001")])).toMatchObject({ status: "ready", proposed: "75001", source: { question: "ZIP code" } });
    expect(review(field("Email"), [entry("Email address", "a@example.test")]).proposed).toBe("a@example.test");
  });

  it("finds a close wording of a bank question", () => {
    const row = review(field("Why do you want to join our company"), [entry("Why do you want to join our company today", "Great team")]);
    expect(row).toMatchObject({ status: "ready", proposed: "Great team" });
  });

  it("lists a question with no answer for manual entry", () => {
    expect(review(field("Why Acme?"))).toMatchObject({ status: "manual", reason: "No answer in the bank." });
    expect(review(field("Phone"))).toMatchObject({ status: "manual", reason: "No answer in the bank." });
  });

  it("shows both answers when two saved answers fit", () => {
    const row = review(field("Notice period"), [entry("Notice period", "Two weeks"), entry("Your notice period", "A month")]);
    expect(row).toMatchObject({ status: "manual", alternatives: ["Two weeks", "A month"] });
    expect(row.write).toBeUndefined();
  });

  it("shows both answers when two bank entries of one type disagree", () => {
    const row = review(field("Postal code"), [entry("ZIP code", "75001"), entry("Postcode", "75002")]);
    expect(row).toMatchObject({ status: "manual", alternatives: ["75001", "75002"] });
  });

  it("doesn't give a free-form answer to a field that merely shares a word", () => {
    const bank = [entry("Are you open to onsite or hybrid work?", "Yes"), entry("Why are you interested in this role?", "I like it")];
    expect(review(field("Other Website"), bank).status).toBe("manual");
    expect(review(field("Current Title"), bank).status).toBe("manual");
  });
});

describe("answers the bank holds inside another", () => {
  it("splits a two-part full name", () => {
    const bank = [entry("Full name", "Meera Krishnan")];
    expect(review(field("First name"), bank)).toMatchObject({ proposed: "Meera", source: { question: "Full name" } });
    expect(review(field("Last name"), bank).proposed).toBe("Krishnan");
  });

  it("won't guess how a longer name splits", () => {
    expect(review(field("First name"), [entry("Full name", "Sai Kiran Reddy")]).status).toBe("manual");
    expect(review(field("First name"), [entry("Full name", "Sai Kiran Reddy"), entry("First name", "Sai Kiran")]).proposed).toBe("Sai Kiran");
  });

  it("takes the city, state and country from a location", () => {
    expect(review(field("City"), [location])).toMatchObject({ proposed: "Dallas", source: { question: "Current location" } });
    expect(review(field("State"), [location]).proposed).toBe("TX");
    expect(review(field("Country", { kind: "combobox" }), [location]).proposed).toBe("United States");
  });

  it("answers a location dropdown that lists countries", () => {
    const options = [{ id: "o0", label: "Canada" }, { id: "o1", label: "United States" }];
    expect(review(field("What is your location?", { kind: "select", options }), [location]))
      .toMatchObject({ status: "ready", proposed: "United States", source: { question: "Current location" }, write: { optionId: "o1" } });
  });

  it("says nothing about the country of a place it can't place", () => {
    expect(review(field("Country"), [entry("Current location", "Hyderabad, India")]).status).toBe("manual");
    expect(review(field("Country"), [entry("Current location", "Dallas")]).status).toBe("manual");
  });

  it("gives a city lookup the state as well", () => {
    expect(review(field("Location (City)", { kind: "combobox" }), [location]).proposed).toBe("Dallas, TX");
    expect(review(field("City", { kind: "combobox" }), [location]).proposed).toBe("Dallas, TX");
  });

  it("answers whether the candidate lives in the US from their location", () => {
    const question = field("Do you live and work in North America?", { kind: "combobox" });
    expect(review(question, [location])).toMatchObject({ status: "ready", proposed: "Yes", source: { question: "Current location" } });
    expect(review(question, [entry("Current location", "Hyderabad, India")]).status).toBe("manual");
  });

  it("fills a field with no label when its name says what it is", () => {
    const unlabelled = field("", { clues: { ...field("").clues, name: "linkedin_url" } });
    expect(review(unlabelled, [entry("LinkedIn profile", "https://linkedin.example.test/in/a")]))
      .toMatchObject({ status: "ready", source: { question: "LinkedIn profile" } });
  });

  it("fills today's date", () => {
    expect(review(field("Today's date")).proposed).toBe("11/05/2026");
    expect(review(field("Today's date", { kind: "date" })).proposed).toBe("2026-11-05");
  });

  it("keeps a start date from being in the past", () => {
    expect(review(field("Start date"), [entry("When can you start?", "01/15/2026")]).proposed).toBe("11/05/2026");
    expect(review(field("Start date"), [entry("When can you start?", "12/01/2026")]).proposed).toBe("12/01/2026");
    expect(review(field("Start date"), [entry("When can you start?", "Immediately")]).proposed).toBe("Immediately");
  });
});

describe("the phone number", () => {
  it.each([
    ["+1 (214) 555-0167", "(214) 555-0167"], ["+1-214-555-0167", "214-555-0167"], ["+12145550167", "2145550167"],
    ["12145550167", "2145550167"], ["(214) 555-0167", "(214) 555-0167"], ["+91 98765 43210", "98765 43210"],
    ["+919876543210", "9876543210"],
  ])("goes into the field without its country code: %s", (saved, number) => {
    expect(review(field("Phone", { kind: "tel" }), [entry("Phone number", saved)]).proposed).toBe(number);
  });

  it.each(["6025550189", "(602) 555-0189", "602-555-0189", "+1 602 555 0189"])("reads a phone showing %s as already filled", (current) => {
    expect(review(field("Phone", { kind: "tel", current }), [entry("Phone number", "6025550189")]).status).toBe("same");
  });

  describe("its country dropdown", () => {
    const dropdown = (current = "") => field("Phone country code", { kind: "combobox", current });

    it("takes the code from the saved number", () => {
      expect(review(dropdown(), [entry("Phone number", "+91 98765 43210")]).proposed).toBe("+91");
      expect(review(dropdown(), [entry("Phone number", "+1 214 555 0167")]).proposed).toBe("United States +1");
    });

    it("falls back on where the candidate lives", () => {
      expect(review(dropdown(), [entry("Phone number", "2145550167"), location]).proposed).toBe("United States +1");
    });

    it("doesn't guess", () => {
      expect(review(dropdown(), [entry("Phone number", "2145550167")]).status).toBe("manual");
    });

    it("has nothing to do when it already shows the code", () => {
      expect(review(dropdown("+1"), [location]).status).toBe("same");
    });

    it("changes a code the form guessed wrongly", () => {
      expect(review(dropdown("+91"), [location])).toMatchObject({ status: "ready", proposed: "United States +1" });
    });
  });
});

describe("what stays manual", () => {
  it("never fills a consent statement, even with a matching answer", () => {
    const row = review(field("I acknowledge the privacy statement", { kind: "combobox" }), [entry("I acknowledge the privacy statement", "I acknowledge")]);
    expect(row.status).toBe("blocked");
    expect(row.write).toBeUndefined();
    expect(row.proposed).toBeUndefined();
  });

  it("blocks what only the engine recognises", () => {
    const row = review(field("Attach", { clues: { ...field("").clues, name: "job_application[resume]" }, pageUrl: "https://boards.greenhouse.io/acme/jobs/1" }));
    expect(row).toMatchObject({ status: "blocked", reason: "File upload" });
  });

  it("doesn't cut an answer to fit", () => {
    const row = review(field("Notice period", { maxLength: 5 }), [entry("Notice period", "Two weeks")]);
    expect(row).toMatchObject({ status: "manual", proposed: "Two weeks" });
    expect(row.reason).toContain("9 characters");
    expect(row.reason).toContain("allows 5");
  });

  it("leaves controls it can't fill, and fields with no label", () => {
    expect(review(field("Skills", { kind: "custom" }), [entry("Skills", "Java")]).status).toBe("manual");
    expect(review(field("")).reason).toBe("This field has no label.");
  });

  it("leaves a question that appears twice", () => {
    const rows = buildReview([field("Company", { id: "f0" }), field("Company", { id: "f1" }), field("Notice period", { id: "f2" })], [entry("Company", "Acme")]);
    expect(rows.map(({ status }) => status)).toEqual(["manual", "manual", "manual"]);
    expect(rows[0]!.reason).toContain("more than once");
  });
});

describe("self-ID questions", () => {
  const gender = [{ id: "o0", label: "Decline To Self Identify" }, { id: "o1", label: "Female" }, { id: "o2", label: "Male" }];

  it("recognises them and leaves them with no saved answer", () => {
    expect(review(field("Gender", { kind: "combobox" }))).toMatchObject({ status: "manual", reason: "No answer in the bank." });
  });

  it("fills them from the bank alone", () => {
    expect(review(field("Gender", { kind: "select", options: gender }), [entry("Gender", "Female")]))
      .toMatchObject({ status: "ready", write: { type: "option", optionId: "o1" } });
  });

  it("finds the saved answer however the form words it", () => {
    const question = field("What gender identity do you most closely identify with?", { kind: "combobox" });
    expect(review(question, [entry("Gender", "Woman")])).toMatchObject({ status: "ready", proposed: "Woman", source: { question: "Gender" } });
  });

  it("matches the same answer in other words", () => {
    const options = [{ id: "o0", label: "Man" }, { id: "o1", label: "Woman" }, { id: "o2", label: "I don't wish to answer" }];
    expect(review(field("Gender", { kind: "select", options }), [entry("Gender", "Female")]).write).toMatchObject({ optionId: "o1" });
    expect(review(field("Gender", { kind: "select", options }), [entry("Gender", "Decline")]).write).toMatchObject({ optionId: "o2" });
  });

  it("reads veteran answers that don't say yes or no", () => {
    const options = [
      { id: "o0", label: "I don't wish to answer" }, { id: "o1", label: "I identify as one or more of the classifications of a protected veteran" },
      { id: "o2", label: "I am not a protected veteran" },
    ];
    const question = field("Veteran Status", { kind: "select", options });
    expect(review(question, [entry("Are you a protected veteran?", "No")]).write).toMatchObject({ optionId: "o2" });
    expect(review(question, [entry("Are you a protected veteran?", "Yes")]).write).toMatchObject({ optionId: "o1" });
  });

  it("fills a self-ID question the form asks twice", () => {
    const rows = buildReview([field("Gender", { id: "f0", kind: "combobox" }), field("Gender", { id: "f1", kind: "combobox" })], [entry("Gender", "Female")]);
    expect(rows.map(({ status }) => status)).toEqual(["ready", "ready"]);
    expect(new Set(rows.map(({ key }) => key)).size).toBe(2);
  });

  it("keeps one self-ID answer out of another's question", () => {
    expect(review(field("Race", { kind: "combobox" }), [entry("Gender", "Female")]).status).toBe("manual");
  });
});

describe("an answer that fits several options", () => {
  const options = ["East Asian", "South Asian", "Southeast Asian", "White"].map((label, index) => ({ id: `o${index}`, label }));
  const reason = "This answer fits East Asian, South Asian and Southeast Asian. Pick the right one yourself.";

  it("leaves the pick to the BDE and names them, in a dropdown", () => {
    expect(review(field("Race or Ethnicity", { kind: "select", options }), [entry("Race/Ethnicity", "Asian")]))
      .toMatchObject({ status: "manual", reason, source: { answer: "Asian" } });
  });

  it("does the same in a group of checkboxes", () => {
    expect(review(field("Race or Ethnicity", { kind: "checkbox", options }), [entry("Race/Ethnicity", "Asian")]))
      .toMatchObject({ status: "manual", reason });
  });

  it("fills a specific saved answer on the same form", () => {
    expect(review(field("Race or Ethnicity", { kind: "select", options }), [entry("Race/Ethnicity", "South Asian")]))
      .toMatchObject({ status: "ready", proposed: "South Asian" });
  });

  it("counts the group a BDE picked by hand as already filled", () => {
    expect(review(field("Race or Ethnicity", { kind: "combobox", current: "South Asian" }), [entry("Race/Ethnicity", "Asian")]).status).toBe("same");
  });
});

describe("broad questions", () => {
  const bank = [
    entry("How many years of experience do you have?", "5"), entry("Rate your experience with Salesforce", "4"), entry("Hourly rate", "60"),
    entry("Race/Ethnicity", "Asian"), entry("Are you at least 18 years of age?", "Yes"), location,
  ];

  it.each([
    "Rate your experience with Salesforce", "Rate your skills in SQL", "How would you rate your Java skills?",
    "On a scale of 1 to 5, how comfortable are you with AWS?", "How proficient are you in Python?",
    "What is your level of expertise in React?", "Experience level", "Skill level in Apex", "Salesforce experience",
  ])("leaves %s to the BDE, even with a saved answer", (label) => {
    expect(review(field(label, { kind: "combobox" }), bank).status).toBe("manual");
  });

  it.each([
    ["Race or Ethnicity", "Asian"], ["Are you above 18?", "Yes"], ["Age above 18", "Yes"], ["Are you 18 or older?", "Yes"], ["Are you 18+?", "Yes"],
    ["Where are you currently located?", "Dallas, TX"], ["Currently located in", "Dallas, TX"], ["Hourly rate", "60"],
  ])("still fills %s", (label, answer) => {
    expect(review(field(label, { kind: "combobox" }), bank)).toMatchObject({ status: "ready", proposed: answer });
  });
});

describe("questions forms word many ways", () => {
  it("answers them from any saved wording", () => {
    const pronoun = field("What is your preferred pronoun?", { kind: "select", options: [{ id: "o0", label: "She / Her / Hers" }, { id: "o1", label: "He / Him / His" }] });
    expect(review(pronoun, [entry("Pronouns", "she/her")])).toMatchObject({ status: "ready", proposed: "She / Her / Hers", source: { question: "Pronouns" } });
    expect(review(field("Do you require workplace accommodations?", { kind: "combobox" }), [entry("Will you need an accommodation?", "No")]).proposed).toBe("No");
  });

  it.each(["Do you require workplace accommodations?", "What is your preferred pronoun?", "Have you ever been convicted of a felony?", "Have you ever worked for Figma before?"])(
    "never answers %s without a saved answer", (label) => {
      const bank = [location, entry("Are you legally authorized to work in the United States?", "Yes"), entry("Gender", "Female")];
      expect(review(field(label, { kind: "combobox" }), bank)).toMatchObject({ status: "manual", reason: "No answer in the bank." });
    });

  it("keeps a yes about accommodations out of the question about doing the job", () => {
    const question = field("Are you able to perform the essential functions of this job, with or without reasonable accommodation?", { kind: "combobox" });
    expect(review(question, [entry("Do you require workplace accommodations?", "No")]).status).toBe("manual");
  });
});

describe("work authorization", () => {
  const bank = [entry("Are you legally authorized to work in the United States?", "Yes")];

  it("answers it however the form words it", () => {
    const question = field("Are you legally authorized to work in the country where the job is located?", { kind: "combobox" });
    expect(review(question, bank)).toMatchObject({ status: "ready", proposed: "Yes", source: bank[0] });
  });

  it("leaves another country's question alone", () => {
    expect(review(field("Are you authorized to work in Canada?", { kind: "combobox" }), bank).status).toBe("manual");
  });
});

describe("a minimum of experience", () => {
  const years = entry("How many years of experience do you have?", "5");
  const question = (needed: number) => field(`Do you have at least ${needed} years of experience?`, { kind: "combobox" });

  it("answers from the total, whichever way it goes", () => {
    expect(review(question(5), [years])).toMatchObject({ status: "ready", proposed: "Yes", source: years });
    expect(review(question(8), [years])).toMatchObject({ status: "ready", proposed: "No", source: years });
  });

  it.each(["Do you have at least 5 years of experience as a Salesforce Engineer?", "Do you have 3+ years of experience in Kubernetes?", "How many years of relevant experience do you have?"])(
    "leaves %s to the BDE", (label) => {
      expect(review(field(label, { kind: "combobox" }), [years, entry("Current job title", "Salesforce Developer")]).status).toBe("manual");
    });

  it("can't answer without a number of years", () => {
    expect(review(question(3), [entry("How many years of experience do you have?", "Plenty")]).status).toBe("manual");
  });
});

describe("how an answer goes into a control", () => {
  it("replaces an existing value, showing both", () => {
    const row = review(field("Notice period", { current: "One month" }), [entry("Notice period", "Two weeks")]);
    expect(row).toMatchObject({ status: "ready", proposed: "Two weeks", field: { current: "One month" } });
  });

  it("has nothing to do when the field already holds the answer", () => {
    expect(review(field("Notice period", { current: "Two weeks " }), [entry("Notice period", "Two weeks")]).status).toBe("same");
  });

  it("fills a number field only with a number", () => {
    expect(review(field("Years of experience", { kind: "number" }), [entry("Years of experience", "8")]).status).toBe("ready");
    expect(review(field("Years of experience", { kind: "number" }), [entry("Years of experience", "About eight")]).status).toBe("manual");
  });

  it("writes a date the way the control takes it", () => {
    const bank = [entry("Start date", "12/01/2026")];
    expect(review(field("Start date"), bank).proposed).toBe("12/01/2026");
    expect(review(field("Start date", { kind: "date" }), bank).proposed).toBe("2026-12-01");
    expect(review(field("Start date", { kind: "date" }), [entry("Start date", "Soon")]).reason).toBe("This form wants a date.");
  });

  it("picks the option a select or radio means", () => {
    for (const kind of ["select", "radio"] as const) {
      const row = review(field("Sponsorship", { kind, options: yesNo }), [entry("Sponsorship", "No, thanks")]);
      expect(row).toMatchObject({ status: "ready", proposed: "No", write: { type: "option", optionId: "o1" } });
    }
  });

  it("recognises an option that's already chosen", () => {
    expect(review(field("Sponsorship", { kind: "radio", options: yesNo, current: "No" }), [entry("Sponsorship", "No")]).status).toBe("same");
  });

  it("shows the answer when it can't choose an option", () => {
    const row = review(field("Sponsorship", { kind: "select", options: yesNo }), [entry("Sponsorship", "It depends")]);
    expect(row).toMatchObject({ status: "manual", proposed: "It depends" });
  });

  it("checks or unchecks a single checkbox by the answer", () => {
    const question = "Willing to relocate";
    const on = review(field(question, { kind: "checkbox" }), [entry(question, "Yes")]);
    expect(on).toMatchObject({ status: "ready", proposed: "Checked", write: { type: "check", checked: true } });
    const off = review(field(question, { kind: "checkbox", current: "Checked" }), [entry(question, "No")]);
    expect(off).toMatchObject({ status: "ready", proposed: "Not checked", write: { type: "check", checked: false } });
    expect(review(field(question, { kind: "checkbox" }), [entry(question, "No")]).status).toBe("same");
    expect(review(field(question, { kind: "checkbox" }), [entry(question, "Sometimes")]).status).toBe("manual");
  });

  describe("a group of checkboxes", () => {
    const options = [{ id: "o0", label: "Email" }, { id: "o1", label: "Phone Call" }, { id: "o2", label: "Text Message" }];
    const group = (current = "") => field("How should we communicate with you?", { kind: "checkbox", options, current });
    const answer = (text: string) => [entry("How should we communicate with you?", text)];

    it("checks the one option it means", () => {
      expect(review(group(), answer("Email"))).toMatchObject({ status: "ready", proposed: "Email", write: { type: "check", checked: true, optionIds: ["o0"] } });
    });

    it.each(["Email, Text Message", "Email and Text Message", "Email; Text Message", "Email / Text Message"])("checks every option in %s", (text) => {
      expect(review(group(), answer(text))).toMatchObject({ proposed: "Email, Text Message", write: { optionIds: ["o0", "o2"] } });
    });

    it("leaves it all when one of them isn't an option", () => {
      expect(review(group(), answer("Email, Carrier Pigeon")).status).toBe("manual");
    });

    it("has nothing to do when they're already checked", () => {
      expect(review(group("Email, Text Message"), answer("Email and Text Message")).status).toBe("same");
    });
  });

  describe("a custom dropdown", () => {
    const dropdown = (label: string, current = "") => field(label, { kind: "combobox", current });

    it("leaves its option to fill time, when its options exist", () => {
      const row = review(dropdown("Do you need sponsorship?"), [entry("Do you need sponsorship?", "Yes")]);
      expect(row).toMatchObject({ status: "ready", proposed: "Yes", write: { type: "choice", value: "Yes" } });
    });

    it.each([
      ["Location (City)", "Dallas, Texas, United States", location],
      ["Country", "United States of America", entry("Country", "US")],
      ["Do you need sponsorship?", "No, I do not", entry("Do you need sponsorship?", "No")],
    ])("reads %s showing %s as already filled", (label, current, saved) => {
      expect(review(dropdown(label, current), [saved]).status).toBe("same");
    });

    it("offers to change a different choice", () => {
      expect(review(dropdown("Location (City)", "Austin, Texas, United States"), [location]).status).toBe("ready");
      expect(review(dropdown("Do you need sponsorship?", "Yes"), [entry("Do you need sponsorship?", "No")]).status).toBe("ready");
    });
  });
});

describe("row keys", () => {
  it("keeps a row's key through a rescan, and apart from its twin", () => {
    const fields = [field("Company", { id: "f0" }), field("Company", { id: "f1" })];
    const first = buildReview(fields, []).map(({ key }) => key);
    const again = buildReview([field("Company", { id: "f7" }), field("Company", { id: "f8" })], []).map(({ key }) => key);
    expect(new Set(first).size).toBe(2);
    expect(again).toEqual(first);
  });

  it("keeps the same question in two frames apart", () => {
    const fields = [field("Company", { frameId: 0 }), field("Company", { frameId: 7 })];
    expect(new Set(buildReview(fields, []).map(({ key }) => key)).size).toBe(2);
  });
});

describe("the sponsorship question", () => {
  const question = "Do you now, or will you in the future, require immigration sponsorship to work at Reddit?";
  const saved = (answer: string) => [entry("Will you now or in the future require sponsorship for employment visa status?", answer)];

  it("answers from the bank, whichever way it goes", () => {
    expect(review(field(question, { kind: "combobox" }), saved("Yes")))
      .toMatchObject({ status: "ready", proposed: "Yes", write: { type: "choice", value: "Yes" }, source: saved("Yes")[0] });
    expect(review(field(question, { kind: "select", options: yesNo }), saved("No")))
      .toMatchObject({ status: "ready", proposed: "No", write: { type: "option", optionId: "o1" } });
  });
});

describe("what stays out of the form saved with an application", () => {
  it.each([
    ["Social security number"], ["Passport number"], ["Date of birth"], ["Credit card number"], ["Bank account number"],
    ["Signature"], ["Username"],
  ])("keeps out %s", (label) => {
    expect(review(field(label))).toMatchObject({ status: "blocked", isUnsaved: true });
  });

  it("keeps out a password, and anything on a sign-in form", () => {
    expect(review(field("Choose one", { kind: "password" })).isUnsaved).toBe(true);
    expect(review(field("Email", { inAccountForm: true })).isUnsaved).toBe(true);
  });

  it("keeps out EEO answers, filled or not", () => {
    expect(review(field("Gender"), [entry("Gender", "Female")])).toMatchObject({ status: "ready", isUnsaved: true });
    expect(review(field("Gender"))).toMatchObject({ status: "manual", isUnsaved: true });
    expect(review(field("Veteran status"))).toMatchObject({ isUnsaved: true });
  });

  it("keeps an upload, which is only its file name, and a consent", () => {
    expect(review(field("Resume", { kind: "file" }))).toMatchObject({ status: "blocked", reason: "File upload" });
    expect(review(field("Resume", { kind: "file" })).isUnsaved).toBe(false);
    expect(review(field("I agree to the terms", { kind: "checkbox" })).isUnsaved).toBe(false);
  });

  it("keeps everything else", () => {
    expect(review(field("Notice period"), [entry("Notice period", "Two weeks")]).isUnsaved).toBeFalsy();
    expect(review(field("Why this company?")).isUnsaved).toBeFalsy();
  });
});

describe("the same answer again", () => {
  it("lists each saved answer once, by what it says", () => {
    const bank = [entry("ZIP code", "75001"), entry("Postcode", "75001."), entry("Zip", "75002")];
    expect(review(field("Postal code"), bank)).toMatchObject({ status: "manual", alternatives: ["75001", "75002"] });
  });

  it("leaves a repeat of an answered question, for another entry, to the BDE", () => {
    const bank = [entry("Phone", "+1 214 555 0167"), entry("Current employer", "Acme")];
    const labels = ["Phone", "Other phone", "Phone 2", "Current employer", "Previous employer", "Employer 2"];
    const rows = buildReview(labels.map((label, index) => field(label, { id: `f${index}` })), bank);
    expect(rows.map(({ status }) => status)).toEqual(["ready", "manual", "manual", "ready", "manual", "manual"]);
    expect(rows[1]).toMatchObject({ reason: "This asks the same thing again, for another entry, so it's yours to fill.", write: undefined });
  });

  it("still fills fields that ask different things with one answer", () => {
    const bank = [entry("Current location", "Dallas, TX")];
    const rows = buildReview([field("City", { id: "a" }), field("Current location", { id: "b" })], bank);
    expect(rows.map(({ status }) => status)).toEqual(["ready", "ready"]);
  });
});

describe("suggestions for a question nothing answers", () => {
  const radio: Partial<TabField> = { kind: "radio", options: yesNo };

  it("offers the candidate's own screening answers, never to fill on their own", () => {
    const bank = [entry("Willing to work weekends?", "Yes"), entry("Do you own a car?", "No"), entry("Email", "a@example.test")];
    const row = review(field("Can you support Saturday/Sunday shifts?", radio), bank);
    expect(row).toMatchObject({ status: "manual", reason: "No answer in the bank." });
    expect(row.write).toBeUndefined();
    const offered = row.suggestions!.map(({ question }) => question);
    expect(offered).toEqual(expect.arrayContaining(["Willing to work weekends?", "Do you own a car?"]));
    expect(offered).not.toContain("Email");
  });

  it("offers none for a plain field, or for a kind of question BenchQ knows", () => {
    const bank = [entry("Willing to work weekends?", "Yes")];
    expect(review(field("Middle name"), bank).suggestions).toBeUndefined();
    expect(review(field("Are you a protected veteran?", radio), bank).suggestions).toBeUndefined();
  });

  it("offers three at most, the closest wording first", () => {
    const bank = ["Do you smoke?", "Can you work holidays?", "Do you own a car?", "Can you drive a truck?"].map((question) => entry(question, "Yes"));
    const offered = review(field("Are you available to work on public holidays?", radio), bank).suggestions!;
    expect(offered).toHaveLength(3);
    expect(offered[0]!.question).toBe("Can you work holidays?");
  });
});
