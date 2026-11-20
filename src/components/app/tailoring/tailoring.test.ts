import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { ResumeShelfSchema, type ResumeShelf } from "@/lib/schemas/resume";
import { tailoringRefetch } from "@/lib/hooks/use-tailoring";
import type { TailoringRun } from "@/lib/schemas/tailoring";
import { runFailure, startRefusal } from "./messages";
import { readStored, writeStored } from "./stored";
import { tailorSources } from "./tailor-button";

describe("why a tailoring failed (part 3 Q8)", () => {
  it("offers Try again only where it can help", () => {
    for (const code of ["provider_failed", "unreadable_reply", "lost", "internal", null]) expect(runFailure(code)).toEqual({ message: "Tailoring failed.", canRetry: true });
    for (const code of ["gone", "hidden", "setup"]) expect(runFailure(code).canRetry, code!).toBe(false);
  });

  it("says why a start was refused, with a link to the résumés when there's no base", () => {
    const refusal = (status: number, message = "") => startRefusal(new ApiError(message, "X", status));
    expect(refusal(422).message).toMatch(/no description/);
    expect(refusal(429).message).toMatch(/5 tailorings running/);
    expect(refusal(500).message).toMatch(/isn't set up/);
    expect(refusal(409, "This candidate has no active base résumé to tailor from.")).toEqual({ message: "This candidate has no active base résumé to tailor from.", needsBase: true });
    expect(refusal(409, "This résumé is already being tailored for this job.").needsBase).toBe(false);
    expect(startRefusal(new Error("offline")).message).toBe("Tailoring didn't start. Try again.");
  });
});

describe("the panel reads again every 3 s while one runs (part 3 R2-Q4)", () => {
  const run = (status: TailoringRun["status"]) => ({ status }) as TailoringRun;
  it("and not at all otherwise", () => {
    expect(tailoringRefetch([run("completed"), run("running")])).toBe(3000);
    expect(tailoringRefetch([run("completed"), run("failed")])).toBe(false);
    expect(tailoringRefetch(undefined)).toBe(false);
  });
});

describe("what the panel keeps in this browser", () => {
  // The runner has no browser: a stub stands in for localStorage (as in src/mocks/db.test.ts).
  const items = new Map<string, string>();
  const g = globalThis as { window?: unknown };
  const saved = g.window;
  g.window = { localStorage: { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), clear: () => items.clear() } };
  afterEach(() => items.clear());
  afterAll(() => { g.window = saved; });

  it("works with no storage at all (a private window): the fallback", () => {
    g.window = undefined;
    expect(readStored("k", z.boolean().catch(false))).toBe(false);
    expect(() => writeStored("k", true)).not.toThrow();
    g.window = { localStorage: { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) } };
  });

  it("reads back what it wrote, and falls back on anything else", () => {
    const Dismissed = z.array(z.string()).catch([]);
    expect(readStored("k", Dismissed)).toEqual([]);
    writeStored("k", ["run-1"]);
    expect(readStored("k", Dismissed)).toEqual(["run-1"]);
    items.set("k", "{not json");
    expect(readStored("k", Dismissed)).toEqual([]);
    items.set("k", JSON.stringify({ an: "object" }));
    expect(readStored("k", Dismissed)).toEqual([]);
  });
});

describe("the Tailor picker (part 3 R3-Q1, Q3, Q4)", () => {
  const at = (n: number) => `2026-11-0${n}T10:00:00.000Z`;
  const version = (id: string, resumeId: string, n: number) => ({
    id, resumeId, versionNumber: n, parentVersionId: null, madeByLead: false, templateId: "t", includedSectionIds: [], includedBulletIds: [],
    bulletOverrides: {}, atsScore: null, atsGrade: null, atsIssues: [], keywordScore: null, keywordsMatched: [], keywordsMissing: [], lines: [],
    tailoring: null, tracer: null, pdfUrl: null, docxUrl: null, renderedAt: null, changeSummary: null, createdByUserId: "u", createdAt: at(n),
  });
  const base = (id: string, n: number, over: Record<string, unknown> = {}) => ({
    id, firmId: "f", candidateId: "c", source: "UPLOAD", madeByLead: false, isActive: false, createdByUserId: "u", createdAt: at(n),
    promotedFromResumeId: null, archivedAt: null, ...over,
  });
  const resume = (id: string, baseId: string, versions: ReturnType<typeof version>[], jobId: string | null = null) => ({
    id, firmId: "f", candidateId: "c", baseResumeId: baseId, name: "Base", isMaster: !jobId, targetJobId: jobId, targetJob: null,
    templateId: "t", versions, latestVersionId: versions.at(-1)!.id,
  });
  const shelf: ResumeShelf = ResumeShelfSchema.parse({
    bases: [
      base("b1", 1, { isActive: true }),
      base("b2", 2, { source: "PROMOTED", promotedFromResumeId: "b1v3", archivedAt: at(5) }),   // hidden, made from b1 v3
      base("b3", 3, { archivedAt: at(6) }),                                                       // a hidden base
    ],
    resumes: [
      resume("r1", "b1", [version("b1v1", "r1", 1), version("b1v2", "r1", 2), version("b1v3", "r1", 3)]),
      resume("r2", "b2", [version("b2v1", "r2", 1)]),
      resume("r3", "b3", [version("b3v1", "r3", 1)]),
      resume("t1", "b1", [version("t1v1", "t1", 1)], "job-1"),                                    // a tailored copy
    ],
  });

  it("defaults to the active base's v1 and lists the visible bases' own versions only", () => {
    const { sources, defaultId } = tailorSources(shelf, "c");
    expect(defaultId).toBe("b1v1");
    expect(sources.map((s) => s.value)).toEqual(["b1v1", "b1v2", "b1v3"]);   // no hidden base, no tailored copy
    expect(sources[0]).toMatchObject({ label: "Base 1 v1 · active", baseId: "b1", disabled: false });
    expect(sources[1]).toMatchObject({ description: "Becomes a base of its own", baseId: null, disabled: false });
  });

  it("can't use a version whose base, made from it before, is hidden: it says why", () => {
    expect(tailorSources(shelf, "c").sources[2]).toMatchObject({ disabled: true, description: "Base 2 (made from it) is hidden" });
  });
});
