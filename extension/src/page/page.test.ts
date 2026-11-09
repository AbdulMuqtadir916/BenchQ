// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFiller } from "./fill";
import { readFields, scanDocument, waitForQuiet, type Registry } from "./scan";

/** jsdom has no layout, so everything is "visible" unless a test hides it. */
beforeEach(() => {
  Element.prototype.getClientRects = function getClientRects(this: Element) {
    return (this.closest("[data-hidden]") ? [] : [{}]) as unknown as DOMRectList;
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function scan(html: string, scanId = 1) {
  document.body.innerHTML = html;
  return scanDocument(document, scanId, true);
}

const labelled = (html: string) => scan(html).scan.fields.map(({ label }) => label);

describe("reading labels", () => {
  it.each([
    ["for", `<label for="a">First Name</label><input id="a">`],
    ["wrapping", `<label>First Name <input></label>`],
    ["aria-labelledby", `<span id="x">First Name</span><input aria-labelledby="x">`],
    ["aria-label", `<input aria-label="First Name">`],
    ["nearby text", `<div><div>First Name</div><input></div>`],
    ["nearby text a level up", `<div><div>First Name</div><div><input></div></div>`],
    ["placeholder", `<input placeholder="First Name">`],
    ["title", `<input title="First Name">`],
  ])("reads a label from %s", (_how, html) => {
    expect(labelled(html)).toEqual(["First Name"]);
  });

  it("leaves a select's options out of its wrapping label", () => {
    expect(labelled(`<label>Country <select><option>Canada</option></select></label>`)).toEqual(["Country"]);
  });

  it("doesn't borrow the label of the field before", () => {
    expect(labelled(`<div>First</div><input><input>`)[1]).toBe("");
  });

  it("strips required markers and trailing colons, and notes that it's required", () => {
    const [field] = scan(`<label for="a">Email * :</label><input id="a">`).scan.fields;
    expect(field).toMatchObject({ label: "Email", required: true });
    expect(scan(`<label for="a">Email (required)</label><input id="a">`).scan.fields[0]).toMatchObject({ label: "Email", required: true });
    expect(scan(`<label for="a">Email (optional)</label><input id="a">`).scan.fields[0]).toMatchObject({ label: "Email", required: false });
    expect(scan(`<input aria-label="Email" aria-required="true">`).scan.fields[0]?.required).toBe(true);
    expect(scan(`<input aria-label="Email" required>`).scan.fields[0]?.required).toBe(true);
  });

  it("goes by a label that says optional, whatever the markup says", () => {
    expect(scan(`<label for="a">Race or Ethnicity (optional)</label><input id="a" aria-required="true">`).scan.fields[0])
      .toMatchObject({ label: "Race or Ethnicity", required: false });
    expect(scan(`<label for="a">LinkedIn optional</label><input id="a" required>`).scan.fields[0])
      .toMatchObject({ label: "LinkedIn", required: false });
  });

  it("reads whether a group is required from the group itself", () => {
    const choice = (text: string) => `<label><input type="radio" name="shift">${text}</label>`;
    expect(scan(`<fieldset aria-required="true"><legend>Shift</legend>${choice("Day")}${choice("Night")}</fieldset>`).scan.fields[0])
      .toMatchObject({ label: "Shift", kind: "radio", required: true });
    expect(scan(`<fieldset><legend>Shift (optional)</legend>${choice("Day")}${choice("Night")}</fieldset>`).scan.fields[0])
      .toMatchObject({ label: "Shift", required: false });
  });
});

describe("which controls count", () => {
  it("names each kind of control", () => {
    const kinds = scan(`
      <input aria-label="a"><input aria-label="b" type="email"><input aria-label="c" type="tel"><input aria-label="d" type="url">
      <input aria-label="e" type="number"><input aria-label="f" type="date"><textarea aria-label="g"></textarea>
      <select aria-label="h"><option>x</option></select><input aria-label="i" type="password"><input aria-label="j" type="file">
      <input aria-label="k" type="color">`).scan.fields.map(({ kind }) => kind);
    expect(kinds).toEqual(["text", "email", "tel", "url", "number", "date", "textarea", "select", "password", "file", "custom"]);
  });

  it("skips what a person can't use", () => {
    const fields = scan(`
      <input type="hidden" name="a"><input type="submit"><input type="button"><input aria-label="off" disabled>
      <fieldset disabled><input aria-label="off too"></fieldset><div data-hidden><input aria-label="unseen"></div>
      <input aria-label="on">`).scan.fields;
    expect(fields.map(({ label }) => label)).toEqual(["on"]);
  });

  it("skips the hidden input a custom dropdown keeps beside it", () => {
    expect(scan(`<input aria-label="on"><input required tabindex="-1" aria-hidden="true">`).scan.fields).toHaveLength(1);
  });

  it("treats a read-only control as one it can't fill, and a multiple select as a list of choices", () => {
    const fields = scan(`<input aria-label="a" readonly><select aria-label="b" multiple><option>x</option></select>`).scan.fields;
    expect(fields.map(({ kind }) => kind)).toEqual(["custom", "checkbox"]);
  });

  it("marks every field of a sign-in form", () => {
    const [email] = scan(`<form><input aria-label="Email"><input type="password" aria-label="Password"></form>`).scan.fields;
    expect(email?.inAccountForm).toBe(true);
  });

  it("collects what the engine reads about a field", () => {
    const [field] = scan(`<h2>About you</h2><div><input id="i" name="n" class="c" data-qa="q" placeholder="p" aria-label="Label"></div>`).scan.fields;
    expect(field?.clues).toMatchObject({ name: "n", id: "i", className: "c", placeholder: "p", ariaLabel: "Label", dataAttrs: "data-qa q", sectionHeading: "About you" });
  });

  it("never reads a password", () => {
    expect(scan(`<input type="password" aria-label="p" value="secret">`).scan.fields[0]?.current).toBe("");
  });

  it("doesn't change the page", () => {
    const html = `<form><label for="a">Name</label><input id="a" value="x"><select aria-label="s"><option>o</option></select>
      <input role="combobox" aria-label="c"></form>`;
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    scanDocument(document, 1, true);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe("choices", () => {
  it("lists a select's options without its placeholder or disabled ones", () => {
    const [field] = scan(`<select aria-label="s"><option value="">Select...</option><option>Yes</option><option disabled>Maybe</option><option>No</option></select>`).scan.fields;
    expect(field?.options.map(({ label }) => label)).toEqual(["Yes", "No"]);
    expect(field?.current).toBe("");
  });

  it("reads a select's current choice", () => {
    expect(scan(`<select aria-label="s"><option value="1">Yes</option><option value="2" selected>No</option></select>`).scan.fields[0]?.current).toBe("No");
  });

  it("gathers radios under the fieldset's question", () => {
    const fields = scan(`<fieldset><legend>Do you need sponsorship?</legend>
      <label><input type="radio" name="s" value="1" checked> Yes</label><label><input type="radio" name="s" value="0"> No</label></fieldset>`).scan.fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: "radio", label: "Do you need sponsorship?", current: "Yes" });
    expect(fields[0]?.options.map(({ label }) => label)).toEqual(["Yes", "No"]);
  });

  it("gathers radios under the text before them when there's no fieldset", () => {
    const [field] = scan(`<div><div>Relocate?</div><ul><li><label><input type="radio" name="r"> Yes</label></li><li><label><input type="radio" name="r"> No</label></li></ul></div>`).scan.fields;
    expect(field?.label).toBe("Relocate?");
  });

  it("keeps same-named radios of different forms apart", () => {
    expect(scan(`<form><input type="radio" name="r" aria-label="a"></form><form><input type="radio" name="r" aria-label="b"></form>`).scan.fields).toHaveLength(2);
  });

  it("gathers same-named checkboxes", () => {
    const [field] = scan(`<fieldset><legend>Setting</legend><label><input type="checkbox" name="w"> Remote</label><label><input type="checkbox" name="w" checked> Onsite</label></fieldset>`).scan.fields;
    expect(field).toMatchObject({ kind: "checkbox", current: "Onsite" });
  });

  it("names an option by the text beside it, not the label wrapped around it all", () => {
    const { fields } = scan(`<fieldset><legend>Race</legend><label>Race <input type="radio" name="r"><span>Asian</span><div>A person having origins in the Far East</div></label></fieldset>`).scan;
    expect(fields[0]!.options[0]!.label).toBe("Asian");
  });

  it("leaves a list of descriptions out of a label", () => {
    expect(labelled(`<label>Race <ul><li>Asian: a person having origins in the Far East</li></ul><select><option>Asian</option></select></label>`)).toEqual(["Race"]);
  });

  it("treats a nameless box with its own value as an option, not a field", () => {
    expect(labelled(`<label><input type="checkbox" value="Custom"> Custom</label><label><input type="checkbox"> I agree</label>`)).toEqual(["I agree"]);
  });

  it("keeps a styled radio whose input is hidden but label shows", () => {
    expect(scan(`<input id="r" type="radio" name="r" data-hidden><label for="r">Yes</label>`).scan.fields).toHaveLength(1);
  });

  it("reads a custom dropdown's shown value, not its search box", () => {
    const [empty] = scan(`<div class="select__control"><div class="select__placeholder">Select...</div><input role="combobox" aria-label="c"></div>`).scan.fields;
    expect(empty).toMatchObject({ kind: "combobox", current: "" });
    const [chosen] = scan(`<div class="select__control"><div class="select__single-value">Yes</div><input role="combobox" aria-label="c"></div>`).scan.fields;
    expect(chosen?.current).toBe("Yes");
  });

  it("lists a dropdown built from a button", () => {
    const [field] = scan(`<button aria-haspopup="listbox" aria-label="Country">Select One</button>`).scan.fields;
    expect(field).toMatchObject({ kind: "combobox", label: "Country", current: "" });
  });
});

describe("a phone number's country dropdown", () => {
  const phone = `<fieldset><legend>Phone</legend><label for="c">Country</label><input id="c" role="combobox"><label for="t">Phone</label><input id="t" type="tel"></fieldset>`;

  it("goes by what it's for, not its label", () => {
    expect(labelled(phone)).toEqual(["Phone country code", "Phone"]);
  });

  it("stays apart from the address's country", () => {
    expect(labelled(`<label for="a">Country</label><input id="a">${phone}`)).toEqual(["Country", "Phone country code", "Phone"]);
  });
});

describe("page signals", () => {
  it("reads the title, heading and posting", () => {
    document.head.innerHTML = `<meta property="og:site_name" content="Acme"><script type="application/ld+json">
      {"@type":"JobPosting","title":"Java Dev","hiringOrganization":{"name":"Acme"}}</script>`;
    document.title = "Apply";
    const { signals } = scan(`<h1>Java Dev</h1>`).scan;
    expect(signals).toMatchObject({ title: "Apply", heading: "Java Dev", siteName: "Acme", posting: { title: "Java Dev", company: "Acme" } });
  });

  it("finds a posting inside a graph, and survives broken data", () => {
    document.head.innerHTML = `<script type="application/ld+json">{ broken</script>
      <script type="application/ld+json">{"@graph":[{"@type":"Org"},{"@type":["JobPosting"],"title":"Dev","hiringOrganization":"Acme"}]}</script>`;
    expect(scan(``).scan.signals?.posting).toEqual({ title: "Dev", company: "Acme" });
  });
});

describe("waitForQuiet", () => {
  it("waits for the page to stop changing", async () => {
    vi.useFakeTimers();
    let done = false;
    void waitForQuiet(document).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(200);
    document.body.appendChild(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

/** A registry the filler reads, and helpers that scan and act the way the panel does. */
function setup(html: string) {
  let registry: Registry | null = null;
  const filler = createFiller(() => registry);
  let scans = 0;
  const rescan = () => {
    scans += 1;
    const result = scanDocument(document, scans, true);
    registry = result.registry;
    return result.scan;
  };
  document.body.innerHTML = html;
  return { filler, rescan };
}

const element = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

describe("filling", () => {
  it("writes text, fires the events a page listens for, and reports what stuck", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name">`);
    const seen: string[] = [];
    for (const type of ["input", "change", "blur", "focusout"]) element("#a").addEventListener(type, () => seen.push(type));
    const { scanId, fields } = rescan();
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "Priya" }, current: "" });
    expect(result).toEqual({ status: "filled", current: "Priya" });
    expect(element<HTMLInputElement>("#a").value).toBe("Priya");
    expect(seen).toEqual(["input", "change", "blur", "focusout"]);
  });

  it("writes past a framework's value tracker", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name">`);
    const input = element<HTMLInputElement>("#a");
    const tracked: string[] = [];
    Object.defineProperty(input, "value", {
      configurable: true,
      get() { return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.get!.call(this); },
      set(next: string) { tracked.push(next); },
    });
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "Priya" }, current: "" });
    expect(tracked).toEqual([]);
    expect(input.value).toBe("Priya");
  });

  it("leaves a field that changed after the review", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name">`);
    const { scanId, fields } = rescan();
    element<HTMLInputElement>("#a").value = "Typed by the BDE";
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "Priya" }, current: "" });
    expect(result).toEqual({ status: "changed", current: "Typed by the BDE" });
    expect(element<HTMLInputElement>("#a").value).toBe("Typed by the BDE");
  });

  it("stops at a field that's gone", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name">`);
    const { scanId, fields } = rescan();
    element("#a").remove();
    expect((await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "x" }, current: "" })).status).toBe("stale");
  });

  it("puts back what a field held when the page refuses the new value", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name" value="old">`);
    element<HTMLInputElement>("#a").addEventListener("input", (event) => { (event.target as HTMLInputElement).value = "mangled"; }, { once: true });
    const { scanId, fields } = rescan();
    expect(await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "new" }, current: "old" })).toEqual({ status: "failed", current: "old" });
    expect(element<HTMLInputElement>("#a").value).toBe("old");
  });

  it("reports a value the page refused", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="Name">`);
    element<HTMLInputElement>("#a").addEventListener("input", (event) => { (event.target as HTMLInputElement).value = ""; });
    const { scanId, fields } = rescan();
    expect((await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "x" }, current: "" })).status).toBe("failed");
  });

  it.each([["(602) 555-0189"], ["+1 602 555 0189"]])("accepts a number the page reformats to %s", async (shown) => {
    const { filler, rescan } = setup(`<input id="a" type="text" aria-label="Phone">`);
    element<HTMLInputElement>("#a").addEventListener("input", (event) => { (event.target as HTMLInputElement).value = shown; });
    const { scanId, fields } = rescan();
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "6025550189" }, current: "" });
    expect(result).toEqual({ status: "filled", current: shown });
  });

  it("selects an option, and fires change on the select", async () => {
    const { filler, rescan } = setup(`<select id="s" aria-label="s"><option value="">Select</option><option value="1">Yes</option><option value="0">No</option></select>`);
    const change = vi.fn();
    element("#s").addEventListener("change", change);
    const { scanId, fields } = rescan();
    const field = fields[0]!;
    const optionId = field.options.find(({ label }) => label === "No")!.id;
    expect((await filler.fill({ scanId, fieldId: field.id, write: { type: "option", optionId }, current: "" })).status).toBe("filled");
    expect(element<HTMLSelectElement>("#s").value).toBe("0");
    expect(change).toHaveBeenCalled();
  });

  it("clicks a radio, so a framework sees the choice", async () => {
    const { filler, rescan } = setup(`<input type="radio" name="r" id="y" aria-label="Yes"><input type="radio" name="r" id="n" aria-label="No">`);
    const click = vi.fn();
    element("#n").addEventListener("click", click);
    const { scanId, fields } = rescan();
    const field = fields[0]!;
    await filler.fill({ scanId, fieldId: field.id, write: { type: "option", optionId: "o1" }, current: "" });
    expect(element<HTMLInputElement>("#n").checked).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it("checks and unchecks a checkbox", async () => {
    const { filler, rescan } = setup(`<input type="checkbox" id="c" aria-label="Relocate">`);
    let { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "check", checked: true }, current: "" });
    expect(element<HTMLInputElement>("#c").checked).toBe(true);
    ({ scanId, fields } = rescan());
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "check", checked: false }, current: "Checked" });
    expect(element<HTMLInputElement>("#c").checked).toBe(false);
  });
});

describe("a group of checkboxes", () => {
  const html = `<input type="checkbox" name="w" id="a" aria-label="Email"><input type="checkbox" name="w" id="b" aria-label="Phone"><input type="checkbox" name="w" id="c" aria-label="Text">`;

  it("checks every option asked for", async () => {
    const { filler, rescan } = setup(html);
    const { scanId, fields } = rescan();
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "check", checked: true, optionIds: ["o0", "o2"] }, current: "" });
    expect(result).toEqual({ status: "filled", current: "Email, Text" });
    expect(["#a", "#b", "#c"].map((id) => element<HTMLInputElement>(id).checked)).toEqual([true, false, true]);
  });

  it("reports the whole write as failed when one box won't stay checked", async () => {
    const { filler, rescan } = setup(html);
    const { scanId, fields } = rescan();
    element("#c").addEventListener("click", (event) => event.preventDefault());
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "check", checked: true, optionIds: ["o0", "o2"] }, current: "" });
    expect(result.status).toBe("failed");
  });
});

describe("the late check", () => {
  it("finds a value the page reset after filling", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A"><input id="b" aria-label="B">`);
    const { scanId, fields } = rescan();
    const [a, b] = fields as [typeof fields[0], typeof fields[0]];
    await filler.fill({ scanId, fieldId: a.id, write: { type: "text", value: "one" }, current: "" });
    await filler.fill({ scanId, fieldId: b.id, write: { type: "text", value: "two" }, current: "" });
    element<HTMLInputElement>("#a").value = "";
    expect(filler.rejected(scanId, [a.id, b.id])).toEqual([a.id]);
    expect(filler.undoCount()).toBe(1);
  });

  it("ignores an older run's field the BDE has since edited", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A">`);
    const first = rescan();
    const fieldId = first.fields[0]!.id;
    await filler.fill({ scanId: first.scanId, fieldId, write: { type: "text", value: "one" }, current: "" });
    element<HTMLInputElement>("#a").value = "edited";
    const second = rescan();
    expect(filler.rejected(second.scanId, [fieldId])).toEqual([]);
  });
});

