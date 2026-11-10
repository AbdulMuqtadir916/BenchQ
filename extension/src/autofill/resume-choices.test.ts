import { describe, expect, it } from "vitest";
import type { ResumeListing, ResumeVersion } from "../api";
import { defaultResume, resumeChoices } from "./resume-choices";

const version = (id: string, number: number, title: string | null = null, jobId: string | null = null): ResumeVersion => ({
  id, version: number, name: "Base", title, category: jobId ? "TAILORED" : "BASE", job_id: jobId,
});

const listing: ResumeListing = {
  bases: [
    { id: "b1", number: 1, is_active: false, archived_at: null, versions: [version("b1v1", 1, "Java Developer"), version("b1v2", 2, "Java Developer")] },
    { id: "b2", number: 2, is_active: true, archived_at: null, versions: [version("b2v1", 1, "Backend Engineer")] },
    { id: "b3", number: 3, is_active: false, archived_at: "2026-11-01T00:00:00Z", versions: [version("b3v1", 1)] },
  ],
  tailored: [
    { base_resume_id: "b2", job_id: "job-1", versions: [version("t1v1", 1, null, "job-1"), version("t1v2", 2, null, "job-1")] },
    { base_resume_id: "b1", job_id: "job-2", versions: [version("t2v1", 1, null, "job-2")] },
  ],
};

describe("the résumés the picker offers", () => {
  it("puts this job's tailored résumé first, then each base at its newest version, the one in use marked active", () => {
    expect(resumeChoices(listing, "job-1").map(({ id, label, isActive }) => [id, label, isActive])).toEqual([
      ["t1v2", "Tailored for this job · from Base 2 · v2", false],
      ["b1v2", "Base 1 · Java Developer · v2", false],
      ["b2v1", "Base 2 · Backend Engineer · v1", true],
    ]);
  });

  it("heads each row with its role and puts which base or job it is, and its version, under it", () => {
    expect(resumeChoices(listing, "job-1").map(({ title, meta }) => [title, meta])).toEqual([
      [null, "Tailored for this job · from Base 2 · v2"],
      ["Java Developer", "Base 1 · v2"],
      ["Backend Engineer", "Base 2 · v1"],
    ]);
  });

  it("offers no other job's tailored résumé, and no hidden base", () => {
    const ids = resumeChoices(listing, null).map(({ id }) => id);
    expect(ids).toEqual(["b1v2", "b2v1"]);
  });

  it("offers an older version the application names, after its résumé's newest", () => {
    expect(resumeChoices(listing, "job-1", "b1v1").map(({ id, label }) => [id, label])).toEqual([
      ["t1v2", "Tailored for this job · from Base 2 · v2"],
      ["b1v2", "Base 1 · Java Developer · v2"],
      ["b1v1", "Base 1 · Java Developer · v1"],
      ["b2v1", "Base 2 · Backend Engineer · v1"],
    ]);
    expect(resumeChoices(listing, "job-1", "t1v1").map(({ id }) => id)).toEqual(["t1v2", "t1v1", "b1v2", "b2v1"]);
    // Not a hidden base's, though, and not another job's tailored résumé.
    expect(resumeChoices(listing, "job-1", "b3v1").map(({ id }) => id)).toEqual(["t1v2", "b1v2", "b2v1"]);
    expect(resumeChoices(listing, "job-1", "t2v1").map(({ id }) => id)).toEqual(["t1v2", "b1v2", "b2v1"]);
  });

  it("tags only the newest version of the base in use as active", () => {
    const twice = { ...listing, bases: listing.bases.map((base) => (base.id === "b2" ? { ...base, versions: [...base.versions, version("b2v2", 2, "Backend Engineer")] } : base)) };
    expect(resumeChoices(twice, null, "b2v1").map(({ id, isActive }) => [id, isActive])).toEqual([
      ["b1v2", false], ["b2v2", true], ["b2v1", false],
    ]);
  });
});

describe("where the picker starts", () => {
  const choices = resumeChoices(listing, "job-1");

  it("on the résumé the application names", () => {
    expect(defaultResume(choices, "b1v2")).toBe("b1v2");
  });

  it("on an older version the application names, which is offered for it", () => {
    expect(defaultResume(resumeChoices(listing, "job-1", "b1v1"), "b1v1")).toBe("b1v1");
    expect(defaultResume(resumeChoices(listing, null, "b3v1"), "b3v1")).toBe("b2v1");
  });

  it("else on this job's tailored résumé, else the base in use", () => {
    expect(defaultResume(choices, "gone")).toBe("t1v2");
    expect(defaultResume(resumeChoices(listing, null), null)).toBe("b2v1");
  });

  it("on nothing when there's nothing to offer", () => {
    expect(defaultResume([], null)).toBeNull();
  });
});
