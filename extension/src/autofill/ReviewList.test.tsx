// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewList from "./ReviewList";
import type { BankEntry, ReviewRow, TabField } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saved: BankEntry = { id: "q1", question: "Race/Ethnicity", answer: "Asian", category: "OTHER" };

const row = (label: string, required: boolean, status: ReviewRow["status"] = "ready", extra: Partial<ReviewRow> = {}): ReviewRow => ({
  key: label, status, proposed: "Yes", field: { label, required, current: "" } as TabField, ...extra,
});

/** A field that holds a value. */
const holding = (label: string, required: boolean, current: string, status: ReviewRow["status"] = "same", extra: Partial<ReviewRow> = {}) =>
  row(label, required, status, { field: { label, required, current } as TabField, ...extra });

let root: Root | null = null;
let host: HTMLElement;
const onGoTo = vi.fn();

const render = (rows: ReviewRow[], isFilling = false) => act(() => {
  root!.render(<ReviewList rows={rows} isFilling={isFilling} onGoTo={onGoTo} />);
});

function show(rows: ReviewRow[], isFilling = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render(rows, isFilling);
}

const all = (selector: string) => [...host.querySelectorAll(selector)];
const labels = () => all("[data-slot='review-label']").map((label) => label.textContent);
const titles = () => all("h3").map((title) => title.textContent);
const ticks = () => all("[data-slot='review-tick']").map((tick) => tick.getAttribute("aria-label"));

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host.remove();
  vi.clearAllMocks();
});

