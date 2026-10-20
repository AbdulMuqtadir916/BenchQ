import { describe, expect, it } from "vitest";
import candidatesSeed from "@/mocks/data/candidates.json";
import applicationsSeed from "@/mocks/data/applications.json";
import resumesSeed from "@/mocks/data/resumes.json";
import { arrayOf } from "@/lib/api/client";
import { CandidateSchema } from "@/lib/schemas/candidate";
import { ApplicationSchema } from "@/lib/schemas/application";
import { ResumeSchema } from "@/lib/schemas/resume";
import { deriveCandidateStats } from "./candidate-stats";
import { deriveExportGate } from "./export-gate";
import { newestDate } from "./match";
import { deriveFunnel } from "./funnel";

const candidatesFixture = arrayOf(CandidateSchema).parse(candidatesSeed);
const applicationsFixture = arrayOf(ApplicationSchema).parse(applicationsSeed);
const resumesFixture = arrayOf(ResumeSchema).parse(resumesSeed);

describe("deriveCandidateStats", () => {
  it("derives counts from applications instead of stored summary values", () => {
    const candidate = candidatesFixture[0]!;
    const applications = applicationsFixture.filter(
      (application) => application.candidateId === candidate.id,
    );
    const submitted = applications.filter(
      (application) => application.status !== "SAVED",
    );

    const stats = deriveCandidateStats(candidate, applications);

    expect(stats.applicationsSubmitted).toBe(submitted.length);
    expect(stats.distinctCompanies).toBe(
      new Set(submitted.map((application) => application.companyNameAtApply)).size,
    );
    expect(stats.responsesReceived).toBe(
      submitted.filter((application) => application.firstResponseAt).length,
    );
  });

  it("returns safe zero values for a candidate with no applications", () => {
    const candidate = candidatesFixture[0]!;
    const stats = deriveCandidateStats(candidate, []);

    expect(stats.applicationsSubmitted).toBe(0);
    expect(stats.responseRatePct).toBe(0);
    expect(stats.firstApplicationAt).toBeNull();
  });
});

describe("deriveExportGate", () => {
  const version = resumesFixture[0]!.versions[0]!;

  it("blocks export when any claim remains as unverified", () => {
    const result = deriveExportGate({
      ...version,
      claims: version.claims.map((claim, index) => ({
        ...claim,
        state: index === 0 ? "UNVERIFIED" : "VERIFIED",
        evidenceId: index === 0 ? null : claim.evidenceId,
      })),
    });

    expect(result.canExport).toBe(false);
    expect(result.unverifiedCount).toBe(1);
    expect(result.blockingClaimIds).toHaveLength(1);
  });

  it("allows export when contradicted claims are excluded and no unverified remains", () => {
    const result = deriveExportGate({
      ...version,
      claims: version.claims.map((claim, index) => ({
        ...claim,
        state: index === 0 ? "CONTRADICTED" : "VERIFIED",
      })),
    });

    expect(result.canExport).toBe(true);
    expect(result.contradictedCount).toBe(1);
    expect(result.blockingClaimIds).toEqual([]);
  });
});

describe("deriveFunnel", () => {
  it("counts every stage reached in the event history", () => {
    const funnel = deriveFunnel(applicationsFixture);

    expect(funnel.map((stage) => stage.label)).toEqual([
      "Applied",
      "Response",
      "Screening",
      "Interview",
      "Offer",
      "Placed",
    ]);
    expect(funnel.every((stage, index) => index === 0 || stage.count <= funnel[index - 1]!.count)).toBe(true);
  });
});

describe("newestDate (the jobs feed's Newest)", () => {
  const job = (postedAt: string | null, ingestedAt: string) => ({ postedAt, provenance: { ingestedAt } }) as Parameters<typeof newestDate>[0];
  it("uses the posted date; a job with none (captured by hand) falls back to when it was captured", () => {
    expect(newestDate(job("2026-10-01T10:00:00.000Z", "2026-10-05T10:00:00.000Z"))).toBe("2026-10-01T10:00:00.000Z");
    expect(newestDate(job(null, "2026-10-20T10:00:00.000Z"))).toBe("2026-10-20T10:00:00.000Z");
    const order = [job("2026-10-18T10:00:00.000Z", "2026-10-18T10:00:00.000Z"), job(null, "2026-10-20T09:00:00.000Z")]
      .sort((a, b) => newestDate(b).localeCompare(newestDate(a)));
    expect(order[0]?.postedAt).toBeNull(); // the just-captured job leads Newest
  });
});
