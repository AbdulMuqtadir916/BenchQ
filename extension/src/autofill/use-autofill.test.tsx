// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResumeAnswers, getResumeFile } from "../api";
import { fakeChrome, type FakeChrome } from "../test/fake-chrome";
import { fillChoice, fillField, flaggedFields, focusField, readTab, rejectedFields, removeFileOnPage, scanTab, takeBackField, undoCount, undoFills, type TabScan } from "./tab-bridge";
import type { AppliedForm, Connection, FieldKind, FillResult, PageSignals, TabField } from "./types";
import { forgetTabs, useAutofill } from "./use-autofill";

vi.mock("../api", async (actual) => ({ ...await actual<typeof import("../api")>(), getResumeAnswers: vi.fn(), getResumeFile: vi.fn() }));
vi.mock("./tab-bridge", () => ({
  scanTab: vi.fn(), readTab: vi.fn(), fillField: vi.fn(), fillChoice: vi.fn(), rejectedFields: vi.fn(), flaggedFields: vi.fn(), focusField: vi.fn(),
  undoFills: vi.fn(), undoCount: vi.fn(), takeBackField: vi.fn(), removeFileOnPage: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection: Connection = {
  tabId: 7, applicationId: "app-1", candidateId: "cand-1", userId: "user-1", confirmedHosts: [],
  job: { title: "Senior Java Developer", company: "Acme", url: "https://jobs.acme.test/1" },
};

/** The picked résumé's answers, as `GET …/resumes/{id}?autofill=true` sends them (docs/02 §8.1). */
const custom = (question: string, answer: unknown) => ({ question, answer, kind: "CUSTOM" });
const answers = [custom("Email", "priya@example.test"), custom("City", "Phoenix"), custom("Do you need sponsorship?", "Yes")];

const field = (id: string, label: string, kind: FieldKind = "text", current = ""): TabField => ({
  id, frameId: 0, pageUrl: "https://jobs.acme.test/1", kind, label, hints: "", autocomplete: "", required: false, current,
  options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});

const page = (fields: TabField[], signals: PageSignals | null = null): TabScan => ({
  fields, signals, scanIds: new Map([[0, 1]]), unreadableFrames: 0,
});

const onSite: PageSignals = { url: "https://jobs.acme.test/1", title: "Senior Java Developer at Acme", heading: "", siteName: "", posting: null };
const elsewhere: PageSignals = { url: "https://other.test/x", title: "Globex careers", heading: "Data Analyst", siteName: "", posting: null };

let fake: FakeChrome;
let root: Root;
let hook: ReturnType<typeof useAutofill>;
vi.spyOn(console, "error").mockImplementation(() => undefined);
const onSessionExpired = vi.fn();
const onAccessLost = vi.fn();

const report = (state: ReturnType<typeof useAutofill>) => { hook = state; };

/** A résumé id that stands for "the panel is still loading the résumés". */
const LOADING = "loading";

function Harness({ value, resumeId = "res-1" }: { value: Connection; resumeId?: string | null }) {
  const state = useAutofill({
    connection: value, firmId: "firm-1", resumeId: resumeId === LOADING ? undefined : resumeId, fileName: "Priya Shah - Java Developer", onSessionExpired, onAccessLost,
  });
  useEffect(() => report(state));
  return null;
}

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function mount(value = connection, resumeId: string | null = "res-1") {
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness value={value} resumeId={resumeId} />); });
  await wait(5);
}

/** The BDE picks another résumé in the panel. */
async function pickResume(resumeId: string | null) {
  await act(async () => { root.render(<Harness value={connection} resumeId={resumeId} />); });
  await wait(5);
}

const run = (action: () => Promise<void>) => act(async () => { await action(); });

const statuses = () => hook.rows?.map(({ field: { id }, status }) => [id, status]);

beforeEach(() => {
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  vi.mocked(getResumeAnswers).mockResolvedValue(answers);
  vi.mocked(getResumeFile).mockResolvedValue(null);
  vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email"), field("b", "City")], onSite));
  vi.mocked(fillField).mockResolvedValue({ status: "filled", current: "" });
  vi.mocked(fillChoice).mockResolvedValue({ status: "filled", current: "" });
  forgetTabs();
  vi.mocked(rejectedFields).mockResolvedValue([]);
  vi.mocked(flaggedFields).mockResolvedValue([]);
  vi.mocked(focusField).mockResolvedValue(true);
  vi.mocked(undoCount).mockResolvedValue(0);
  vi.mocked(readTab).mockResolvedValue({ values: new Map(), moved: false });
  vi.mocked(removeFileOnPage).mockResolvedValue(false);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.clearAllMocks();
});

describe("going to a field", () => {
  it("asks the page for the row's field", async () => {
    await mount();
    vi.mocked(scanTab).mockClear();
    await run(() => hook.goToField(hook.rows![0]!));
    expect(focusField).toHaveBeenCalledWith(7, 0, { scanId: 1, fieldId: "a" });
    expect(scanTab).not.toHaveBeenCalled();
  });

  it("reviews the page again when it has moved on", async () => {
    vi.mocked(focusField).mockResolvedValue(false);
    await mount();
    vi.mocked(scanTab).mockClear();
    await run(() => hook.goToField(hook.rows![0]!));
    expect(scanTab).toHaveBeenCalledTimes(1);
  });

  it("does the same when the page can't be reached", async () => {
    vi.mocked(focusField).mockRejectedValue(new Error("tab closed"));
    await mount();
    vi.mocked(scanTab).mockClear();
    await run(() => hook.goToField(hook.rows![0]!));
    expect(scanTab).toHaveBeenCalledTimes(1);
  });
});

