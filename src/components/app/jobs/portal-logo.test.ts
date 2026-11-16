import { describe, expect, it } from "vitest";
import { stubJob } from "@/mocks/fixture-backend";
import { PORTALS, SOURCE_KEYS, openSourceLabel, portalForJob } from "./portal-logo";

const job = (sourceType: "AGGREGATOR" | "MANUAL" | "USER_SUBMITTED", sourceId: string) => {
  const base = stubJob("firm_hts", "cand_01", 1, "Java Developer");
  return { ...base, provenance: { ...base.provenance, sourceType, sourceId } };
};

describe("where a job came from (docs/02 §6.z): the backend's source, never a guessed job board", () => {
  it("a search's job is Indeed's, freehire.me's or LinkedIn's; a capture is by hand or from the extension", () => {
    expect(PORTALS[portalForJob(job("AGGREGATOR", "indeed"))].label).toBe("Indeed");
    expect(PORTALS[portalForJob(job("AGGREGATOR", "freehire"))].label).toBe("freehire.me");
    expect(PORTALS[portalForJob(job("AGGREGATOR", "linkedin"))].label).toBe("LinkedIn");     // since 2026-11-16 (Q78)
    expect(PORTALS[portalForJob(job("MANUAL", "manual"))].label).toBe("Added by hand");
    expect(PORTALS[portalForJob(job("USER_SUBMITTED", "extension"))].label).toBe("From the extension");
    expect(PORTALS[portalForJob(job("AGGREGATOR", "jsearch"))].label).toBe("Job search");
    expect(SOURCE_KEYS).toEqual(expect.arrayContaining(["INDEED", "FREEHIRE", "LINKEDIN", "OTHER_SOURCE", "MANUAL", "EXTENSION"])); // each is filterable
    expect(openSourceLabel("LINKEDIN")).toBe("Open on LinkedIn");                         // read on LinkedIn (Q86)
    expect(openSourceLabel("INDEED")).toBe("Open source");
  });

  it("names no job board the backend didn't", () => {
    const labels = Object.values(PORTALS).map((portal) => portal.label);
    for (const board of ["Glassdoor", "Dice", "ZipRecruiter"]) expect(labels).not.toContain(board);
  });
});
