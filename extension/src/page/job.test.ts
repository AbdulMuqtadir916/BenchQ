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

  it("uses the visible role on a region-restricted Adzuna listing", () => {
    const doc = pageOf("<main><h1>View Job</h1><p>Sorry, this job is not available in your region</p><p>Position: Salesforce Developer</p></main>");
    doc.title = "View Job | Adzuna";
    expect(readJob(doc, "https://www.adzuna.com/details/5961900552")).toMatchObject({ isJobPage: true, title: "Salesforce Developer" });
  });

  it("uses the role above Apply even when the metadata repeats View Job", () => {
    const doc = pageOf('<script type="application/ld+json">{"@type":"JobPosting","title":"View Job"}</script><main><p>Salesforce Developer</p><button>Apply</button><h2>Overview:</h2></main>');
    doc.title = "View Job";
    expect(readJob(doc, "https://example.org/jobs/12407").title).toBe("Salesforce Developer");
  });

  it.each(["QA Engineer", "QA Engineer | View Job"])("prefers the line the tab title %s confirms over the line above Apply", (tabTitle) => {
    const doc = pageOf("<main><div>QA Engineer</div><div>Remote</div><button>Apply</button></main>");
    doc.title = tabTitle;
    expect(readJob(doc, "https://acme.com/jobs/42").title).toBe("QA Engineer");
  });

  it("takes the role above SmartRecruiters' I'm interested", () => {
    const doc = pageOf("<main><div>QA Engineer</div><button>I'm interested</button><p>Test the API.</p></main>");
    doc.title = "Acme";
    expect(readJob(doc, "https://jobs.smartrecruiters.com/Acme/743999-qa-engineer").title).toBe("QA Engineer");
  });

  it.each([
    ["the page's h1 over a section heading", "<h1>QA Engineer</h1><main><h2>Responsibilities</h2><p>Test the API.</p></main><button>Apply</button>", "QA Engineer"],
    ["the role heading over a site-name h1", "<h1>Acme</h1><main><h2>QA Engineer</h2><p>Test the API.</p></main><button>Apply</button>", "QA Engineer"],
  ])("takes %s", (_name, body, title) => {
    expect(readJob(pageOf(body), "https://acme.com/jobs/42").title).toBe(title);
  });

  it("finds a role above Apply on a custom portal URL with a branded tab title", () => {
    const doc = pageOf("<main><div>Salesforce Developer</div><button>Apply</button><p>Location: Mount Laurel, NJ</p><p>Job Id: PDT - 12407</p></main>");
    doc.title = "Purpledrive recruiting portal";
    expect(readJob(doc, "https://purpledrive.oorwin.com/public/open/12407")).toMatchObject({ isJobPage: true, title: "Salesforce Developer" });
  });

  it("sets aside JobPosting data an app kept from the job it showed before, and reads this one's", () => {
    const stale = `<script type="application/ld+json">{"@type":"JobPosting","title":"Old Role","url":"https://jobs.acme.com/jobs/111111","hiringOrganization":"Acme","description":"<p>Old.</p>"}</script>`;
    const body = "<main><h1>QA Engineer</h1><p>Test the payments API end to end, every day.</p><button>Apply now</button></main>";
    const doc = new DOMParser().parseFromString(`<html><head>${stale}</head><body>${body}</body></html>`, "text/html");
    expect(readJob(doc, "https://jobs.acme.com/jobs/222222")).toMatchObject({ isJobPage: true, title: "QA Engineer" });
    expect(readJob(doc, "https://jobs.acme.com/jobs/111111")).toMatchObject({ isJobPage: true, title: "Old Role" });
  });

  it("is a job's page when it publishes JobPosting data", () => {
    const doc = pageOf(`<script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Test.</p>"}</script>`);
    expect(readJob(doc, "https://acme.com/anything")).toMatchObject({ isJobPage: true, title: "QA Engineer", company: "Acme" });
  });

  it("is a job's page on a job's link with an Apply button, and not on another link", () => {
    const body = "<h1>QA Engineer</h1><main>Test the API.</main><button>Apply now</button>";
    expect(readJob(pageOf(body), "https://acme.com/careers/qa-engineer/")).toMatchObject({ isJobPage: true, title: "QA Engineer", company: "" });
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

  const detail = '<main><h1>Candidate Center</h1><article><h2>Salesforce Developer II</h2><button>Apply</button>'
    + '<p>Job Id: PDT - 12407</p><p>Location: Mount Laurel, NJ</p><p>Build Salesforce apps.</p>'
    + '<aside><h2>Related jobs</h2><p>Position: Payroll Manager</p><p>Job Id: PDT-99887</p></aside></article></main>';
  const portal = "https://portal.example.org/jobs/12407";
  const ld = (...jobs: object[]) => `<script type="application/ld+json">${JSON.stringify(jobs.map(job => ({ "@type": "JobPosting", ...job })))}</script>`;

  it("captures the actual JD, employer, date and posting link without web form and board content", () => {
    const markup = '<link rel="canonical" href="/jobs/12407"><main><h1>Salesforce Developer</h1><p>Employer:</p><p>Acme</p>'
      + '<div data-testid="job-description"><p>Build Apex integrations.</p><ul><li>Maintain Salesforce APIs.</li></ul></div>'
      + '<p>Date posted: 2026-01-12</p><p>Estimated salary: $172,226 per year</p><form>Enter your email</form><button>Apply</button></main>';
    const job = readJob(pageOf(markup), portal + "?utm_source=board");
    expect(job).toMatchObject({ title: "Salesforce Developer", company: "Acme", postedAt: "2026-01-12", postingUrl: portal,
      description: "Build Apex integrations.\nMaintain Salesforce APIs." });
    expect(job.salaryMin).toBeUndefined();
    const other = markup.replace('href="/jobs/12407"', 'href="/jobs/99999"');
    expect(readJob(pageOf(other), portal).postingUrl).toBeUndefined();
    expect(readJob(pageOf(markup), portal + "?job=another").postingUrl).toBeUndefined();
  });

  it("retains the remote eligibility country as well as the stated work location", () => {
    const doc = pageOf(ld({ title: "Engineer", jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { name: "Canada" }, jobLocation: { address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } } }));
    expect(readJob(doc, portal).location).toBe("Toronto, ON, CA · Remote (Canada)");
  });

  it("keeps the visited job URL when a canonical adds another job or tenant selector", () => {
    for (const suffix of ["?job=other", "?tenant=other", "#/jobs/other"]) {
      const doc = pageOf('<link rel="canonical" href="/jobs/12407' + suffix + '">' + detail);
      expect(readJob(doc, portal + "?utm_source=board").postingUrl).toBeUndefined();
    }
  });

  it("resolves the selected posting's employer and image references from the document graph", () => {
    const graph = [
      { "@type": "Organization", "@id": "#board", name: "Unrelated Board", logo: "/board.png" },
      { "@type": "https://schema.org/JobPosting", title: "Engineer", hiringOrganization: { "@id": portal + "#hiring" } },
      { "@type": "Organization", "@id": "#hiring", name: "Northwind", logo: { "@id": "#emblem" } },
      { "@type": "ImageObject", "@id": "#emblem", contentUrl: "/images/northwind.png" },
    ];
    const doc = pageOf('<script type="application/ld+json">' + JSON.stringify({ "@graph": graph }) + '</script>');
    expect(readJob(doc, portal)).toMatchObject({ title: "Engineer", company: "Northwind", logoUrl: "https://portal.example.org/images/northwind.png" });
  });

  it("reads a posted microdata salary without merging it with a different visible range", () => {
    const doc = pageOf('<main itemscope itemtype="https://schema.org/JobPosting"><h1>Engineer</h1><button>Apply</button>'
      + '<div itemprop="baseSalary"><meta itemprop="currency" content="CAD"><div itemprop="value" itemscope>'
      + '<meta itemprop="maxValue" content="85"><meta itemprop="unitText" content="HOUR"></div></div>'
      + '<p>Salary: USD 40000–60000 per year</p></main>');
    const job = readJob(doc, portal);
    expect(job).toMatchObject({ salaryMax: 85, salaryCurrency: "CAD", salaryPeriod: "hour" });
    expect(job.salaryMin).toBeUndefined();
  });

  it("uses the listing's full visible description when structured data contains only its opening words", () => {
    const doc = pageOf(ld({ title: "Engineer", description: "<p>Build Apex integrations…</p>" })
      + '<main><div itemprop="description"><p>Build Apex integrations for customer accounts.</p><p>Maintain Salesforce APIs.</p></div></main>');
    expect(readJob(doc, portal).description).toBe("Build Apex integrations for customer accounts.\nMaintain Salesforce APIs.");
  });

  it("reads only the active detail panel, including its spaced requisition", () => {
    const page = readJob(pageOf(detail), portal);
    expect(page).toMatchObject({ title: "Salesforce Developer II", company: "", ids: ["pdt-12407"] });
    expect(page.description).not.toContain("Payroll");
  });

  it("reads the active employer's logo and one-sided salary without mixing in related jobs", () => {
    const data = ld({ title: "Other role", identifier: "OLD-9876", hiringOrganization: { name: "Other", logo: "/other.png" } },
      { title: "Salesforce Developer II", identifier: "PDT-12407", hiringOrganization: { name: "Acme", logo: { contentUrl: "/logos/acme.png" } },
        baseSalary: { currency: "USD", value: { minValue: 65000, unitText: "YEAR" } } });
    const job = readJob(pageOf(data + detail), portal);
    expect(job).toMatchObject({ logoUrl: "https://portal.example.org/logos/acme.png", company: "Acme", salaryMin: 65000 });
    expect(job.salaryMax).toBeUndefined();
  });

  it("uses a visibly named employer logo and ignores unsafe URLs and board branding", () => {
    const card = (src: string) => pageOf(`<main><h1>Engineer</h1><p>Company: Acme</p><button>Apply</button>
      <img alt="Greenhouse logo" src="/board.png"><img alt="Acme logo" src="${src}"></main>`);
    expect(readJob(card("/acme.svg"), portal).logoUrl).toBe("https://portal.example.org/acme.svg");
    expect(readJob(card("data:text/plain,logo"), portal).logoUrl).toBeUndefined();
  });

  it.each(["Requisition ID: PDT - 12407", "PDT-12407", "Requisition Number", "12407", "JR000012407"])(
    "rejects %s as the role even when the heading, tab and structured title agree", bad => {
      const doc = pageOf(ld({ title: bad, identifier: "PDT-12407" }) +
        `<main><h1>${bad}</h1><button>Apply</button><h2>Salesforce Developer</h2><p>Requisition ID: PDT - 12407</p></main>`);
      doc.title = bad;
      expect(readJob(doc, portal)).toMatchObject({ title: "Salesforce Developer", requisitionId: "PDT-12407" });
    });
  it("leaves the role empty when only the requisition is published", () => {
    const doc = pageOf(ld({ title: "ABCD-EFGH", identifier: "ABCD-EFGH" }) + "<main><h1>ABCD-EFGH</h1><button>Apply</button></main>");
    expect(readJob(doc, portal)).toMatchObject({ isJobPage: true, title: "" });
  });
  it("uses the one structured posting matching the visible requisition and discards stale data", () => {
    const old = { title: "Payroll Manager", identifier: "PDT-99887", hiringOrganization: "Old employer" };
    const active = { title: "Salesforce Developer II", identifier: "PDT-12407", hiringOrganization: "Current employer" };
    expect(readJob(pageOf(ld(old) + detail), portal)).toMatchObject({ title: active.title, company: "" });
    expect(readJob(pageOf(ld(old, active) + detail), portal)).toMatchObject({ title: active.title, company: active.hiringOrganization });
  });

  it("recognizes an unavailable posting with its own role, requisition and location on an unfamiliar site", () => {
    const closed = '<main><h1>Systems Engineer</h1><p>Job ID: R12345</p><p>Location: Remote</p><p>Applications have closed.</p></main>';
    expect(readJob(pageOf(closed), "https://example.org/op/12345")).toMatchObject({ isJobPage: true, title: "Systems Engineer" });
    expect(readJob(pageOf("<main><h1>Membership</h1>Applications have closed.</main>"), "https://example.org/members").isJobPage).toBe(false);
  });
});