describe("what the form flagged", () => {
  it("finds a field the form marked invalid and takes its value back", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A"><input id="b" aria-label="B">`);
    const { scanId, fields } = rescan();
    const [a, b] = fields as [typeof fields[0], typeof fields[0]];
    await filler.fill({ scanId, fieldId: a.id, write: { type: "text", value: "one" }, current: "" });
    await filler.fill({ scanId, fieldId: b.id, write: { type: "text", value: "two" }, current: "" });
    element("#a").setAttribute("aria-invalid", "true");
    expect(await filler.flagged(scanId, [a.id, b.id])).toEqual([a.id]);
    expect(element<HTMLInputElement>("#a").value).toBe("");
    expect(element<HTMLInputElement>("#b").value).toBe("two");
    expect(filler.undoCount()).toBe(1);
  });

  it("uses the browser's own checks", async () => {
    const { filler, rescan } = setup(`<input id="a" type="email" aria-label="Email">`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "not an email" }, current: "" });
    expect(await filler.flagged(scanId, [fields[0]!.id])).toEqual([fields[0]!.id]);
  });

  it("leaves a good value alone", async () => {
    const { filler, rescan } = setup(`<input id="a" required aria-label="A" aria-invalid="false">`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "one" }, current: "" });
    expect(await filler.flagged(scanId, [fields[0]!.id])).toEqual([]);
    expect(element<HTMLInputElement>("#a").value).toBe("one");
    expect(filler.undoCount()).toBe(1);
  });

  it("doesn't judge one radio of a required group", async () => {
    const radio = (text: string) => `<label><input type="radio" name="shift" required>${text}</label>`;
    const { filler, rescan } = setup(`<fieldset><legend>Shift</legend>${radio("Day")}${radio("Night")}</fieldset>`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "option", optionId: "o1" }, current: "" });
    expect(await filler.flagged(scanId, [fields[0]!.id])).toEqual([]);
  });

  it("goes by the form's mark on a custom dropdown, whose search box is empty once picked", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"] });
    await filler.openChoices(request);
    await filler.pickChoice({ ...request, optionId: "c1" });
    const box = element<HTMLInputElement>("[role='combobox']");
    box.required = true;
    expect(await filler.flagged(1, [request.fieldId])).toEqual([]);
    box.setAttribute("aria-invalid", "true");
    expect(await filler.flagged(1, [request.fieldId])).toEqual([request.fieldId]);
  });

  it("ignores an older run's fields", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A">`);
    const first = rescan();
    const fieldId = first.fields[0]!.id;
    await filler.fill({ scanId: first.scanId, fieldId, write: { type: "text", value: "one" }, current: "" });
    element("#a").setAttribute("aria-invalid", "true");
    expect(await filler.flagged(rescan().scanId, [fieldId])).toEqual([]);
  });
});

