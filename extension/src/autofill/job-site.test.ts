import { describe, expect, it } from "vitest";
import { REFERRAL } from "./answer-keys";
import { jobSite, withJobSite } from "./job-site";
import type { BankEntry } from "./types";

const saved = (question: string, answer: string): BankEntry => ({ id: question, question, answer, category: "OTHER" });

describe("where BenchQ found a job", () => {
  it("reads the board from the job's source first", () => {
    expect(jobSite({ source: "jobspy_linkedin", url: "https://boards.greenhouse.io/acme/1" })).toBe("LinkedIn");
    expect(jobSite({ source: "jobspy_zip_recruiter" })).toBe("ZipRecruiter");
    expect(jobSite({ source: "direct" })).toBe("Company website");
  });

  it("falls back to the board the job's address is on", () => {
    expect(jobSite({ source: null, url: "https://www.indeed.com/viewjob?jk=1" })).toBe("Indeed");
  });

  it("says nothing for an employer's or an applicant tracking system's page", () => {
    expect(jobSite({ source: "manual", url: "https://boards.greenhouse.io/acme/1" })).toBeNull();
    expect(jobSite({})).toBeNull();
  });
});

describe("\"How did you hear about us?\"", () => {
  it("takes where BenchQ found the job over the résumé's answer", () => {
    const bank = withJobSite([saved("How did you hear about us?", "A friend"), saved("Email", "a@b.test")], { source: "jobspy_dice" });
    expect(bank.map(({ question, answer }) => [question, answer])).toEqual([["Email", "a@b.test"], ["How did you hear about us?", "Dice"]]);
    expect(bank[1]!.key).toBe(REFERRAL);
  });

  it("keeps the résumé's answer when the job's site isn't known", () => {
    const bank = [saved("How did you hear about us?", "A friend")];
    expect(withJobSite(bank, { url: "https://jobs.acme.test/1" })).toBe(bank);
  });
});
