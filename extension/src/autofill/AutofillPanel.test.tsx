// @vitest-environment jsdom
import { act, cloneElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../api";
import { installDialog } from "../test/dialog";
import { fakeChrome, type FakeChrome } from "../test/fake-chrome";
import AutofillPanel from "./AutofillPanel";
import { forgetOwnFiles } from "./own-files";
import type { AppliedForm, Connection, ReviewRow, TabField } from "./types";
import { useAutofill } from "./use-autofill";
import { useResumes, type ApplicationContextStatus, type Resumes } from "./use-resumes";
import { useTailoring, type Tailoring } from "./use-tailoring";

vi.mock("./use-autofill", () => ({ useAutofill: vi.fn() }));
vi.mock("./use-resumes", () => ({ useResumes: vi.fn() }));
vi.mock("./use-tailoring", async (actual) => ({ ...await actual<typeof import("./use-tailoring")>(), useTailoring: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installDialog();

const connection = {
  tabId: 7, applicationId: "app-1", candidateId: "cand-1", userId: "user-1", confirmedHosts: [],
  job: { title: "Java Developer", company: "Acme", url: "https://jobs.acme.test/1" },
} as Connection;

const form: AppliedForm = { fields: [{ label: "City", value: "Dallas", required: false, source: "bde" }] };

const finalForm = vi.fn(async () => form);
const autofill = vi.fn();

const holdsFile = vi.fn<(id: string) => boolean>(() => false);
const reviewed = {
  rows: [], scanning: false, error: "", filling: false, outcome: null, undoable: 0, fillCount: 0, needsConfirmation: false, unreadableFrames: 0,
  check: { conflict: false, detected: "" }, finalForm, autofill, holdsFile,
};

const row = (label: string, required: boolean, current = ""): ReviewRow => ({
  key: label, status: "manual", field: { label, required, current } as TabField,
});

/** The form's résumé upload, with the file Autofill attaches (withResumeFile). */
const upload = (): ReviewRow => ({
  key: "cv", status: "ready", field: { label: "Resume/CV", kind: "file", hints: "", required: true, current: "" } as TabField,
  proposed: "Priya - Java Developer.pdf", write: { type: "file", name: "Priya - Java Developer.pdf", mimeType: "application/pdf", data: "" },
});
/** The same upload with no file to attach. */
const emptyUpload = (): ReviewRow => ({ ...upload(), status: "blocked", proposed: undefined, write: undefined });

const base = { id: "res-2", label: "Base 1 · Java Developer · v2", meta: "Base 1 · v2", isTailored: false, isActive: true, title: "Java Developer", baseId: "base-1" };
const tailored = { id: "res-9", label: "Tailored for this job · from Base 1 · v1", meta: "From Base 1 · v1", isTailored: true, isActive: false, title: "Java Developer", baseId: "base-1" };
const pick = vi.fn();
const retry = vi.fn();
const refresh = vi.fn();
/** What Tailor reads: Base 1's version 1. */
const source = { resumeId: "res-1", baseId: "base-1", label: "Base 1 (Active)" };
const tailorStart = vi.fn();
const tailorDismiss = vi.fn();
let tailoring: Tailoring = { status: "idle" };
let refreshFailed = false;
const oneResume: Resumes = { status: "ready", choices: [base], picked: base };

let root: Root | null = null;
let host: HTMLElement;
let fake: FakeChrome;
let element: ReactElement<{ connection: Connection }>;

type State = {
  fillCount?: number; filling?: boolean; undoable?: number; rows?: ReviewRow[] | null; outcome?: { filled: number; handedBack: number; stopped: boolean } | null;
  answeredFrom?: string | null; needsConfirmation?: boolean; scanning?: boolean; attachment?: string | null; attachedFile?: string | null;
  attachmentSource?: "uploaded" | "generated" | "picked" | null; fileProblem?: boolean; rescan?: () => void;
  attachedShown?: boolean; refusedAccept?: string | null;
  step?: string | null; error?: string;
  needsAccess?: { origins: string[]; host: string } | null; isAccessDenied?: boolean;
  reviewedFor?: { applicationId: string; candidateId: string; resumeId: string | null; fileId?: string | null } | null;
};

function show(state: State, panel: { onApply?: (form: AppliedForm, resumeId: string | null) => void; isApplied?: boolean; applying?: boolean; details?: Application | null; applicationStatus?: ApplicationContextStatus; resumesUrl?: string | null; tabUrl?: string | null } = {}, resumes: Resumes = oneResume) {
  vi.mocked(useResumes).mockReturnValue({ resumes, pick, retry, refresh, refreshFailed, source });
  vi.mocked(useTailoring).mockReturnValue({ tailoring, start: tailorStart, dismiss: tailorDismiss });
  const applicationStatus = panel.applicationStatus ?? "ready";
  vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state, reviewedFor: state.reviewedFor ?? (applicationStatus === "ready" && resumes.status === "ready" ? { applicationId: connection.applicationId, candidateId: connection.candidateId, resumeId: resumes.picked?.id ?? null } : null) } as unknown as ReturnType<typeof useAutofill>);
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  element = <AutofillPanel connection={connection} firmId="firm-1" firmSlug="acme-staffing" candidateName="Priya" applying={false} isApplied={false} applicationStatus="ready" onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} {...panel} />;
  act(() => { root!.render(element); });
}

/** The panel again with what the hooks now say, as after the BDE's pick. */
function update(state: State, resumes: Resumes) {
  vi.mocked(useResumes).mockReturnValue({ resumes, pick, retry, refresh, refreshFailed, source });
  vi.mocked(useTailoring).mockReturnValue({ tailoring, start: tailorStart, dismiss: tailorDismiss });
  const appConnection = element.props.connection;
  vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state, reviewedFor: state.reviewedFor ?? (resumes.status === "ready" ? { applicationId: appConnection.applicationId, candidateId: appConnection.candidateId, resumeId: resumes.picked?.id ?? null } : null) } as unknown as ReturnType<typeof useAutofill>);
  // A copy, so React renders the panel again instead of keeping the one it has.
  element = cloneElement(element);
  act(() => { root!.render(element); });
}

const inBody = () => [...host.querySelectorAll<HTMLButtonElement>("[data-slot='autofill-body'] > button")];
const atBottom = () => [...host.querySelectorAll<HTMLButtonElement>("[data-slot='autofill-actions'] button")];
const named = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(({ textContent }) => textContent === name)!;
const click = (name: string) => act(async () => { named(name).click(); });

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host.remove();
  tailoring = { status: "idle" };
  refreshFailed = false;
  // The BDE's own file outlives the panel while the side panel is open: each test starts without one.
  forgetOwnFiles();
  vi.clearAllMocks();
});