describe("going to a field", () => {
  const scrolled = vi.fn();
  const ringed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = scrolled;
    Element.prototype.animate = ringed;
  });

  it("brings it into view, rings it and focuses it, without touching the form", () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A"><input id="b" aria-label="B">`);
    const { scanId, fields } = rescan();
    const before = document.body.innerHTML;
    expect(filler.focusField({ scanId, fieldId: fields[1]!.id })).toBe(true);
    expect(scrolled.mock.contexts[0]).toBe(element("#b"));
    expect(ringed.mock.contexts[0]).toBe(element("#b"));
    expect(document.activeElement).toBe(element("#b"));
    expect(document.body.innerHTML).toBe(before);
  });

  it("shows a hidden control through what wraps it", () => {
    const radio = (text: string) => `<label><span data-hidden><input type="radio" name="shift"></span>${text}</label>`;
    const { filler, rescan } = setup(`<fieldset><legend>Shift</legend>${radio("Day")}${radio("Night")}</fieldset>`);
    const { scanId, fields } = rescan();
    expect(filler.focusField({ scanId, fieldId: fields[0]!.id })).toBe(true);
    expect(scrolled.mock.contexts[0]).toBe(element("label"));
  });

  it("says so when the page has moved on", () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A">`);
    const { fields } = rescan();
    expect(filler.focusField({ scanId: 99, fieldId: fields[0]!.id })).toBe(false);
    element("#a").remove();
    expect(filler.focusField({ scanId: 1, fieldId: fields[0]!.id })).toBe(false);
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe("undo", () => {
  it("restores what a field held", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A" value="before">`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "after" }, current: "before" });
    expect(await filler.undo()).toEqual({ restored: 1, kept: 0, skipped: 0 });
    expect(element<HTMLInputElement>("#a").value).toBe("before");
    expect(filler.undoCount()).toBe(0);
  });

  it("keeps what the BDE typed since", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A" value="before">`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "after" }, current: "before" });
    element<HTMLInputElement>("#a").value = "typed";
    expect(await filler.undo()).toEqual({ restored: 0, kept: 1, skipped: 0 });
    expect(element<HTMLInputElement>("#a").value).toBe("typed");
  });

  it("restores a select and a radio group", async () => {
    const { filler, rescan } = setup(`<select id="s" aria-label="s"><option value="1" selected>Yes</option><option value="0">No</option></select>
      <input type="radio" name="r" id="y" aria-label="Yes" checked><input type="radio" name="r" id="n" aria-label="No">`);
    const { scanId, fields } = rescan();
    const [select, radio] = fields as [typeof fields[0], typeof fields[0]];
    await filler.fill({ scanId, fieldId: select.id, write: { type: "option", optionId: select.options[1]!.id }, current: "Yes" });
    await filler.fill({ scanId, fieldId: radio.id, write: { type: "option", optionId: "o1" }, current: radio.current });
    await filler.undo();
    expect(element<HTMLSelectElement>("#s").value).toBe("1");
    expect(element<HTMLInputElement>("#y").checked).toBe(true);
  });

  it("counts a field that's gone as kept", async () => {
    const { filler, rescan } = setup(`<input id="a" aria-label="A">`);
    const { scanId, fields } = rescan();
    await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "text", value: "x" }, current: "" });
    element("#a").remove();
    expect(await filler.undo()).toEqual({ restored: 0, kept: 1, skipped: 0 });
  });
});

