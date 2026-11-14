import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIT_MIN, FIT_STEPS, fittedSize, linesToTrim, MAX_FIT_STEP } from "./fit";

const PX_PER_PT = 96 / 72;
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("Fit to one page", () => {
  it("starts at the template as designed and only ever shrinks", () => {
    expect(FIT_STEPS[0]).toEqual({ type: 1, space: 1, leading: 0 });
    for (let i = 1; i <= MAX_FIT_STEP; i++) {
      expect(FIT_STEPS[i]!.type).toBeLessThan(FIT_STEPS[i - 1]!.type);
      expect(FIT_STEPS[i]!.space).toBeLessThanOrEqual(FIT_STEPS[i - 1]!.space);
      expect(FIT_STEPS[i]!.leading).toBeGreaterThan(FIT_STEPS[i - 1]!.leading);
    }
  });

  it("never scales spacing below the minimum", () => {
    expect(Math.min(...FIT_STEPS.map((s) => s.space))).toBe(FIT_MIN.space);
  });

  describe("minimums", () => {
    const last = FIT_STEPS[MAX_FIT_STEP]!;

    it("keeps body text at 9.5pt or more when the template starts above it", () => {
      // Classic's 13.5px body (10.1pt) shrinks, but stops at the floor.
      const pt = fittedSize(13.5, last.type, FIT_MIN.bodyPt * PX_PER_PT) / PX_PER_PT;
      expect(pt).toBeCloseTo(FIT_MIN.bodyPt, 5);
    });

    it("doesn't shrink body text that starts below the floor", () => {
      // Modern's 12.5px body is 9.375pt: already under 9.5pt, so it stays as designed.
      expect(fittedSize(12.5, last.type, FIT_MIN.bodyPt * PX_PER_PT)).toBe(12.5);
    });

    it("keeps line height and margins at their floors", () => {
      expect(Math.max(1.45 - last.leading, Math.min(1.45, FIT_MIN.leading))).toBeGreaterThanOrEqual(FIT_MIN.leading);
      expect(fittedSize(0.6, last.space, FIT_MIN.marginIn)).toBe(FIT_MIN.marginIn);
    });

    it.each([
      ["--rt-min-body", `${FIT_MIN.bodyPt}pt`],
      ["--rt-min-small", `${FIT_MIN.smallPt}pt`],
      ["--rt-min-leading", `${FIT_MIN.leading}`],
      ["--paper-margin-min", `${FIT_MIN.marginIn}in`],
    ])("globals.css declares %s: %s, the floor the paper applies", (token, value) => {
      expect(css).toContain(`${token}: ${value};`);
    });

    it("applies every paper font size through a floored value", () => {
      const paperRules = css.split("\n").filter((line) => line.startsWith(".rt"));
      const sizes = paperRules.flatMap((line) => line.match(/font-size: [^;]+/g) ?? []);
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toMatch(/font-size: (var\(--rt-fs[\w-]*\)|max\()/);
    });
  });

  it("says how many lines to trim", () => {
    expect(linesToTrim(0, 18)).toBe(0);
    expect(linesToTrim(1, 18)).toBe(1);
    expect(linesToTrim(37, 18)).toBe(3);
  });
});