describe("the picked résumé", () => {
  it("waits while the résumés load", async () => {
    await mount(connection, LOADING);
    expect(scanTab).not.toHaveBeenCalled();
    expect(getResumeAnswers).not.toHaveBeenCalled();
    expect(hook.rows).toBeNull();
  });

  it("reviews the form with no answers when the candidate has no résumé", async () => {
    await mount(connection, null);
    expect(getResumeAnswers).not.toHaveBeenCalled();
    expect(statuses()).toEqual([["a", "manual"], ["b", "manual"]]);
    expect(hook.bankEmpty).toBe(true);
  });

  it("says which résumé the review answers from", async () => {
    await mount();
    expect(hook.answeredFrom).toBe("res-1");
  });

  it("answers \"How did you hear about us?\" with where BenchQ found the job, over the résumé's answer", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue([custom("How did you hear about us?", "A friend")]);
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "How did you hear about us?")], onSite));
    await mount({ ...connection, job: { ...connection.job, source: "jobspy_linkedin" } });
    expect(hook.rows![0]).toMatchObject({ status: "ready", proposed: "LinkedIn" });
  });

  it("keeps the résumé's answer when the job's site isn't known", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue([custom("How did you hear about us?", "A friend")]);
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "How did you hear about us?")], onSite));
    await mount();
    expect(hook.rows![0]).toMatchObject({ status: "ready", proposed: "A friend" });
  });

  it("refills BenchQ's own fills from another résumé, never what the BDE changed", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "priya@example.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    expect(statuses()).toEqual([["a", "same"], ["b", "same"]]);
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "mine@example.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.rescan());
    vi.mocked(getResumeAnswers).mockResolvedValue([custom("Email", "work@example.test"), custom("City", "Dallas")]);
    await pickResume("res-2");
    expect(getResumeAnswers).toHaveBeenLastCalledWith("firm-1", "cand-1", "res-2");
    expect(hook.answeredFrom).toBe("res-2");
    expect(statuses()).toEqual([["a", "same"], ["b", "ready"]]);
    expect(hook.rows![1]!.proposed).toBe("Dallas");
  });
});

describe("a suggestion the BDE picks", () => {
  it("fills the field with it, as BenchQ's own fill", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue([custom("Willing to work weekends?", "Yes")]);
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Can you support Saturday/Sunday shifts?")]));
    await mount();
    const row = hook.rows![0]!;
    expect(row.suggestions?.map(({ question }) => question)).toEqual(["Willing to work weekends?"]);
    await run(() => hook.fillWith(row, row.suggestions![0]!));
    expect(fillField).toHaveBeenCalledWith(7, 0, { scanId: 1, fieldId: "a", current: "", write: { type: "text", value: "Yes" } });
  });
});

describe("scanning", () => {
  it("reviews the page when it opens", async () => {
    await mount();
    expect(scanTab).toHaveBeenCalledWith(7);
    expect(getResumeAnswers).toHaveBeenCalledWith("firm-1", "cand-1", "res-1");
    expect(statuses()).toEqual([["a", "ready"], ["b", "ready"]]);
    expect(hook.fillCount).toBe(2);
    expect(hook.scanning).toBe(false);
  });

  it("ends the session on a 401", async () => {
    vi.mocked(getResumeAnswers).mockRejectedValue(Object.assign(new Error("SESSION_EXPIRED"), { status: 401 }));
    await mount();
    expect(onSessionExpired).toHaveBeenCalled();
  });

  it("reports lost access on a 404", async () => {
    vi.mocked(getResumeAnswers).mockRejectedValue(Object.assign(new Error("Request failed"), { status: 404 }));
    await mount();
    expect(onAccessLost).toHaveBeenCalled();
  });

  it("offers a retry when the answers won't load", async () => {
    vi.mocked(getResumeAnswers).mockRejectedValue(Object.assign(new Error("Request failed"), { status: 500 }));
    await mount();
    expect(hook.error).toContain("Could not load");
    expect(hook.rows).toBeNull();
  });

  it("copes with an older backend's answer", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue(null);
    await mount();
    expect(hook.error).toContain("Could not load");
  });

  it("says why the page can't be read", async () => {
    vi.mocked(scanTab).mockRejectedValue(new Error("Cannot access contents of the page"));
    await mount();
    expect(hook.error).toContain("can't read this page");
    expect(hook.error).toContain("Cannot access contents of the page");
  });

  it("doesn't blame the page when its own review fails", async () => {
    const oldScript = field("a", "Favourite colour") as Partial<TabField>;
    delete oldScript.clues;
    vi.mocked(scanTab).mockResolvedValue(page([oldScript as TabField]));
    await mount();
    expect(hook.error).toContain("couldn't work out this form");
    expect(hook.error).not.toContain("can't read this page");
  });

  it("clears the error once a retry works", async () => {
    vi.mocked(scanTab).mockRejectedValueOnce(new Error("Cannot access"));
    await mount();
    expect(hook.error).not.toBe("");
    await run(() => hook.rescan());
    expect(hook.error).toBe("");
    expect(hook.rows).toHaveLength(2);
  });

  it("notes an empty bank and unreadable frames", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue([]);
    vi.mocked(scanTab).mockResolvedValue({ ...page([field("a", "Email")]), unreadableFrames: 2 });
    await mount();
    expect(hook.bankEmpty).toBe(true);
    expect(hook.unreadableFrames).toBe(2);
  });

  it("rescans on a single-page route change, once for a burst", async () => {
    await mount();
    vi.mocked(scanTab).mockClear();
    await act(async () => {
      fake.webNavigation.onHistoryStateUpdated.fire({ tabId: 7, frameId: 0 });
      fake.webNavigation.onHistoryStateUpdated.fire({ tabId: 7, frameId: 0 });
    });
    await wait(560);
    expect(scanTab).toHaveBeenCalledTimes(1);
  });

  it("ignores other tabs and inner frames", async () => {
    await mount();
    vi.mocked(scanTab).mockClear();
    await act(async () => {
      fake.webNavigation.onCompleted.fire({ tabId: 8, frameId: 0 });
      fake.webNavigation.onCompleted.fire({ tabId: 7, frameId: 2 });
    });
    await wait(560);
    expect(scanTab).not.toHaveBeenCalled();
  });

  it("stops listening when it closes", async () => {
    await mount();
    await act(async () => { root.unmount(); });
    expect(fake.webNavigation.onCompleted.listeners.size).toBe(0);
    await mount();
  });
});

