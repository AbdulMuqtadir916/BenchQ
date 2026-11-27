import { expect, it } from "vitest";
import { filledValue } from "./form-memory";
import type { ReviewRow } from "./types";

const row = (current: string, kind: string, label: string) => ({ field: { current, kind, label }, status: "ready" }) as unknown as ReviewRow;

it("counts a dial code alone as no phone number, and a salary's plus sign as a value", () => {
  expect(filledValue(row("+1", "tel", "Mobile Number"))).toBe("");
  expect(filledValue(row("+91", "text", "Phone"))).toBe("");
  expect(filledValue(row("+5000", "text", "Expected salary"))).toBe("+5000");
  // A box asking for the code itself holds it.
  expect(filledValue(row("+1", "text", "Country code"))).toBe("+1");
  expect(filledValue(row("+1", "select", "Phone"))).toBe("+1");
});
