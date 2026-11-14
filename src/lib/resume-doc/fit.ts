/**
 * "Fit to one page": the paper shrinks its type and spacing step by step until the résumé fits on one page, and
 * stops at fixed minimums. Each step scales the template's own sizes; the floors are CSS tokens in globals.css
 * (`--rt-min-*`, `--paper-margin-min`), applied as max(scaled size, min(template size, floor)), so a template never
 * goes below a floor it starts above, and one that starts below a floor (Compact's body text) isn't shrunk at all.
 */
export interface FitStep {
  /** Multiplies font sizes. */
  type: number;
  /** Multiplies gaps, margins and padding. */
  space: number;
  /** Subtracted from the line height. */
  leading: number;
}

export const FIT_MIN = {
  /** Body text, in pt (`--rt-min-body`). */
  bodyPt: 9.5,
  /** Dates, locations and contact details, in pt (`--rt-min-small`). */
  smallPt: 8,
  /** The line height (`--rt-min-leading`). */
  leading: 1.25,
  /** The page margin, in inches (`--paper-margin-min`). */
  marginIn: 0.45,
  /** The smallest spacing multiplier a step uses. */
  space: 0.5,
} as const;

const STEP_COUNT = 9;

/** Step 0 is the template as designed; the last step is the most a résumé is shrunk. */
export const FIT_STEPS: readonly FitStep[] = Array.from({ length: STEP_COUNT }, (_, i) => ({
  type: round(1 - 0.025 * i),
  space: round(Math.max(FIT_MIN.space, 1 - 0.07 * i)),
  leading: round(0.025 * i),
}));

export const MAX_FIT_STEP = FIT_STEPS.length - 1;

/** A size after a step, as the CSS computes it: scaled, but never below min(base, floor). Any unit, as long as it's one. */
export function fittedSize(base: number, scale: number, floor: number): number {
  return Math.max(base * scale, Math.min(base, floor));
}

/** "Trim about N lines": how much is left over at the minimums, in lines of body text. */
export function linesToTrim(overflowPx: number, lineHeightPx: number): number {
  if (overflowPx <= 0 || lineHeightPx <= 0) return 0;
  return Math.max(1, Math.ceil(overflowPx / lineHeightPx));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
