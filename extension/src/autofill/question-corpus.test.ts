import { describe, expect, it } from "vitest";
import { answersFromResume } from "./resume-answers";
import { buildReview } from "./review";
import type { TabField } from "./types";

/** Common questions from real application forms (Greenhouse, Lever, Workday, iCIMS) through the real matcher, with a
 * résumé's full answers as the backend sends them (docs/02 §8.1): its built answers, the wordings it sends with them
 * (`also`), and the personal, screening and self-ID answers the BDE added on the Autofill screen (decided 2026-11-11).
 * A question that stops filling, or one a guard should stop, shows here. */
let next = 0;
const field = (label: string, overrides: Partial<TabField> = {}): TabField => ({
  id: `f${next++}`, frameId: 0, pageUrl: "https://jobs.example.test/apply", kind: "text", label, hints: "", autocomplete: "",
  required: false, current: "", options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
  ...overrides,
});
const yesNo = [{ id: "o0", label: "Yes" }, { id: "o1", label: "No" }];
const fixed = (key: string, question: string, answer: unknown, also: string[] = []) => ({ question, answer, kind: "FIXED", key, also });
const edited = (key: string, question: string, answer: unknown) => ({ question, answer, kind: "EDITED", key, built: null });
const entries = [
  fixed("full-name", "What is your full name?", "Lakshmi Narayanan"), fixed("email", "What is your email address?", "lakshmi@example.test"),
  fixed("phone", "What is your phone number?", "+1-404-555-0134"), fixed("linkedin-url", "What is your LinkedIn profile URL?", "https://linkedin.com/in/lakshmi"),
  fixed("github-url", "What is your GitHub profile URL?", "https://github.com/lakshmi"), fixed("address-city", "Which city do you live in?", "Atlanta"),
  fixed("address-region", "Which state do you live in?", "GA"), fixed("address-country", "Which country do you live in?", "US"),
  fixed("professional-title", "What is your professional title?", "QA Automation Engineer"), fixed("work-auth-status", "What is your work authorization?", "H-1B"),
  fixed("current-company", "Who is your current or most recent employer?", "Acme Bank"), fixed("current-title", "What is your current or most recent job title?", "QA Lead"),
  fixed("education-degree", "What is your highest degree?", "M.S. Computer Science"),
  fixed("education-field", "What did you study?", "Computer Science", ["Field of study", "What is your field of study?", "Major", "What was your major?", "Area of study", "Discipline", "Specialization", "Concentration"]),
  fixed("education-school", "Which school did you attend?", "UT Dallas"), fixed("graduation-year", "What year did you graduate?", 2019),
  fixed("education-grade", "What was your GPA?", "3.8", ["GPA", "What is your GPA?", "Cumulative GPA", "Overall GPA", "Overall result (GPA)", "CGPA"]),
  fixed("languages", "Which languages do you speak?", ["English", "Telugu"], ["Languages", "Languages spoken", "What languages do you speak?"]), fixed("visa-sponsorship", "Will you now or in the future require visa sponsorship?", true),
  fixed("visa-transfer", "Do you need a visa transfer?", true, ["Do you need an H-1B transfer?", "Will you require an H1B visa transfer?", "Do you require a visa transfer?"]),
  fixed("years-experience", "How many years of experience do you have?", 8), fixed("pay-rate", "What is your expected rate?", 85),
  fixed("start-date", "When can you start?", "2026-12-01"), fixed("notice-period-days", "What is your notice period in days?", 14),
  fixed("relocation-willing", "Are you willing to relocate?", true),
  fixed("employment-types", "Which employment types are you open to?", ["C2C", "W2"], ["Employment type", "What type of employment are you looking for?", "Are you looking for full-time or contract roles?"]),
  fixed("work-settings", "Do you prefer remote, hybrid or on-site work?", ["Remote", "Hybrid"], ["Are you open to remote, hybrid or onsite work?", "Work arrangement preference", "Preferred work setting", "Preferred work arrangement", "Work arrangement"]),
  fixed("preferred-locations", "Which locations do you prefer?", ["Dallas, TX"], ["Which locations are you open to working in?"]),
  fixed("citizenship", "Are you a US citizen?", false),
  edited("preferred-name", "What is your preferred name?", "Lakshmi"), edited("middle-name", "What is your middle name?", "Devi"),
  edited("address-line1", "What is your street address?", "12 Peachtree St"), edited("address-postal", "What is your ZIP or postal code?", "30301"),
  edited("portfolio-url", "What is your portfolio or personal website?", "https://lakshmi.dev"), edited("nationality", "What is your nationality?", "Indian"),
  edited("current-pay", "What is your current pay rate?", "$80/hr"), edited("salary-expectation", "What is your expected annual salary?", 150000),
  edited("onsite-work", "Are you willing to work on-site?", true), { ...edited("willing-to-travel", "Are you willing to travel for work?", "Up to 25%"), also: ["Willingness to travel", "Are you open to travel?"] },
  edited("commute", "Can you commute to the job's location?", true), edited("over-18", "Are you at least 18 years old?", true),
  edited("criminal-history", "Have you ever been convicted of a crime?", false), edited("background-check", "Are you willing to undergo a background check?", true),
  edited("drug-test", "Are you willing to take a drug test?", true), edited("security-clearance", "Do you hold an active security clearance?", "No"),
  edited("non-compete", "Are you bound by a non-compete agreement?", false), edited("government-work", "Have you ever worked for a government agency?", false),
  edited("relative-at-company", "Do you have relatives who work at the company?", false), edited("former-employee", "Have you worked for the company before?", false),
  edited("accommodations", "Do you need accommodations during the hiring process?", false),
  edited("essential-functions", "Can you perform the job's essential functions, with or without reasonable accommodation?", true),
  edited("gender", "What is your gender?", "Female"), edited("pronouns", "What are your pronouns?", "She/her"), edited("race", "What is your race or ethnicity?", "Asian"),
  edited("hispanic-latino", "Are you Hispanic or Latino?", "No"), edited("veteran-status", "What is your veteran status?", "I am not a protected veteran"),
  edited("disability-status", "Do you have a disability?", "No, I don't have a disability"),
  edited("sexual-orientation", "What is your sexual orientation?", "Decline to self-identify"), edited("transgender", "Do you identify as transgender?", "No"),
];
const YES_NO = new Set([
  "Are you legally authorized to work in the United States?", "Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?",
  "Are you a U.S. citizen?", "Are you willing to relocate?", "Are you open to working on-site?", "Are you willing to travel up to 25%?",
  "Can you reliably commute to Atlanta, GA?", "Are you at least 18 years of age?", "Are you 18 years or older?", "Have you ever been convicted of a felony?",
  "Are you willing to submit to a background check?", "Are you willing to take a drug test?", "Are you subject to a non-compete agreement?",
  "Have you ever been employed by Acme?", "Do you have any relatives employed at Acme?", "Are you a current or former government employee?",
  "Do you require any accommodations for the interview process?", "Can you perform the essential functions of this job with or without reasonable accommodation?",
  "Are you Hispanic/Latino?", "Do you identify as transgender?", "Do you require visa transfer?", "Do you need H1B transfer?",
  "Have you previously worked at Acme?", "Do you currently or have you ever worked for a government entity?",
]);
const LABELS = [
  "First Name", "Last Name", "Preferred First Name", "Middle Name", "Email", "Phone Number", "Address", "Address Line 1", "Street Address",
  "Zip/Postal Code", "Postal Code", "City", "State", "Country", "LinkedIn Profile", "GitHub URL", "Portfolio", "Website", "Current Location",
  "Are you legally authorized to work in the United States?", "Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?",
  "Are you a U.S. citizen?", "What is your current visa status?", "Do you require visa transfer?", "Do you need H1B transfer?", "Citizenship", "Nationality",
  "Current Company", "Current Title", "Years of Experience", "Highest level of education", "School", "Degree", "Discipline", "Field of Study", "Major", "GPA",
  "Graduation Date", "Graduation Year",
  "Desired Salary", "Expected hourly rate", "Current Salary", "Current hourly rate", "When can you start?", "Earliest start date", "Notice period",
  "Are you willing to relocate?", "Are you open to working on-site?", "Are you willing to travel up to 25%?", "Willingness to travel", "Can you reliably commute to Atlanta, GA?",
  "Preferred work arrangement", "Employment type", "Languages",
  "Are you at least 18 years of age?", "Are you 18 years or older?", "Have you ever been convicted of a felony?", "Are you willing to submit to a background check?",
  "Are you willing to take a drug test?", "Do you have an active security clearance?", "Security clearance", "Are you subject to a non-compete agreement?",
  "Have you ever been employed by Acme?", "Have you previously worked at Acme?", "Do you have any relatives employed at Acme?",
  "Are you a current or former government employee?", "Do you currently or have you ever worked for a government entity?",
  "Do you require any accommodations for the interview process?", "Can you perform the essential functions of this job with or without reasonable accommodation?",
  "Gender", "What is your gender?", "Race", "Race/Ethnicity", "Ethnicity", "Are you Hispanic/Latino?", "Veteran Status", "Protected veteran status", "Disability Status",
  "Pronouns", "Sexual Orientation", "Do you identify as transgender?",
];

