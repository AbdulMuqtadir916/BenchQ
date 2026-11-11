import { describe, expect, it } from "vitest";
import { answersFromResume } from "./resume-answers";
import { buildReview } from "./review";
import type { TabField } from "./types";

/** A form's education questions, filled from a résumé's answers as the backend sends them (docs/02 §8.1): the highest
 * degree with its subject, school, year and GPA. The subject and the GPA have no field kind of their own: they're found
 * by the wordings the backend sends with them (`also`, 07 Q35). */

let next = 0;
const field = (label: string, overrides: Partial<TabField> = {}): TabField => ({
  id: `f${next++}`, frameId: 0, pageUrl: "https://jobs.example.test/apply", kind: "text", label, hints: "", autocomplete: "",
  required: false, current: "", options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
  ...overrides,
});

const fixed = (key: string, question: string, answer: unknown, also: string[] = []) => ({ question, answer, kind: "FIXED", key, also });
const education = [
  fixed("education-degree", "What is your highest degree?", "M.S. Computer Science"),
  fixed("education-field", "What did you study?", "Computer Science",
    ["Field of study", "What is your field of study?", "Major", "What was your major?", "Area of study", "Discipline", "Specialization", "Concentration"]),
  fixed("education-school", "Which school did you attend?", "University of Texas at Dallas"),
  fixed("graduation-year", "What year did you graduate?", 2019),
  fixed("education-grade", "What was your GPA?", "3.8", ["GPA", "What is your GPA?", "Cumulative GPA", "Overall GPA", "Overall result (GPA)", "CGPA"]),
];
const levels = [{ id: "o0", label: "High School" }, { id: "o1", label: "Bachelor's Degree" }, { id: "o2", label: "Master's Degree" }, { id: "o3", label: "Doctorate" }];

const filled = (fields: TabField[]) =>
  buildReview(fields, answersFromResume(education)).map(({ field: { label }, status, proposed }) => [label, status, proposed]);

describe("a form's education questions", () => {
  it("fill from the résumé: the degree's level in a dropdown, the school, the year, the subject and the GPA", () => {
    expect(filled([
      field("Highest level of education", { kind: "select", options: levels }),
      field("School"),
      field("Graduation year"),
      field("Field of study"),
      field("GPA"),
    ])).toEqual([
      ["Highest level of education", "ready", "Master's Degree"],
      ["School", "ready", "University of Texas at Dallas"],
      ["Graduation year", "ready", "2019"],
      ["Field of study", "ready", "Computer Science"],
      ["GPA", "ready", "3.8"],
    ]);
  });

  it("fill however the form words them", () => {
    expect(filled([field("Degree"), field("University"), field("Major"), field("Discipline"), field("Cumulative GPA")])).toEqual([
      ["Degree", "ready", "M.S. Computer Science"],
      ["University", "ready", "University of Texas at Dallas"],
      ["Major", "ready", "Computer Science"],
      ["Discipline", "ready", "Computer Science"],
      ["Cumulative GPA", "ready", "3.8"],
    ]);
  });
});
