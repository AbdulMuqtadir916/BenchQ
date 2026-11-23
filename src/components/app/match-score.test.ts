import { describe, expect, it } from "vitest";
import { heldLine } from "./match-score";

describe("the hover line of a score held at 40 (decided 2026-11-14, Q37)", () => {
  it("says it is held, and why, in one line; nothing when it isn't held", () => {
    expect(heldLine(40, "no C2C or third-party candidates")).toBe("Held at 40: no C2C or third-party candidates");
    expect(heldLine(31, "requires Korean")).toBe("Capped under 40: requires Korean");
    expect(heldLine(88, null)).toBeUndefined();
  });
});