describe("the job check", () => {
  it("pauses Autofill on a page for another job", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email")], elsewhere));
    await mount();
    expect(hook.needsConfirmation).toBe(true);
    expect(hook.host).toBe("other.test");
    await run(() => hook.autofill());
    expect(fillField).not.toHaveBeenCalled();
  });

  it("lets the BDE carry on after confirming the host", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email")], elsewhere));
    await mount({ ...connection, confirmedHosts: ["other.test"] });
    expect(hook.needsConfirmation).toBe(false);
    await run(() => hook.autofill());
    expect(fillField).toHaveBeenCalled();
  });
});

describe("autofill", () => {
  it("fills every ready field and reports it", async () => {
    await mount();
    await run(() => hook.autofill());
    expect(fillField).toHaveBeenCalledTimes(2);
    expect(fillField).toHaveBeenCalledWith(7, 0, { scanId: 1, fieldId: "a", current: "", write: { type: "text", value: "priya@example.test" } });
    expect(hook.outcome).toEqual({ filled: 2, handedBack: 0, stopped: false });
    expect(hook.filling).toBe(false);
  });

  it("runs once when clicked twice", async () => {
    await mount();
    await run(async () => { await Promise.all([hook.autofill(), hook.autofill()]); });
    expect(fillField).toHaveBeenCalledTimes(2);
  });

  it("uses the dropdown path for a custom dropdown, searching on the city alone", async () => {
    vi.mocked(getResumeAnswers).mockResolvedValue([custom("Current location", "Phoenix, AZ")]);
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Location (City)", "combobox")]));
    await mount();
    await run(() => hook.autofill());
    expect(fillChoice).toHaveBeenCalledWith(7, 0, { scanId: 1, fieldId: "a", current: "", search: "Phoenix" }, "Phoenix, AZ", undefined);
    expect(fillField).not.toHaveBeenCalled();
  });

  it("reports a field the form refused, and carries on", async () => {
    vi.mocked(fillField).mockResolvedValueOnce({ status: "failed", current: "" });
    await mount();
    await run(() => hook.autofill());
    expect(hook.outcome).toEqual({ filled: 1, handedBack: 1, stopped: false });
  });

  it("explains a dropdown with no matching option", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Do you need sponsorship?", "combobox")]));
    vi.mocked(fillChoice).mockResolvedValue({ status: "no-match", current: "" });
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]!.reason).toContain("None of the form's options");
  });

  it("says which options fit when there are several", async () => {
    const reason = "This answer fits East Asian and South Asian. Pick the right one yourself.";
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Do you need sponsorship?", "combobox")]));
    vi.mocked(fillChoice).mockResolvedValue({ status: "no-match", current: "", reason });
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason });
  });

  it("stops at once if the form changes underneath it", async () => {
    vi.mocked(fillField).mockResolvedValueOnce({ status: "stale", current: "" });
    await mount();
    await run(() => hook.autofill());
    expect(fillField).toHaveBeenCalledTimes(1);
    expect(hook.outcome).toMatchObject({ filled: 0, stopped: true });
  });

  it("treats a lost page mid-run as a stop, not a crash", async () => {
    vi.mocked(fillField).mockRejectedValueOnce(new Error("Frame removed"));
    await mount();
    await run(() => hook.autofill());
    expect(hook.outcome?.stopped).toBe(true);
  });

  it("catches a value the page reset once the run settled", async () => {
    vi.mocked(rejectedFields).mockResolvedValue(["a"]);
    await mount();
    await run(() => hook.autofill());
    expect(rejectedFields).toHaveBeenCalledWith(7, 0, 1, ["a", "b"]);
    expect(hook.outcome).toEqual({ filled: 1, handedBack: 1, stopped: false });
  });

  it("rescans afterwards to show what the page now holds", async () => {
    await mount();
    vi.mocked(scanTab).mockClear();
    await run(() => hook.autofill());
    expect(scanTab).toHaveBeenCalledTimes(1);
  });
});