type DropdownOptions = { options: string[]; searchOnly?: boolean; filters?: boolean; lookupMs?: number; ignoresKeyboard?: boolean; selected?: string };

/** A dropdown shaped like the ones on Greenhouse: the value sits beside the input, and options exist only while open. */
function dropdown({ options, searchOnly = false, filters = false, lookupMs = 0, ignoresKeyboard = false, selected }: DropdownOptions) {
  document.body.innerHTML = `<label id="l">Do you need sponsorship?</label><div class="select__container"><div class="select__control">
    ${selected ? `<div class="select__single-value">${selected}</div>` : `<div class="select__placeholder">Select...</div>`}
    <input class="select__input" id="c" role="combobox" aria-labelledby="l" aria-expanded="false"></div></div>`;
  const input = element<HTMLInputElement>("#c");
  const container = element(".select__container");
  const control = element(".select__control");
  const closeMenu = () => {
    element(".select__menu")?.remove();
    input.setAttribute("aria-expanded", "false");
  };
  const showMenu = (labels: string[]) => {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "select__menu";
    input.setAttribute("aria-expanded", "true");
    for (const label of labels) {
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.textContent = label;
      option.addEventListener("click", () => {
        control.querySelector(".select__placeholder, .select__single-value")?.remove();
        const value = document.createElement("div");
        value.className = "select__single-value";
        value.textContent = label;
        control.prepend(value);
        input.value = "";
        closeMenu();
      });
      menu.appendChild(option);
    }
    container.appendChild(menu);
  };
  const open = () => showMenu(searchOnly ? [] : options);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !ignoresKeyboard) open();
    if (event.key === "Escape") closeMenu();
  });
  control.addEventListener("mousedown", open);
  const search = () => showMenu(options.filter((label) => label.includes(input.value)));
  input.addEventListener("input", () => {
    if (!searchOnly && !filters) return;
    if (lookupMs > 0) setTimeout(search, lookupMs);
    else search();
  });
}

