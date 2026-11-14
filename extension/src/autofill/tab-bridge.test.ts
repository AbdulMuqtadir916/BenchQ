import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChrome, type FakeChrome } from "../test/fake-chrome";
import { addEntryIn, chooseChoice, fillChoice, fillField, flaggedFields, focusField, listChoices, readTab, rejectedFields, scanTab, undoCount, undoFills } from "./tab-bridge";
import type { ScannedField } from "./types";

type Injection = { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; func?: (...args: never[]) => unknown; args?: unknown[]; files?: string[] };

const scope = globalThis as { __benchqAutofill?: Record<string, ReturnType<typeof vi.fn>> };

let fake: FakeChrome;
let page: Record<string, ReturnType<typeof vi.fn>>;

/** Runs the injected function here, once per frame, as Chrome would in each frame's page. */
function frames(...ids: number[]) {
  fake.scripting.executeScript.mockImplementation(async (...calls: unknown[]) => {
    const { target, func, args } = calls[0] as Injection;
    if (!func) return [];
    const inFrames = target.frameIds ?? ids;
    return Promise.all(inFrames.map(async (frameId) => ({ frameId, result: await (func as (...values: unknown[]) => unknown)(...(args ?? [])) })));
  });
}

const field = (id: string): ScannedField => ({
  id, kind: "text", label: id, hints: "", autocomplete: "", required: false, current: "", options: [], maxLength: null,
  inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});

const request = { scanId: 3, fieldId: "f0", current: "", search: "" };

beforeEach(() => {
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  page = {
    scan: vi.fn(), read: vi.fn(), fill: vi.fn(), openChoices: vi.fn(), searchChoices: vi.fn(), pickChoice: vi.fn(), closeChoices: vi.fn(() => true),
    rejected: vi.fn(() => []), flagged: vi.fn(async () => []), focusField: vi.fn(() => false), undo: vi.fn(), undoCount: vi.fn(() => 0),
  };
  scope.__benchqAutofill = page;
  frames(0);
});

afterEach(() => {
  delete scope.__benchqAutofill;
});

describe("scanTab", () => {
  it("injects the page script into every frame first", async () => {
    page.scan!.mockResolvedValue({ scanId: 1, url: "https://a.test/", fields: [], signals: null });
    await scanTab(7);
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ["page.js"] });
  });

  it("gathers every frame's fields and scan ids, tagged with where they came from", async () => {
    frames(0, 4);
    page.scan!
      .mockResolvedValueOnce({ scanId: 1, url: "https://a.test/", fields: [field("a")], signals: { title: "Top" } })
      .mockResolvedValueOnce({ scanId: 9, url: "https://b.test/", fields: [field("b")], signals: null });
    const scan = await scanTab(7);
    expect(scan.fields.map(({ id, frameId, pageUrl }) => [id, frameId, pageUrl])).toEqual([["a", 0, "https://a.test/"], ["b", 4, "https://b.test/"]]);
    expect([...scan.scanIds]).toEqual([[0, 1], [4, 9]]);
    expect(scan.signals).toEqual({ title: "Top" });
  });

  it("counts the frames it couldn't read, not blank ones", async () => {
    page.scan!.mockResolvedValue({ scanId: 1, url: "https://a.test/", fields: [], signals: null });
    fake.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, url: "https://a.test/" }, { frameId: 5, url: "https://locked.test/" }, { frameId: 6, url: "about:blank" },
    ]);
    expect((await scanTab(7)).unreadableFrames).toBe(1);
  });

  it("passes on Chrome's refusal of a page it can't touch", async () => {
    fake.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    await expect(scanTab(7)).rejects.toThrow("Cannot access");
  });

  it("reports why the page's script failed", async () => {
    page.scan!.mockRejectedValue(new TypeError("Cannot read properties of null"));
    await expect(scanTab(7)).rejects.toThrow("Cannot read properties of null");
  });

  it("carries on without a frame whose script failed, and counts it", async () => {
    frames(0, 4);
    page.scan!
      .mockResolvedValueOnce({ scanId: 1, url: "https://a.test/", fields: [field("a")], signals: null })
      .mockRejectedValueOnce(new Error("Broken frame"));
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "https://a.test/" }, { frameId: 4, url: "https://b.test/" }]);
    const scan = await scanTab(7);
    expect(scan.fields.map(({ id }) => id)).toEqual(["a"]);
    expect(scan.unreadableFrames).toBe(1);
  });

  it("skips a frame where the page script isn't installed", async () => {
    delete scope.__benchqAutofill;
    const scan = await scanTab(7);
    expect(scan.fields).toEqual([]);
  });
});