describe("the refill loop", () => {
  it("doesn't offer a field again when the form reformats what was filled", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "PRIYA@EXAMPLE.TEST"), field("b", "City", "text", "Phoenix, Arizona")]));
    await run(() => hook.autofill());
    expect(statuses()).toEqual([["a", "same"], ["b", "same"]]);
    expect(hook.fillCount).toBe(0);
    vi.mocked(fillField).mockClear();
    await run(() => hook.autofill());
    expect(fillField).not.toHaveBeenCalled();
  });

  it("leaves a value alone once the BDE has changed it", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "PRIYA@EXAMPLE.TEST"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "someone@else.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.rescan());
    expect(statuses()![0]).toEqual(["a", "same"]);
    expect(hook.fillCount).toBe(0);
  });

  it("offers it again if the BDE empties it", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "PRIYA@EXAMPLE.TEST"), field("b", "City")]));
    await run(() => hook.autofill());
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", ""), field("b", "City")]));
    await run(() => hook.rescan());
    expect(statuses()![0]).toEqual(["a", "ready"]);
  });

  it("hands a field the page reset to the BDE", async () => {
    vi.mocked(rejectedFields).mockResolvedValue(["a"]);
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "x"), field("b", "City")]));
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The page reset this value." });
  });

  it("hands a field the form flagged to the BDE", async () => {
    vi.mocked(flaggedFields).mockResolvedValue(["a"]);
    await mount();
    await run(() => hook.autofill());
    expect(flaggedFields).toHaveBeenCalledWith(7, 0, 1, ["a", "b"]);
    expect(hook.outcome).toEqual({ filled: 1, handedBack: 1, stopped: false });
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The form flagged this value." });
    expect(hook.rows![0]!.write).toBeUndefined();
  });

  it("counts a field once when the page reset it", async () => {
    vi.mocked(rejectedFields).mockResolvedValue(["a"]);
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The page reset this value." });
    expect(hook.outcome?.handedBack).toBe(1);
  });

  it("still fills when the form can't be asked", async () => {
    vi.mocked(flaggedFields).mockRejectedValue(new Error("frame gone"));
    await mount();
    await run(() => hook.autofill());
    expect(hook.outcome).toEqual({ filled: 2, handedBack: 0, stopped: false });
  });

  const failOnce = () => vi.mocked(fillField).mockResolvedValueOnce({ status: "failed", current: "" });
  const scanned = (scanId: number): TabScan => ({ ...page([field("a", "Email"), field("b", "City")]), scanIds: new Map([[0, scanId]]) });

  it("hands a field it couldn't fill to the BDE", async () => {
    failOnce();
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The form didn't accept this value.", proposed: "priya@example.test" });
    expect(hook.rows![0]!.write).toBeUndefined();
    expect(hook.fillCount).toBe(0);
  });

  it("keeps it with the BDE through a rescan, an undo and a tab switch", async () => {
    failOnce();
    vi.mocked(undoFills).mockResolvedValue({ restored: 1, kept: 0, skipped: 0 });
    await mount();
    await run(() => hook.autofill());
    await run(() => hook.rescan());
    expect(hook.rows![0]!.status).toBe("manual");
    await run(() => hook.undo());
    expect(hook.rows![0]!.status).toBe("manual");
    await act(async () => { root.unmount(); });
    await mount();
    expect(hook.rows![0]!.status).toBe("manual");
  });

  it("offers it again once the page loads afresh", async () => {
    failOnce();
    vi.mocked(scanTab).mockResolvedValue(scanned(4));
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]!.status).toBe("manual");
    vi.mocked(scanTab).mockResolvedValue(scanned(1));
    await run(() => hook.rescan());
    expect(hook.rows![0]!.status).toBe("ready");
  });

  it("hands back a field that came back empty after filling", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The page reset this value." });
    expect(hook.rows![1]!.status).toBe("same");
  });
});

describe("undo", () => {
  it("reports what it restored and offers the fields again", async () => {
    vi.mocked(undoFills).mockResolvedValue({ restored: 2, kept: 0, skipped: 0 });
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "PRIYA@EXAMPLE.TEST"), field("b", "City")]));
    await run(() => hook.autofill());
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "PRIYA@EXAMPLE.TEST"), field("b", "City")]));
    await run(() => hook.undo());
    expect(hook.undoNote).toBe("Restored 2 fields.");
    expect(statuses()![0]).toEqual(["a", "ready"]);
  });

  it("says what it kept and couldn't clear", async () => {
    vi.mocked(undoFills).mockResolvedValue({ restored: 1, kept: 2, skipped: 1 });
    await mount();
    await run(() => hook.undo());
    expect(hook.undoNote).toBe("Restored 1 field. Kept 2 fields you changed. 1 dropdown couldn't be cleared, so change that on the page.");
  });

  it("says when the page has moved on", async () => {
    vi.mocked(undoFills).mockRejectedValue(new Error("gone"));
    await mount();
    await run(() => hook.undo());
    expect(hook.undoNote).toContain("Could not undo");
  });
});

const typed = (...values: [string, string][]) => vi.mocked(readTab).mockResolvedValue({ values: new Map(values), moved: false });

async function finalForm() {
  let form: AppliedForm = { fields: [] };
  await run(async () => { form = await hook.finalForm(); });
  return form;
}

describe("the list as it fills", () => {
  const paused = () => {
    let finish: (result: FillResult) => void = () => undefined;
    vi.mocked(fillField)
      .mockResolvedValueOnce({ status: "filled", current: "priya@example.test" })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    return (result: FillResult) => finish(result);
  };

  it("ticks each field as soon as it's filled, before the run ends", async () => {
    const finish = paused();
    await mount();
    let done = Promise.resolve();
    await act(async () => { done = hook.autofill(); });
    expect(hook.filling).toBe(true);
    expect(hook.rows![0]).toMatchObject({ status: "same", field: { current: "priya@example.test" } });
    expect(hook.rows![1]).toMatchObject({ status: "ready", field: { current: "" } });
    expect(hook.outcome).toBeNull();
    await act(async () => { finish({ status: "filled", current: "Phoenix" }); await done; });
    expect(hook.filling).toBe(false);
    expect(hook.outcome).toEqual({ filled: 2, handedBack: 0, stopped: false });
  });

  it("shows a field it couldn't fill as soon as it knows", async () => {
    vi.mocked(fillField).mockResolvedValueOnce({ status: "failed", current: "" });
    const blocked = new Promise<FillResult>(() => undefined);
    vi.mocked(fillField).mockReturnValueOnce(blocked);
    await mount();
    await act(async () => { void hook.autofill(); });
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The form didn't accept this value." });
    expect(hook.rows![0]!.write).toBeUndefined();
  });

  it("keeps filling the fields it set out to", async () => {
    await mount();
    await run(() => hook.autofill());
    expect(vi.mocked(fillField).mock.calls.map(([, , request]) => request.fieldId)).toEqual(["a", "b"]);
  });
});

