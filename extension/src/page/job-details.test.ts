// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dateOf, employmentOf, microdataDetails, pageDetails, payIn, postingDetails } from "./job-details";
import { companyOf, readJob } from "./job";

const page = (body: string, head = "") => new DOMParser().parseFromString(`<html><head>${head}</head><body>${body}</body></html>`, "text/html");

describe("reading what a job's page states, and nothing it doesn't", () => {
  it("reads pay only with a currency or a period, and the currency and period only when named", () => {
    expect(payIn("$120,000 - $150,000 a year")).toEqual({ salaryMin: 120000, salaryMax: 150000, salaryPeriod: "year" });
    expect(payIn("USD 60–70/hr")).toEqual({ salaryMin: 60, salaryMax: 70, salaryCurrency: "USD", salaryPeriod: "hour" });
    expect(payIn("$95k – $110k annually")).toMatchObject({ salaryMin: 95000, salaryMax: 110000, salaryPeriod: "year" });
    expect(payIn("$200,000 - $225,000 USD")).toEqual({ salaryMin: 200000, salaryMax: 225000, salaryCurrency: "USD" });
    for (const text of ["We raised $5M last year? No: $5M", "401k match", "Team of 120 - 150 people", "$150,000 - $120,000"]) {
      expect(payIn(text), text).toBeUndefined();
    }
  });

  it("reads a date written out, never a relative or ambiguous one, nor one still to come", () => {
    expect(["2026-11-10T09:00:00Z", "Nov 10, 2026", "10 November 2026", "13/06/2026"].map((text) => dateOf(text)))
      .toEqual(["2026-11-10", "2026-11-10", "2026-11-10", "2026-06-13"]);
    for (const text of ["05/06/2026", "3 days ago", "2099-01-01", "Feb 30, 2026"]) expect(dateOf(text), text).toBeUndefined();
    expect(dateOf("11/12/2026, 06:21 PM", true)).toBe("2026-11-12");   // a US English page writes month first
  });

  it("names employment types, and only ones it knows", () => {
    expect(employmentOf("FULL_TIME")).toBe("Full-time");
    expect(employmentOf("Full-time, Contract")).toBe("Full-time, Contract");
    expect(employmentOf("CONTRACTOR")).toBe("Contract");
    expect(employmentOf("Regular")).toBeUndefined();
  });

  it("reads a JobPosting's type, pay, date, identifier and remote mark", () => {
    expect(postingDetails({ employmentType: ["FULL_TIME", "CONTRACTOR"], datePosted: "2026-11-10", jobLocationType: "TELECOMMUTE",
      identifier: { "@type": "PropertyValue", name: "Req", value: "R123456" },
      baseSalary: { currency: "usd", value: { minValue: 60, maxValue: 70, unitText: "HOUR" } } })).toEqual({
      workMode: "remote", employmentType: "Full-time, Contract", salaryMin: 60, salaryMax: 70, salaryCurrency: "USD",
      salaryPeriod: "hour", postedAt: "2026-11-10", requisitionId: "R123456" });
  });

  it("reads labelled lines, chips and a location icon, leaving the site's menus out", () => {
    const doc = page(`<nav><a>Locations</a><a>Teams</a></nav><main><h1>QA Engineer</h1>
      <div><span aria-label="location" role="img"></span><span>US, AZ, Phoenix</span></div>
      <dl><dt>Job type</dt><dd>Full time</dd><dt>Date posted</dt><dd>Nov 10, 2026</dd></dl>
      <div class="chip">Hybrid</div><p>Job ID: R998877 | Payments</p>
      <p>United States Salary Range</p><p><bdi>$139,200</bdi> - <bdi>$235,200</bdi> <bdi>USD</bdi></p></main>`);
    expect(pageDetails(doc, "QA Engineer")).toEqual({ location: "US, AZ, Phoenix", workMode: "hybrid", employmentType: "Full-time",
      salaryMin: 139200, salaryMax: 235200, salaryCurrency: "USD", postedAt: "2026-11-10", requisitionId: "R998877" });
  });

  it("reads a page with no JobPosting data, main or footer element as it shows: lines a <br> breaks, no site footer", () => {
    const doc = page(`<a href="#main">Skip to main content</a><div class="jobs-header">Amazon Jobs home page</div>
      <h1>Software Dev Eng II</h1><p>Job ID: 10600216 | Amazon Advertising LLC</p><a id="apply-button" href="#">Apply now</a>
      <div class="association location-icon"><span aria-label="location" role="img"></span><ul><li>USA, WA, Seattle</li><li>USA, WA, SEATTLE</li></ul></div>
      <div class="section"><p>Design and build services.<br/><br/>40 hours/week, Salary Range $143,700 - $194,400 per year. #0000<br/></p></div>
      <div class="footer"><span>JOIN US ON</span><p>© 1996-2026, Amazon.com, Inc.</p></div>`, '<meta property="og:site_name" content="Amazon.jobs">');
    const job = readJob(doc, "https://www.amazon.jobs/en/jobs/10600216/software-dev-eng-ii");
    expect(job).toMatchObject({ title: "Software Dev Eng II", company: "Amazon", location: "USA, WA, Seattle", requisitionId: "10600216",
      salaryMin: 143700, salaryMax: 194400, salaryPeriod: "year" });
    expect(job.description.startsWith("Software Dev Eng II")).toBe(true);
    expect(job.description).not.toMatch(/Skip to main|JOIN US|©/);
  });

  it("reads schema.org microdata", () => {
    const doc = page(`<div itemscope itemtype="http://schema.org/JobPosting"><li itemprop="employmentType">Part-time</li>
      <meta itemprop="datePosted" content="2026-11-12T18:38:26Z"><span itemprop="addressLocality">Itasca</span>
      <span itemprop="addressRegion">IL</span></div>`);
    expect(microdataDetails(doc)).toEqual({ location: "Itasca, IL", employmentType: "Part-time", postedAt: "2026-11-12" });
  });

  it("takes how the job is done from the page before a JobPosting's remote mark, which hybrid jobs carry too", () => {
    const doc = page(`<main><h1>QA Engineer</h1><div>Hybrid</div><p>Test it all, every day, with care and a steady hand.</p></main>`,
      `<script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":"Acme","jobLocationType":"TELECOMMUTE","description":"<p>Test.</p>"}</script>`);
    expect(readJob(doc, "https://acme.com/careers/qa-engineer")).toMatchObject({ isJobPage: true, workMode: "hybrid", location: "Remote" });
  });
});

describe("a company as a site names itself", () => {
  it("drops the site's own words", () => {
    expect(["Amazon.jobs", "JPMC Candidate Experience page", "Careers at Acme", "Globex Careers", "Initech"].map(companyOf))
      .toEqual(["Amazon", "JPMC", "Acme", "Globex", "Initech"]);
  });
});