function setupDropdown(options: DropdownOptions) {
  let registry: Registry | null = null;
  const filler = createFiller(() => registry);
  dropdown(options);
  const result = scanDocument(document, 1, true);
  registry = result.registry;
  const request = { scanId: 1, fieldId: result.scan.fields[0]!.id, current: result.scan.fields[0]!.current, search: "" };
  return { filler, request, field: result.scan.fields[0]! };
}

describe("installing the page script", () => {
  const scope = globalThis as { __benchqAutofill?: { version: string; marker?: string } };

  afterEach(() => {
    delete scope.__benchqAutofill;
    vi.resetModules();
  });

  it("stays put on the next scan, keeping what it knows", async () => {
    await import("./index");
    scope.__benchqAutofill!.marker = "still here";
    vi.resetModules();
    await import("./index");
    expect(scope.__benchqAutofill?.marker).toBe("still here");
  });

  it("replaces an older build left in a tab across an update", async () => {
    scope.__benchqAutofill = { version: "old", marker: "stale" };
    await import("./index");
    expect(scope.__benchqAutofill?.marker).toBeUndefined();
    expect(scope.__benchqAutofill?.version).toBe(__PAGE_BUILD__);
  });
});

describe("custom dropdowns", () => {
  it("scans one without opening it", () => {
    const { field } = setupDropdown({ options: ["Yes", "No"] });
    expect(field).toMatchObject({ kind: "combobox", label: "Do you need sponsorship?", current: "", options: [] });
    expect(element(".select__menu")).toBeNull();
  });

  it("opens it, lists the options, and picks one", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"] });
    const list = await filler.openChoices(request);
    expect(list).toEqual({ status: "open", options: [{ id: "c0", label: "Yes" }, { id: "c1", label: "No" }] });
    expect(await filler.pickChoice({ ...request, optionId: "c1" })).toEqual({ status: "filled", current: "No" });
    expect(element(".select__single-value").textContent).toBe("No");
  });

  it("falls back to the mouse when the keyboard doesn't open it", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"], ignoresKeyboard: true });
    expect((await filler.openChoices(request)).status).toBe("open");
  });

  it("types into a list that opens empty", async () => {
    const { filler, request } = setupDropdown({ options: ["Phoenix, Arizona", "Dallas, Texas"], searchOnly: true });
    const list = await filler.openChoices({ ...request, search: "Phoenix" });
    expect(list).toEqual({ status: "open", options: [{ id: "c0", label: "Phoenix, Arizona" }] });
  });

  it("searches a list for what it isn't showing", async () => {
    const { filler, request } = setupDropdown({ options: ["Rice University", "Yale University"], filters: true });
    await filler.openChoices(request);
    const list = await filler.searchChoices({ ...request, search: "Rice" });
    expect(list).toEqual({ status: "open", options: [{ id: "c0", label: "Rice University" }] });
    expect(await filler.pickChoice({ ...request, optionId: "c0" })).toEqual({ status: "filled", current: "Rice University" });
  });

  it("doesn't take the old list for a slow search's answer", async () => {
    const { filler, request } = setupDropdown({ options: ["Rice University", "Yale University"], filters: true, lookupMs: 200 });
    await filler.openChoices(request);
    const list = await filler.searchChoices({ ...request, search: "Yale" });
    expect(list).toEqual({ status: "open", options: [{ id: "c0", label: "Yale University" }] });
  });

  it("closes the list untouched, clearing any search", async () => {
    const { filler, request } = setupDropdown({ options: ["Dallas, Texas"], searchOnly: true });
    await filler.openChoices({ ...request, search: "Dal" });
    filler.closeChoices(request);
    expect(element(".select__menu")).toBeNull();
    expect(element<HTMLInputElement>("#c").value).toBe("");
    expect(element(".select__single-value")).toBeNull();
  });

  it("leaves one that changed after the review", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes"] });
    expect((await filler.openChoices({ ...request, current: "Something else" })).status).toBe("changed");
  });

  it("stops at one that's gone", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes"] });
    element("#c").remove();
    expect((await filler.openChoices(request)).status).toBe("stale");
    expect((await filler.pickChoice({ ...request, optionId: "c0" })).status).toBe("stale");
  });

  it("accepts a dialling code shown for its country", async () => {
    const { filler, request } = setupDropdown({ options: ["United States +1"] });
    await filler.openChoices(request);
    element("[role='option']").addEventListener("click", () => {
      const shown = element(".select__single-value");
      shown.textContent = "";
      shown.append(document.createTextNode("+"), document.createTextNode("1"));
    });
    expect(await filler.pickChoice({ ...request, optionId: "c0" })).toEqual({ status: "filled", current: "+1" });
  });

  it("reads a value split by the marker server rendering leaves", () => {
    const { field } = setupDropdown({ options: ["United States +1"], selected: "+<!-- -->1" });
    expect(field.current).toBe("+1");
  });

  it("reports a pick the page refused", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes"] });
    await filler.openChoices(request);
    element(".select__menu").addEventListener("click", (event) => event.stopPropagation(), true);
    expect((await filler.pickChoice({ ...request, optionId: "c0" })).status).toBe("failed");
    expect(filler.undoCount()).toBe(0);
    expect(element(".select__menu")).toBeNull();
  });

  it("puts back an earlier choice on undo", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"], selected: "Yes" });
    await filler.openChoices(request);
    await filler.pickChoice({ ...request, optionId: "c1" });
    expect(await filler.undo()).toEqual({ restored: 1, kept: 0, skipped: 0 });
    expect(element(".select__single-value").textContent).toBe("Yes");
  });

  it("empties one that was blank with its own clear button", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"] });
    await filler.openChoices(request);
    await filler.pickChoice({ ...request, optionId: "c0" });
    const clear = document.createElement("div");
    clear.className = "select__clear-indicator";
    clear.addEventListener("mousedown", () => element(".select__single-value").remove());
    element(".select__control").append(clear);
    expect(await filler.undo()).toEqual({ restored: 1, kept: 0, skipped: 0 });
    expect(element(".select__single-value")).toBeNull();
  });

  it("says when one that was blank can't be emptied", async () => {
    const { filler, request } = setupDropdown({ options: ["Yes", "No"] });
    await filler.openChoices(request);
    await filler.pickChoice({ ...request, optionId: "c0" });
    expect(await filler.undo()).toEqual({ restored: 0, kept: 0, skipped: 1 });
  });
});