describe("Autofill", () => {
  it("floats at the bottom of the panel, in reach however long the form, and gives no count", () => {
    show({ fillCount: 3, rows: [row("Email", true)] });
    expect(inBody()).toEqual([]);
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Autofill"]);
    expect(atBottom()[0]!.className).toContain("bq-primary");
    expect(host.querySelector("[data-slot='autofill-actions']")!.className).toContain("sticky");
  });

  it("runs when clicked", () => {
    show({ fillCount: 1 });
    act(() => { atBottom()[0]!.click(); });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("says it's filling during a run", () => {
    show({ fillCount: 3, filling: true });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Filling…"]);
    expect(atBottom()[0]!.disabled).toBe(true);
  });

  it("makes way for a summary of the run once it leaves nothing to fill", () => {
    show({ fillCount: 0, outcome: { filled: 3, handedBack: 0, stopped: false } });
    expect(inBody()).toEqual([]);
    expect(host.querySelector("[data-slot='autofill-done']")?.textContent).toBe("Filled 3");
    expect(host.querySelector("[data-slot='autofill-done']")?.className).toContain("text-caption");
  });

  it("isn't complete while there's more to fill", () => {
    show({ fillCount: 2, outcome: { filled: 3, handedBack: 0, stopped: true } });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Autofill"]);
    expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
  });

  it("isn't complete when nothing was filled, and leaves no note: the list shows what's left", () => {
    show({ fillCount: 0, rows: [row("Phone", true), row("City", true)], outcome: { filled: 0, handedBack: 2, stopped: false } });
    expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
    expect(host.querySelector("[data-slot='autofill-result']")).toBeNull();
  });

  it("leaves no way to rescan by hand: the panel does that itself", () => {
    show({ fillCount: 1, undoable: 1 });
    expect(host.textContent).not.toContain("Rescan");
  });
});

describe("the résumé the answers come from", () => {
  const picker = () => host.querySelector("[data-slot='resume-picker']")!;
  const twoResumes: Resumes = { status: "ready", choices: [tailored, base], picked: base };

  const select = () => picker().querySelector<HTMLButtonElement>("[data-slot='resume-select']")!;
  const open = () => act(async () => { select().click(); });
  const options = () => [...picker().querySelectorAll<HTMLButtonElement>("[data-slot='resume-option']")];
  /** Picks the résumé on row `index` of the open list. */
  const choose = (index: number) => act(async () => { options()[index]!.click(); });
  const press = (target: Element, key: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

  it("waits for the linked application before enabling fill or Mark applied", () => {
    show({ fillCount: 2, rows: [row("Email", true)] }, { onApply: vi.fn(), applicationStatus: "loading" }, { status: "loading" });
    expect(host.querySelector("[data-slot='autofill-run']")).toBeNull();
    expect(named("Mark applied")).toBeUndefined();
    expect(vi.mocked(useAutofill).mock.lastCall?.[0].resumeId).toBeUndefined();
  });

  it("asks to restore a missing named resume instead of using a fallback", () => {
    show({ fillCount: 2, rows: [row("Email", true)] }, { onApply: vi.fn() }, { status: "missing" });
    expect(host.textContent).toContain("The resume saved with this application is no longer available");
    expect(host.querySelector("[data-slot='autofill-run']")).toBeNull();
    expect(named("Mark applied")).toBeUndefined();
  });

  it("refills after a connected application changes and holds Mark applied until the new résumé is in sync", async () => {
    let finish!: () => void;
    autofill.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, reviewedFor: { applicationId: "app-1", candidateId: "cand-1", resumeId: base.id } }, { onApply: vi.fn() });
    expect(autofill).not.toHaveBeenCalled();

    vi.mocked(useAutofill).mockReturnValue({ ...reviewed, rows, fillCount: 1, reviewedFor: { applicationId: "app-1", candidateId: "cand-1", resumeId: base.id } } as unknown as ReturnType<typeof useAutofill>);
    vi.mocked(useResumes).mockReturnValue({ resumes: { status: "ready", choices: [base], picked: base }, pick, retry, refresh, refreshFailed, source });
    element = cloneElement(element, { connection: { ...connection, applicationId: "app-2" } });
    await act(async () => { root!.render(element); });

    expect(autofill).not.toHaveBeenCalled();
    expect(named("Mark applied")).toBeUndefined();
    vi.mocked(useAutofill).mockReturnValue({ ...reviewed, rows, fillCount: 1, reviewedFor: { applicationId: "app-2", candidateId: "cand-1", resumeId: base.id } } as unknown as ReturnType<typeof useAutofill>);
    element = cloneElement(element);
    await act(async () => { root!.render(element); });
    expect(autofill).toHaveBeenCalledTimes(1);
    expect(named("Mark applied")).toBeUndefined();
    await act(async () => { finish(); await Promise.resolve(); });
    expect(named("Mark applied")).toBeDefined();
  });

  it("keeps Mark applied available when a résumé was picked and the site then needed access: the queued fill waits, tracking doesn't", async () => {
    const access = { origins: ["https://careers.acme.test/*"], host: "careers.acme.test" };
    const reviewedForBase = { applicationId: "app-1", candidateId: "cand-1", resumeId: base.id };
    show({ fillCount: 1, rows: [row("Email", true)], reviewedFor: reviewedForBase }, { onApply: vi.fn() }, twoResumes);
    await open();
    await choose(0);
    expect(pick).toHaveBeenCalledWith(tailored.id);
    // The new résumé's review can't happen on a site BenchQ may not read: access is asked for, nothing is scanned.
    vi.mocked(useAutofill).mockReturnValue({ ...reviewed, rows: null, needsAccess: access, isAccessDenied: true, reviewedFor: null } as unknown as ReturnType<typeof useAutofill>);
    vi.mocked(useResumes).mockReturnValue({ resumes: { status: "ready", choices: [tailored, base], picked: tailored }, pick, retry, refresh, refreshFailed, source });
    element = cloneElement(element);
    await act(async () => { root!.render(element); });
    expect(host.querySelector("[data-slot='site-access']")).not.toBeNull();
    expect(named("Mark applied")).toBeDefined();
    expect(named("Mark applied").disabled).toBe(false);
    expect(autofill).not.toHaveBeenCalled();
    // Allowed later: the page is reviewed for the picked résumé, and the fill that was queued runs once.
    vi.mocked(useAutofill).mockReturnValue({ ...reviewed, rows: [row("Email", true)], fillCount: 1, reviewedFor: { ...reviewedForBase, resumeId: tailored.id } } as unknown as ReturnType<typeof useAutofill>);
    element = cloneElement(element);
    await act(async () => { root!.render(element); });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("shows the one résumé as a plain row, with a way to view it in BenchQ (07 Q55)", () => {
    show({ fillCount: 1 });
    expect(picker().querySelector("[data-slot='resume-picked']")!.textContent).toBe("Java Developer");
    expect(picker().textContent).toContain("Base 1 · v2");
    expect(picker().querySelector("a")!.getAttribute("href")).toContain("/acme-staffing/resumes/res-2");
    expect(picker().querySelectorAll("button")).toHaveLength(0);
  });

  it("says the one résumé is the only one, with a way to add another in BenchQ", () => {
    show({ fillCount: 1 }, { resumesUrl: "https://app.test/acme-staffing/candidates/cand-1?tab=resumes" });
    expect(picker().querySelector("[data-slot='resume-count']")!.textContent).toBe("1 resume");
    const only = picker().querySelector("[data-slot='resume-only']")!;
    expect(only.textContent).toBe("Only resumeViewAdd another in BenchQ");
    expect([...only.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "http://localhost:3000/acme-staffing/resumes/res-2", "https://app.test/acme-staffing/candidates/cand-1?tab=resumes"]);
    expect(picker().querySelector("[data-slot='resume-select']")).toBeNull();
  });

  it("says how many résumés there are to choose from, closed and open", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    expect(picker().querySelector("[data-slot='resume-count']")!.textContent).toBe("2 resumes");
    expect(select().querySelector("[data-slot='resume-change']")).not.toBeNull();
    expect(select().getAttribute("aria-label")).toBe(`Change the resume, 2 resumes to choose from. In use: ${base.label}`);
    expect(picker().querySelector("[data-slot='resume-only']")).toBeNull();
    await open();
    // The menu is named by the section's "Resume", with no title of its own (less to read).
    expect(picker().querySelector("[data-slot='resume-list-title']")).toBeNull();
    expect(document.getElementById(select().getAttribute("aria-controls")!)!.getAttribute("aria-labelledby")).toBe("resume-picker-title");
    // This job's tailored résumés, then the bases, each group named, and each group's list by its name.
    const groups = [...picker().querySelectorAll("[data-slot='resume-group-title']")];
    expect(groups.map(({ textContent }) => textContent)).toEqual(["Tailored for this job", "Base resumes"]);
    expect([...picker().querySelectorAll("[data-slot='resume-group'] ul")].map((list) => list.getAttribute("aria-labelledby"))).toEqual(groups.map(({ id }) => id));
  });

  it("names no group when there are only bases", async () => {
    show({ fillCount: 1 }, {}, { status: "ready", choices: [base, { ...base, id: "res-3", isActive: false, meta: "Base 2 · v1", baseId: "base-2" }], picked: base });
    await open();
    expect(picker().querySelector("[data-slot='resume-group-title']")).toBeNull();
    expect(picker().querySelector("[data-slot='resume-group'] ul")!.getAttribute("aria-labelledby")).toBe("resume-picker-title");
  });

  it("starts closed on the résumé in use; its ▾ opens one row per résumé, the one in use ticked, and Esc closes them", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    expect(select().getAttribute("aria-expanded")).toBe("false");
    expect(select().textContent).toContain("Java Developer");
    expect(picker().querySelectorAll("[data-slot='resume-choice']")).toHaveLength(0);
    await open();
    expect(select().getAttribute("aria-expanded")).toBe("true");
    expect(options().map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(options()[0]!.textContent).toContain("From Base 1 · v1");
    expect(picker().querySelector("button")).toBe(select());
    // No link on each row: one "View in BenchQ" at the menu's foot, for the résumé in use.
    expect([...picker().querySelectorAll("[data-slot='resume-choice'] a")]).toHaveLength(0);
    const view = picker().querySelector("[data-slot='resume-view']")!;
    expect([view.getAttribute("aria-label"), view.getAttribute("href")]).toEqual([`View ${base.label} in BenchQ`, "http://localhost:3000/acme-staffing/resumes/res-2"]);
    await press(options()[1]!, "Escape");
    expect(select().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(select());
  });

  it("opens on the résumé in use and moves through the list with the arrow keys", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    await press(select(), "ArrowDown");
    expect(document.activeElement).toBe(options()[1]);
    await press(options()[1]!, "ArrowUp");
    expect(document.activeElement).toBe(options()[0]);
    await press(options()[0]!, "End");
    expect(document.activeElement).toBe(options()[1]);
    await press(options()[1]!, "Home");
    expect(document.activeElement).toBe(options()[0]);
  });

  it("only closes the list when the résumé in use is chosen again", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    await open();
    await choose(1);
    expect(pick).not.toHaveBeenCalled();
    expect(picker().querySelectorAll("[data-slot='resume-choice']")).toHaveLength(0);
  });

  it("tags the base in use Active, as the website does, closed and in the list", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    const tag = select().querySelector("[data-slot='resume-active']")!;
    expect(tag.textContent).toBe("Active");
    // On the second line, after the base and version, so the role keeps the whole row.
    expect(tag.parentElement!.textContent).toBe("Base 1 · v2Active");
    expect(select().querySelector("[data-slot='resume-picked']")!.textContent).toBe("Java Developer");
    await open();
    const choices = [...picker().querySelectorAll("[data-slot='resume-choice']")];
    expect(choices.map((choice) => choice.querySelector("[data-slot='resume-active']")?.textContent ?? null)).toEqual([null, "Active"]);
    expect(choices[1]!.querySelector("[data-slot='resume-picked']")!.textContent).toBe("Java Developer");
  });

  it("tags a résumé tailored for this job Tailored, as the website does, closed and in the list", async () => {
    show({ fillCount: 1 }, {}, { ...twoResumes, picked: tailored });
    expect(select().querySelector("[data-slot='resume-tailored']")!.parentElement!.textContent).toBe("From Base 1 · v1Tailored");
    await open();
    const choices = [...picker().querySelectorAll("[data-slot='resume-choice']")];
    expect(choices.map((choice) => choice.querySelector("[data-slot='resume-tailored']")?.textContent ?? null)).toEqual(["Tailored", null]);
  });

  it("closes once a résumé is picked", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    await open();
    await choose(0);
    expect(pick).toHaveBeenCalledWith("res-9");
    expect(picker().querySelectorAll("[data-slot='resume-choice']")).toHaveLength(0);
  });

  it("fills the form as soon as the picked résumé's answers are in", async () => {
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, answeredFrom: "res-2" }, {}, twoResumes);
    await open();
    await choose(0);
    expect(pick).toHaveBeenCalledWith("res-9");
    expect(autofill).not.toHaveBeenCalled();
    update({ fillCount: 1, rows, answeredFrom: "res-9" }, { ...twoResumes, picked: tailored });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("only picks when the form isn't on the page yet", async () => {
    show({ fillCount: 0, rows: [], answeredFrom: "res-2" }, {}, twoResumes);
    await open();
    await choose(0);
    update({ fillCount: 0, rows: [], answeredFrom: "res-9" }, { ...twoResumes, picked: tailored });
    expect(autofill).not.toHaveBeenCalled();
  });

  it("only picks when the page may be a different job", async () => {
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, answeredFrom: "res-2" }, {}, twoResumes);
    await open();
    await choose(0);
    update({ fillCount: 1, rows, answeredFrom: "res-9", needsConfirmation: true }, { ...twoResumes, picked: tailored });
    expect(autofill).not.toHaveBeenCalled();
  });

  it("lets the BDE pick again when the picked résumé's answers can't load, and Try again still fills", async () => {
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, answeredFrom: "res-2" }, { onApply: vi.fn() }, twoResumes);
    await open();
    await choose(0);
    // While the pick waits for its answers, the list and Mark applied wait with it.
    expect(select().disabled).toBe(true);
    expect(named("Mark applied")).toBeUndefined();
    // They never came: the review in hand is still the old résumé's.
    const failed = "Could not load this resume's answers. Try again.";
    update({ fillCount: 1, rows, answeredFrom: "res-2", error: failed, reviewedFor: { applicationId: connection.applicationId, candidateId: connection.candidateId, resumeId: "res-2" } }, { ...twoResumes, picked: tailored });
    expect(select().disabled).toBe(false);
    expect(named("Mark applied")).toBeDefined();
    expect(autofill).not.toHaveBeenCalled();
    update({ fillCount: 1, rows, answeredFrom: "res-9" }, { ...twoResumes, picked: tailored });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("says when the candidate has no résumé yet", () => {
    show({ fillCount: 0, rows: [] }, {}, { status: "ready", choices: [], picked: null });
    expect(picker().textContent).toContain("Priya has no resume in BenchQ yet");
  });

  it("says when the résumés couldn't be loaded, with a way to try again", async () => {
    show({ fillCount: 0, rows: [] }, {}, { status: "error" });
    expect(picker().querySelector("[role='alert']")!.textContent).toContain("Could not load Priya's resumes");
    await click("Try again");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says it's loading them", () => {
    show({ fillCount: 0, rows: null }, {}, { status: "loading" });
    expect(picker().querySelector("[role='status']")!.textContent).toContain("Loading Priya's resumes");
  });

  it("names it as the one to attach by hand when BenchQ has no file for it", () => {
    const upload = { key: "cv", status: "manual", field: { label: "Resume/CV", kind: "file", hints: "", required: true, current: "" } } as unknown as ReviewRow;
    show({ fillCount: 0, rows: [upload] });
    expect(host.querySelector("[data-document='resume'] [data-slot='document-held']")!.textContent).toBe(`Attach by hand: ${base.label}`);
  });

  it("doesn't say a file is attached once the upload is gone and no chip names it (#148)", () => {
    show({ fillCount: 0, rows: [row("Email", true)], attachedFile: "Priya - Java Developer.pdf", attachedShown: false });
    // Nor shows a Resume or Cover letter section the form no longer asks for.
    expect(host.querySelector("[data-slot='document-attached']")).toBeNull();
    expect(host.querySelector("[data-slot='documents']")).toBeNull();
  });

  it("shows the file Autofill attached when the site swapped its upload for a chip (07 Q53)", () => {
    show({ fillCount: 0, rows: [row("Email", true)], attachedFile: "Priya - Java Developer.pdf", attachedShown: true });
    const resume = host.querySelector("[data-document='resume']")!;
    expect(resume.querySelector("[data-slot='document-status']")!.textContent).toBe("Attached");
    expect(resume.querySelector("[data-slot='document-attached'] [data-slot='document-value']")!.textContent).toBe("Priya - Java Developer.pdf");
    expect(resume.querySelector("[data-slot='document-attached']")!.textContent).toContain("Attached");
  });

  it("shows an upload's file in one line, then Attached and Go to field, with nothing else to say (07 Q56)", () => {
    const upload = { key: "cv", status: "same", field: { label: "Resume/CV", kind: "file", hints: "", required: true, current: "cv.pdf" } } as unknown as ReviewRow;
    show({ fillCount: 0, rows: [upload] });
    const resume = host.querySelector("[data-document='resume']")!;
    const file = resume.querySelector("[data-slot='document-attached']")!;
    expect([file.querySelector("[data-slot='document-value']")!.getAttribute("title"), file.textContent]).toEqual(["cv.pdf", "cv.pdfAttachedGo to field"]);
    expect(resume.querySelector("[data-slot='document-held']")).toBeNull();
    expect(resume.querySelector("a")).toBeNull();
  });

  it("offers Change resume on an attached résumé when there's another to pick, opening the picker's list", async () => {
    const upload = { key: "cv", status: "same", field: { label: "Resume/CV", kind: "file", hints: "", required: true, current: "cv.pdf" } } as unknown as ReviewRow;
    show({ fillCount: 0, rows: [upload] }, {}, twoResumes);
    const change = host.querySelector<HTMLButtonElement>("[data-document='resume'] [data-slot='document-change']")!;
    expect(change.textContent).toBe("Change resume");
    await act(async () => { change.click(); });
    expect(select().getAttribute("aria-expanded")).toBe("true");
    expect(options()).toHaveLength(2);
  });

  it("says Autofill attaches its file when BenchQ has one (07 Q49)", () => {
    show({ fillCount: 1, rows: [upload()], attachment: "Priya - Java Developer.pdf", answeredFrom: base.id });
    expect(host.querySelector("[data-document='resume'] [data-slot='document-held']")!.textContent).toBe("Autofill attaches: Priya - Java Developer.pdf");
    expect(host.querySelector("[data-slot='autofill-ready']")!.textContent).toBe("Ready to fill 1 field, the resume file first.");
  });

  it("doesn't promise the file first when the form's upload won't get it", () => {
    const kept = { ...upload(), status: "kept", field: { ...upload().field, current: "old.pdf" } } as ReviewRow;
    show({ fillCount: 1, rows: [kept, row("Email", true)], attachment: "Priya - Java Developer.pdf", answeredFrom: base.id });
    expect(host.querySelector("[data-slot='autofill-ready']")!.textContent).toBe("Ready to fill 1 field.");
  });

  it("says where the file comes from: made from the picked version, or as uploaded (docs/02 §8.2)", () => {
    show({ fillCount: 1, rows: [upload()], attachment: "Priya - Java Developer.pdf", attachmentSource: "generated", answeredFrom: base.id });
    expect(host.querySelector("[data-slot='resume-file-source']")!.textContent).toBe("Made from Base 1 · v2");
    update({ fillCount: 1, rows: [upload()], attachment: "Priya - Java Developer.pdf", attachmentSource: "uploaded", answeredFrom: base.id }, oneResume);
    expect(host.querySelector("[data-slot='resume-file-source']")!.textContent).toBe("Uploaded file");
  });

  it("takes a PDF or Word file from the computer in place of the résumé's own (Q5)", async () => {
    show({ fillCount: 1, rows: [upload()], attachment: "Priya - Java Developer.pdf", attachmentSource: "generated", answeredFrom: base.id });
    const input = host.querySelector<HTMLInputElement>("[data-slot='own-file-input']")!;
    expect(input.accept).toBe(".pdf,.doc,.docx");
    expect(named("Use a different file")).toBeTruthy();
    const choose = async (file: File) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await choose(new File(["x"], "photo.png"));
    expect(host.querySelector("[data-slot='own-file-error']")!.textContent).toBe("Pick a PDF or Word file.");
    await choose(new File(["%PDF-1.4"], "mine.pdf", { lastModified: 1 }));
    expect(vi.mocked(useAutofill).mock.lastCall![0].pickedFile)
      .toEqual({ name: "mine.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQ=", source: "picked", id: expect.stringMatching(/^own:/) });
    // Nothing filled while the pick was being read (#148).
    expect(vi.mocked(useAutofill).mock.calls.some(([options]) => options.isHeld === true)).toBe(true);
    expect(vi.mocked(useAutofill).mock.lastCall![0].isHeld).toBe(false);
    expect(host.querySelector("[data-slot='own-file-error']")).toBeNull();
  });

  /** The BDE picks `file` with the Resume section's picker; the hooks then say `state`, with the review for that file. */
  async function pickOwn(state: State, file = new File(["%PDF-1.4"], "mine.pdf", { lastModified: 1 })) {
    const input = host.querySelector<HTMLInputElement>("[data-slot='own-file-input']")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    update({ ...state, reviewedFor: reviewedForOwn() }, oneResume);
  }
  /** The review for the file the BDE picked last, as the hook would report it. */
  const reviewedForOwn = () => ({ applicationId: connection.applicationId, candidateId: connection.candidateId, resumeId: base.id,
    fileId: vi.mocked(useAutofill).mock.lastCall![0].pickedFile?.id ?? null });
  const generated = { fillCount: 1, rows: [upload()], attachment: "Priya - Java Developer.pdf", attachmentSource: "generated" as const, answeredFrom: base.id };

  it("names the BDE's own file and offers to take it off again", async () => {
    show(generated);
    await pickOwn({ ...generated, attachmentSource: "picked" });
    expect(host.querySelector("[data-slot='resume-file-source']")!.textContent).toBe("Your file");
    expect(host.querySelector("[data-slot='own-file-pick']")).toBeNull();
    await click("Remove");
    expect(vi.mocked(useAutofill).mock.lastCall![0].pickedFile).toBeNull();
  });

  it("still offers to stop using the BDE's own file once it's on the form, and where the site swapped the upload for a chip", async () => {
    show(generated);
    const attachedRow = { ...upload(), status: "same", field: { ...upload().field, current: "Priya - Java Developer.pdf" } } as ReviewRow;
    await pickOwn({ ...generated, fillCount: 0, rows: [attachedRow], attachmentSource: "picked" });
    expect(host.querySelector("[data-slot='resume-file-source']")!.textContent).toBe("Your file");
    expect(named("Remove")).toBeTruthy();
    update({ ...generated, fillCount: 0, rows: [row("Email", true, "a@example.test")], attachmentSource: "picked", attachedFile: "Priya - Java Developer.pdf",
      attachedShown: true, reviewedFor: reviewedForOwn() }, oneResume);
    expect(host.querySelector("[data-document='resume'] [data-slot='document-status']")!.textContent).toBe("Attached");
    expect(named("Remove")).toBeTruthy();
    // The upload gone with no chip either: Remove still shows, and nothing says a file goes on (#148).
    update({ ...generated, fillCount: 0, rows: [row("Email", true, "a@example.test")], attachmentSource: "picked", attachedFile: null,
      attachedShown: false, reviewedFor: reviewedForOwn() }, oneResume);
    expect(host.querySelector("[data-document='resume'] [data-slot='document-status']")!.textContent).toBe("No field found");
    expect(named("Remove")).toBeTruthy();
    expect(host.querySelector("[data-document='resume'] [data-slot='document-held']")).toBeNull();
  });

  it("keeps the BDE's own file when the panel is rebuilt, as on a switch to another tab and back (#148's review)", async () => {
    show(generated);
    await pickOwn({ ...generated, attachmentSource: "picked" });
    act(() => { root!.unmount(); });
    root = createRoot(host);
    act(() => { root!.render(cloneElement(element)); });
    expect(vi.mocked(useAutofill).mock.lastCall![0].pickedFile).toMatchObject({ name: "mine.pdf", source: "picked" });
    expect(host.querySelector("[data-slot='resume-file-source']")!.textContent).toBe("Your file");
    // Another candidate's panel has none of it.
    act(() => { root!.render(cloneElement(element, { connection: { ...connection, candidateId: "cand-2", applicationId: "app-2" } })); });
    expect(vi.mocked(useAutofill).mock.lastCall![0].pickedFile).toBeNull();
  });

  it("keeps holding fills for a pick still being read when the panel is rebuilt, and uses the file once read", async () => {
    show(generated);
    let finishRead: (buffer: ArrayBuffer) => void = () => undefined;
    const file = new File(["%PDF-1.4"], "slow.pdf", { lastModified: 2 });
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; }) });
    const input = host.querySelector<HTMLInputElement>("[data-slot='own-file-input']")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    act(() => { root!.unmount(); });
    root = createRoot(host);
    act(() => { root!.render(cloneElement(element)); });
    expect(vi.mocked(useAutofill).mock.lastCall![0].isHeld).toBe(true);
    await act(async () => {
      finishRead(new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vi.mocked(useAutofill).mock.lastCall![0]).toMatchObject({ isHeld: false, pickedFile: { name: "slow.pdf" } });
  });

  it("offers Use a different file on the card of a file BenchQ attached, never on one attached by hand (#148's review)", () => {
    const onForm = (name: string) => ({ ...upload(), status: "same", field: { ...upload().field, current: name } }) as ReviewRow;
    show({ ...generated, fillCount: 0, rows: [onForm("Priya - Java Developer.pdf")], attachedFile: "Priya - Java Developer.pdf" });
    expect(host.querySelector("[data-document='resume'] [data-slot='document-attached'] [data-slot='own-file-pick']")!.textContent).toBe("Use a different file");
    update({ ...generated, fillCount: 0, rows: [onForm("by-hand.pdf")], attachedFile: null }, oneResume);
    expect(host.querySelector("[data-slot='own-file-pick']")).toBeNull();
  });

  it("swaps a file picked in place of BenchQ's at once, and swaps back on Remove (#148's review)", async () => {
    const attachedRow = { ...upload(), status: "same", field: { ...upload().field, current: "Priya - Java Developer.pdf" } } as ReviewRow;
    const attached = { ...generated, rows: [attachedRow], attachedFile: "Priya - Java Developer.pdf" };
    show(attached);
    expect(autofill).not.toHaveBeenCalled();
    await pickOwn({ ...attached, fillCount: 1, attachmentSource: "picked" });
    expect(autofill).toHaveBeenCalledTimes(1);
    // The BDE's file is the one on the form now, under the résumé's file name: Remove knows it by its identity, and puts
    // the résumé's own back the same way.
    const ownId = vi.mocked(useAutofill).mock.lastCall![0].pickedFile!.id;
    holdsFile.mockImplementation((id) => id === ownId);
    update({ ...attached, fillCount: 0, attachedFile: "Priya - Java Developer.pdf", attachmentSource: "picked", reviewedFor: reviewedForOwn() }, oneResume);
    await click("Remove");
    expect(holdsFile).toHaveBeenCalledWith(ownId);
    update({ ...attached, fillCount: 1, reviewedFor: { applicationId: connection.applicationId, candidateId: connection.candidateId, resumeId: base.id, fileId: null } }, oneResume);
    expect(autofill).toHaveBeenCalledTimes(2);
    // A rebuilt panel doesn't swap the same pick again.
    act(() => { root!.unmount(); });
    root = createRoot(host);
    act(() => { root!.render(cloneElement(element)); });
    expect(autofill).toHaveBeenCalledTimes(2);
  });

  it("still swaps a pick read while the panel was rebuilt, as on a switch to another tab and back (#148's review)", async () => {
    const attachedRow = { ...upload(), status: "same", field: { ...upload().field, current: "Priya - Java Developer.pdf" } } as ReviewRow;
    const attached = { ...generated, rows: [attachedRow], attachedFile: "Priya - Java Developer.pdf", fillCount: 1 };
    show(attached);
    let finishRead: (buffer: ArrayBuffer) => void = () => undefined;
    const file = new File(["%PDF-1.4"], "slow.pdf", { lastModified: 3 });
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; }) });
    const input = host.querySelector<HTMLInputElement>("[data-slot='own-file-input']")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    act(() => { root!.unmount(); });
    root = createRoot(host);
    act(() => { root!.render(cloneElement(element)); });
    await act(async () => {
      finishRead(new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    update({ ...attached, attachmentSource: "picked", reviewedFor: reviewedForOwn() }, oneResume);
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("runs a swap though no answer is left to fill, and waits for the résumés before queuing one (#148's review)", async () => {
    // The site swapped its upload for a chip and every answer is in: the swap still runs Autofill, to take the old off.
    const done = { ...generated, fillCount: 0, rows: [row("Email", true, "a@example.test")], attachedFile: "Priya - Java Developer.pdf", attachedShown: true };
    show(done);
    let finishRead: (buffer: ArrayBuffer) => void = () => undefined;
    const file = new File(["%PDF-1.4"], "mine.pdf", { lastModified: 4 });
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; }) });
    const input = host.querySelector<HTMLInputElement>("[data-slot='document-attached'] [data-slot='own-file-input']")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    // The résumés load again while the file is read: the swap waits for them.
    update(done, { status: "loading" });
    await act(async () => {
      finishRead(new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(autofill).not.toHaveBeenCalled();
    update({ ...done, attachmentSource: "picked", reviewedFor: reviewedForOwn() }, oneResume);
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("says a picked file was refused though BenchQ's is on the form, which stays, with one chooser (#148's review)", async () => {
    const attachedRow = { ...upload(), status: "same", field: { ...upload().field, current: "Priya - Java Developer.pdf" } } as ReviewRow;
    const onForm = { ...generated, fillCount: 0, rows: [attachedRow], attachedFile: "Priya - Java Developer.pdf" };
    show(onForm);
    await pickOwn({ ...onForm, attachmentSource: "picked", refusedAccept: ".pdf" }, new File(["PK"], "mine.docx", { lastModified: 5 }));
    expect(host.querySelector("[data-slot='resume-file-refused']")!.textContent)
      .toBe("Your file, mine.docx, isn't a kind this form's upload takes (.pdf). The file already on the form stays. Use another file, or attach one by hand.");
    expect(named("Remove")).toBeTruthy();
    expect(host.querySelectorAll("[data-document='resume'] [data-slot='own-file-pick']")).toHaveLength(1);
  });

  it("shows why a file wasn't taken, though a file is already on the form (#148's review)", async () => {
    const attachedRow = { ...upload(), status: "same", field: { ...upload().field, current: "Priya - Java Developer.pdf" } } as ReviewRow;
    show({ ...generated, fillCount: 0, rows: [attachedRow], attachedFile: "Priya - Java Developer.pdf" });
    const input = host.querySelector<HTMLInputElement>("[data-document='resume'] [data-slot='document-attached'] [data-slot='own-file-input']")!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "photo.png")], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("[data-document='resume'] [data-slot='own-file-error']")!.textContent).toBe("Pick a PDF or Word file.");
    expect(host.querySelector("[data-slot='document-attached'] [data-slot='own-file-pick']")).not.toBeNull();
  });

  it("says when the form's upload won't take the file, and keeps the BDE's controls", async () => {
    show(generated);
    await pickOwn({ ...generated, rows: [emptyUpload()], attachment: null, attachmentSource: null, refusedAccept: ".docx" });
    expect(host.querySelector("[data-slot='resume-file-refused']")!.textContent)
      .toBe("Your file, mine.pdf, isn't a kind this form's upload takes (.docx). Use another file, or attach one by hand.");
    expect(named("Use a different file")).toBeTruthy();
    expect(named("Remove")).toBeTruthy();
  });

  it("says when the file couldn't be made, with Try again and a file from the computer", async () => {
    const rescan = vi.fn();
    show({ fillCount: 1, rows: [emptyUpload()], fileProblem: true, rescan, answeredFrom: base.id });
    expect(host.querySelector("[data-slot='resume-file-problem']")!.textContent).toBe("The resume file couldn't be made. Try again, or use a file from your computer.");
    expect(named("Use a file")).toBeTruthy();
    await click("Try again");
    expect(rescan).toHaveBeenCalledTimes(1);
  });
});

