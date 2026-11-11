import { describe, expect, it } from "vitest";
import { stubJob } from "@/mocks/fixture-backend";
import { PORTALS, portalForJob } from "./portal-logo";

const job = (sourceType: "AGGREGATOR" | "MANUAL" | "USER_SUBMITTED", sourceId: string) => {
  const base = stubJob("firm_hts", "cand_01", 1, "Java Developer");
  return { ...base, provenance: { ...base.provenance, sourceType, sourceId } };
};

describe("where a job came from (docs/02 §6.z): the backend's source, never a guessed job board", () => {
  it("a search's job is freehire.me's; a capture is by hand or from the extension", () => {
    expect(PORTALS[portalForJob(job("AGGREGATOR", "freehire"))].label).toBe("freehire.me");
    expect(PORTALS[portalForJob(job("MANUAL", "manual"))].label).toBe("Added by hand");
    expect(PORTALS[portalForJob(job("USER_SUBMITTED", "extension"))].label).toBe("From the extension");
    expect(PORTALS[portalForJob(job("AGGREGATOR", "jsearch"))].label).toBe("Job search");
  });

  it("names no job board the backend didn't", () => {
    const labels = Object.values(PORTALS).map((portal) => portal.label);
    for (const board of ["Glassdoor", "Indeed", "LinkedIn", "Dice"]) expect(labels).not.toContain(board);
  });
});