describe("readTab", () => {
  const known = { scanIds: new Map([[0, 3]]), unreadableFrames: 0 };
  const read = (values: Record<string, string> = {}, change: object = {}) => ({ scanId: 3, values, moved: false, ...change });

  it("gathers every frame's values, by frame and field", async () => {
    frames(0, 2);
    page.read!.mockReturnValueOnce(read({ f0: "Dallas" })).mockReturnValueOnce(read({ f0: "Plano", f1: "Texas" }));
    const { values, moved } = await readTab(7, { scanIds: new Map([[0, 3], [2, 3]]), unreadableFrames: 0 });
    expect([...values]).toEqual([["0:f0", "Dallas"], ["2:f0", "Plano"], ["2:f1", "Texas"]]);
    expect(moved).toBe(false);
  });

  it("doesn't inject anything", async () => {
    page.read!.mockReturnValue(read());
    await readTab(7, known);
    expect(fake.scripting.executeScript.mock.calls.flat().some((call) => (call as unknown as Injection).files)).toBe(false);
  });

  it("says the form moved when a frame says so", async () => {
    page.read!.mockReturnValue(read({}, { moved: true }));
    expect((await readTab(7, known)).moved).toBe(true);
  });

  it("says it moved when a frame has scanned since", async () => {
    page.read!.mockReturnValue(read({}, { scanId: 4 }));
    expect((await readTab(7, known)).moved).toBe(true);
  });

  it("says it moved when a frame has gone", async () => {
    page.read!.mockReturnValue(read());
    expect((await readTab(7, { scanIds: new Map([[0, 3], [2, 3]]), unreadableFrames: 0 })).moved).toBe(true);
  });

  it("says it moved when a page has lost its script", async () => {
    delete scope.__benchqAutofill;
    expect((await readTab(7, known)).moved).toBe(true);
  });

  it("says it moved when a new frame arrives, such as a form embedded late", async () => {
    page.read!.mockReturnValue(read());
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "https://jobs.acme.test" }, { frameId: 9, url: "https://boards.greenhouse.io/x" }]);
    expect((await readTab(7, known)).moved).toBe(true);
  });

  it("stays put when the frames it couldn't read haven't changed", async () => {
    page.read!.mockReturnValue(read());
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "https://jobs.acme.test" }, { frameId: 9, url: "https://ads.test" }]);
    expect((await readTab(7, { ...known, unreadableFrames: 1 })).moved).toBe(false);
  });

  it("passes on a page it can't reach", async () => {
    fake.scripting.executeScript.mockRejectedValue(new Error("No tab with id: 7"));
    await expect(readTab(7, known)).rejects.toThrow("No tab");
  });
});

describe("fillField", () => {
  it("runs in the field's own frame", async () => {
    page.fill!.mockResolvedValue({ status: "filled", current: "x" });
    const fill = { scanId: 1, fieldId: "f0", current: "", write: { type: "text" as const, value: "x" } };
    expect(await fillField(7, 4, fill)).toEqual({ status: "filled", current: "x" });
    expect(fake.scripting.executeScript.mock.calls[0]).toMatchObject([{ target: { tabId: 7, frameIds: [4] } }]);
    expect(page.fill).toHaveBeenCalledWith(fill);
  });

  it("calls the field stale when its page has gone", async () => {
    delete scope.__benchqAutofill;
    const fill = { scanId: 1, fieldId: "f0", current: "", write: { type: "text" as const, value: "x" } };
    expect(await fillField(7, 0, fill)).toEqual({ status: "stale", current: "" });
  });
});

