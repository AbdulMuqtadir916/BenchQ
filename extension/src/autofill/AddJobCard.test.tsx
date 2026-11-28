// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addJob, BENCHQ_URL, getCandidateJob } from "../api";
import AddJobCard, { isOtherJobOnSite, isSavedJob, jobIdsOf, looksLikeJobPage, offersPage } from "./AddJobCard";
import { detailsOf } from "./job-details";
import { missingAccess, requestAccess } from "./site-access";
import { readJobPage } from "./tab-bridge";

vi.mock("./tab-bridge", () => ({ readJobPage: vi.fn() }));
// A site BenchQ may read, unless a test says otherwise (#126).
vi.mock("./site-access", () => ({ missingAccess: vi.fn(async () => null), requestAccess: vi.fn() }));
vi.mock("../api", async (actual) => ({ ...await actual<typeof import("../api")>(), addJob: vi.fn(), getCandidateJob: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = { title: "Senior QA Engineer", company: "Acme Bank", description: "<p>Test the API.</p>", location: "Atlanta, GA", url: "https://boards.example.test/acme/jobs/123", isJobPage: true };
let root: Root | null = null;
let host: HTMLElement;

type Known = { title: string | null; company: string | null; location: string | null; url?: string | null };

async function show(onAdded = vi.fn(), knownUrls: string[] = [], knownJobs: Known[] = [], url = page.url, userId?: string) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AddJobCard userId={userId} tab={{ id: 7, url }} firmId="firm-1" candidateId="cand-1" candidateName="Priya" knownUrls={knownUrls} knownJobs={knownJobs} onAdded={onAdded} />); });
  return onAdded;
}

const click = (slot: string) => act(async () => { host.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)!.click(); });
/** Types into one of React's inputs as the BDE would: the value, then the input event React listens for. */
const type = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
});
const inputOf = (label: string) => [...host.querySelectorAll("[data-slot='add-job-form'] label")]
  .find((field) => field.querySelector("span")?.textContent === label)!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;

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

  it("says when it shows a job, so the panel is the page that adds it, and opens the posting's own page on request", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    const onShown = vi.fn();
    const onDetailsShown = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<AddJobCard tab={{ id: 7, url: page.url }} firmId="firm-1" candidateId="cand-1" candidateName="Priya Shah" knownUrls={[]} onAdded={vi.fn()} onShown={onShown} onDetailsShown={onDetailsShown} />); });
    expect(onShown).toHaveBeenLastCalledWith(true);
    expect(onDetailsShown).toHaveBeenLastCalledWith(false);
    // Save is under the card, for the candidate by their first name, as the design has it.
    expect(host.querySelector("[data-slot='add-job'] [data-slot='add-job-run']")).toBeNull();
    expect(host.querySelector("[data-slot='add-job-run']")!.textContent).toBe("Save job for Priya");
    await click("add-job-more");
    // The design's Job Details page: the posting's HTML read as text, and Save at its foot.
    const details = host.querySelector("[data-slot='job-details']")!;
    expect(details.querySelector("[data-slot='job-details-title']")!.textContent).toBe(page.title);
    expect(details.querySelector("[data-slot='job-details-section'] p")!.textContent).toBe("Test the API.");
    expect(details.querySelector("[data-slot='job-details-actions'] [data-slot='add-job-run']")!.textContent).toBe("Save job for Priya");
    expect(host.querySelector("[data-slot='add-job']")).toBeNull();
    expect(onDetailsShown).toHaveBeenLastCalledWith(true);
    await click("job-details-back");
    expect(host.querySelector("[data-slot='add-job']")).not.toBeNull();
    expect(onDetailsShown).toHaveBeenLastCalledWith(false);
    act(() => { root!.unmount(); });
    root = null;
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(onDetailsShown).toHaveBeenLastCalledWith(false);
  });

  it("adds on an explicit save click the job for the candidate and hands back its application", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    vi.mocked(addJob).mockResolvedValue({ id: "app-1", status: "saved", job_created: true, application_created: true } as never);
    const onAdded = await show();
    expect(host.querySelector("h2")?.textContent).toBe(page.title);
    // The company, then the place on a line of its own, as the design has them.
    expect([...host.querySelectorAll("[data-slot='add-job'] p")].map(({ textContent }) => textContent).slice(0, 2)).toEqual(["Acme Bank", "Atlanta, GA"]);
    expect(addJob).not.toHaveBeenCalled();
    await click("add-job-run");
    expect(addJob).toHaveBeenCalledWith("cand-1", page);
    expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }));
    expect(host.querySelector("[role='status']")?.textContent).toBe("Added to Priya's Saved jobs.");
  });

  it("shows the captured employer logo and lets the recruiter complete a partial job", async () => {
    vi.mocked(readJobPage).mockResolvedValue({ ...page, logoUrl: "https://acme.example/logo.png", description: "" });
    await show();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://acme.example/logo.png");
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>("[data-slot='add-job-run']")?.disabled).toBe(true);
  });

  it("adds nothing until the BDE chooses Save", async () => {
    vi.mocked(readJobPage).mockResolvedValue(page);
    await show();
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

  it.each(["View Job", "PDT - 12407", "Requisition ID: 12407"])("recovers the saved placeholder %s only from that exact listing", async placeholder => {
    const onPageTitle = vi.fn();
    vi.mocked(readJobPage).mockResolvedValue(page);
    const saved = { ...page, id: "app-9", title: placeholder };
    host = document.createElement("div");
    root = createRoot(host);
    await act(async () => {
      root!.render(<AddJobCard tab={{ id: 7, url: page.url }} candidateId="cand-1" candidateName="Priya"
        knownUrls={[page.url]} knownJobs={[saved]} onAdded={vi.fn()} onPageTitle={onPageTitle} />);
    });
    expect(onPageTitle).toHaveBeenCalledWith("app-9", page.title);
    expect(addJob).not.toHaveBeenCalled();
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
    expect(host.querySelector("[data-slot='add-job']")?.textContent).toContain("Senior QA Engineer");
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
    for (const url of ["https://careers.acme.test/", "https://acme.test/careers", "https://acme.test/en/jobs/"]) expect(looksLikeJobPage(url), url).toBe(false);
  });
});

