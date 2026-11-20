import { describe, expect, it } from "vitest";
import { isJobLink as pageRule } from "../page/job";
import { isJobLink } from "./job-link";

describe("the panel's copy of the job-link rule", () => {
  it("answers as the page's own does, link for link", () => {
    for (const url of [
      "https://boards.greenhouse.io/acme/jobs/123", "https://jobs.lever.co/acme/5f1c", "https://jobs.lever.co/acme",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Atlanta/QA_R1", "https://acme.wd5.myworkdayjobs.com/en-US/External",
      "https://www.indeed.com/viewjob?jk=abc", "https://www.indeed.com/jobs?q=qa", "https://www.linkedin.com/jobs/view/123/",
      "https://www.linkedin.com/jobs/search/?currentJobId=3912345678", "https://www.linkedin.com/jobs/", "https://acme.breezy.hr/p/qa-engineer",
      "https://acme.breezy.hr/", "https://careers.acme.com/", "https://careers.acme.com/en", "https://careers.acme.com/en/position/42",
      "https://acme.com/careers", "https://acme.com/careers/qa-engineer/", "https://acme.com/careers/search?q=qa", "https://acme.com/jobs/page/2",
      "https://www.amazon.jobs/en/", "https://www.amazon.jobs/en/jobs/2934567/software-development-engineer",
      "https://careers-acme.icims.com/jobs/1234/qa-engineer/job", "https://careers-acme.icims.com/jobs/search?ss=1",
      "https://www.google.com/about/careers/applications/jobs/results/123-qa-engineer", "https://www.google.com/search?q=qa+jobs",
      "https://research.acme.com/careers/research-scientist", "https://acme.test/opportunities?gh_jid=8329677",
      "https://news.example.com/2026/11/story", "https://news.example.test/jobsearch-tips", "https://acme.com/about/", "not a link",
    ]) expect(isJobLink(url), url).toBe(pageRule(url));
  });
});