describe("following the form", () => {
  const fieldsWithNoAnswer = () => page([field("n", "Nickname"), field("a", "Email")]);

  it("ticks a field the BDE filled by hand", async () => {
    vi.mocked(scanTab).mockResolvedValue(fieldsWithNoAnswer());
    await mount();
    expect(hook.rows![0]).toMatchObject({ status: "manual", field: { current: "" } });
    typed(["0:n", "Pri"], ["0:a", ""]);
    await finalForm();
    expect(hook.rows![0]).toMatchObject({ status: "manual", field: { current: "Pri" } });
  });

  it("leaves what the BDE typed out of the next Autofill", async () => {
    await mount();
    typed(["0:a", "mine@example.test"], ["0:b", ""]);
    await finalForm();
    expect(statuses()).toEqual([["a", "same"], ["b", "ready"]]);
    expect(hook.fillCount).toBe(1);
    await run(() => hook.autofill());
    expect(vi.mocked(fillField).mock.calls.map(([, , request]) => request.fieldId)).toEqual(["b"]);
  });

  it("remembers that through a tab switch", async () => {
    await mount();
    await act(async () => { root.unmount(); });
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "mine@example.test"), field("b", "City")]));
    await mount();
    expect(statuses()).toEqual([["a", "same"], ["b", "ready"]]);
  });

  it("takes back a field it handed over once the BDE fills it", async () => {
    vi.mocked(fillField).mockResolvedValueOnce({ status: "failed", current: "" });
    await mount();
    await run(() => hook.autofill());
    expect(hook.rows![0]).toMatchObject({ status: "manual", reason: "The form didn't accept this value." });
    typed(["0:a", "mine@example.test"], ["0:b", ""]);
    await finalForm();
    expect(hook.rows![0]!.status).toBe("same");
  });

  it("offers a field again when the BDE empties it", async () => {
    await mount();
    typed(["0:a", "mine@example.test"]);
    await finalForm();
    typed(["0:a", ""]);
    await finalForm();
    expect(statuses()![0]).toEqual(["a", "ready"]);
  });

  it("doesn't count what BenchQ wrote as the BDE's", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "priya@example.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    vi.mocked(undoFills).mockResolvedValue({ restored: 2, kept: 0, skipped: 0 });
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "old@example.test"), field("b", "City")]));
    await run(() => hook.undo());
    expect(statuses()).toEqual([["a", "ready"], ["b", "ready"]]);
  });

  it("keeps no copy of a field it never fills", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("s", "Social security number", "text", "123-45-6789"), field("a", "Email")]));
    await mount();
    typed(["0:s", "000-00-0000"], ["0:a", ""]);
    await finalForm();
    expect(statuses()).toEqual([["s", "blocked"], ["a", "ready"]]);
    expect(hook.rows![0]!.field.current).toBe("000-00-0000");
  });

  it("leaves the rows alone when nothing changed", async () => {
    await mount();
    const before = hook.rows;
    typed(["0:a", ""], ["0:b", ""]);
    await finalForm();
    expect(hook.rows).toBe(before);
  });

  it("scans by itself when the form changes shape, with the answers it already has", async () => {
    await mount();
    vi.mocked(scanTab).mockClear();
    vi.mocked(getResumeAnswers).mockClear();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email"), field("b", "City"), field("c", "Do you need sponsorship?")]));
    vi.mocked(readTab).mockResolvedValue({ values: new Map(), moved: true });
    await finalForm();
    expect(scanTab).toHaveBeenCalledTimes(1);
    expect(getResumeAnswers).not.toHaveBeenCalled();
    expect(hook.rows).toHaveLength(3);
  });

  it("copes with a page it can't reach", async () => {
    await mount();
    vi.mocked(readTab).mockRejectedValue(new Error("No tab"));
    await finalForm();
    expect(hook.error).toBe("");
    expect(hook.rows).toHaveLength(2);
  });

  it("waits for a run to finish", async () => {
    vi.mocked(fillField).mockReturnValue(new Promise(() => undefined));
    await mount();
    await act(async () => { void hook.autofill(); });
    vi.mocked(readTab).mockClear();
    await finalForm();
    expect(readTab).not.toHaveBeenCalled();
  });

  it("waits for a first scan that hasn't worked", async () => {
    vi.mocked(scanTab).mockRejectedValue(new Error("Cannot access"));
    await mount();
    await finalForm();
    expect(readTab).not.toHaveBeenCalled();
  });
});