describe("reading a scanned form", () => {
  const registryOf = (html: string) => scan(html).registry;

  it("reads what each field holds now", () => {
    const registry = registryOf(`<input aria-label="City"><select aria-label="State"><option value="">Select</option><option>Texas</option></select>`);
    expect(readFields(document, registry)).toEqual({ scanId: 1, values: { f0: "", f1: "" }, moved: false });
    element<HTMLInputElement>("input").value = "Dallas";
    element<HTMLSelectElement>("select").selectedIndex = 1;
    expect(readFields(document, registry)).toEqual({ scanId: 1, values: { f0: "Dallas", f1: "Texas" }, moved: false });
  });

  it("reads radios and checkboxes", () => {
    const registry = registryOf(`<fieldset><legend>Remote?</legend>
      <label><input type="radio" name="r"> Yes</label><label><input type="radio" name="r"> No</label></fieldset>
      <label><input type="checkbox" name="c"> Text me</label>`);
    document.querySelectorAll<HTMLInputElement>("input")[1]!.checked = true;
    document.querySelectorAll<HTMLInputElement>("input")[2]!.checked = true;
    expect(readFields(document, registry).values).toEqual({ f0: "No", f1: "Checked" });
  });

  it("never reads a password", () => {
    const registry = registryOf(`<input type="password" aria-label="Password" value="secret">`);
    expect(readFields(document, registry).values).toEqual({ f0: "" });
  });

  it("gives an upload's file name and nothing of the file", () => {
    const registry = registryOf(`<input type="file" aria-label="Resume">`);
    expect(readFields(document, registry).values).toEqual({ f0: "" });
    Object.defineProperty(element("input"), "files", { value: [new File(["contents"], "priya-resume.pdf")] });
    expect(readFields(document, registry).values).toEqual({ f0: "priya-resume.pdf" });
  });

  it("names every file of a multiple upload", () => {
    const registry = registryOf(`<input type="file" multiple aria-label="Documents">`);
    Object.defineProperty(element("input"), "files", { value: [new File(["a"], "one.pdf"), new File(["b"], "two.pdf")] });
    expect(readFields(document, registry).values).toEqual({ f0: "one.pdf, two.pdf" });
  });

  it("doesn't change the page", () => {
    const registry = registryOf(`<input aria-label="City" value="Dallas">`);
    const before = document.body.innerHTML;
    readFields(document, registry);
    expect(document.body.innerHTML).toBe(before);
  });

  it("stays put when only values change", () => {
    const registry = registryOf(`<input aria-label="City">`);
    element<HTMLInputElement>("input").value = "Dallas";
    expect(readFields(document, registry).moved).toBe(false);
  });

  it("notices a field that arrives", () => {
    const registry = registryOf(`<input aria-label="City">`);
    document.body.insertAdjacentHTML("beforeend", `<input aria-label="State">`);
    expect(readFields(document, registry).moved).toBe(true);
  });

  it("notices a field that goes", () => {
    const registry = registryOf(`<input aria-label="City"><input aria-label="State">`);
    element("input").remove();
    expect(readFields(document, registry).moved).toBe(true);
  });

  it("notices a field that's hidden, and one that's replaced by another", () => {
    const registry = registryOf(`<div><input aria-label="City"></div>`);
    element("div").setAttribute("data-hidden", "");
    expect(readFields(document, registry).moved).toBe(true);
    const swapped = registryOf(`<input aria-label="City">`);
    element("input").replaceWith(document.createElement("input"));
    expect(readFields(document, swapped).moved).toBe(true);
  });

  it("notices a dropdown getting new options, like states once a country is picked", () => {
    const registry = registryOf(`<select aria-label="State"><option value="">Select</option></select>`);
    element("select").insertAdjacentHTML("beforeend", `<option>Texas</option>`);
    expect(readFields(document, registry).moved).toBe(true);
  });

  it("notices a new option in a group of radios", () => {
    const registry = registryOf(`<fieldset><legend>Remote?</legend><label><input type="radio" name="r"> Yes</label></fieldset>`);
    element("fieldset").insertAdjacentHTML("beforeend", `<label><input type="radio" name="r"> No</label>`);
    expect(readFields(document, registry).moved).toBe(true);
  });
});

