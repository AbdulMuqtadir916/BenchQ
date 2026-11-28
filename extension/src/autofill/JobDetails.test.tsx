// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Application, BenchqJob } from "../api";
import { employmentWords, savedJobFacts } from "./job-details";
import { sectionsOf } from "./JobDetails";

const shape = (description: string | null) => sectionsOf(description).map(({ title, kind, paragraphs, items }) => [title, kind, paragraphs, items]);

describe("a posting's description in the details page's sections", () => {
  it("puts what comes before any heading under About the role, then each heading with its text and its list", () => {
    expect(shape("<p>Join the payments team.</p><h3>Requirements</h3><ul><li>5+ years of Java</li><li>Spring Boot</li></ul>"
      + "<p><strong>Benefits:</strong></p><ul><li>Health insurance</li><li>401(k)</li></ul><h3>About us</h3><p>Acme moves money.</p>")).toEqual([
      ["About the role", "about", ["Join the payments team."], []],
      ["Requirements", "requirements", [], ["5+ years of Java", "Spring Boot"]],
      ["Benefits", "benefits", [], ["Health insurance", "401(k)"]],
      ["About us", "company", ["Acme moves money."], []],
    ]);
  });

  it("reads a description in plain text too: its bullets, and a short line ending in a colon as a heading", () => {
    expect(shape("We test the API.\nWhat you'll bring:\n- Selenium\n• Cypress\nTools we use:\nJira and Postman, mostly.")).toEqual([
      ["About the role", "about", ["We test the API."], []],
      ["What you'll bring", "requirements", [], ["Selenium", "Cypress"]],
      ["Tools we use", "about", ["Jira and Postman, mostly."], []],
    ]);
  });

  it("keeps a sentence that only starts like a heading as text", () => {
    expect(shape("Requirements change fast here, so we test everything.")).toEqual([
      ["About the role", "about", ["Requirements change fast here, so we test everything."], []],
    ]);
  });

  it("words an employment type BenchQ holds as a code, and keeps a source's own words", () => {
    expect(["FULL_TIME", "full_time", "PART_TIME", "CONTRACT", "PER_DIEM"].map(employmentWords)).toEqual(["Full-time", "Full-time", "Part-time", "Contract", "Per diem"]);
    expect(employmentWords("Contract to hire")).toBe("Contract to hire");
    expect(employmentWords("Full-time, Contract")).toBe("Full-time, Contract");
    expect(employmentWords(" ")).toBeNull();
    expect(employmentWords(null)).toBeNull();
  });

  it("reads no script or style in a description as its text", () => {
    expect(shape("<p>Test the API.</p><script>track()</script><style>p { color: red }</style>")).toEqual([
      ["About the role", "about", ["Test the API."], []],
    ]);
  });

  it("gives no sections for no description", () => {
    expect(sectionsOf("")).toEqual([]);
    expect(sectionsOf(null)).toEqual([]);
    expect(sectionsOf("<p></p>")).toEqual([]);
  });
});

describe("a saved job as its details page shows it", () => {
  const job = { title: "Analytics Engineer", company: "Reddit", url: "https://boards.greenhouse.io/reddit/jobs/1" };
  const listed = { id: "app-1", title: "Analytics Engineer", company: "Reddit", location: "Remote - United States", salary_min: 164200,
    salary_max: 229990 } as Application;
  const stored: BenchqJob = { id: "post-1", title: "Analytics Engineer", company: "Reddit", location: "Remote - United States",
    url: job.url, description: "About the role\nReddit is a community of communities.", descriptionHtml: "<h3>About the role</h3><p>Reddit is a community of communities.</p>",
    workMode: "remote", employmentType: "Full-time", salaryMin: 164200, salaryMax: 229990, salaryCurrency: "USD", requisitionId: "7012345" };

  it("words what Add job read and BenchQ saved as Add job words it", () => {
    expect(savedJobFacts(job, listed, stored, null)).toMatchObject({ title: "Analytics Engineer", company: "Reddit",
      location: "Remote - United States", workMode: "Remote", employmentType: "Full-time", pay: "USD 164,200–229,990",
      requisitionId: "7012345", description: stored.descriptionHtml });
  });

  it("takes the page's own reading for what BenchQ holds as text, and its pay bounds as the job list words them", () => {
    const page = { ...job, location: "Remote", isJobPage: true, description: "<h3>Benefits</h3><ul><li>401k</li></ul>" };
    const facts = savedJobFacts(job, listed, { ...stored, descriptionHtml: null, salaryCurrency: null }, page);
    expect(facts.description).toBe(page.description);
    expect(facts.pay).toBe("$164.2k–$230k/yr");
    expect(savedJobFacts(job, listed, null, null)).toMatchObject({ pay: "$164.2k–$230k/yr", workMode: null, description: null });
  });
});