describe("a job the candidate has, by its code (CodeRabbit #129)", () => {
  const page = (url: string, company = "Acme") => ({ title: "QA Engineer", company, description: "", location: "Remote", url, isJobPage: true });
  const known = (url: string, company = "Acme") => ({ title: "QA Engineer", company, location: "Remote", url });
  const acme = "https://acme.wd5.myworkdayjobs.com/External/job/Remote/QA-Engineer_R123456";

  it("needs the same employer for a shared requisition code, and tells two requisitions for one role apart", () => {
    expect(isSavedJob(page("https://globex.wd1.myworkdayjobs.com/Careers/job/Remote/QA-Engineer_R123456", "Globex"), known(acme))).toBe(false);
    expect(isSavedJob(page(`${acme}?source=LinkedIn`), known(acme))).toBe(true);
    expect(isSavedJob(page("https://acme.wd5.myworkdayjobs.com/External/job/Remote/QA-Engineer_R654321"), known(acme))).toBe(false);
    expect(isSavedJob(page("https://www.linkedin.com/jobs/view/3912345678"), known(acme))).toBe(true);
  });
});

describe("a fuller reading of the same page (PR #140 review)", () => {
  it("replaces the first, even when its JobPosting names the job better; another page's never does", async () => {
    vi.mocked(missingAccess).mockResolvedValue(null);
    vi.useFakeTimers();
    try {
      const fuller = { ...page, title: "Senior QA Engineer II", salaryMin: 120000, salaryMax: 150000, salaryPeriod: "year" as const };
      vi.mocked(readJobPage).mockResolvedValueOnce(page).mockResolvedValueOnce(fuller)
        .mockResolvedValue({ ...fuller, url: "https://boards.example.test/acme/jobs/999", title: "Data Engineer", employmentType: "Full-time", location: "Remote" });
      await show();
      expect(host.textContent).toContain("Senior QA Engineer");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(host.textContent).toContain("Senior QA Engineer II");
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(host.textContent).toContain("Senior QA Engineer II");
      expect(host.textContent).not.toContain("Data Engineer");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what the card says the page stated, before the BDE adds the job", () => {
  it("names each detail, the posted date in words, and only what the page stated", () => {
    expect(detailsOf({ ...page, workMode: "remote", employmentType: "Full-time", salaryMin: 120000, salaryMax: 150000, salaryCurrency: "USD",
      salaryPeriod: "year", postedAt: "2026-11-10", requisitionId: "R123456" })).toEqual([
      ["Work mode", "Remote"], ["Employment", "Full-time"], ["Pay", "USD 120,000–150,000 a year"], ["Posted", "10 Nov 2026"], ["Job ID", "R123456"],
    ]);
    expect(detailsOf(page)).toEqual([]);
  });

  it("shows them as named rows on the card", async () => {
    vi.mocked(missingAccess).mockResolvedValue(null);
    vi.mocked(readJobPage).mockResolvedValue({ ...page, employmentType: "Contract", salaryMin: 60, salaryPeriod: "hour", salaryCurrency: "USD" });
    await show();
    const rows = [...host.querySelectorAll("[data-slot='add-job-details'] dt")].map((name) => [name.textContent, name.nextElementSibling!.textContent]);
    expect(rows).toEqual([["Employment", "Contract"], ["Pay", "From USD 60 an hour"]]);
  });
});

describe("editing the job before saving it", () => {
  it("edits the description as text, keeps the edits through a later reading of the page, and saves what the BDE wrote", async () => {
    vi.mocked(missingAccess).mockResolvedValue(null);
    vi.useFakeTimers();
    try {
      const url = "https://boards.example.test/acme/jobs/777";
      // A later look reads the same posting more fully: its requisition ID loads late.
      vi.mocked(readJobPage).mockResolvedValueOnce({ ...page, url }).mockResolvedValue({ ...page, url, requisitionId: "R777" });
      vi.mocked(addJob).mockResolvedValue({ id: "app-7", status: "saved", job_created: true, application_created: true } as never);
      await show(vi.fn(), [], [], url);
      await click("add-job-edit");
      // The posting's HTML as text, never its tags.
      expect(inputOf("Description").value).toBe("Test the API.");
      await type(inputOf("Job title"), "Senior QA Engineer II");
      await type(inputOf("Description"), "Test the API and the app.");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(inputOf("Job title").value).toBe("Senior QA Engineer II");
      expect(inputOf("Description").value).toBe("Test the API and the app.");
      await click("add-job-done");
      expect(host.querySelector("[data-slot='add-job-form']")).toBeNull();
      expect(host.querySelector("h2")!.textContent).toBe("Senior QA Engineer II");
      await click("add-job-run");
      expect(addJob).toHaveBeenCalledWith("cand-1", expect.objectContaining({ title: "Senior QA Engineer II", description: "Test the API and the app.", requisitionId: "R777" }));
      expect(host.querySelector("[role='status']")?.textContent).toBe("Added to Priya's Saved jobs.");
      // Saved, the card still shows what the BDE made it.
      expect(host.querySelector("h2")!.textContent).toBe("Senior QA Engineer II");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the edits when the card is drawn afresh on the same posting", async () => {
    const url = "https://boards.example.test/acme/jobs/779";
    vi.mocked(readJobPage).mockResolvedValue({ ...page, url });
    await show(vi.fn(), [], [], url);
    await click("add-job-edit");
    await type(inputOf("Location"), "Remote (US)");
    act(() => { root!.unmount(); });
    host.remove();
    await show(vi.fn(), [], [], url);
    expect(host.querySelector("[data-slot='add-job'] p:nth-of-type(2)")!.textContent).toBe("Remote (US)");
  });

  it("starts from the page again when another account opens the same posting", async () => {
    const url = "https://boards.example.test/acme/jobs/790";
    vi.mocked(readJobPage).mockResolvedValue({ ...page, url });
    await show(vi.fn(), [], [], url, "user-1");
    await click("add-job-edit");
    await type(inputOf("Job title"), "Edited for the first user");
    act(() => { root!.unmount(); });
    host.remove();
    await show(vi.fn(), [], [], url, "user-2");
    expect(host.querySelector("h2")?.textContent).toBe(page.title);
  });

  it("keeps the BDE's edits when Save finds the page names the posting another way", async () => {
    const url = "https://boards.example.test/acme/jobs/778";
    vi.mocked(readJobPage).mockResolvedValueOnce({ ...page, url }).mockResolvedValue({ ...page, url, title: "QA Engineer (Payments)" });
    await show(vi.fn(), [], [], url);
    await click("add-job-edit");
    await type(inputOf("Location"), "Remote");
    await click("add-job-run");
    expect(addJob).not.toHaveBeenCalled();
    expect(host.textContent).toContain("The posting changed");
    // The page's reading now, with the BDE's edit still over it.
    expect(host.querySelector("h2")!.textContent).toBe("QA Engineer (Payments)");
    expect(inputOf("Location").value).toBe("Remote");
  });
});

describe("a later reading of the page (PR #140, second review)", () => {
  it("requires a fresh review if the tab moves to a different requisition with the same title", async () => {
    vi.mocked(missingAccess).mockResolvedValue(null);
    vi.useFakeTimers();
    try {
      const teaser = { ...page, description: "<p>Test the API.</p>" };
      const whole = { ...page, description: "<p>Test the API.</p><p>Own the payments test suite, end to end, every release.</p>" };
      vi.mocked(readJobPage).mockResolvedValueOnce(teaser).mockResolvedValueOnce(whole)
        .mockResolvedValue({ ...whole, url: "https://boards.example.test/acme/jobs/456", location: "Remote", employmentType: "Contract" });
      await show();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(addJob).not.toHaveBeenCalled();
      // A delayed read of the new page must not silently change the Save action.
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(host.textContent).not.toContain("Remote");
      expect(host.querySelector("[data-slot='add-job-confirm']")).toBeNull();
      await click("add-job-run");
      expect(addJob).not.toHaveBeenCalled();
      expect(host.textContent).toContain("The posting changed");
      expect(host.textContent).toContain("Remote");
    } finally {
      vi.useRealTimers();
    }
  });
});

it("treats Adzuna's tracked link and the listing it opens as one job", () => {
  const saved = "https://www.adzuna.com/land/ad/5963480464?se=b&utm_medium=api&v=C0FFEE";
  expect(isOtherJobOnSite("https://www.adzuna.com/details/5963480464?i=a&se=b", saved)).toBe(false);
  expect(isOtherJobOnSite("https://www.adzuna.com/details/5963480465", saved)).toBe(true);
});

it("offers to save a job BenchQ already has, with BenchQ's details, and saves that job", async () => {
  vi.stubGlobal("chrome", { storage: { session: { get: async () => ({ "source-job:7": "job-9" }) } } });
  vi.mocked(getCandidateJob).mockResolvedValue({ id: "job-9", title: "QA Lead", company: "Acme Corp", location: "Austin, TX", description: "<p>Lead QA.</p>", url: page.url });
  vi.mocked(readJobPage).mockResolvedValue(page);
  vi.mocked(addJob).mockResolvedValue({ id: "app-1", candidate_id: "cand-1", job_id: "job-9", status: "saved", title: "QA Lead", company: "Acme Corp", location: "Austin, TX", url: page.url, job_created: false, application_created: true });
  await show();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain("already in BenchQ");
  expect([...host.querySelectorAll("[data-slot='add-job'] p")].map(({ textContent }) => textContent).slice(0, 2)).toEqual(["Acme Corp", "Austin, TX"]);
  await click("add-job-run");
  expect(getCandidateJob).toHaveBeenCalledWith("firm-1", "cand-1", "job-9");
  expect(addJob).toHaveBeenCalledWith("cand-1", expect.objectContaining({ title: "QA Lead", company: "Acme Corp" }), expect.objectContaining({ id: "job-9" }));
  vi.unstubAllGlobals();
});

it("never saves one candidate's BenchQ job by its id for another", async () => {
  vi.stubGlobal("chrome", { storage: { session: { get: async () => ({ "source-job:7": "job-9" }) } } });
  const job = { id: "job-9", title: "QA Lead", company: "Acme Corp", location: "Austin, TX", description: "<p>Lead QA.</p>", url: page.url };
  let noPosting!: () => void;
  vi.mocked(getCandidateJob).mockImplementation((_firm, candidate) => candidate === "cand-1" ? Promise.resolve(job)
    : new Promise((_resolve, reject) => { noPosting = () => reject(Object.assign(new Error("Not found"), { status: 404 })); }));
  vi.mocked(readJobPage).mockResolvedValue(page);
  vi.mocked(addJob).mockResolvedValue({ id: "app-2", candidate_id: "cand-2", job_id: "job-10", status: "saved", title: page.title, company: page.company, location: page.location, url: page.url, job_created: true, application_created: true });
  await show();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain("already in BenchQ");
  await act(async () => { root!.render(<AddJobCard tab={{ id: 7, url: page.url }} firmId="firm-1" candidateId="cand-2" candidateName="Ravi" knownUrls={[]} knownJobs={[]} onAdded={vi.fn()} />); });
  expect(host.textContent).not.toContain("already in BenchQ");
  await click("add-job-run");
  expect(addJob).not.toHaveBeenCalled();
  await act(async () => { noPosting(); });
  await click("add-job-run");
  expect(addJob).toHaveBeenLastCalledWith("cand-2", expect.anything());
  vi.unstubAllGlobals();
});

it("adds from the page when the selected candidate doesn't have the BenchQ job", async () => {
  vi.stubGlobal("chrome", { storage: { session: { get: async () => ({ "source-job:7": "job-9" }) } } });
  vi.mocked(getCandidateJob).mockRejectedValue(Object.assign(new Error("Not found."), { status: 404 }));
  vi.mocked(readJobPage).mockResolvedValue(page);
  await show();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.textContent).not.toContain("already in BenchQ");
  expect(host.querySelector("[role='alert']")).toBeNull();
  vi.unstubAllGlobals();
});