describe("fillChoice", () => {
  it("matches the answer to what the dropdown offers, then picks it", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Yes" }, { id: "c1", label: "No" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "No" });
    expect(await fillChoice(7, 0, request, "No, thanks")).toEqual({ status: "filled", current: "No" });
    expect(page.pickChoice).toHaveBeenCalledWith({ ...request, optionId: "c1" });
    expect(page.closeChoices).not.toHaveBeenCalled();
  });

  it("closes the list untouched when no option clearly fits", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Red" }] });
    expect(await fillChoice(7, 0, request, "Purple")).toEqual({ status: "no-match", current: "" });
    expect(page.pickChoice).not.toHaveBeenCalled();
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("names the options when the answer fits several", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "East Asian" }, { id: "c1", label: "South Asian" }] });
    expect(await fillChoice(7, 0, request, "Asian")).toEqual({
      status: "no-match", current: "", reason: "This answer fits East Asian and South Asian. Pick the right one yourself.",
    });
    expect(page.pickChoice).not.toHaveBeenCalled();
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("closes the list when nothing came up", async () => {
    page.openChoices!.mockResolvedValue({ status: "empty" });
    expect((await fillChoice(7, 0, request, "Yes")).status).toBe("no-match");
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("knows answers that say the same thing in other words", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Permanent Resident" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Permanent Resident" });
    expect((await fillChoice(7, 0, request, "Green Card")).status).toBe("filled");
  });

  const longList = Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, label: `School ${index}` }));

  it("searches a long list for an answer it doesn't show", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: longList });
    page.searchChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Rice University" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Rice University" });
    expect((await fillChoice(7, 0, request, "Rice University")).status).toBe("filled");
    expect(page.pickChoice).toHaveBeenCalledWith({ ...request, optionId: "c0" });
  });

  it("closes a long list when the search finds nothing either", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: longList });
    page.searchChoices!.mockResolvedValue({ status: "empty" });
    expect((await fillChoice(7, 0, request, "Rice University")).status).toBe("no-match");
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("searches a short list too when nothing on show fits: a lookup shows only its first suggestions", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Austin, Texas, United States" }] });
    page.searchChoices!.mockResolvedValue({ status: "open", options: [{ id: "c1", label: "Dallas, Texas, United States" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Dallas, Texas, United States" });
    expect((await fillChoice(7, 0, request, "Dallas, TX")).status).toBe("filled");
    expect(page.searchChoices).toHaveBeenCalledTimes(1);
    expect(page.pickChoice).toHaveBeenCalledWith({ ...request, optionId: "c1" });
  });

  it("doesn't search when an option on show fits", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Red" }, { id: "c1", label: "Purple" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Purple" });
    await fillChoice(7, 0, request, "Purple");
    expect(page.searchChoices).not.toHaveBeenCalled();
  });

  it("passes on a stale or changed field", async () => {
    page.openChoices!.mockResolvedValueOnce({ status: "stale" }).mockResolvedValueOnce({ status: "changed" });
    expect((await fillChoice(7, 0, request, "Yes")).status).toBe("stale");
    expect((await fillChoice(7, 0, request, "Yes")).status).toBe("changed");
  });
});

describe("flaggedFields", () => {
  it("asks the frame which fields the form flagged", async () => {
    page.flagged!.mockResolvedValue(["f1"]);
    expect(await flaggedFields(7, 2, 5, ["f0", "f1"])).toEqual(["f1"]);
    expect(page.flagged).toHaveBeenCalledWith(5, ["f0", "f1"]);
  });
});

describe("focusField", () => {
  it("asks the field's frame to bring it into view", async () => {
    page.focusField!.mockReturnValue(true);
    expect(await focusField(7, 2, { scanId: 5, fieldId: "f1" })).toBe(true);
    expect(page.focusField).toHaveBeenCalledWith({ scanId: 5, fieldId: "f1" });
  });

  it("says no when the page script isn't there", async () => {
    delete scope.__benchqAutofill;
    expect(await focusField(7, 2, { scanId: 5, fieldId: "f1" })).toBe(false);
  });
});

describe("rejectedFields", () => {
  it("asks about one run's fields", async () => {
    page.rejected!.mockReturnValue(["f1"]);
    expect(await rejectedFields(7, 2, 5, ["f0", "f1"])).toEqual(["f1"]);
    expect(page.rejected).toHaveBeenCalledWith(5, ["f0", "f1"]);
  });
});

describe("undo", () => {
  it("adds up every frame", async () => {
    frames(0, 4);
    page.undo!.mockResolvedValueOnce({ restored: 2, kept: 1, skipped: 0 }).mockResolvedValueOnce({ restored: 1, kept: 0, skipped: 1 });
    expect(await undoFills(7)).toEqual({ restored: 3, kept: 1, skipped: 1 });
  });

  it("counts what can be undone across frames", async () => {
    frames(0, 4);
    page.undoCount!.mockReturnValueOnce(2).mockReturnValueOnce(0);
    expect(await undoCount(7)).toBe(2);
  });
});

describe("dropdowns that keep several choices", () => {
  const races = [{ id: "c0", label: "East Asian" }, { id: "c1", label: "South Asian (inclusive of Indian)" }, { id: "c2", label: "White" }];

  it("picks each saved part, opening the list again with the value the last pick left", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", multiple: true, options: races });
    page.pickChoice!
      .mockResolvedValueOnce({ status: "filled", current: "South Asian (inclusive of Indian)" })
      .mockResolvedValueOnce({ status: "filled", current: "South Asian (inclusive of Indian) White" });
    expect((await fillChoice(7, 0, request, "South Asian, White")).status).toBe("filled");
    expect(page.pickChoice!.mock.calls.map(([call]) => (call as { optionId: string }).optionId)).toEqual(["c1", "c2"]);
    expect(page.openChoices!.mock.calls[2]?.[0]).toMatchObject({ current: "South Asian (inclusive of Indian)" });
  });

  it("picks none of them when one part has no option", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", multiple: true, options: [races[0], races[2]] });
    page.searchChoices!.mockResolvedValue({ status: "empty" });
    expect((await fillChoice(7, 0, request, "South Asian, White")).status).toBe("no-match");
    expect(page.pickChoice).not.toHaveBeenCalled();
  });
});