describe("the regular check", () => {
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  async function mountWithFakeTimers() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness value={connection} />); });
    await advance(1);
  }

  afterEach(() => {
    vi.useRealTimers();
    delete (document as { visibilityState?: string }).visibilityState;
  });

  it("looks at the form every two seconds", async () => {
    await mountWithFakeTimers();
    expect(readTab).not.toHaveBeenCalled();
    await advance(2000);
    expect(readTab).toHaveBeenCalledTimes(1);
    expect(readTab).toHaveBeenCalledWith(7, expect.objectContaining({ unreadableFrames: 0 }));
    await advance(2000);
    expect(readTab).toHaveBeenCalledTimes(2);
  });

  it("shows what changed without being asked", async () => {
    await mountWithFakeTimers();
    typed(["0:a", "mine@example.test"], ["0:b", ""]);
    await advance(2000);
    expect(hook.rows![0]!.field.current).toBe("mine@example.test");
  });

  it("doesn't overlap: the next look waits for this one", async () => {
    await mountWithFakeTimers();
    vi.mocked(readTab).mockReturnValue(new Promise(() => undefined));
    await advance(10000);
    expect(readTab).toHaveBeenCalledTimes(1);
  });

  it("doesn't let a page that won't answer hold up Mark applied", async () => {
    await mountWithFakeTimers();
    vi.mocked(readTab).mockReturnValue(new Promise(() => undefined));
    let form: AppliedForm | null = null;
    void hook.finalForm().then((found) => { form = found; });
    await advance(3999);
    expect(form).toBeNull();
    await advance(1);
    expect(form).toEqual({ fields: [] });
  });

  it("rests while the panel can't be seen", async () => {
    await mountWithFakeTimers();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await advance(6000);
    expect(readTab).not.toHaveBeenCalled();
    delete (document as { visibilityState?: string }).visibilityState;
    await advance(2000);
    expect(readTab).toHaveBeenCalledTimes(1);
  });

  it("stops when it closes", async () => {
    await mountWithFakeTimers();
    await act(async () => { root.unmount(); });
    await advance(6000);
    expect(readTab).not.toHaveBeenCalled();
    vi.useRealTimers();
    await mount();
  });
});

describe("the form for Mark applied", () => {
  it("says who filled what", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email"), field("n", "Nickname")]));
    await mount();
    vi.mocked(fillField).mockResolvedValue({ status: "filled", current: "priya@example.test" });
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "priya@example.test"), field("n", "Nickname")]));
    await run(() => hook.autofill());
    typed(["0:a", "priya@example.test"], ["0:n", "Pri"]);
    expect((await finalForm()).fields).toEqual([
      { label: "Email", value: "priya@example.test", required: false, source: "autofill" },
      { label: "Nickname", value: "Pri", required: false, source: "bde" },
    ]);
  });

  it("calls a fix to what BenchQ filled the BDE's", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "priya@example.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    typed(["0:a", "priya@work.test"], ["0:b", "Phoenix"]);
    expect((await finalForm()).fields.map(({ value, source }) => [value, source])).toEqual([["priya@work.test", "bde"], ["Phoenix", "autofill"]]);
  });

  it("carries the form's required flag", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([{ ...field("n", "Nickname", "text", "Pri"), required: true }]));
    await mount();
    expect((await finalForm()).fields[0]!.required).toBe(true);
  });

  it("keeps every page of the form", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("n", "Nickname", "text", "Pri")]));
    await mount();
    vi.mocked(scanTab).mockResolvedValue({ ...page([field("c", "Cover note", "text", "Hello")]), scanIds: new Map([[0, 2]]) });
    await run(() => hook.rescan());
    expect((await finalForm()).fields.map(({ label }) => label)).toEqual(["Nickname", "Cover note"]);
  });

  it("keeps it through a page load, a tab switch and a form that has gone", async () => {
    vi.mocked(scanTab).mockResolvedValue({ ...page([field("n", "Nickname", "text", "Pri")]), scanIds: new Map([[0, 3]]) });
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([]));
    await run(() => hook.rescan());
    await act(async () => { root.unmount(); });
    await mount();
    vi.mocked(readTab).mockRejectedValue(new Error("No tab"));
    expect((await finalForm()).fields.map(({ value }) => value)).toEqual(["Pri"]);
  });

  it("shares it between the tabs of one job", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("n", "Nickname", "text", "Pri")]));
    await mount();
    await act(async () => { root.unmount(); });
    vi.mocked(scanTab).mockResolvedValue(page([field("c", "Cover note", "text", "Hello")]));
    await mount({ ...connection, tabId: 8 });
    expect((await finalForm()).fields.map(({ label }) => label)).toEqual(["Nickname", "Cover note"]);
  });

  it("keeps it apart from another job's", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("n", "Nickname", "text", "Pri")]));
    await mount();
    await act(async () => { root.unmount(); });
    vi.mocked(scanTab).mockResolvedValue(page([]));
    await mount({ ...connection, applicationId: "app-2" });
    expect((await finalForm()).fields).toEqual([]);
  });

  it("takes in the latest change as it marks the job applied", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("n", "Nickname", "text", "Pri")]));
    await mount();
    typed(["0:n", "Priya"]);
    expect((await finalForm()).fields.map(({ value }) => value)).toEqual(["Priya"]);
  });

  it("drops what the BDE emptied and what Undo took back", async () => {
    await mount();
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email", "text", "priya@example.test"), field("b", "City", "text", "Phoenix")]));
    await run(() => hook.autofill());
    typed(["0:a", ""], ["0:b", "Phoenix"]);
    expect((await finalForm()).fields.map(({ label }) => label)).toEqual(["City"]);
    vi.mocked(undoFills).mockResolvedValue({ restored: 1, kept: 0, skipped: 0 });
    vi.mocked(scanTab).mockResolvedValue(page([field("a", "Email"), field("b", "City")]));
    await run(() => hook.undo());
    typed();
    expect((await finalForm()).fields).toEqual([]);
  });

  it("leaves out what must never be stored, and an upload is only its name", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([
      field("s", "Social security number", "text", "123-45-6789"), field("d", "Date of birth", "date", "1990-01-01"),
      field("c", "Credit card number", "text", "4111111111111111"), field("x", "Signature", "text", "Priya"),
      field("g", "Gender", "text", "Female"), field("r", "Resume", "file", "priya.pdf"), field("n", "Nickname", "text", "Pri"),
    ]));
    await mount();
    expect((await finalForm()).fields.map(({ label, value }) => [label, value])).toEqual([["Resume", "priya.pdf"], ["Nickname", "Pri"]]);
  });

  it("is empty when the form couldn't be read, so Mark applied still works", async () => {
    vi.mocked(scanTab).mockRejectedValue(new Error("Cannot access"));
    await mount();
    expect(await finalForm()).toEqual({ fields: [] });
  });

  it("goes with the rest at sign-out", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([field("n", "Nickname", "text", "Pri")]));
    await mount();
    forgetTabs();
    vi.mocked(readTab).mockRejectedValue(new Error("No tab"));
    expect(await finalForm()).toEqual({ fields: [] });
  });
});

