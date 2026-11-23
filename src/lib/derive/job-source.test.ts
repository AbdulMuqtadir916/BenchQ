import { describe, expect, it } from "vitest";
import { defaultJobSource, readJobSource } from "./job-source";

describe("defaultJobSource", () => {
  it("opens on freehire.me when it has jobs", () => {
    expect(defaultJobSource({ freehire: 2, indeed: 10, linkedin: 20 })).toBe("FREEHIRE");
  });

  it("falls back to Indeed, then LinkedIn", () => {
    expect(defaultJobSource({ freehire: 0, indeed: 10, linkedin: 20 })).toBe("INDEED");
    expect(defaultJobSource({ indeed: 0, linkedin: 20 })).toBe("LINKEDIN");
  });

  it("never hides a captured job behind an empty list", () => {
    expect(defaultJobSource({ manual: 3 })).toBe("MANUAL");
    expect(defaultJobSource({ extension: 1, other: 4 })).toBe("EXTENSION");
  });

  it("stays on freehire.me when no source has a job", () => {
    expect(defaultJobSource({})).toBe("FREEHIRE");
  });
});

describe("readJobSource", () => {
  it("reads a source and refuses anything else", () => {
    expect(readJobSource("LINKEDIN")).toBe("LINKEDIN");
    expect(readJobSource("ALL")).toBeNull();
    expect(readJobSource(null)).toBeNull();
  });
});