describe("a label wrapped around its whole question", () => {
  const LEVER_UPLOAD = (mark = "") => `<li class="application-question resume"><label>
    <div class="application-label">Resume/CV${mark}</div>
    <div class="application-field">
      <a href="#" class="visible-resume-upload"><svg></svg><span class="filename"></span><span class="default-label">ATTACH RESUME/CV</span>
        <input id="resume-upload-input" name="resume" tabindex="-1" type="file"></a>
      <span class="resume-upload-failure" style="display: none"><div>Couldn't auto-read resume.</div></span>
      <span class="resume-upload-working" style="display: none"><div>Analyzing resume...</div></span>
      <span class="resume-upload-success" style="display: none"><div>Success!</div></span>
    </div></label></li>`;

  it("reads Lever's upload as its question, not its button or status messages", () => {
    expect(labelled(LEVER_UPLOAD())).toEqual(["Resume/CV"]);
  });

  it("still sees it's required", () => {
    expect(scan(LEVER_UPLOAD(`<span class="required">✱</span>`)).scan.fields[0]).toMatchObject({ label: "Resume/CV", required: true });
    expect(scan(LEVER_UPLOAD()).scan.fields[0]?.required).toBe(false);
  });

  it("leaves out what follows the control", () => {
    expect(labelled(`<label><div>Phone</div><div><input><span>We only call about this job</span></div></label>`)).toEqual(["Phone"]);
  });

  it("finds wording inside the same part as the control", () => {
    expect(labelled(`<label><span>Email <input></span></label>`)).toEqual(["Email"]);
  });

  it("falls back on what follows when nothing comes before", () => {
    expect(labelled(`<label><input> Email</label>`)).toEqual(["Email"]);
  });

  it("leaves a label beside the control alone", () => {
    expect(labelled(`<label for="a">Email <em>(work)</em></label><input id="a">`)).toEqual(["Email (work)"]);
  });

  it("still reads a checkbox's label after it", () => {
    expect(labelled(`<label><span>Consent</span><input type="checkbox"> I agree to be contacted</label>`)).toEqual(["Consent I agree to be contacted"]);
  });
});