describe("the summary a run leaves", () => {
  it("names the résumé it attached, where the site shows it as a chip", () => {
    show({ fillCount: 0, rows: [row("Email", true, "a@example.test")], outcome: { filled: 2, handedBack: 0, stopped: false }, attachedFile: "Priya - Java Developer.pdf",
      attachedShown: true });
    expect(host.querySelector("[data-slot='autofill-done-file']")!.textContent).toBe("Resume attached: Priya - Java Developer.pdf");
    expect(host.querySelector("[data-slot='autofill-done-no-file']")).toBeNull();
  });

  it("warns when the résumé isn't on the form after the run, with the way to its field", () => {
    show({ fillCount: 0, rows: [emptyUpload(), row("Email", true, "a@example.test")], outcome: { filled: 1, handedBack: 0, stopped: false } });
    expect(host.querySelector("[data-slot='autofill-done']")!.textContent).toBe("Filled 1");
    expect(host.querySelector("[data-slot='autofill-done-no-file']")!.textContent).toContain("The resume isn't on the form yet. Attach it by hand.");
  });

  it("warns when the site took the upload away and no chip names the file (#148)", () => {
    show({ fillCount: 0, rows: [row("Email", true, "a@example.test")], outcome: { filled: 2, handedBack: 0, stopped: false }, attachedFile: "Priya - Java Developer.pdf" });
    expect(host.querySelector("[data-slot='autofill-done-file']")).toBeNull();
    expect(host.querySelector("[data-slot='autofill-done-no-file']")!.textContent).toBe("The resume isn't on the form yet. Attach it by hand.");
  });

  it("believes the form, not the earlier write: an upload the site cleared is still missing", () => {
    show({ fillCount: 0, rows: [emptyUpload(), row("Email", true, "a@example.test")], outcome: { filled: 2, handedBack: 1, stopped: false }, attachedFile: "Priya - Java Developer.pdf" });
    expect(host.querySelector("[data-slot='autofill-done-file']")).toBeNull();
    expect(host.querySelector("[data-slot='autofill-done-no-file']")).not.toBeNull();
  });

  it("counts what still needs the BDE and what the form already held", () => {
    const kept = { ...row("City", false, "Austin"), status: "kept" } as ReviewRow;
    show({ fillCount: 0, rows: [row("Phone", true), kept], outcome: { filled: 4, handedBack: 0, stopped: false } });
    expect(host.querySelector("[data-slot='autofill-done']")!.textContent).toBe("Filled 4 · 1 needs you · 1 kept as it was");
  });
});

