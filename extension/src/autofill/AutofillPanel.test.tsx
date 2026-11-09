// @vitest-environment jsdom
import { act, cloneElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "../api";
import { installDialog } from "../test/dialog";
import AutofillPanel from "./AutofillPanel";
import type { AppliedForm, Connection, ReviewRow, TabField } from "./types";
import { useAutofill } from "./use-autofill";
import { useResumes, type Resumes } from "./use-resumes";

vi.mock("./use-autofill", () => ({ useAutofill: vi.fn() }));
vi.mock("./use-resumes", () => ({ useResumes: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installDialog();

const connection = {
  tabId: 7, applicationId: "app-1", candidateId: "cand-1", userId: "user-1", confirmedHosts: [],
  job: { title: "Java Developer", company: "Acme", url: "https://jobs.acme.test/1" },
} as Connection;

const form: AppliedForm = { fields: [{ label: "City", value: "Dallas", required: false, source: "bde" }] };

const finalForm = vi.fn(async () => form);
const autofill = vi.fn();

const reviewed = {
  rows: [], scanning: false, error: "", filling: false, outcome: null, undoable: 0, fillCount: 0, needsConfirmation: false, unreadableFrames: 0,
  check: { conflict: false, detected: "" }, finalForm, autofill,
};

const row = (label: string, required: boolean, current = ""): ReviewRow => ({
  key: label, status: "manual", field: { label, required, current } as TabField,
});

const base = { id: "res-2", label: "Base 1 · Java Developer · v2 (in use)", isTailored: false, isActive: true };
const tailored = { id: "res-9", label: "Tailored for this job · from Base 1 · v1", isTailored: true, isActive: false };
const pick = vi.fn();
const retry = vi.fn();
const oneResume: Resumes = { status: "ready", choices: [base], picked: base };

let root: Root | null = null;
let host: HTMLElement;
let element: ReactElement;

type State = {
  fillCount?: number; filling?: boolean; undoable?: number; rows?: ReviewRow[] | null; outcome?: { filled: number; handedBack: number; stopped: boolean } | null;
  answeredFrom?: string | null; needsConfirmation?: boolean;
};

function show(state: State, panel: { onApply?: (form: AppliedForm) => void; isApplied?: boolean; applying?: boolean; details?: Application | null } = {}, resumes: Resumes = oneResume) {
  vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state } as unknown as ReturnType<typeof useAutofill>);
  vi.mocked(useResumes).mockReturnValue({ resumes, pick, retry });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  element = <AutofillPanel connection={connection} firmId="firm-1" firmSlug="acme-staffing" candidateName="Priya" applying={false} isApplied={false} onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} {...panel} />;
  act(() => { root!.render(element); });
}

/** The panel again with what the hooks now say, as after the BDE's pick. */
function update(state: State, resumes: Resumes) {
  vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state } as unknown as ReturnType<typeof useAutofill>);
  vi.mocked(useResumes).mockReturnValue({ resumes, pick, retry });
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
  vi.clearAllMocks();
});