const filled = () => {
  const fields = LABELS.map((label) => field(label, YES_NO.has(label) ? { kind: "radio", options: yesNo } : {}));
  return buildReview(fields, answersFromResume(entries), { title: "QA Engineer", company: "Acme" });
};

describe("common application questions", () => {
  it("all fill, but the three a guard keeps for the BDE: a travel share, a named place, yearly pay from an hourly rate", () => {
    expect(filled().filter(({ status }) => status !== "ready").map(({ field: { label } }) => label)).toEqual([
      "Current Salary", "Are you willing to travel up to 25%?", "Can you reliably commute to Atlanta, GA?",
    ]);
  });

  it("fill with the right answers", () => {
    const answer = new Map(filled().map(({ field: { label }, proposed }) => [label, proposed]));
    expect(Object.fromEntries(["Zip/Postal Code", "Middle Name", "Are you a U.S. citizen?", "Are you at least 18 years of age?",
      "Have you ever been convicted of a felony?", "Are you a current or former government employee?", "Do you have any relatives employed at Acme?",
      "Security clearance", "Willingness to travel", "Languages", "Preferred work arrangement", "Field of Study", "GPA", "Race/Ethnicity",
      "Veteran Status", "Disability Status", "Pronouns"].map((label) => [label, answer.get(label)]))).toEqual({
      "Zip/Postal Code": "30301", "Middle Name": "Devi", "Are you a U.S. citizen?": "No", "Are you at least 18 years of age?": "Yes",
      "Have you ever been convicted of a felony?": "No", "Are you a current or former government employee?": "No",
      "Do you have any relatives employed at Acme?": "No", "Security clearance": "No", "Willingness to travel": "Up to 25%",
      Languages: "English, Telugu", "Preferred work arrangement": "Remote, Hybrid", "Field of Study": "Computer Science", GPA: "3.8",
      "Race/Ethnicity": "Asian", "Veteran Status": "I am not a protected veteran", "Disability Status": "No, I don't have a disability",
      Pronouns: "She/her",
    });
  });
});