describe("the keyboard shortcuts", () => {
  const press = (command: string, tabId = 7, sender: object = { id: "extension-id" }) =>
    act(async () => { fake.runtime.onMessage.fire({ type: "shortcut", command, tabId }, sender, () => undefined); });

  it("run Autofill on its key, for this tab's job", async () => {
    show({ fillCount: 1, rows: [row("Email", true)] });
    await press("run-autofill");
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("do nothing when Autofill couldn't be clicked", async () => {
    show({ fillCount: 0, rows: [row("Email", true)], scanning: true });
    await press("run-autofill");
    expect(autofill).not.toHaveBeenCalled();
  });

  it("leave another tab's key alone, and a message that isn't the worker's", async () => {
    show({ fillCount: 1, rows: [row("Email", true)] });
    await press("run-autofill", 8);
    await press("run-autofill", 7, { id: "extension-id", tab: { id: 7, windowId: 1 } });
    await press("run-autofill", 7, { id: "another-extension" });
    expect(autofill).not.toHaveBeenCalled();
  });

  it("open Mark applied on its key, with Yes ready for Enter", async () => {
    const onApply = vi.fn();
    show({ fillCount: 0 }, { onApply });
    await press("mark-applied");
    expect(host.querySelector("dialog[data-slot='autofill-confirm']")!.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("[data-slot='mark-applied-confirm']"));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("the job card", () => {
  it("keeps the job to a few short lines: where on a row of its own, pay and when it was found side by side", () => {
    const details = { location: "Atlanta, GA - Hybrid; Denver, CO", salary_min: null, salary_max: null, discovered_at: new Date(Date.now() - 86_400_000).toISOString() } as unknown as Application;
    show({}, { details });
    const facts = [...host.querySelectorAll("[data-slot='job-facts'] li")];
    expect(facts.map(({ textContent }) => textContent)).toEqual(["Location: Atlanta, GA - Hybrid; Denver, CO", "Pay not listed", "Found yesterday"]);
    expect(facts.map(({ className }) => className.includes("col-span-2"))).toEqual([true, false, false]);
    expect(host.querySelector("[data-slot='job-card']")?.textContent).not.toContain("Linked job");
  });
});

describe("the note a run leaves", () => {
  const note = () => host.querySelector("[data-slot='autofill-result']");
  const title = () => host.querySelector("[data-slot='autofill-result-title']")?.textContent;
  const detail = () => host.querySelector("[data-slot='autofill-result-detail']")?.textContent;

  it("is gone from a run that ended as it should: only the summary shows, in green", () => {
    const rows = [row("Email", true, "a@example.test"), row("Phone", true), row("Website", false)];
    show({ fillCount: 0, rows, outcome: { filled: 15, handedBack: 1, stopped: false } });
    expect(note()).toBeNull();
    expect(host.textContent).not.toContain("Still empty");
    expect(host.querySelector("[data-slot='autofill-done']")?.textContent).toBe("Filled 15 · 2 need you");
    expect(host.querySelector("[data-slot='autofill-done']")?.className).toContain("--color-success-fg");
  });

  it("stays when the run stopped, in amber, until the BDE closes it", () => {
    vi.useFakeTimers();
    try {
      show({ fillCount: 2, outcome: { filled: 1, handedBack: 0, stopped: true } });
      act(() => { vi.advanceTimersByTime(60_000); });
      expect([title(), detail()]).toEqual(["BenchQ stopped: the form changed", "Check the form before going on."]);
      expect(note()?.className).toContain("--color-warning-bg");
      act(() => { note()!.querySelector("button")!.click(); });
      expect(note()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a run's first steps", () => {
  it("say what's happening beside a spinner, and hold Autofill and the picker until it's done", () => {
    show({ fillCount: 2, step: "Taking the old resume's file off…" });
    const step = host.querySelector("[data-slot='autofill-step']")!;
    expect([step.getAttribute("role"), step.textContent]).toEqual(["status", "Taking the old resume's file off…"]);
    expect(host.querySelector<HTMLButtonElement>("[data-slot='autofill-run']")!).toMatchObject({ disabled: true, textContent: "Filling…" });
  });
});

describe("the buttons at the bottom", () => {
  it("make Mark applied plain to see while there are fields to fill: a done look of its own, and what it's for", () => {
    show({ fillCount: 3 }, { onApply: vi.fn() });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Autofill", "Mark applied"]);
    const markApplied = named("Mark applied");
    expect(markApplied.className).toContain("color-success-bg");
    expect(markApplied.className).not.toContain("bq-primary");
    const hint = host.querySelector("[data-slot='mark-applied-hint']")!;
    expect(hint.textContent).toBe("Submitted the form? Mark the job applied in BenchQ.");
    expect(markApplied.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("keep Mark applied available on a site BenchQ may not read, so a refused site can still be marked applied", () => {
    show({ rows: null, reviewedFor: { applicationId: "another-app", candidateId: "cand-1", resumeId: null }, fillCount: 0, needsAccess: { origins: ["https://careers.acme.test/*"], host: "careers.acme.test" }, isAccessDenied: true }, { onApply: vi.fn() });
    expect(host.querySelector("[data-slot='site-access']")).not.toBeNull();
    const mark = host.querySelector<HTMLButtonElement>("[data-slot='mark-applied']")!;
    expect(mark.disabled).toBe(false);
  });

  it("keep Mark applied waiting for the review when there is no access question", () => {
    show({ rows: null, reviewedFor: { applicationId: "another-app", candidateId: "cand-1", resumeId: null }, fillCount: 0 }, { onApply: vi.fn() });
    expect(host.querySelector<HTMLButtonElement>("[data-slot='mark-applied']")!.disabled).toBe(true);
  });

  it("lead with Mark applied once nothing is left to fill", () => {
    show({ fillCount: 0 }, { onApply: vi.fn() });
    expect(atBottom()[0]!.className).toContain("bq-primary");
  });

  it("leave Mark applied out while a run fills the form, and keep Undo waiting", () => {
    show({ fillCount: 3, filling: true, undoable: 2 }, { onApply: vi.fn() });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Filling…", "Undo"]);
    expect(atBottom().map(({ disabled }) => disabled)).toEqual([true, true]);
  });

  it("keep Undo beside it", () => {
    show({ fillCount: 0, undoable: 2 }, { onApply: vi.fn() });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied", "Undo"]);
  });

  it("say Applied once it's done", () => {
    show({ fillCount: 0 }, { isApplied: true });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Applied"]);
    expect(atBottom()[0]!.disabled).toBe(true);
  });

  it("say so while saving", () => {
    show({ fillCount: 0 }, { onApply: vi.fn(), applying: true });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Saving…"]);
    expect(atBottom()[0]!.disabled).toBe(true);
  });

  it("leave nothing behind when there's nothing to offer", () => {
    show({ fillCount: 0 });
    expect(host.querySelector("[data-slot='autofill-actions']")?.childElementCount).toBe(0);
  });
});

describe("confirming Mark applied", () => {
  const onApply = vi.fn();
  const dialog = () => host.querySelector<HTMLDialogElement>("dialog[data-slot='autofill-confirm']")!;
  const confirmText = () => dialog().textContent;
  const inDialog = () => [...dialog().querySelectorAll<HTMLButtonElement>("button")];
  // The dialog's own Mark applied, beside the one that opened it.
  const confirmButton = () => host.querySelector<HTMLButtonElement>("[data-slot='mark-applied-confirm']")!;
  const confirm = () => act(async () => { confirmButton().click(); });
  const note = () => host.querySelector("[data-slot='autofill-confirm-note']");

  it("asks first, in a modal dialog that names the job, and marks nothing yet", async () => {
    show({ fillCount: 0 }, { onApply });
    expect(dialog().hasAttribute("open")).toBe(false);
    await click("Mark applied");
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(dialog().getAttribute("aria-labelledby")).toBe("autofill-confirm-title");
    expect(host.querySelector("#autofill-confirm-title")?.textContent).toBe("Mark this job as applied?");
    expect(host.querySelector("#autofill-confirm-job")?.textContent).toBe("Java Developer at Acme · for Priya");
    expect(inDialog().map(({ textContent }) => textContent)).toEqual(["Mark applied", "Cancel"]);
    expect(inDialog()[0]!.className).toContain("bq-primary");
    expect(document.activeElement).toBe(confirmButton());
    expect(onApply).not.toHaveBeenCalled();
    expect(finalForm).not.toHaveBeenCalled();
  });

  it("sends the form as it stands on Yes", async () => {
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await confirm();
    expect(finalForm).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(form, "res-2");
  });

  it("shows it's saving while it reads the form", async () => {
    let finish: (found: AppliedForm) => void = () => undefined;
    finalForm.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await confirm();
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Saving…"]);
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => { finish(form); });
    expect(onApply).toHaveBeenCalledWith(form, "res-2");
  });

  it("goes back on Cancel, to the button it came from", async () => {
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await click("Cancel");
    expect(onApply).not.toHaveBeenCalled();
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied"]);
    expect(document.activeElement).toBe(named("Mark applied"));
  });

  it("goes back on Esc, to the button it came from", async () => {
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await act(async () => { confirmButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(confirmText()).toBe("");
    expect(document.activeElement).toBe(named("Mark applied"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("warns about required fields still empty, each a way back to it, and still lets the BDE confirm", async () => {
    show({ fillCount: 0, rows: [row("Email", true), row("Phone", true), row("City", true, "Dallas"), row("LinkedIn", false)] }, { onApply });
    await click("Mark applied");
    expect(note()?.querySelector("p")?.textContent).toBe("2 required fields are still empty:");
    expect([...note()!.querySelectorAll("li button")].map(({ textContent }) => textContent)).toEqual(["Email", "Phone"]);
    await confirm();
    expect(onApply).toHaveBeenCalledWith(form, "res-2");
  });

  it("lists the first three empty fields, one line each, and all of them on request", async () => {
    const empty = ["Email", "Phone", "Zip code", "Which of the following metropolitan areas do you reside in?", "Veteran status"];
    show({ fillCount: 0, rows: empty.map((label) => row(label, true)) }, { onApply });
    await click("Mark applied");
    const fields = () => [...note()!.querySelectorAll<HTMLButtonElement>("li button")];
    expect(fields().map(({ textContent }) => textContent)).toEqual(["Email", "Phone", "Zip code"]);
    expect(fields()[0]!.className).toContain("truncate");
    expect(fields()[0]!.getAttribute("title")).toBe("Email");
    const more = note()!.querySelector<HTMLButtonElement>("[data-slot='autofill-confirm-more']")!;
    expect(more.textContent).toBe("Show all 5");
    await act(async () => { more.click(); });
    expect(fields()).toHaveLength(5);
    expect(more.textContent).toBe("Show fewer");
  });

  it("says it right for one", async () => {
    show({ fillCount: 0, rows: [row("Email", true)] }, { onApply });
    await click("Mark applied");
    expect(note()?.querySelector("p")?.textContent).toBe("1 required field is still empty:");
  });

  it("has nothing to warn about when the required fields are filled, or no form could be read", async () => {
    show({ fillCount: 0, rows: [row("City", true, "Dallas"), row("LinkedIn", false)] }, { onApply });
    await click("Mark applied");
    expect(confirmText()).toBe("Mark this job as applied?Java Developer at Acme · for PriyaMark appliedCancel");
    act(() => { root?.unmount(); });
    host.remove();
    show({ fillCount: 0, rows: null }, { onApply });
    await click("Mark applied");
    expect(note()).toBeNull();
  });

  describe("around a run", () => {
    const rerender = (state: State) => act(() => {
      vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state, reviewedFor: state.reviewedFor ?? { applicationId: connection.applicationId, candidateId: connection.candidateId, resumeId: base.id } } as unknown as ReturnType<typeof useAutofill>);
      root!.render(<AutofillPanel connection={connection} candidateName="Priya" applying={false} isApplied={false} onApply={onApply} onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} />);
    });
    const scrolled = vi.fn();

    // jsdom has no scrolling into view.
    beforeEach(() => { Element.prototype.scrollIntoView = scrolled; });
    afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView; });

    it("scrolls smoothly to Needs you once a run leaves fields for the BDE, with Mark applied back", () => {
      const rows = [row("Email", true, "a@example.test"), row("Phone", true)];
      show({ fillCount: 1, rows }, { onApply });
      expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Autofill", "Mark applied"]);
      rerender({ fillCount: 1, filling: true, rows });
      expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Filling…"]);
      expect(scrolled).not.toHaveBeenCalled();
      rerender({ fillCount: 0, rows, outcome: { filled: 1, handedBack: 0, stopped: false } });
      expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied"]);
      const needed = host.querySelector("[data-slot='review-needed']");
      expect(scrolled).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(scrolled.mock.contexts[0]).toBe(needed);
      expect(document.activeElement?.getAttribute("data-slot")).toBe("review-needed-title");
      // Its scroll margin stops it under the sticky top bar, clear of the Mark applied bar at the bottom.
      expect(needed?.className).toContain("scroll-mt-[calc(var(--topbar-height)");
    });

    it("scrolls to Autofill complete once a run leaves nothing for the BDE", () => {
      const rows = [row("Email", true, "a@example.test")];
      show({ fillCount: 1, rows }, { onApply });
      rerender({ fillCount: 1, filling: true, rows });
      rerender({ fillCount: 0, rows, outcome: { filled: 1, handedBack: 0, stopped: false } });
      const done = host.querySelector("[data-slot='autofill-done']");
      expect(scrolled.mock.contexts[0]).toBe(done);
      expect(done?.className).toContain("scroll-mt-[calc(var(--topbar-height)");
    });

    it("scrolls to the note of a run that stopped, when Autofill complete isn't on show", () => {
      const rows = [row("Phone", true)];
      show({ fillCount: 1, rows }, { onApply });
      rerender({ fillCount: 1, filling: true, rows });
      rerender({ fillCount: 1, rows, outcome: { filled: 1, handedBack: 1, stopped: true } });
      expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
      expect(scrolled.mock.contexts[0]).toBe(host.querySelector("[data-slot='autofill-result']"));
    });
  });
});

describe("Tailor for this job", () => {
  /** The connected job's saved record: `job_id` is the candidate's posting, which tailoring reads. */
  const job = { id: "app-1", candidate_id: "cand-1", status: "saved", title: "Java Developer", company: "Acme", url: null, location: null, job_id: "posting-1" } as Application;
  const twoResumes: Resumes = { status: "ready", choices: [tailored, base], picked: base };
  const tailor = () => host.querySelector("[data-slot='tailor']");

  it("sits at the foot of the résumés, says which base it reads, and starts from that base's version 1", async () => {
    show({ fillCount: 1 }, { details: job });
    expect(host.querySelector("[data-slot='resume-picker']")!.contains(tailor())).toBe(true);
    // One line: how long it takes; what it does is the button's tooltip and description.
    expect(tailor()!.querySelector("[data-slot='tailor-from']")!.textContent).toBe("Rewrites Base 1 (Active) to fit this job, about a minute");
    expect(named("Tailor resume for this job").getAttribute("title")).toBe("Rewrites Base 1 (Active) to fit this job");
    await click("Tailor resume for this job");
    expect(tailorStart).toHaveBeenCalledWith("res-1");
    expect(vi.mocked(useTailoring).mock.lastCall?.[0]).toMatchObject({ firmId: "firm-1", candidateId: "cand-1", jobId: "posting-1" });
  });

  it("says Tailor again once that base has a résumé tailored for this job", () => {
    show({ fillCount: 1 }, { details: job }, twoResumes);
    expect(named("Tailor again")).toBeDefined();
  });

  it("isn't offered before the job's record is confirmed, or for a candidate with no résumé", () => {
    show({ fillCount: 1 }, { details: null });
    expect(tailor()).toBeNull();
    act(() => { root?.unmount(); });
    host.remove();
    show({ fillCount: 1 }, { details: job, applicationStatus: "loading" }, { status: "loading" });
    expect(tailor()).toBeNull();
    act(() => { root?.unmount(); });
    host.remove();
    show({ fillCount: 0 }, { details: job }, { status: "ready", choices: [], picked: null });
    expect(tailor()).toBeNull();
  });

  it("shows the step it's on, how far along it is, and its clock while it runs", () => {
    tailoring = { status: "running", runId: "run-1", step: "draft", startedAt: Date.now() - 65_000 };
    show({ fillCount: 1 }, { details: job });
    expect(tailor()!.querySelector("[role='status']")!.textContent).toBe("Writing the draft…");
    const bar = tailor()!.querySelector("[role='progressbar']")!;
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuetext")]).toEqual(["2", "Step 2 of 6: Writing the draft"]);
    expect(tailor()!.querySelector("[data-slot='tailor-clock']")!.textContent).toMatch(/^1:0\d$/);
    expect(tailor()!.querySelector("[data-slot='tailor-start']")).toBeNull();
  });

  it("offers the finished résumé to use, which picks it and so fills the form from it, once it's in the list", async () => {
    tailoring = { status: "completed", resumeId: "res-9" };
    show({ fillCount: 1 }, { details: job }, twoResumes);
    expect(tailor()!.textContent).toContain("Tailored resume ready");
    await click("Use this resume");
    expect(pick).toHaveBeenCalledWith("res-9");
    expect(tailor()!.querySelector("a")!.getAttribute("href")).toContain("/resumes/res-9");
    act(() => { root?.unmount(); });
    host.remove();
    tailoring = { status: "completed", resumeId: "res-new" };
    show({ fillCount: 1 }, { details: job }, twoResumes);
    expect(named("Use this resume").disabled).toBe(true);
    expect(tailor()!.textContent).toContain("Adding it to the list");
  });

  it("says when the list couldn't be read again once it finished, and reads it again on Reload resumes (PR #140 review)", async () => {
    tailoring = { status: "completed", resumeId: "res-new" };
    refreshFailed = true;
    show({ fillCount: 1 }, { details: job }, twoResumes);
    expect(tailor()!.querySelector("[data-slot='tailor-reload']")!.textContent).toContain("couldn't add the new resume to the list");
    expect(tailor()!.textContent).not.toContain("Adding it to the list");
    await click("Reload resumes");
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the finished résumé is the one in use", () => {
    tailoring = { status: "completed", resumeId: "res-9" };
    show({ fillCount: 1 }, { details: job }, { ...twoResumes, picked: tailored });
    expect(tailor()!.textContent).toContain("Tailored resume in use");
    expect(named("Use this resume")).toBeUndefined();
  });

  it("says why it failed, with Try again when that can help", async () => {
    tailoring = { status: "failed", message: "Tailoring didn't finish. Try again.", canRetry: true };
    show({ fillCount: 1 }, { details: job });
    expect(tailor()!.querySelector("[role='alert']")!.textContent).toContain("Tailoring didn't finish.");
    await click("Try again");
    expect(tailorStart).toHaveBeenCalledWith("res-1");
    await click("Close");
    expect(tailorDismiss).toHaveBeenCalled();
  });
});

describe("what the panel shows first", () => {
  const body = () => host.querySelector("[data-slot='autofill-body']")!;

  it("shows no step list: the floating actions say what's next, the resume leads the body", () => {
    show({ fillCount: 2, rows: [row("Email", true)] });
    expect(host.querySelector("[data-slot='next-steps']")).toBeNull();
    expect(body().querySelector("[data-slot='autofill-run']")).toBeNull();
    expect(host.querySelector("[data-slot='autofill-actions'] [data-slot='autofill-run']")).not.toBeNull();
    expect(body().querySelector("[data-slot='resume-picker']")).not.toBeNull();
  });

  it("asks for a site's permission alone, Mark applied kept, and shows the rest once it's given", () => {
    show({ fillCount: 0, rows: null, needsAccess: { origins: ["https://jobs.acme.test/*"], host: "jobs.acme.test" } }, { onApply: vi.fn() });
    expect(body().querySelector("[data-slot='resume-picker']")).toBeNull();
    expect(body().querySelector("[data-slot='next-steps']")).toBeNull();
    expect(body().querySelector("[data-slot='autofill-run']")).toBeNull();
    expect(body().textContent).toContain("jobs.acme.test");
    expect(named("Mark applied")).toBeDefined();
    act(() => { root?.unmount(); });
    host.remove();
    show({ fillCount: 2, rows: [row("Email", true)] }, { onApply: vi.fn() });
    expect(body().querySelector("[data-slot='resume-picker']")).not.toBeNull();
  });

  it("asks to disconnect when the tab moved on to another job on the job's site, and shows nothing else until answered", async () => {
    const onDisconnect = vi.fn();
    show({ fillCount: 2, rows: [row("Email", true)] }, { onApply: vi.fn(), tabUrl: "https://jobs.acme.test/jobs/98765" });
    element = cloneElement(element, { onDisconnect } as never);
    act(() => { root!.render(element); });
    expect(body().querySelector("[data-slot='moved-away']")!.textContent).toContain("This tab now shows another job.");
    expect(body().querySelector("[data-slot='resume-picker']")).toBeNull();
    expect(named("Mark applied")).toBeUndefined();
    await click("Disconnect");
    expect(onDisconnect).toHaveBeenCalled();
    await click("Keep it connected");
    expect(body().querySelector("[data-slot='moved-away']")).toBeNull();
    expect(body().querySelector("[data-slot='resume-picker']")).not.toBeNull();
  });

  it("never asks on the job's own page, its application, or another site (an ATS the job sends the BDE to)", () => {
    for (const tabUrl of ["https://jobs.acme.test/1", "https://jobs.acme.test/1/apply", "https://boards.greenhouse.io/acme/jobs/555"]) {
      show({ fillCount: 2, rows: [row("Email", true)] }, { tabUrl });
      expect(body().querySelector("[data-slot='moved-away']"), tabUrl).toBeNull();
      act(() => { root?.unmount(); });
      host.remove();
    }
    show({ fillCount: 2, rows: [row("Email", true)] });
  });
});

describe("fills while the panel asks about another job (PR #140, second review)", () => {
  it("are held, automatic ones included, until the BDE keeps the tab", async () => {
    show({ fillCount: 2, rows: [row("Email", true)] }, { tabUrl: "https://jobs.acme.test/jobs/98765" });
    expect(vi.mocked(useAutofill).mock.lastCall?.[0].isHeld).toBe(true);
    await click("Keep it connected");
    expect(vi.mocked(useAutofill).mock.lastCall?.[0].isHeld).toBe(false);
  });
});
