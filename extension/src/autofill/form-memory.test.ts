import { beforeEach, describe, expect, it } from "vitest";
import { appliedForm, fieldLabel, filledValue, forgetForm, forgetForms, formOf, rememberRows } from "./form-memory";
import type { AppliedField, ReviewRow, TabField } from "./types";

const row = (key: string, current: string, extra: Partial<ReviewRow> = {}): ReviewRow => ({
  key, status: "manual", field: { label: key, required: false, current } as TabField, ...extra,
});

const none = new Map<string, string>();

const memory = (fields: Partial<AppliedField>[]) => new Map(fields.map((field, index) => [`k${index}`, { label: "", value: "", required: false, source: "bde" as const, ...field }]));

beforeEach(forgetForms);

describe("what counts as filled", () => {
  it("is what the field holds", () => {
    expect(filledValue(row("a", "Dallas"))).toBe("Dallas");
    expect(filledValue(row("a", ""))).toBe("");
  });

  it("isn't an answer still waiting to be filled", () => {
    expect(filledValue(row("a", "", { status: "ready", proposed: "Dallas" }))).toBe("");
  });

  it("includes a box that should stay unchecked", () => {
    expect(filledValue(row("a", "", { status: "same", proposed: "Not checked" }))).toBe("Not checked");
  });

  it("names a field with no label", () => {
    expect(fieldLabel({ label: "" })).toBe("Unlabeled field");
    expect(fieldLabel({ label: "City" })).toBe("City");
  });
});

describe("remembering a form", () => {
  it("keeps each job's form apart", () => {
    rememberRows(formOf("app-1"), [row("a", "One")], none);
    rememberRows(formOf("app-2"), [row("a", "Two")], none);
    expect(formOf("app-1").get("a")?.value).toBe("One");
    expect(formOf("app-2").get("a")?.value).toBe("Two");
  });

  it("gives each field its label, value and required flag", () => {
    const form = formOf("app-1");
    const required = { ...row("Email", "a@example.test"), field: { label: "Email", required: true, current: "a@example.test" } as TabField };
    rememberRows(form, [required], none);
    expect(form.get("Email")).toEqual({ label: "Email", value: "a@example.test", required: true, source: "bde" });
  });

  it("credits BenchQ only with what it wrote and the page still holds", () => {
    const form = formOf("app-1");
    rememberRows(form, [row("a", "Written")], new Map([["a", "Written"]]));
    expect(form.get("a")?.source).toBe("autofill");
    rememberRows(form, [row("a", "Written, then fixed")], new Map([["a", "Written"]]));
    expect(form.get("a")?.source).toBe("bde");
  });

  it("keeps who filled a value when a page load has wiped the rest", () => {
    const form = formOf("app-1");
    rememberRows(form, [row("a", "Written")], new Map([["a", "Written"]]));
    rememberRows(form, [row("a", "Written")], none);
    expect(form.get("a")?.source).toBe("autofill");
  });

  it("drops a field the page now shows empty", () => {
    const form = formOf("app-1");
    rememberRows(form, [row("a", "Dallas")], none);
    rememberRows(form, [row("a", "")], none);
    expect(form.size).toBe(0);
  });

  it("keeps a field that's no longer on the page", () => {
    const form = formOf("app-1");
    rememberRows(form, [row("a", "Dallas")], none);
    rememberRows(form, [row("b", "Plano")], none);
    expect([...form.keys()]).toEqual(["a", "b"]);
  });

  it("never holds a field that stays out of the saved form, even one it held before", () => {
    const form = formOf("app-1");
    rememberRows(form, [row("a", "123-45-6789", { isUnsaved: true })], none);
    expect(form.size).toBe(0);
    rememberRows(form, [row("b", "x")], none);
    rememberRows(form, [row("b", "x", { isUnsaved: true })], none);
    expect(form.size).toBe(0);
  });

  it("forgets one job, or all of them", () => {
    rememberRows(formOf("app-1"), [row("a", "One")], none);
    rememberRows(formOf("app-2"), [row("a", "Two")], none);
    forgetForm("app-1");
    expect(formOf("app-1").size).toBe(0);
    expect(formOf("app-2").size).toBe(1);
    forgetForms();
    expect(formOf("app-2").size).toBe(0);
  });
});

describe("the form sent with Mark applied", () => {
  it("is empty when nothing could be read", () => {
    expect(appliedForm(formOf("app-1"))).toEqual({ fields: [] });
  });

  it("holds at most what the backend accepts", () => {
    const { fields } = appliedForm(memory(Array.from({ length: 205 }, () => ({ label: "L".repeat(600), value: "V".repeat(5000) }))));
    expect(fields).toHaveLength(200);
    expect(fields[0]!.label).toHaveLength(500);
    expect(fields[0]!.value).toHaveLength(4000);
  });

  it("counts whole characters, so an emoji is never cut in half", () => {
    const { fields } = appliedForm(memory([{ value: "😀".repeat(4001) }]));
    expect(Array.from(fields[0]!.value)).toHaveLength(4000);
    expect(fields[0]!.value.endsWith("😀")).toBe(true);
  });

  it("drops a NUL, which can't be stored", () => {
    expect(appliedForm(memory([{ label: "a\0b", value: "c\0d" }])).fields[0]).toMatchObject({ label: "ab", value: "cd" });
  });
});