describe("the picked résumé's file (07 Q49–Q52)", () => {
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const pdf = { mimeType: "application/pdf", data: "JVBERi0=" };
  const NAME = "Priya Shah - Java Developer.pdf";
  const upload = (current = "") => field("r", "Resume/CV", "file", current);

  afterEach(() => { vi.useRealTimers(); });

  it("goes on first, and the answers go on once the form is still, over what the site read from it", async () => {
    vi.mocked(getResumeFile).mockResolvedValue(pdf);
    vi.mocked(scanTab).mockResolvedValue(page([upload(), field("a", "Email")], onSite));
    vi.mocked(fillField).mockImplementation(async (_tab, _frame, { write }) => {
      // The site reads the file and fills the email itself, as Lever does.
      if (write.type === "file") vi.mocked(scanTab).mockResolvedValue(page([upload(NAME), field("a", "Email", "text", "site@parsed.test")], onSite));
      return { status: "filled", current: write.type === "file" ? NAME : write.type === "text" ? write.value : "" };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness value={connection} />); });
    await advance(1);
    expect(hook.attachment).toBe(NAME);
    expect(statuses()).toEqual([["r", "ready"], ["a", "ready"]]);
    const running = hook.autofill();
    await advance(500 * 24);
    await act(async () => { await running; });
    const requests = vi.mocked(fillField).mock.calls.map(([, , request]) => request);
    expect(requests).toEqual([
      { scanId: 1, fieldId: "r", current: "", write: { type: "file", name: NAME, ...pdf } },
      { scanId: 1, fieldId: "a", current: "site@parsed.test", write: { type: "text", value: "priya@example.test" } },
    ]);
    const answered = vi.mocked(fillField).mock.invocationCallOrder[1]!;
    // Five looks at least (2 s), still for three, before the answers go on.
    expect(vi.mocked(readTab).mock.invocationCallOrder.filter((order) => order < answered).length).toBeGreaterThanOrEqual(5);
    expect(hook.outcome).toEqual({ filled: 2, handedBack: 0, stopped: false });
    // The panel keeps the attached file's name, for when the site swaps its input for a chip (07 Q53); Undo forgets it.
    expect(hook.attachedFile).toBe(NAME);
    vi.mocked(undoFills).mockResolvedValue({ restored: 2, kept: 0, skipped: 0 });
    await act(async () => { const undoing = hook.undo(); await vi.advanceTimersByTimeAsync(500 * 24); await undoing; });
    expect(hook.attachedFile).toBeNull();
  });

  it("goes on with the answers when the page swapped its upload out, and leaves that upload to the BDE", async () => {
    vi.mocked(getResumeFile).mockResolvedValue(pdf);
    vi.mocked(scanTab).mockResolvedValue(page([upload(), field("a", "Email")], onSite));
    vi.mocked(fillField).mockImplementation(async (_tab, _frame, { write }) =>
      (write.type === "file" ? { status: "stale", current: "" } : { status: "filled", current: write.type === "text" ? write.value : "" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness value={connection} />); });
    await advance(1);
    const running = hook.autofill();
    await advance(500 * 24);
    await act(async () => { await running; });
    expect(vi.mocked(fillField).mock.calls.map(([, , request]) => request.write.type)).toEqual(["file", "text"]);
    expect(hook.outcome).toEqual({ filled: 1, handedBack: 1, stopped: false });
    expect(hook.rows!.find(({ field: { id } }) => id === "r")).toMatchObject({ status: "manual", reason: "The page changed this upload, so change the file there." });
  });

  it("leaves a file that was on the form before BenchQ looked", async () => {
    vi.mocked(getResumeFile).mockResolvedValue(pdf);
    vi.mocked(scanTab).mockResolvedValue(page([upload("mine.pdf"), field("a", "Email")], onSite));
    await mount();
    expect(statuses()).toEqual([["r", "kept"], ["a", "ready"]]);
    expect(hook.fillCount).toBe(1);
  });

  it("is the BDE's to attach when the résumé has none, and is fetched once per version", async () => {
    vi.mocked(scanTab).mockResolvedValue(page([upload(), field("a", "Email")], onSite));
    await mount();
    expect(statuses()).toEqual([["r", "blocked"], ["a", "ready"]]);
    expect(hook.attachment).toBeNull();
    await run(() => hook.rescan());
    expect(getResumeFile).toHaveBeenCalledTimes(1);
    expect(getResumeFile).toHaveBeenCalledWith("firm-1", "cand-1", "res-1");
  });
});