describe("text a person can't see", () => {
  it("stays out of a label", () => {
    expect(labelled(`<label for="a">Email<span style="display: none">This field is required</span></label><input id="a">`)).toEqual(["Email"]);
  });

  it("doesn't make a field required", () => {
    expect(scan(`<label for="a">Email <span style="display: none">Required</span></label><input id="a">`).scan.fields[0]?.required).toBe(false);
  });

  it("still names a field from a hidden element it points at", () => {
    expect(labelled(`<span id="a" style="display: none">Email</span><input aria-labelledby="a">`)).toEqual(["Email"]);
  });

  it("keeps text only screen readers get: it's still shown to them", () => {
    expect(labelled(`<label for="a"><span style="position: absolute; clip: rect(0 0 0 0)">Email</span></label><input id="a">`)).toEqual(["Email"]);
  });
});

describe("an upload that doesn't say what it's for", () => {
  const GREENHOUSE_UPLOAD = (id: string, name: string, required: boolean) => `<div role="group" aria-labelledby="upload-label-${id}" aria-required="${required}" class="file-upload">
    <div id="upload-label-${id}" class="label upload-label">${name}${required ? `<span class="required">*</span>` : ""}</div>
    <div class="file-upload__wrapper"><div class="button-container"><div><button type="button">Attach</button>
      <label class="visually-hidden" for="${id}">Attach</label><input id="${id}" class="visually-hidden" type="file"></div></div>
    <p>Accepted file types: pdf, doc, docx, txt, rtf</p></div></div>`;

  it("goes by the group around it, as Greenhouse names them", () => {
    const { fields } = scan(GREENHOUSE_UPLOAD("resume", "Resume/CV", true) + GREENHOUSE_UPLOAD("cover_letter", "Cover Letter", false)).scan;
    expect(fields.map(({ label, required }) => [label, required])).toEqual([["Resume/CV", true], ["Cover Letter", false]]);
  });

  it("goes by a heading in its block, as with Ashby's Autofill from resume", () => {
    expect(labelled(`<h2>Location</h2><div role="presentation"><input type="file" tabindex="-1"><div><h3>Autofill from resume</h3><p>Upload your resume here.</p><button>Upload file</button></div></div>`))
      .toEqual(["Autofill from resume"]);
  });

  it("keeps an upload's own clear label, as with Ashby's Resume", () => {
    expect(labelled(`<fieldset><legend>Documents</legend><label for="r">Resume</label><input id="r" type="file"></fieldset>`)).toEqual(["Resume"]);
  });

  it.each([["Attach"], ["Upload"], ["Upload file"], ["Choose file"], ["Browse"], ["Select files"]])("doesn't take %s for its name", (button) => {
    expect(labelled(`<fieldset><legend>Cover letter</legend><label for="r">${button}</label><input id="r" type="file"></fieldset>`)).toEqual(["Cover letter"]);
  });

  it("keeps a vague label when there's nothing better", () => {
    expect(labelled(`<label for="r">Attach</label><input id="r" type="file">`)).toEqual(["Attach"]);
  });

  it("leaves other controls' labels alone", () => {
    expect(labelled(`<fieldset><legend>Portfolio</legend><label for="r">Upload</label><input id="r"></fieldset>`)).toEqual(["Upload"]);
  });
});

describe("a captcha's frames", () => {
  const onPage = (url: string) => Object.defineProperty(document, "URL", { value: url, configurable: true });

  afterEach(() => { delete (document as { URL?: string }).URL; });

  const LANGUAGE_MENU = `<div role="combobox" aria-label="EN - English, Select a language">EN - English</div><input aria-label="Answer">`;

  it.each([
    ["https://newassets.hcaptcha.com/captcha/v1/58a2/static/hcaptcha-enclave.html#frame=enclave"],
    ["https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1"],
    ["https://www.recaptcha.net/recaptcha/enterprise/bframe?hl=en"],
    ["https://www.google.com/recaptcha/api2/anchor?ar=1"],
    ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/1"],
    ["https://client-api.arkoselabs.com/fc/gc/?token=1"],
  ])("are no part of the form: %s", (url) => {
    onPage(url);
    expect(scan(LANGUAGE_MENU).scan.fields).toEqual([]);
  });

  it("never look like the form moved", () => {
    onPage("https://newassets.hcaptcha.com/captcha/v1/58a2/static/hcaptcha-enclave.html");
    const { registry } = scan(LANGUAGE_MENU);
    document.body.insertAdjacentHTML("beforeend", `<input aria-label="Another">`);
    expect(readFields(document, registry)).toEqual({ scanId: 1, values: {}, moved: false });
  });

  it.each([
    ["https://jobs.lever.co/veeva/9ac5/apply"], ["https://www.google.com/about/careers/apply"], ["https://hcaptcha.com.jobs.example.test/apply"],
  ])("leaves a form on a page that only sounds like one: %s", (url) => {
    onPage(url);
    expect(scan(`<input aria-label="City">`).scan.fields).toHaveLength(1);
  });
});

describe("a list box that keeps several choices", () => {
  const html = `<label for="r">Race (mark all that apply)</label><select id="r" multiple><option>Asian</option><option>Black</option><option>White</option></select>`;

  it("reads it like a group of checkboxes, and selects every option asked for", async () => {
    const { filler, rescan } = setup(html);
    const { scanId, fields } = rescan();
    expect(fields[0]).toMatchObject({ kind: "checkbox", label: "Race (mark all that apply)", options: [{ id: "o0", label: "Asian" }, { id: "o1", label: "Black" }, { id: "o2", label: "White" }] });
    const result = await filler.fill({ scanId, fieldId: fields[0]!.id, write: { type: "check", checked: true, optionIds: ["o0", "o2"] }, current: "" });
    expect(result).toEqual({ status: "filled", current: "Asian, White" });
    expect([...element<HTMLSelectElement>("#r").selectedOptions].map(({ text }) => text)).toEqual(["Asian", "White"]);
  });
});
