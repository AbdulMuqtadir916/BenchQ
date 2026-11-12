// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isJobLink, isJobListLink, readJob } from "./job";

const pageOf = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html");

describe("telling a job's page", () => {
  it("knows a job's link from other links", () => {
    for (const url of ["https://boards.greenhouse.io/acme/jobs/123", "https://jobs.lever.co/acme/5f1c", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Atlanta/QA_R1",
      "https://www.indeed.com/viewjob?jk=abc", "https://www.linkedin.com/jobs/view/123/", "https://acme.breezy.hr/p/qa-engineer"]) expect(isJobLink(url), url).toBe(true);
    for (const url of ["https://www.google.com/search?q=qa+jobs", "https://news.example.com/2026/11/story", "https://acme.com/about/"]) expect(isJobLink(url), url).toBe(false);
  });

  it("never takes a careers home or a list of jobs for one job's page", () => {
    for (const url of ["https://careers.acme.com/", "https://careers.acme.com/en", "https://acme.com/careers", "https://acme.com/en/jobs/",
      "https://jobs.lever.co/acme", "https://acme.com/careers/search?q=qa", "https://www.amazon.jobs/en/", "https://acme.com/jobs/page/2",
      "https://careers-acme.icims.com/jobs/search?ss=1"]) expect(isJobLink(url), url).toBe(false);
    for (const url of ["https://careers.acme.com/", "https://acme.com/careers", "https://acme.com/en/jobs/", "https://acme.com/careers/search?q=qa"]) {
      expect(isJobListLink(url), url).toBe(true);
    }
    // A list that names its open job shows that job; a job's own link stays one, whatever words it holds.
    for (const url of ["https://www.linkedin.com/jobs/search/?currentJobId=3912345678", "https://careers-acme.icims.com/jobs/1234/qa-engineer/job",
      "https://www.google.com/about/careers/applications/jobs/results/123-qa-engineer", "https://research.acme.com/careers/research-scientist"]) {
      expect(isJobLink(url), url).toBe(true);
      expect(isJobListLink(url), url).toBe(false);
    }
    expect(readJob(pageOf("<h1>Join us</h1><main>Our teams.</main><a href='/apply'>Apply now</a>"), "https://careers.acme.com/").isJobPage).toBe(false);
    const two = `<script type="application/ld+json">[{"@type":"JobPosting","title":"QA Engineer"},{"@type":"JobPosting","title":"SRE"}]</script>`;
    expect(readJob(pageOf(two), "https://acme.com/jobs/qa").isJobPage).toBe(false);
    const one = `<script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":"Acme"}</script>`;
    expect(readJob(pageOf(one), "https://acme.com/careers").isJobPage).toBe(false);
  });

  it("is a job's page when it publishes JobPosting data", () => {
    const doc = pageOf(`<script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Test.</p>"}</script>`);
    expect(readJob(doc, "https://acme.com/anything")).toMatchObject({ isJobPage: true, title: "QA Engineer", company: "Acme" });
  });

  it("is a job's page on a job's link with an Apply button, and not on another link", () => {
    const body = "<h1>QA Engineer</h1><main>Test the API.</main><button>Apply now</button>";
    expect(readJob(pageOf(body), "https://acme.com/careers/qa-engineer/")).toMatchObject({ isJobPage: true, title: "QA Engineer", company: "acme.com" });
    expect(readJob(pageOf(body), "https://news.example.com/story")).toMatchObject({ isJobPage: false, title: "", description: "" });
    expect(readJob(pageOf("<h1>QA Engineer</h1><main>Test the API.</main>"), "https://acme.com/careers/qa-engineer/").isJobPage).toBe(false);
  });

  it("reads the company from the page's title when the page doesn't name it, never a job site's own name", () => {
    const greenhouse = new DOMParser().parseFromString(`<html><head><title>Job Application for QA Engineer at Robinhood</title>`
      + `<meta property="og:site_name" content="Greenhouse"></head><body><h1>QA Engineer</h1><main>Test.</main><button>Apply</button></body></html>`, "text/html");
    expect(readJob(greenhouse, "https://job-boards.greenhouse.io/robinhood/jobs/1").company).toBe("Robinhood");
    const lever = new DOMParser().parseFromString(`<html><head><title>Zoox - Test Engineer</title></head><body><h1>Test Engineer</h1>`
      + `<main>Test.</main><a href="#">Apply for this job</a></body></html>`, "text/html");
    expect(readJob(lever, "https://jobs.lever.co/zoox/abc").company).toBe("Zoox");
  });

  it("reads the codes a page gives its job and the links it gives itself", () => {
    const doc = new DOMParser().parseFromString(`<html><head><link rel="canonical" href="https://careers.acme.com/jobs/8329677">`
      + `<script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":"Acme",`
      + `"description":"<p>Test.</p>","identifier":{"@type":"PropertyValue","value":"JR-2041"}}</script></head>`
      + `<body><main>Test the API. Req ID: R123456</main></body></html>`, "text/html");
    expect(readJob(doc, "https://acme.com/x")).toMatchObject({ ids: ["jr-2041", "r123456"], links: ["https://careers.acme.com/jobs/8329677"] });
  });
});