describe("other wordings and the panel's own pick", () => {
  it("tries the other wordings it's given when the answer has no option", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [
      { id: "c0", label: "I am authorized to work in the U.S. for any employer" },
      { id: "c1", label: "I am authorized to work in the U.S. but will require sponsorship" },
      { id: "c2", label: "I am not authorized to work in the U.S." },
    ] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "I am authorized to work in the U.S. but will require sponsorship" });
    await fillChoice(7, 0, request, "H-1B", ["Authorized to work in the US, will require sponsorship"]);
    expect(page.pickChoice).toHaveBeenCalledWith({ ...request, optionId: "c1" });
  });

  it("lists a dropdown's options for the panel, closing it again, and picks the one chosen there", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Red" }, { id: "c1", label: "Blue" }] });
    expect(await listChoices(7, 0, request)).toEqual(["Red", "Blue"]);
    expect(page.closeChoices).toHaveBeenCalled();
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Blue" });
    expect(await chooseChoice(7, 0, request, "Blue")).toEqual({ status: "filled", current: "Blue" });
    expect(page.pickChoice).toHaveBeenCalledWith({ ...request, optionId: "c1" });
  });
});

describe("the panel's hold, when the tab moves on to another job mid-write (PR #140's review)", () => {
  let isHeld = false;
  const shouldStop = () => isHeld;
  beforeEach(() => { isHeld = false; });

  it("picks nothing when the hold starts while the list opens, and closes the list again", async () => {
    page.openChoices!.mockImplementation(async () => {
      isHeld = true;
      return { status: "open", options: [{ id: "c0", label: "Yes" }] };
    });
    expect(await fillChoice(7, 0, request, "Yes", [], shouldStop)).toEqual({ status: "stale", current: "" });
    expect(page.pickChoice).not.toHaveBeenCalled();
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("picks nothing when the hold starts while the list is searched", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Austin, Texas, United States" }] });
    page.searchChoices!.mockImplementation(async () => {
      isHeld = true;
      return { status: "open", options: [{ id: "c1", label: "Dallas, Texas, United States" }] };
    });
    expect((await fillChoice(7, 0, request, "Dallas, TX", [], shouldStop)).status).toBe("stale");
    expect(page.pickChoice).not.toHaveBeenCalled();
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("picks no further part of a several-choice answer once the hold starts", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", multiple: true, options: [{ id: "c0", label: "Python" }, { id: "c1", label: "Java" }] });
    page.pickChoice!.mockImplementation(async () => {
      isHeld = true;
      return { status: "filled", current: "Python" };
    });
    expect((await fillChoice(7, 0, request, "Python, Java", [], shouldStop)).status).toBe("stale");
    expect(page.pickChoice).toHaveBeenCalledTimes(1);
  });

  it("doesn't pick the option chosen in the panel when the hold starts while the list opens", async () => {
    page.openChoices!.mockImplementation(async () => {
      isHeld = true;
      return { status: "open", options: [{ id: "c0", label: "Blue" }] };
    });
    expect((await chooseChoice(7, 0, request, "Blue", shouldStop)).status).toBe("stale");
    expect(page.pickChoice).not.toHaveBeenCalled();
    expect(page.closeChoices).toHaveBeenCalled();
  });

  it("clicks no Add when the hold starts while the frames are listed", async () => {
    page.addEntry = vi.fn(() => false);
    fake.webNavigation.getAllFrames.mockImplementation(async () => {
      isHeld = true;
      return [{ frameId: 0, url: "https://jobs.example.com/a" }, { frameId: 3, url: "https://jobs.example.com/form" }];
    });
    expect(await addEntryIn(7, "work", shouldStop)).toBe(false);
    expect(page.addEntry).not.toHaveBeenCalled();
  });

  it("tries no later frame's Add once the hold starts", async () => {
    page.addEntry = vi.fn(() => {
      isHeld = true;
      return false;
    });
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "https://jobs.example.com/a" }, { frameId: 3, url: "https://jobs.example.com/form" }]);
    expect(await addEntryIn(7, "work", shouldStop)).toBe(false);
    expect(page.addEntry).toHaveBeenCalledTimes(1);
  });

  it("writes as before when there is no hold", async () => {
    page.openChoices!.mockResolvedValue({ status: "open", options: [{ id: "c0", label: "Yes" }] });
    page.pickChoice!.mockResolvedValue({ status: "filled", current: "Yes" });
    expect(await fillChoice(7, 0, request, "Yes", [], shouldStop)).toEqual({ status: "filled", current: "Yes" });
    page.addEntry = vi.fn(() => true);
    fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: "https://jobs.example.com/a" }]);
    expect(await addEntryIn(7, "education", shouldStop)).toBe(true);
  });
});
