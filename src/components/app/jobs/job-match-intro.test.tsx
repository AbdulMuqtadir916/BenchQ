import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (actual) => ({
  ...await actual<typeof import("motion/react")>(),
  useReducedMotion: () => motion.reduce,
}));

const { CountUp } = await import("./job-match-intro");

/** Found testing (2026-11-13, Windows with animations off): with reduced motion the intro's counts stayed at 0, "0 of
 * 103 open roles accept this visa" and "0 strong matches (70+)" beside "Top match 98". */
describe("the intro's counts", () => {
  it("show their number at once with reduced motion", () => {
    motion.reduce = true;
    expect(renderToStaticMarkup(<CountUp to={103} duration={0.15} />)).toContain(">103<");
  });

  it("rise from 0 otherwise, as before", () => {
    motion.reduce = false;
    expect(renderToStaticMarkup(<CountUp to={103} duration={0.75} />)).toContain(">0<");
  });
});