describe("Autofill", () => {
  it("sits at the top of the form, above the list, and gives no count", () => {
    show({ fillCount: 3, rows: [row("Email", true)] });
    expect(inBody().map(({ textContent }) => textContent)).toEqual(["Autofill"]);
    expect(inBody()[0]!.className).toContain("bq-primary");
    const button = inBody()[0]!;
    const list = host.querySelector("[data-slot='review']")!;
    expect(button.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("runs when clicked", () => {
    show({ fillCount: 1 });
    act(() => { inBody()[0]!.click(); });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("says it's filling during a run", () => {
    show({ fillCount: 3, filling: true });
    expect(inBody().map(({ textContent }) => textContent)).toEqual(["Filling…"]);
    expect(inBody()[0]!.disabled).toBe(true);
  });

  it("makes way for Autofill complete once a run leaves nothing to fill", () => {
    show({ fillCount: 0, outcome: { filled: 3, handedBack: 0, stopped: false } });
    expect(inBody()).toEqual([]);
    expect(host.querySelector("[data-slot='autofill-done']")?.textContent).toBe("Autofill complete");
    expect(host.querySelector("[data-slot='autofill-done']")?.className).toContain("text-caption");
  });

  it("isn't complete while there's more to fill", () => {
    show({ fillCount: 2, outcome: { filled: 3, handedBack: 0, stopped: true } });
    expect(inBody().map(({ textContent }) => textContent)).toEqual(["Autofill"]);
    expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
  });

  it("isn't complete when nothing was filled", () => {
    show({ fillCount: 0, rows: [row("Phone", true), row("City", true)], outcome: { filled: 0, handedBack: 2, stopped: false } });
    expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
    expect(host.querySelector("[data-slot='autofill-result-title']")?.textContent).toBe("Nothing was filled");
    expect(host.querySelector("[data-slot='autofill-result-detail']")?.textContent)
      .toBe("Still empty: 2 required. Autofill didn't recognize these or couldn't fill them. Fill in the required ones below, then submit the form.");
  });

  it("leaves no way to rescan by hand: the panel does that itself", () => {
    show({ fillCount: 1, undoable: 1 });
    expect(host.textContent).not.toContain("Rescan");
  });
});

describe("the résumé the answers come from", () => {
  const picker = () => host.querySelector("[data-slot='resume-picker']")!;
  const twoResumes: Resumes = { status: "ready", choices: [tailored, base], picked: base };

  it("names it on one line, with a way to view it in BenchQ", () => {
    show({ fillCount: 1 });
    expect(picker().querySelector("[data-slot='resume-picked']")!.textContent).toBe(base.label);
    expect(picker().querySelector("a")!.getAttribute("href")).toContain("/acme-staffing/resumes/res-2");
    expect(picker().querySelectorAll("button")).toHaveLength(0);
  });

  it("lists the candidate's résumés on Change, each with Pick and a link", async () => {
    show({ fillCount: 1 }, {}, twoResumes);
    await click("Change");
    const choices = [...picker().querySelectorAll("[data-slot='resume-choice']")];
    expect(choices.map((choice) => choice.querySelector("button")!.textContent)).toEqual(["Pick", "Picked"]);
    expect(choices[0]!.textContent).toContain("Tailored");
    expect(choices[0]!.querySelector("a")!.getAttribute("href")).toContain("/resumes/res-9");
  });

  it("fills the form as soon as the picked résumé's answers are in", async () => {
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, answeredFrom: "res-2" }, {}, twoResumes);
    await click("Change");
    await click("Pick");
    expect(pick).toHaveBeenCalledWith("res-9");
    expect(autofill).not.toHaveBeenCalled();
    update({ fillCount: 1, rows, answeredFrom: "res-9" }, { ...twoResumes, picked: tailored });
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it("only picks when the form isn't on the page yet", async () => {
    show({ fillCount: 0, rows: [], answeredFrom: "res-2" }, {}, twoResumes);
    await click("Change");
    await click("Pick");
    update({ fillCount: 0, rows: [], answeredFrom: "res-9" }, { ...twoResumes, picked: tailored });
    expect(autofill).not.toHaveBeenCalled();
  });

  it("only picks when the page may be a different job", async () => {
    const rows = [row("Email", true)];
    show({ fillCount: 1, rows, answeredFrom: "res-2" }, {}, twoResumes);
    await click("Change");
    await click("Pick");
    update({ fillCount: 1, rows, answeredFrom: "res-9", needsConfirmation: true }, { ...twoResumes, picked: tailored });
    expect(autofill).not.toHaveBeenCalled();
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

  it("names it as the one to attach when the form asks for a résumé", () => {
    const upload = { key: "cv", status: "manual", field: { label: "Resume/CV", kind: "file", hints: "", required: true, current: "" } } as unknown as ReviewRow;
    show({ fillCount: 0, rows: [upload] });
    expect(host.querySelector("[data-document='resume'] [data-slot='document-held']")!.textContent).toBe(`Attach: ${base.label}`);
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
  const closeButton = () => note()!.querySelector("button")!;
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const title = () => host.querySelector("[data-slot='autofill-result-title']")?.textContent;
  const detail = () => host.querySelector("[data-slot='autofill-result-detail']")?.textContent;

  it("sums the run up in two short lines: what it filled, what's left, and that the form is the BDE's to submit", () => {
    show({ fillCount: 0, rows: [row("Phone", true)], outcome: { filled: 15, handedBack: 1, stopped: false } });
    expect([title(), detail()]).toEqual([
      "Filled 15 fields",
      "Still empty: 1 required. Autofill didn't recognize it or couldn't fill it. Fill in the required one below, then submit the form.",
    ]);
  });

  it("tells how many required and optional fields are still empty, and why, in amber", () => {
    const rows = [row("Email", true, "a@example.test"), row("Phone", true), row("Website", false), row("Twitter", false)];
    show({ fillCount: 0, rows, outcome: { filled: 15, handedBack: 1, stopped: false } });
    expect([title(), detail()]).toEqual([
      "Filled 15 fields",
      "Still empty: 1 required, 2 optional. Autofill didn't recognize these or couldn't fill them. Fill in the required one below, then submit the form.",
    ]);
    expect(note()?.className).toContain("--color-warning-bg");
  });

  it("stays green when only optional fields are left, and says so", () => {
    const rows = [row("Email", true, "a@example.test"), row("Website", false), row("Twitter", false)];
    show({ fillCount: 0, rows, outcome: { filled: 15, handedBack: 0, stopped: false } });
    expect(detail()).toBe("Still empty: 2 optional. Autofill didn't recognize these or couldn't fill them. Fill in any you need below, then submit the form.");
    expect(note()?.className).toContain("--color-success-bg");
  });

  it("goes after a few seconds, but not while the BDE is reading it", () => {
    show({ fillCount: 0, outcome: { filled: 3, handedBack: 0, stopped: false } });
    expect([title(), detail()]).toEqual(["Filled 3 fields", "Check the form, then submit it."]);
    act(() => { closeButton().focus(); });
    wait(20_000);
    expect(note()).not.toBeNull();
    act(() => { closeButton().blur(); });
    wait(6_000);
    wait(1_000);
    expect(note()).toBeNull();
  });

  it("stays when the run stopped, until the BDE closes it", () => {
    show({ fillCount: 2, outcome: { filled: 1, handedBack: 0, stopped: true } });
    wait(60_000);
    expect([title(), detail()]).toEqual(["BenchQ stopped: the form changed", "Check the form before going on."]);
    act(() => { closeButton().click(); });
    expect(note()).toBeNull();
  });
});

describe("the buttons at the bottom", () => {
  it("have Mark applied as the quiet choice while there are fields to fill", () => {
    show({ fillCount: 3 }, { onApply: vi.fn() });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied"]);
    expect(atBottom()[0]!.className).toContain("bq-secondary");
  });

  it("lead with Mark applied once nothing is left to fill", () => {
    show({ fillCount: 0 }, { onApply: vi.fn() });
    expect(atBottom()[0]!.className).toContain("bq-primary");
  });

  it("leave Mark applied out while a run fills the form, and keep Undo waiting", () => {
    show({ fillCount: 3, filling: true, undoable: 2 }, { onApply: vi.fn() });
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Undo"]);
    expect(atBottom().map(({ disabled }) => disabled)).toEqual([true]);
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
  const note = () => host.querySelector("[data-slot='autofill-confirm-note']");

  it("asks first, in a modal dialog that names the job, and marks nothing yet", async () => {
    show({ fillCount: 0 }, { onApply });
    expect(dialog().hasAttribute("open")).toBe(false);
    await click("Mark applied");
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(dialog().getAttribute("aria-labelledby")).toBe("autofill-confirm-title");
    expect(host.querySelector("#autofill-confirm-title")?.textContent).toBe("Mark this job as applied?");
    expect(host.querySelector("#autofill-confirm-job")?.textContent).toBe("Java Developer at Acme · for Priya");
    expect(inDialog().map(({ textContent }) => textContent)).toEqual(["Yes, mark applied", "Cancel"]);
    expect(inDialog()[0]!.className).toContain("bq-primary");
    expect(document.activeElement).toBe(named("Yes, mark applied"));
    expect(onApply).not.toHaveBeenCalled();
    expect(finalForm).not.toHaveBeenCalled();
  });

  it("sends the form as it stands on Yes", async () => {
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await click("Yes, mark applied");
    expect(finalForm).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(form);
  });

  it("shows it's saving while it reads the form", async () => {
    let finish: (found: AppliedForm) => void = () => undefined;
    finalForm.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    show({ fillCount: 0 }, { onApply });
    await click("Mark applied");
    await click("Yes, mark applied");
    expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Saving…"]);
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => { finish(form); });
    expect(onApply).toHaveBeenCalledWith(form);
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
    await act(async () => { named("Yes, mark applied").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
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
    await click("Yes, mark applied");
    expect(onApply).toHaveBeenCalledWith(form);
  });

  it("says it right for one", async () => {
    show({ fillCount: 0, rows: [row("Email", true)] }, { onApply });
    await click("Mark applied");
    expect(note()?.querySelector("p")?.textContent).toBe("1 required field is still empty:");
  });

  it("has nothing to warn about when the required fields are filled, or no form could be read", async () => {
    show({ fillCount: 0, rows: [row("City", true, "Dallas"), row("LinkedIn", false)] }, { onApply });
    await click("Mark applied");
    expect(confirmText()).toBe("Mark this job as applied?Java Developer at Acme · for PriyaYes, mark appliedCancel");
    act(() => { root?.unmount(); });
    host.remove();
    show({ fillCount: 0, rows: null }, { onApply });
    await click("Mark applied");
    expect(note()).toBeNull();
  });

  describe("around a run", () => {
    const rerender = (state: State) => act(() => {
      vi.mocked(useAutofill).mockReturnValue({ ...reviewed, ...state } as unknown as ReturnType<typeof useAutofill>);
      root!.render(<AutofillPanel connection={connection} candidateName="Priya" applying={false} isApplied={false} onApply={onApply} onDisconnect={vi.fn()} onSessionExpired={vi.fn()} onAccessLost={vi.fn()} />);
    });
    const scrolled = vi.fn();

    // jsdom has no scrolling into view.
    beforeEach(() => { Element.prototype.scrollIntoView = scrolled; });
    afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView; });

    it("scrolls smoothly to Autofill complete once a run ends, with Mark applied back", () => {
      const rows = [row("Email", true, "a@example.test"), row("Phone", true)];
      show({ fillCount: 1, rows }, { onApply });
      expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied"]);
      rerender({ fillCount: 1, filling: true, rows });
      expect(atBottom()).toEqual([]);
      expect(scrolled).not.toHaveBeenCalled();
      rerender({ fillCount: 0, rows, outcome: { filled: 1, handedBack: 0, stopped: false } });
      expect(atBottom().map(({ textContent }) => textContent)).toEqual(["Mark applied"]);
      const done = host.querySelector("[data-slot='autofill-done']");
      expect(scrolled).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(scrolled.mock.contexts[0]).toBe(done);
      // Its scroll margin stops it under the sticky top bar, clear of the Mark applied bar at the bottom.
      expect(done?.className).toContain("scroll-mt-[calc(var(--topbar-height)");
    });

    it("scrolls to the run's note when fields are left to fill, and Autofill complete isn't on show", () => {
      const rows = [row("Phone", true)];
      show({ fillCount: 1, rows }, { onApply });
      rerender({ fillCount: 1, filling: true, rows });
      rerender({ fillCount: 1, rows, outcome: { filled: 1, handedBack: 1, stopped: false } });
      expect(host.querySelector("[data-slot='autofill-done']")).toBeNull();
      expect(scrolled.mock.contexts[0]).toBe(host.querySelector("[data-slot='autofill-result']"));
    });
  });
});
