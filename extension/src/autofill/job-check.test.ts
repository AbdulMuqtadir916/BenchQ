import { describe, expect, it } from "vitest";
import { checkJob, hostOf, sameListing } from "./job-check";
import type { JobSummary, PageSignals } from "./types";

const job: JobSummary = { title: "Senior Java Developer", company: "Acme Corp, Inc.", url: "https://careers.acme.test/jobs/1" };

const page = (overrides: Partial<PageSignals>): PageSignals => ({
  url: "https://boards.example.test/x", title: "", heading: "", siteName: "", posting: null, ...overrides,
});

const conflict = (overrides: Partial<PageSignals>, saved = job) => checkJob(saved, page(overrides)).conflict;

describe("hostOf", () => {
  it("drops www and survives a bad URL", () => {
    expect(hostOf("https://www.acme.test/jobs")).toBe("acme.test");
    expect(hostOf("not a url")).toBe("");
  });
});

describe("checkJob", () => {
  it("has nothing to say without a page", () => {
    expect(checkJob(job, null)).toEqual({ conflict: false, detected: "" });
  });

  it("is no conflict on the saved URL itself", () => {
    expect(conflict({ url: "https://careers.acme.test/jobs/1?src=benchq", title: "Careers" })).toBe(false);
  });

  it("is no conflict when the page shows the company", () => {
    expect(conflict({ title: "Job Application for Backend Role at Acme" })).toBe(false);
    expect(conflict({ heading: "Apply", siteName: "ACME CORP" })).toBe(false);
  });

  it("finds the company in the application site's address", () => {
    expect(conflict({ url: "https://acme.wd5.myworkdayjobs.test/apply", title: "My Information" })).toBe(false);
    expect(conflict({ url: "https://apply.workable.test/acme/j/1", title: "Application" })).toBe(false);
  });

  it("is no conflict when the page shows the role", () => {
    expect(conflict({ title: "Sr Java Developer, Senior Payments", heading: "Senior Java Developer" })).toBe(false);
  });

  it("flags a page that shows neither the company nor the role", () => {
    const result = checkJob(job, page({ title: "Globex careers", heading: "Data Analyst" }));
    expect(result).toEqual({ conflict: true, detected: "Data Analyst" });
  });

  it("stays quiet on a page with nothing to go on", () => {
    expect(conflict({})).toBe(false);
  });

  it("trusts a posting's structured data over the page's text", () => {
    const posting = { title: "Senior Java Developer", company: "Acme Corp" };
    expect(conflict({ title: "Globex careers", posting })).toBe(false);
  });

  it("flags a posting for another company", () => {
    const result = checkJob(job, page({ title: "Acme careers", posting: { title: "Senior Java Developer", company: "Globex" } }));
    expect(result).toEqual({ conflict: true, detected: "Senior Java Developer · Globex" });
  });

  it("flags a posting for another role at the same company", () => {
    expect(conflict({ posting: { title: "Data Analyst", company: "Acme Corp" } })).toBe(true);
  });

  it("copes with a saved job that has no company or title", () => {
    expect(conflict({ title: "Globex careers" }, { title: null, company: null, url: job.url })).toBe(false);
    expect(conflict({ title: "Globex careers" }, { title: "Senior Java Developer", company: null, url: job.url })).toBe(true);
    expect(conflict({ posting: { title: "", company: "" } }, { title: null, company: null, url: job.url })).toBe(false);
  });
});

describe("sameListing's places (CodeRabbit #129)", () => {
  it("tells two cities in one state apart, and keeps a place named less closely", () => {
    const job = { title: "QA Engineer", company: "Acme", location: "Dallas, TX" };
    expect(sameListing({ ...job, location: "Austin, TX" }, job)).toBe(false);
    expect(sameListing({ ...job, location: "Dallas, Texas, USA" }, job)).toBe(true);
    expect(sameListing({ ...job, location: "TX" }, job)).toBe(true);
  });
});
