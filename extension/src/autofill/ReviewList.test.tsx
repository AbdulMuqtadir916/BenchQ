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

/** Renders the list with "Filled" opened, unless a test is about the fold itself. */
function show(rows: ReviewRow[], isFilling = false, isFilledOpen = true) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render(rows, isFilling);
  const toggle = host.querySelector<HTMLButtonElement>("[data-slot='review-filled-toggle']");
  if (isFilledOpen && toggle) act(() => { toggle.click(); });
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

describe("the groups (07 Q56)", () => {
  const fold = () => host.querySelector<HTMLButtonElement>("[data-slot='review-filled-toggle']");

  it("put what still needs the BDE first, required before optional, each required one marked", () => {
    show([holding("First name", true, "Priya"), row("Why us?", false, "manual"), row("Email", true), holding("LinkedIn", false, "https://x.test")], false, false);
    expect(titles()).toEqual(["Needs you (2)"]);
    expect(labels()).toEqual(["Email", "Why us?"]);
    expect(all("[data-slot='review-required']").map((tag) => tag.textContent)).toEqual(["Required"]);
  });

  it("fold what's filled under its count, open on a click", () => {
    show([holding("First name", true, "Priya"), row("Email", true), holding("LinkedIn", false, "https://x.test")], false, false);
    expect([fold()!.textContent, fold()!.getAttribute("aria-expanded")]).toEqual(["Filled (2)", "false"]);
    act(() => { fold()!.click(); });
    expect(fold()!.getAttribute("aria-expanded")).toBe("true");
    expect(labels()).toEqual(["Email", "First name", "LinkedIn"]);
  });

  it("leave out a group with nothing in it", () => {
    show([row("Email", true)]);
    expect(titles()).toEqual(["Needs you (1)"]);
    expect(fold()).toBeNull();
  });

  it("have no checkboxes", () => {
    show([row("Email", true), row("Why us?", false, "manual")]);
    expect(host.querySelector("input")).toBeNull();
  });

  it("show a value from the page as plain text, on two lines at most", () => {
    show([holding("Name", true, "<img src=x onerror=alert(1)>")]);
    expect(host.querySelector("img")).toBeNull();
    const value = host.querySelector("[data-slot='review-value']")!;
    expect(value.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(value.className).toContain("line-clamp-2");
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
    expect(titles()).toEqual(["Needs you (2)", "Other uploads (1 of 2 filled)"]);
    expect(labels()).toEqual(["Email", "LinkedIn", "Resume/CV", "Cover Letter"]);
  });

  it("stay out of the other groups' counts", () => {
    show([upload("Resume/CV", true), holding("Email", true, "a@example.test")]);
    expect(titles()).toEqual(["Other uploads (0 of 1 filled)"]);
  });

  it("show no section when the form has none", () => {
    show([row("Email", true)]);
    expect(titles()).toEqual(["Needs you (1)"]);
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

describe("suggestions", () => {
  const weekends: BankEntry = { id: "w", question: "Willing to work weekends?", answer: "Yes", category: "OTHER" };
  const unmatched = row("Can you support Saturday/Sunday shifts?", true, "manual", { reason: "No answer in the bank.", suggestions: [weekends] });
  const onSuggest = vi.fn();
  const showWith = (rows: ReviewRow[], isFilling = false) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => { root!.render(<ReviewList rows={rows} isFilling={isFilling} onGoTo={onGoTo} onSuggest={onSuggest} />); });
  };

  it("offers saved answers for a question nothing matched, each with what it was saved for and Use", () => {
    showWith([unmatched]);
    const box = host.querySelector("[data-slot='review-suggestions']")!;
    expect(box.textContent).toContain("Saved answers that might fit");
    expect(box.textContent).toContain("No saved answer matched this question.");
    expect(box.querySelector("[data-slot='suggestion-answer']")!.textContent).toBe("Yes");
    expect(box.querySelector("[data-slot='suggestion-question']")!.textContent).toBe("Saved for “Willing to work weekends?”");
    const use = box.querySelector<HTMLButtonElement>("[data-slot='suggestion-use']")!;
    expect(use.textContent).toBe("Use");
    act(() => { use.click(); });
    expect(onSuggest).toHaveBeenCalledWith(unmatched, weekends);
  });

  it("waits while a run fills the form", () => {
    showWith([unmatched], true);
    expect(host.querySelector<HTMLButtonElement>("[data-slot='suggestion-use']")!.disabled).toBe(true);
  });

  it("goes once the field is filled", () => {
    showWith([{ ...unmatched, field: { ...unmatched.field, current: "Yes" } }]);
    expect(host.querySelector("[data-slot='review-suggestions']")).toBeNull();
  });
});

describe("a long saved answer and a long dropdown (07 Q54)", () => {
  it("shows a long answer on four lines until Show all, wrapping instead of running off the panel", () => {
    const long: BankEntry = { id: "l", question: "Why do you want to work here?", answer: "Because ".repeat(40).trim(), category: "OTHER" };
    const unmatched = row("Why us?", false, "manual", { reason: "No answer in the bank.", suggestions: [long] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => { root!.render(<ReviewList rows={[unmatched]} isFilling={false} onGoTo={onGoTo} onSuggest={vi.fn()} />); });
    const answer = host.querySelector("[data-slot='suggestion-answer']")!;
    expect(answer.className).toContain("wrap-anywhere");
    expect(answer.className).toContain("line-clamp-4");
    const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find(({ textContent }) => textContent === "Show all")!;
    act(() => { more.click(); });
    expect(answer.className).not.toContain("line-clamp-4");
    expect(more.textContent).toBe("Show less");
  });

  it("lists eight options, then all of them on request, with no scroll", async () => {
    const options = Array.from({ length: 10 }, (_, index) => `Option ${index + 1}`);
    const dropdown = row("Country", true, "manual", { canChoose: true, field: { label: "Country", required: true, current: "", kind: "combobox" } as TabField });
    show([]);
    act(() => { root!.render(<ReviewList rows={[dropdown]} isFilling={false} onGoTo={onGoTo} onListOptions={async () => options} onChoose={vi.fn()} />); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-slot='choice-open']")!.click(); });
    const list = () => [...host.querySelectorAll("[data-slot='choice-list'] button")];
    expect(list()).toHaveLength(8);
    expect(host.querySelector("[data-slot='choice-list']")!.className).not.toContain("overflow");
    act(() => { host.querySelector<HTMLButtonElement>("[data-slot='choice-all']")!.click(); });
    expect(list()).toHaveLength(10);
    expect(host.querySelector("[data-slot='choice-all']")).toBeNull();
  });
});

describe("keeping a typed answer (07 Q58)", () => {
  const offer = { label: "Save for next time", change: { add: { "Why us?": "Payments." } } };
  const renderWith = (rows: ReviewRow[], onSave = vi.fn().mockResolvedValue(true)) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => { root!.render(<ReviewList rows={rows} isFilling={false} onGoTo={onGoTo} onSave={onSave} />); });
    return onSave;
  };

  it("lists what the BDE typed first, each with its button and Only this résumé", async () => {
    const typedRow = holding("Why us?", false, "Payments.", "same", { saveOffer: offer });
    const onSave = renderWith([row("Email", true), typedRow]);
    expect(titles()).toEqual(["Save for next time (1)", "Needs you (1)"]);
    const box = host.querySelector<HTMLInputElement>("[data-slot='review-save'] input")!;
    act(() => { box.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-slot='review-save'] button")!.click(); });
    expect(onSave).toHaveBeenCalledWith(typedRow, true);
  });

  it("says once it's saved, under the filled fields", () => {
    renderWith([holding("Why us?", false, "Payments.", "same", { saveOffer: "saved" })]);
    expect(titles()).toEqual([]);
    act(() => { host.querySelector<HTMLButtonElement>("[data-slot='review-filled-toggle']")!.click(); });
    expect(host.querySelector("[data-slot='review-saved-note']")!.textContent).toBe("Saved for next time");
    expect(host.querySelector("[data-slot='review-save']")).toBeNull();
  });
});
