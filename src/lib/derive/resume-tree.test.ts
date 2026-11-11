import { describe, expect, it } from "vitest";
import sample from "@/lib/api/dto/__samples__/resumes.json";
import { ResumeShelfDto, toResumeShelf } from "@/lib/api/dto/resumes";
import { arrayOf } from "@/lib/api/client";
import { ResumeSchema } from "@/lib/schemas/resume";
import resumesSeed from "@/test/fixtures/resumes.json";
import { baseSummary, buildResumeTree } from "./resume-tree";

const shelf = toResumeShelf(ResumeShelfDto.parse(sample.listing), "firm_hts");

describe("buildResumeTree", () => {
  const [candidate] = buildResumeTree(shelf);

  it("numbers the bases in the order they were made and puts the hidden ones apart", () => {
    expect(candidate!.bases.map((b) => [b.number, b.base.source, b.base.isActive])).toEqual([[1, "UPLOAD", false], [2, "PROMOTED", true]]);
    expect(candidate!.hidden.map((b) => [b.number, b.base.source])).toEqual([[3, "UPLOAD"]]);
  });

  it("puts each tailored copy under the base it was made from, versions newest first", () => {
    const [first, second] = candidate!.bases;
    expect(first!.versions.map((v) => [v.number, v.isLatest])).toEqual([[2, true], [1, false]]);
    expect(first!.tailored.map((t) => [t.jobId, t.versions.map((v) => v.number)])).toEqual([["7d2f0c20-0000-4e3c-9c73-000000000001", [2, 1]]]);
    expect(second!.tailored).toEqual([]);
    expect(baseSummary(first!)).toBe("2 versions · 1 tailored");
  });

  it("orders candidates as asked, and an empty shelf is no tree", () => {
    const mock = arrayOf(ResumeSchema).parse(resumesSeed);
    const bases = mock.filter((r) => r.isMaster).map((r) => ({ id: r.baseResumeId!, firmId: r.firmId, candidateId: r.candidateId, source: "UPLOAD" as const, madeByLead: false, isActive: true, createdByUserId: "u", createdAt: "2026-01-01T00:00:00.000Z", promotedFromResumeId: null, archivedAt: null }));
    const tree = buildResumeTree({ bases, resumes: mock }, ["cand_02", "cand_01"]);
    expect(tree.slice(0, 2).map((t) => t.candidateId)).toEqual(["cand_02", "cand_01"]);
    expect(tree.every((t) => t.bases.length === 1 && t.hidden.length === 0)).toBe(true);
    const tailored = mock.filter((r) => !r.isMaster).length;
    expect(tree.reduce((n, t) => n + t.bases[0]!.tailored.length, 0)).toBe(tailored);
    expect(buildResumeTree({ bases: [], resumes: [] })).toEqual([]);
  });
});
