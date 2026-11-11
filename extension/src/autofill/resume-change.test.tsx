// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResumeAnswers, getResumeFile, getResumeListing, type ResumeListing } from "../api";
import { fakeChrome } from "../test/fake-chrome";
import AutofillPanel from "./AutofillPanel";
import { fillField, flaggedFields, readTab, rejectedFields, removeFileOnPage, scanTab, takeBackField, undoCount, type TabScan } from "./tab-bridge";
import type { Connection, PageSignals, TabField } from "./types";
import { forgetTabs } from "./use-autofill";

/** Changing the résumé on a form already filled, end to end through the panel and its real hooks: the page and the
 * network are the only fakes. */

vi.mock("../api", async (actual) => ({
  ...await actual<typeof import("../api")>(), getResumeAnswers: vi.fn(), getResumeFile: vi.fn(), getResumeListing: vi.fn(),
}));
vi.mock("./tab-bridge", () => ({
  scanTab: vi.fn(), readTab: vi.fn(), fillField: vi.fn(), fillChoice: vi.fn(), rejectedFields: vi.fn(), flaggedFields: vi.fn(),
  focusField: vi.fn(), undoFills: vi.fn(), undoCount: vi.fn(), takeBackField: vi.fn(), listChoices: vi.fn(), chooseChoice: vi.fn(),
  removeFileOnPage: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.spyOn(console, "error").mockImplementation(() => undefined);

const connection: Connection = {
  tabId: 7, applicationId: "app-1", candidateId: "cand-1", userId: "user-1", confirmedHosts: [],
  job: { title: "Senior Java Developer", company: "Acme", url: "https://jobs.acme.test/1" },
};
const onSite: PageSignals = { url: "https://jobs.acme.test/1", title: "Senior Java Developer at Acme", heading: "", siteName: "", posting: null };
const version = (id: string, title: string) => ({ id, version: 1, name: "Base", title, category: "BASE", job_id: null });
const listing: ResumeListing = {
  bases: [
    { id: "b1", number: 1, is_active: true, archived_at: null, versions: [version("res-1", "Java Developer")] },
    { id: "b2", number: 2, is_active: false, archived_at: null, versions: [version("res-2", "Data Engineer")] },
  ],
  tailored: [],
};
const answersOf: Record<string, unknown[]> = {
  "res-1": [{ question: "Email", answer: "one@example.test", kind: "CUSTOM" }, { question: "City", answer: "Phoenix", kind: "CUSTOM" }],
  "res-2": [{ question: "Email", answer: "two@example.test", kind: "CUSTOM" }],
};
const field = (id: string, label: string, current: string, kind: TabField["kind"] = "text"): TabField => ({
  id, frameId: 0, pageUrl: "https://jobs.acme.test/1", kind, label, hints: "", autocomplete: "", required: false, current,
  options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});

let root: Root;
let host: HTMLElement;
const onPage = { a: "", b: "", r: "" };
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const slot = (name: string) => host.querySelector<HTMLButtonElement>(`[data-slot='${name}']`);

beforeEach(() => {
  vi.stubGlobal("chrome", fakeChrome());
  // jsdom lays nothing out: the run list follows its newest field with this.
  Element.prototype.scrollIntoView = vi.fn();
  forgetTabs();
  Object.assign(onPage, { a: "", b: "", r: "" });
  vi.mocked(getResumeListing).mockResolvedValue(listing);
  vi.mocked(getResumeAnswers).mockImplementation(async (_firm, _candidate, resumeId) => answersOf[resumeId] ?? []);
  vi.mocked(getResumeFile).mockResolvedValue(null);
  vi.mocked(scanTab).mockImplementation(async (): Promise<TabScan> => ({
    fields: [field("a", "Email", onPage.a), field("b", "City", onPage.b)], signals: onSite, scanIds: new Map([[0, 1]]), unreadableFrames: 0,
  }));
  vi.mocked(readTab).mockImplementation(async () => ({ values: new Map([["0:a", onPage.a], ["0:b", onPage.b]]), moved: false }));
  vi.mocked(fillField).mockImplementation(async (_tab, _frame, { fieldId, write }) => {
    // Like Greenhouse, the page shows a file it took by its name.
    const value = write.type === "text" ? write.value : write.type === "file" ? write.name : "";
    onPage[fieldId as keyof typeof onPage] = value;
    return { status: "filled", current: value };
  });
  vi.mocked(removeFileOnPage).mockImplementation(async (_tab, name) => {
    if (onPage.r !== name) return false;
    onPage.r = "";
    return true;
  });
  vi.mocked(takeBackField).mockImplementation(async (_tab, _frame, { fieldId }) => {
    onPage[fieldId as keyof typeof onPage] = "";
    return true;
  });
  vi.mocked(rejectedFields).mockResolvedValue([]);
  vi.mocked(flaggedFields).mockResolvedValue([]);
  vi.mocked(undoCount).mockResolvedValue(0);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.clearAllMocks();
});

describe("changing the résumé on a filled form (07 Q24)", () => {
  it("fills the form from the new résumé and takes back what only the old one answered", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<AutofillPanel connection={connection} firmId="firm-1" firmSlug="acme" candidateName="Priya" applying={false}
        isApplied={false} onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} />);
    });
    await wait(50);
    await act(async () => { slot("autofill-run")!.click(); });
    await wait(800);
    expect(onPage).toEqual({ a: "one@example.test", b: "Phoenix", r: "" });

    await act(async () => { slot("resume-select")!.click(); });
    const options = [...host.querySelectorAll<HTMLButtonElement>("[data-slot='resume-option']")];
    await act(async () => { options[1]!.click(); });
    await wait(1500);
    expect(onPage).toEqual({ a: "two@example.test", b: "", r: "" });
    expect(slot("resume-select")!.textContent).toContain("Data Engineer");
  });
});

describe("changing the résumé where the page shows the file it took", () => {
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  /** A second at a time, so the panel's effects run between its waits as they would in the browser. */
  const runFor = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) await advance(1000);
  };

  afterEach(() => { vi.useRealTimers(); });

  it("takes the old résumé's file off through the page's own control, then attaches the new one (Greenhouse)", async () => {
    vi.mocked(getResumeFile).mockResolvedValue({ mimeType: "application/pdf", data: "JVBERi0=" });
    vi.mocked(scanTab).mockImplementation(async (): Promise<TabScan> => ({
      fields: [field("r", "Resume/CV", onPage.r, "file"), field("a", "Email", onPage.a), field("b", "City", onPage.b)],
      signals: onSite, scanIds: new Map([[0, 1]]), unreadableFrames: 0,
    }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<AutofillPanel connection={connection} firmId="firm-1" firmSlug="acme" candidateName="Priya" applying={false}
        isApplied={false} onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} />);
    });
    await advance(50);
    await act(async () => { slot("autofill-run")!.click(); });
    await runFor(15);
    expect(onPage).toEqual({ r: "Priya - Java Developer.pdf", a: "one@example.test", b: "Phoenix" });

    await act(async () => { slot("resume-select")!.click(); });
    await act(async () => { host.querySelectorAll<HTMLButtonElement>("[data-slot='resume-option']")[1]!.click(); });
    await advance(100);
    expect(slot("autofill-step")!.textContent).toBe("Taking the old resume's file off…");
    await runFor(8);
    expect(slot("autofill-step")).toBeNull();
    expect(removeFileOnPage).toHaveBeenCalledWith(7, "Priya - Java Developer.pdf");
    expect(onPage).toEqual({ r: "Priya - Data Engineer.pdf", a: "two@example.test", b: "" });
  });
});
