// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addJob, BENCHQ_URL } from "../api";
import AddJobCard, { jobIdsOf, looksLikeJobPage, offersPage } from "./AddJobCard";
import { missingAccess, requestAccess } from "./site-access";
import { readJobPage } from "./tab-bridge";

vi.mock("./tab-bridge", () => ({ readJobPage: vi.fn() }));
// A site BenchQ may read, unless a test says otherwise (#126).
vi.mock("./site-access", () => ({ missingAccess: vi.fn(async () => null), requestAccess: vi.fn() }));
vi.mock("../api", async (actual) => ({ ...await actual<typeof import("../api")>(), addJob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = { title: "Senior QA Engineer", company: "Acme Bank", description: "<p>Test the API.</p>", location: "Atlanta, GA", url: "https://boards.example.test/acme/jobs/123", isJobPage: true };
let root: Root | null = null;
let host: HTMLElement;

type Known = { title: string | null; company: string | null; location: string | null; url?: string | null };

async function show(onAdded = vi.fn(), knownUrls: string[] = [], knownJobs: Known[] = [], url = page.url) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AddJobCard tab={{ id: 7, url }} candidateId="cand-1" candidateName="Priya" knownUrls={knownUrls} knownJobs={knownJobs} onAdded={onAdded} />); });
  return onAdded;
}

const click = (slot: string) => act(async () => { host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)!.click(); });

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host?.remove();
  vi.clearAllMocks();
});

describe("adding the job on this page", () => {
  it("looks only at a web page that isn't BenchQ's own or one of the candidate's jobs", () => {
    expect(offersPage(page.url, [])).toBe(true);
    expect(offersPage(`${page.url}/#apply`, [page.url])).toBe(false);
    expect(offersPage("chrome://extensions", [])).toBe(false);
    expect(offersPage(`${BENCHQ_URL}/acme/jobs`, [])).toBe(false);
  });

  it("knows one of the candidate's jobs however its page was reached", () => {
    const greenhouse = "https://boards.greenhouse.io/robinhood/jobs/8329677?t=gh_src=&gh_jid=8329677";
    expect(offersPage("https://job-boards.greenhouse.io/robinhood/jobs/8329677?t=gh_src=&gh_jid=8329677", [greenhouse])).toBe(false);
    expect(offersPage("https://job-boards.greenhouse.io/robinhood/jobs/8329677", [greenhouse])).toBe(false);
    const lever = "https://jobs.lever.co/zoox/e0d46302-6fa2-45a7-927d-cd11ccf1843e";
    expect(offersPage(`${lever}/apply?lever-source=LinkedIn`, [lever])).toBe(false);
    expect(offersPage("https://jobs.ashbyhq.com/openai/393b88d7/application", ["https://jobs.ashbyhq.com/openai/393b88d7"])).toBe(false);
  });

  it("still offers another job on the same site", () => {
    expect(offersPage("https://job-boards.greenhouse.io/robinhood/jobs/1111111", ["https://boards.greenhouse.io/robinhood/jobs/8329677"])).toBe(true);
    expect(offersPage("https://www.indeed.com/viewjob?jk=bbb", ["https://www.indeed.com/viewjob?jk=aaa"])).toBe(true);
    expect(offersPage("https://careers.acme.com/jobs/2", ["https://careers.acme.com/jobs/1"])).toBe(true);
    expect(offersPage("https://acme.com/careers/qa-engineer", ["https://acme.com/"])).toBe(true);
  });

  it("isn't shown on a page that isn't a job's page", async () => {
    vi.mocked(readJobPage).mockResolvedValue({ ...page, isJobPage: false });
    await show();
    expect(readJobPage).toHaveBeenCalledWith(7);
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
  });

  it("asks first, then adds the job for the candidate and hands back its application", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    vi.mocked(addJob).mockResolvedValue({ id: "app-1", status: "saved", job_created: true, application_created: true } as never);
    const onAdded = await show();
    expect(host.textContent).toContain("Senior QA Engineer · Acme Bank · Atlanta, GA");
    await click("add-job-run");
    expect(addJob).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Add this job to Priya's Saved jobs?");
    await click("add-job-confirm");
    expect(addJob).toHaveBeenCalledWith("cand-1", page);
    expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(host.querySelector("[role='status']")?.textContent).toBe("Added to Priya's Saved jobs.");
  });

  it("adds nothing when the BDE cancels", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    await show();
    await click("add-job-run");
    await click("add-job-cancel");
    expect(addJob).not.toHaveBeenCalled();
    expect(host.querySelector("[data-slot='add-job-run']")).not.toBeNull();
  });

  it("isn't shown when the page's job is one of the candidate's jobs at another link", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    await show(vi.fn(), [], [{ title: "Senior QA Engineer", company: "Acme Bank Inc", location: "Atlanta, GA" }]);
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
  });

  it("is shown for the same role in another city, or another role at the company", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    await show(vi.fn(), [], [{ title: "Senior QA Engineer", company: "Acme Bank", location: "Boston, MA" },
      { title: "Staff QA Engineer", company: "Acme Bank", location: "Atlanta, GA" }]);
    expect(host.querySelector("[data-slot='add-job']")).not.toBeNull();
  });

  it("reads the codes that name a job in its link", () => {
    expect(jobIdsOf("https://boards.greenhouse.io/robinhood/jobs/8329677?t=gh_src=&gh_jid=8329677")).toEqual(["8329677"]);
    expect(jobIdsOf("https://jobs.lever.co/zoox/e0d46302-6fa2-45a7-927d-cd11ccf1843e/apply")).toEqual(["e0d46302-6fa2-45a7-927d-cd11ccf1843e"]);
    expect(jobIdsOf("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Atlanta-GA/Senior-QA_R123456")).toEqual(["r123456"]);
    expect(jobIdsOf("https://www.indeed.com/viewjob?jk=9f3a2b1c4d5e6f70&from=serp")).toEqual(["9f3a2b1c4d5e6f70"]);
    expect(jobIdsOf("https://acme.com/careers/qa-engineer-2024")).toEqual([]);
  });

  it("isn't shown when the page carries the code of one of the candidate's jobs", async () => {
    vi.mocked(readJobPage).mockResolvedValue({ ...page, url: "https://careers.acmebank.com/roles/qa", title: "QA Engineer II", ids: ["r123456"] });
    await show(vi.fn(), [], [{ title: "Senior QA Engineer", company: "Acme Bank", location: null,
      url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Atlanta/Senior-QA_R123456" }]);
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
  });

  it("is shown when another company's job has the same code", async () => {
    vi.mocked(readJobPage).mockResolvedValue({ ...page, url: "https://careers.acmebank.com/roles/qa", title: "QA Engineer II", ids: ["r123456"] });
    await show(vi.fn(), [], [{ title: "Senior QA Engineer", company: "Globex", location: null,
      url: "https://globex.wd1.myworkdayjobs.com/en-US/Careers/job/Austin/QA_R123456" }]);
    expect(host.querySelector("[data-slot='add-job']")).not.toBeNull();
  });

  it("offers to use this tab on one of the candidate's saved jobs (#130)", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onUseTab = vi.fn();
    const saved = { id: "app-9", title: "Senior QA Engineer", company: "Acme Bank", location: null, url: page.url };
    await act(async () => {
      root!.render(<AddJobCard tab={{ id: 7, url: `${page.url}/apply` }} candidateId="cand-1" candidateName="Priya" knownUrls={[page.url]}
        knownJobs={[saved]} onAdded={vi.fn()} onUseTab={onUseTab} />);
    });
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-slot='use-tab-run']")!.click(); });
    expect(onUseTab).toHaveBeenCalledWith(saved);
    expect(readJobPage).not.toHaveBeenCalled();
  });

  it("doesn't look at a page that is already one of the candidate's jobs", async () => {
    await show(vi.fn(), [page.url]);
    expect(readJobPage).not.toHaveBeenCalled();
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
  });
});

