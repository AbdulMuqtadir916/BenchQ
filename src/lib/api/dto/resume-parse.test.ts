import { describe, expect, it } from "vitest";
import parses from "@/mocks/data/resume-parses.json";
import { matchWorkAuth, splitLocation, splitSkills, toLinkedinUrl, toResumeDraft, yearsFromWork } from "./resume-parse";

/** docs/candidate-onboarding/04-wizard-steps.md §5: Zuhair's parser format → the new-candidate form's draft. */
const NOW = new Date("2026-10-27T00:00:00.000Z");
const fixture = (index: number) => ({ parse_id: `parse_${index}`, ...parses[index]! });

describe("toResumeDraft, on the three sample résumés", () => {
  it("Ravi: a complete header, H-1B, LinkedIn without a scheme, skills de-duplicated across groups", () => {
    expect(toResumeDraft(fixture(0), NOW)).toEqual({
      parseId: "parse_0",
      fileName: "Ravi_Teja_Java_FullStack.pdf",
      fullName: "Ravi Teja Kommineni",
      primaryRole: "Senior Java Full Stack Developer",
      email: "ravi.kommineni@example.com",
      phone: "(469) 555-0182",
      linkedinUrl: "https://linkedin.com/in/ravi-kommineni",
      city: "Irving",
      state: "TX",
      yearsExperience: 10, // 2015-01 → 2016-01 and 2017-01 → now (overlapping 2021 counted once): 13 + 118 months
      workAuth: "H1B",
      workAuthText: null,
      summary: expect.stringContaining("9 years"),
      skills: [
        { name: "Java", family: "Languages" },
        { name: "TypeScript", family: "Languages" },
        { name: "SQL", family: "Languages" },
        { name: "Spring Boot", family: "Frameworks" },
        { name: "React", family: "Frameworks" },
        { name: "Hibernate", family: "Frameworks" },
        { name: "AWS", family: "Cloud" },
        { name: "Docker", family: "Cloud" },
        { name: "Kubernetes", family: "Cloud" },
      ],
    });
  });

  it("Priyanka: Green Card, no phone, an overlapping contract and an undated internship", () => {
    expect(toResumeDraft(fixture(1), NOW)).toMatchObject({
      phone: null,
      workAuth: "GC",
      workAuthText: null,
      linkedinUrl: "https://www.linkedin.com/in/priyanka-nair-data",
      yearsExperience: 7, // 2019-08 → now, gaps none: 87 months
    });
  });

  it("Karthik: no title, a malformed email, a status that matches nothing, one ungrouped skill list with a gap", () => {
    expect(toResumeDraft(fixture(2), NOW)).toMatchObject({
      fullName: "Karthik S",
      primaryRole: null,
      email: null,
      city: "New Jersey",
      state: null,
      linkedinUrl: null,
      workAuth: null,
      workAuthText: "Authorized to work in the US",
      summary: null,
      skills: [
        { name: "Terraform", family: null },
        { name: "Jenkins", family: null },
        { name: "AWS", family: null },
        { name: "Ansible", family: null },
      ],
    });
  });

  it("tolerates missing groups: an empty parse is a draft of nulls", () => {
    expect(toResumeDraft({ parse_id: "p", file_name: "blank.pdf", parse: {} }, NOW)).toMatchObject({
      fullName: null, email: null, yearsExperience: null, workAuth: null, workAuthText: null, skills: [],
    });
  });
});

describe("the mapping rules", () => {
  it("matches every work authorization the form offers, and the closest one first", () => {
    const cases: [string, string | null][] = [
      ["H1B", "H1B"], ["H-1B (transfer)", "H1B"], ["H4 EAD", "H4_EAD"], ["STEM OPT", "OPT"], ["OPT", "OPT"], ["CPT", "CPT"],
      ["Green Card EAD", "GC_EAD"], ["GC-EAD", "GC_EAD"], ["Green Card", "GC"], ["Permanent Resident", "GC"],
      ["US Citizen", "USC"], ["U.S. Citizen", "USC"], ["TN Visa", "TN"], ["Authorized to work in the US", null], ["", null],
    ];
    for (const [printed, expected] of cases) expect(matchWorkAuth(printed), printed).toBe(expected);
  });

  it("splits a location on its commas", () => {
    expect(splitLocation("Irving, TX")).toEqual({ city: "Irving", state: "TX" });
    expect(splitLocation("Hyderabad, Telangana, India")).toEqual({ city: "Hyderabad", state: "Telangana" });
    expect(splitLocation("Remote")).toEqual({ city: "Remote", state: null });
    expect(splitLocation("  ")).toEqual({ city: null, state: null });
  });

  it("makes a LinkedIn link a URL, or drops it", () => {
    expect(toLinkedinUrl("linkedin.com/in/x")).toBe("https://linkedin.com/in/x");
    expect(toLinkedinUrl("https://www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(toLinkedinUrl("not a link")).toBeNull();
    expect(toLinkedinUrl("")).toBeNull();
  });

  it("counts years from the work history: overlaps once, ongoing jobs to now, no-start jobs skipped, rounded down", () => {
    const job = (start: string, end: string, current = false) => ({ job_title: "", company: "", location: "", dates: "", start, end, current, bullets: [] });
    expect(yearsFromWork([job("2020-01", "2021-12")], NOW)).toBe(2);
    expect(yearsFromWork([job("2020-01", "2021-12"), job("2021-01", "2022-12")], NOW)).toBe(3);
    expect(yearsFromWork([job("2020-01", "2020-12"), job("2022-01", "2022-12")], NOW)).toBe(2);
    expect(yearsFromWork([job("2024-10", "", true)], NOW)).toBe(2);
    expect(yearsFromWork([job("2019", "2020")], NOW)).toBe(1);
    expect(yearsFromWork([job("", "2020-05"), job("2023-01", "2022-01")], NOW)).toBeNull();
    expect(yearsFromWork([], NOW)).toBeNull();
  });

  it("splits skills: trimmed, no empties, no case-insensitive duplicates", () => {
    expect(splitSkills([{ category: "A", skills: " Java ,java, ,SQL" }, { category: "", skills: "sql, Go" }])).toEqual([
      { name: "Java", family: "A" }, { name: "SQL", family: "A" }, { name: "Go", family: null },
    ]);
  });
});
