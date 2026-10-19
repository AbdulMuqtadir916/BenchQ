import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn (tailwind-merge with the design system's type scale)", () => {
  it("keeps a token text colour next to a type-scale size class", () => {
    for (const size of ["text-body", "text-caption", "text-label", "text-sm", "text-h3", "text-mono-sm", "text-body-strong", "text-display"]) {
      expect(cn("text-[var(--color-text-2)]", size), size).toBe(`text-[var(--color-text-2)] ${size}`);
    }
  });

  it("still lets a later size replace an earlier one, and a later colour an earlier colour", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
    expect(cn("text-[var(--color-text-2)]", "text-[var(--color-text)]")).toBe("text-[var(--color-text)]");
  });
});