describe("a site BenchQ may not read yet (#126)", () => {
  const careers = "https://careers.acme.test/jobs/123";
  const site = { origins: ["https://careers.acme.test/*"], host: "careers.acme.test" };

  it("asks for it on a job's page, then reads the page once the BDE allows it", async () => {
    vi.mocked(missingAccess).mockResolvedValueOnce(site).mockResolvedValue(null);
    vi.mocked(requestAccess).mockResolvedValue(true);
    vi.mocked(readJobPage).mockResolvedValue({ ...page, url: careers });
    await show(vi.fn(), [], [], careers);
    expect(host.querySelector("[data-slot='add-job-access']")?.textContent).toContain("BenchQ needs to read careers.acme.test");
    expect(readJobPage).not.toHaveBeenCalled();
    await click("add-job-allow");
    expect(requestAccess).toHaveBeenCalledWith(site);
    expect(readJobPage).toHaveBeenCalledWith(7);
    expect(host.querySelector("[data-slot='add-job-access']")).toBeNull();
    expect(host.querySelector("[data-slot='add-job']")?.textContent).toContain("Senior QA Engineer · Acme Bank");
  });

  it("says so when the BDE doesn't allow it, and asks again on the next click", async () => {
    vi.mocked(missingAccess).mockResolvedValue(site);
    vi.mocked(requestAccess).mockResolvedValue(false);
    await show(vi.fn(), [], [], careers);
    await click("add-job-allow");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("Not allowed");
    expect(host.querySelector("[data-slot='add-job-allow']")?.textContent).toBe("Ask again");
    expect(readJobPage).not.toHaveBeenCalled();
  });

  it("doesn't ask on a page whose link isn't a job's", async () => {
    vi.mocked(missingAccess).mockResolvedValue({ origins: ["https://mail.example.test/*"], host: "mail.example.test" });
    await show(vi.fn(), [], [], "https://mail.example.test/inbox/42");
    expect(host.querySelector("[data-slot='add-job-access']")).toBeNull();
    expect(readJobPage).not.toHaveBeenCalled();
  });

  it("knows a job's page by its link", () => {
    expect(looksLikeJobPage("https://careers.acme.test/en/position/42")).toBe(true);
    expect(looksLikeJobPage("https://acme.test/jobs/view/42")).toBe(true);
    expect(looksLikeJobPage("https://acme.test/opportunities?gh_jid=8329677")).toBe(true);
    expect(looksLikeJobPage("https://mail.example.test/inbox/42")).toBe(false);
    expect(looksLikeJobPage("https://news.example.test/jobsearch-tips")).toBe(false);
  });
});