describe("the two lists", () => {
  it("splits the form into Required and Optional, each saying how much is filled", () => {
    show([holding("First name", true, "Priya"), row("Resume", true, "blocked"), row("Email", true), holding("LinkedIn", false, "https://x.test"), row("Why us?", false, "manual")]);
    expect(titles()).toEqual(["Required (1 of 3 filled)", "Optional (1 of 2 filled)"]);
  });

  it("are always open, with nothing to expand", () => {
    show([row("Email", true), row("LinkedIn", false)]);
    expect(host.querySelector("details")).toBeNull();
    expect(labels()).toEqual(["Email", "LinkedIn"]);
  });

  it("leave out a list with nothing in it", () => {
    show([row("Email", true)]);
    expect(titles()).toEqual(["Required (0 of 1 filled)"]);
  });

  it("put what's still to fill first, each kind in the form's order", () => {
    show([holding("First", true, "a"), row("Second", true), holding("Third", true, "b"), row("Fourth", true)]);
    expect(labels()).toEqual(["Second", "Fourth", "First", "Third"]);
  });

  it("keep every row in place during a run, so each ticks where it is", () => {
    const rows = [row("First", true), holding("Second", true, "b"), row("Third", true)];
    show(rows, true);
    expect(labels()).toEqual(["First", "Second", "Third"]);
    render([holding("First", true, "a"), rows[1]!, rows[2]!], true);
    expect(labels()).toEqual(["First", "Second", "Third"]);
    expect(ticks()).toEqual(["Filled", "Filled", "Not filled"]);
  });

  it("have no checkboxes", () => {
    show([row("Email", true), row("Why us?", false, "manual")]);
    expect(host.querySelector("input")).toBeNull();
  });

  it("show a value from the page as plain text", () => {
    show([holding("Name", true, "<img src=x onerror=alert(1)>")]);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("a row", () => {
  it("ticks a filled field and shows what it holds", () => {
    show([holding("Email", true, "priya@example.test")]);
    expect(ticks()).toEqual(["Filled"]);
    expect(host.querySelector("[data-slot='review-tick']")?.getAttribute("data-filled")).toBe("true");
    expect(host.querySelector("[data-slot='review-tick'] svg")).not.toBeNull();
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("priya@example.test");
  });

  it("leaves a field with an answer waiting unticked, without the answer", () => {
    show([row("Email", true, "ready", { proposed: "priya@example.test", source: saved })]);
    expect(ticks()).toEqual(["Not filled"]);
    expect(host.querySelector("[data-slot='review-tick'] svg")).toBeNull();
    expect(host.textContent).not.toContain("priya@example.test");
    expect(host.textContent).not.toContain("Asian");
  });

  it("gives the reason a field is the BDE's", () => {
    show([row("Resume", true, "blocked", { reason: "File upload" })]);
    expect(ticks()).toEqual(["Not filled"]);
    expect(host.querySelector("[data-slot='review-reason']")?.textContent).toBe("File upload");
  });

  it("ticks a field the BDE filled by hand, and drops the reason", () => {
    show([holding("Why us?", true, "Great team", "manual", { reason: "No answer in the bank." })]);
    expect(ticks()).toEqual(["Filled"]);
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("Great team");
    expect(host.querySelector("[data-slot='review-reason']")).toBeNull();
  });

  it("says a protected field is filled without showing its value", () => {
    show([holding("Social security number", true, "123-45-6789", "blocked", { reason: "Government or tax ID", isUnsaved: true })]);
    expect(ticks()).toEqual(["Filled"]);
    expect(host.textContent).not.toContain("123-45-6789");
  });

  it("still shows an EEO answer: it only stays out of what's saved", () => {
    show([holding("Gender", false, "Female", "same", { isUnsaved: true })]);
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("Female");
  });

  it("counts a box that should stay unchecked as done", () => {
    show([row("Text me updates", false, "same", { proposed: "Not checked" })]);
    expect(ticks()).toEqual(["Filled"]);
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("Not checked");
  });

  it("gives the BDE an answer that didn't fit", () => {
    show([row("Race", false, "manual", { proposed: "Asian", source: saved, reason: "Pick one yourself." })]);
    expect(host.querySelector("[data-slot='review-saved']")?.textContent).toBe("Saved: Asian");
    expect(host.querySelector("[data-slot='review-reason']")?.textContent).toBe("Pick one yourself.");
  });

  it("lists every saved answer when more than one fits", () => {
    show([row("City", false, "manual", { alternatives: ["Dallas", "Plano"] })]);
    expect(all("[data-slot='review-saved']").map(({ textContent }) => textContent)).toEqual(["Saved: Dallas", "Saved: Plano"]);
  });
});

describe("file uploads", () => {
  const upload = (label: string, required: boolean, current = "") =>
    holding(label, required, current, "blocked", { reason: "File upload", field: { label, required, current, kind: "file" } as TabField });

  it("get their own section, after the rest", () => {
    show([row("Email", true), upload("Resume/CV", true), row("LinkedIn", false), upload("Cover Letter", false, "letter.pdf")]);
    expect(titles()).toEqual(["Required (0 of 1 filled)", "Optional (0 of 1 filled)", "Other uploads (1 of 2 filled)"]);
    expect(labels()).toEqual(["Email", "LinkedIn", "Resume/CV", "Cover Letter"]);
  });

  it("leave Required and Optional counting only what's left", () => {
    show([upload("Resume/CV", true), holding("Email", true, "a@example.test")]);
    expect(titles()).toEqual(["Required (1 of 1 filled)", "Other uploads (0 of 1 filled)"]);
  });

  it("show no section when the form has none", () => {
    show([row("Email", true)]);
    expect(titles()).toEqual(["Required (0 of 1 filled)"]);
  });

  it("show the BDE what's needed, without repeating that it's an upload", () => {
    show([upload("Resume/CV", true), upload("Cover Letter", false)]);
    expect(all("[data-slot='review-row']").map(({ textContent }) => textContent)).toEqual(["Resume/CVRequired", "Cover Letter"]);
  });

  it("tick and show the file's name once it's attached", () => {
    show([upload("Resume/CV", true, "priya-resume.pdf")]);
    expect(ticks()).toEqual(["Filled"]);
    expect(host.querySelector("[data-slot='review-value']")?.textContent).toBe("priya-resume.pdf");
    expect(host.querySelector("[data-slot='review-reason']")).toBeNull();
  });

  it("go to the field on the form", () => {
    const resume = upload("Resume/CV", true);
    show([resume]);
    act(() => { host.querySelector<HTMLElement>("[data-slot='review-jump']")!.click(); });
    expect(onGoTo).toHaveBeenCalledWith(resume);
  });
});

describe("going to a field", () => {
  const jump = () => host.querySelector<HTMLElement>("[data-slot='review-jump']")!;

  it.each([["ready"], ["manual"], ["blocked"], ["same"]] as const)("goes from a %s row", (status) => {
    const email = row("Email", true, status);
    show([email]);
    act(() => { jump().click(); });
    expect(onGoTo).toHaveBeenCalledWith(email);
  });

  it("works from the keyboard", () => {
    const email = row("Email", true);
    show([email]);
    expect(jump().tabIndex).toBe(0);
    act(() => { jump().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    act(() => { jump().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); });
    expect(onGoTo).toHaveBeenCalledTimes(2);
  });

  it("waits while a fill is running", () => {
    show([row("Email", true)], true);
    act(() => { jump().click(); });
    expect(onGoTo).not.toHaveBeenCalled();
    expect(jump().tabIndex).toBe(-1);
  });

  it("doesn't jump when the BDE is selecting text to copy", () => {
    show([row("Email", true, "manual", { source: saved })]);
    getSelection()!.selectAllChildren(host.querySelector("[data-slot='review-saved']")!);
    act(() => { jump().click(); });
    expect(onGoTo).not.toHaveBeenCalled();
    getSelection()!.removeAllRanges();
  });
});

describe("a dropdown Autofill found no clear option in", () => {
  it("lists its options in the panel when asked, and picks the one chosen there", async () => {
    const onListOptions = vi.fn(async () => ["East Asian", "South Asian"]);
    const onChoose = vi.fn();
    const dropdown = row("Race", true, "manual", { canChoose: true, reason: "None of the form's options clearly match this answer.", field: { label: "Race", required: true, current: "", kind: "combobox" } as TabField });
    show([]);
    act(() => { root!.render(<ReviewList rows={[dropdown]} isFilling={false} onGoTo={onGoTo} onListOptions={onListOptions} onChoose={onChoose} />); });
    expect(host.querySelector("[data-slot='choice-list']")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-slot='choice-open']")!.click(); });
    expect(onListOptions).toHaveBeenCalledWith(dropdown);
    const choices = [...host.querySelectorAll<HTMLButtonElement>("[data-slot='choice-list'] button")];
    expect(choices.map(({ textContent }) => textContent)).toEqual(["East Asian", "South Asian"]);
    act(() => { choices[1]!.click(); });
    expect(onChoose).toHaveBeenCalledWith(dropdown, "South Asian");
  });

  it("offers nothing on a row Autofill didn't open", () => {
    show([row("Race", true, "manual", { reason: "No answer in the bank." })]);
    expect(host.querySelector("[data-slot='choice-open']")).toBeNull();
  });
});