describe("picking another résumé (07 Q24)", () => {
  type OnPage = { a: string; b: string };

  function formWith(onPage: OnPage) {
    vi.mocked(scanTab).mockImplementation(async () => page([field("a", "Email", "text", onPage.a), field("b", "City", "text", onPage.b)], onSite));
    vi.mocked(fillField).mockImplementation(async (_tab, _frame, { fieldId, write }) => {
      const value = write.type === "text" ? write.value : "";
      onPage[fieldId as keyof OnPage] = value;
      return { status: "filled", current: value };
    });
    vi.mocked(takeBackField).mockImplementation(async (_tab, _frame, { fieldId }) => {
      onPage[fieldId as keyof OnPage] = "";
      return true;
    });
  }

  it("reconsiders fields when the connected application changes, even with the same résumé id", async () => {
    const onPage = { source: "" };
    vi.mocked(scanTab).mockImplementation(async () => page([field("source", "How did you hear about us?", "text", onPage.source)], onSite));
    vi.mocked(fillField).mockImplementation(async (_tab, _frame, { write }) => {
      const value = write.type === "text" ? write.value : "";
      onPage.source = value;
      return { status: "filled", current: value };
    });
    const first = { ...connection, job: { ...connection.job, source: "linkedin_extension" } };
    await mount(first, "res-1");
    await run(() => hook.autofill());
    expect(onPage.source).toBe("LinkedIn");

    const next = { ...connection, applicationId: "app-2", job: { ...connection.job, source: "indeed" } };
    await act(async () => { root.render(<Harness value={next} resumeId="res-1" />); });
    await wait(5);
    expect(hook.reviewedFor).toEqual({ applicationId: "app-2", candidateId: "cand-1", resumeId: "res-1" });
    expect(hook.rows![0]).toMatchObject({ status: "ready", proposed: "Indeed" });
    expect(hook.fillCount).toBe(1);
  });

  it("takes back what the old one filled that the new one doesn't answer, then fills from the new one", async () => {
    vi.mocked(getResumeAnswers).mockImplementation(async (_firm, _candidate, resumeId) =>
      (resumeId === "res-2" ? [custom("Email", "priya@new.test")] : answers));
    const onPage: OnPage = { a: "", b: "" };
    formWith(onPage);
    await mount();
    await run(() => hook.autofill());
    expect(onPage).toEqual({ a: "priya@example.test", b: "Phoenix" });
    await pickResume("res-2");
    expect(hook.staleCount).toBe(1);
    await run(() => hook.autofill());
    expect(takeBackField).toHaveBeenCalledWith(7, 0, { scanId: 1, fieldId: "b" });
    expect(onPage).toEqual({ a: "priya@new.test", b: "" });
    expect(hook.staleCount).toBe(0);
  });

  it("leaves a value the BDE changed after BenchQ filled it", async () => {
    vi.mocked(getResumeAnswers).mockImplementation(async (_firm, _candidate, resumeId) =>
      (resumeId === "res-2" ? [custom("Email", "priya@new.test")] : answers));
    const onPage: OnPage = { a: "", b: "" };
    formWith(onPage);
    await mount();
    await run(() => hook.autofill());
    onPage.b = "Tempe";
    await pickResume("res-2");
    expect(hook.staleCount).toBe(0);
    await run(() => hook.autofill());
    expect(takeBackField).not.toHaveBeenCalled();
    expect(onPage.b).toBe("Tempe");
  });
});

describe("a site BenchQ may not read yet", () => {
  const employer = "https://careers.employer.test/job/1";
  const onFrames = () => fake.webNavigation.getAllFrames.mockResolvedValue([
    { frameId: 0, url: employer }, { frameId: 5, url: "https://ads.tracker.test/frame" },
  ]);
  const allowed = new Set<string>();
  beforeEach(() => {
    allowed.clear();
    fake.permissions.contains.mockImplementation(async ({ origins }) => origins.every((origin) => allowed.has(origin)));
    fake.permissions.request.mockImplementation(async ({ origins }) => { origins.forEach((origin) => allowed.add(origin)); return true; });
  });

  it("asks about the page's own site only, and doesn't scan until it's allowed", async () => {
    onFrames();
    await mount();
    expect(hook.needsAccess).toEqual({ origins: ["https://careers.employer.test/*"], host: "careers.employer.test" });
    expect(scanTab).not.toHaveBeenCalled();
    expect(hook.error).toBe("");
    expect(fake.permissions.request).not.toHaveBeenCalled();
  });

  it("scans the page once the BDE allows it", async () => {
    onFrames();
    await mount();
    await run(() => hook.allowAccess());
    expect(fake.permissions.request).toHaveBeenCalledWith({ origins: ["https://careers.employer.test/*"] });
    expect(hook.needsAccess).toBeNull();
    expect(scanTab).toHaveBeenCalledTimes(1);
    expect(hook.rows).not.toBeNull();
  });

  it("says so, and scans nothing, when the BDE says no", async () => {
    onFrames();
    fake.permissions.request.mockResolvedValue(false);
    await mount();
    await run(() => hook.allowAccess());
    expect(hook.isAccessDenied).toBe(true);
    expect(hook.needsAccess).not.toBeNull();
    expect(scanTab).not.toHaveBeenCalled();
  });

  it("never asks about a site it is already allowed on, as for every site before", async () => {
    onFrames();
    allowed.add("https://careers.employer.test/*");
    await mount();
    expect(hook.needsAccess).toBeNull();
    expect(scanTab).toHaveBeenCalledTimes(1);
  });

  it("leaves a page that isn't https alone", async () => {
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "http://careers.employer.test/job" }]);
    await mount();
    expect(hook.needsAccess).toBeNull();
    expect(fake.permissions.contains).not.toHaveBeenCalled();
  });
});
