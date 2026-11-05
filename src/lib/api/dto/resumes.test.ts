import { describe, expect, it } from "vitest";
import sample from "./__samples__/resumes.json";
import { fromBackendId } from "./demo-ids";
import { ResumeShelfDto, ResumeVersionDto, toOpenedResume, toResumeDocument, toResumeShelf } from "./resumes";

const FIRM = "firm_hts";
const shelf = toResumeShelf(ResumeShelfDto.parse(sample.listing), FIRM);
const candidate = fromBackendId("daea7708-33cf-52fe-9da5-44db9eb5b22c");

describe("the résumé listing", () => {
  it("maps every base, hidden ones included, with its source and active flag", () => {
    expect(shelf.bases.map((b) => [b.source, b.isActive, b.archivedAt !== null])).toEqual([["UPLOAD", false, false], ["PROMOTED", true, false], ["MANUAL", false, true]]);
    expect(shelf.bases.every((b) => b.candidateId === candidate && b.firmId === FIRM)).toBe(true);
    expect(shelf.bases[1]!.promotedFromResumeId).toBe("6c1e9b1f-0002-4d2b-8b62-000000000002");
    expect(shelf.bases[1]!.createdAt).toBe("2026-11-02T11:00:00.000Z"); // a zone-less time is UTC
  });

  it("groups rows into résumés: a base's own versions, and one tailored copy per base and job", () => {
    const own = shelf.resumes.filter((r) => r.isMaster);
    const [tailored] = shelf.resumes.filter((r) => !r.isMaster);
    expect(own.map((r) => [r.baseResumeId, r.versions.map((v) => v.versionNumber)])).toEqual([
      ["5b0d8a0e-1111-4c1a-9a51-000000000001", [1, 2]], ["5b0d8a0e-2222-4c1a-9a51-000000000002", [1]],
    ]);
    expect(tailored!.baseResumeId).toBe("5b0d8a0e-1111-4c1a-9a51-000000000001");
    expect(tailored!.targetJobId).toBe("7d2f0c20-0000-4e3c-9c73-000000000001");
    expect(tailored!.versions.map((v) => [v.versionNumber, v.parentVersionId])).toEqual([[1, null], [2, "6c1e9b1f-0004-4d2b-8b62-000000000004"]]);
    expect(tailored!.latestVersionId).toBe("6c1e9b1f-0005-4d2b-8b62-000000000005");
  });

  it("a base with no versions left lists no résumé; a version with no design opens in Modern", () => {
    expect(shelf.resumes.some((r) => r.baseResumeId === "5b0d8a0e-3333-4c1a-9a51-000000000003")).toBe(false);
    expect(shelf.resumes[0]!.versions[0]!.templateId).toBe("template_modern");
  });
});

describe("one version's text", () => {
  const version = ResumeVersionDto.parse(sample.version);
  const doc = toResumeDocument(version);

  it("is the studio's document, named by the version's id", () => {
    expect(doc).toMatchObject({ resumeId: "6c1e9b1f-0003-4d2b-8b62-000000000003", candidateId: candidate, isMaster: true, templateId: "template_classic", fullName: "Candidate Name", title: "Java Developer" });
    expect(doc.summary).toEqual({ id: "s-1", html: "Nine years of Java &amp; Spring." });
    expect(doc.header).toEqual({ city: "Dallas", state: "TX", country: "US", email: "candidate@example.com", phone: "+1-214-555-0100", linkedin: "https://www.linkedin.com/in/candidate", github: "", workAuthorization: "H-1B" });
  });

  it("keeps the items' ids, escapes their text, and groups the skills by category", () => {
    expect(doc.experience).toEqual([{ id: "e-1", company: "A Company", title: "Senior Developer", location: "Dallas, TX", dates: "", start: "Jan 2020", end: "", current: true, bullets: [{ id: "b-1", html: "Cut build time &lt;50%&gt;." }] }]);
    expect(doc.skills).toEqual([{ id: "skills_0", category: "Languages", items: "Java, Kotlin" }, { id: "skills_1", category: "", items: "Docker" }]);
    expect(doc.projects[0]).toEqual({ id: "p-1", name: "Tool", link: "https://example.com", dates: "2023", technologies: "Go", bullets: [{ id: "pb-1", html: "Line one" }, { id: "pb-2", html: "Line two" }] });
    expect(doc.education[0]).toEqual({ id: "d-1", school: "A University", degree: "B.Tech", graduationDate: "2016", grade: "" });
    expect(doc.certifications[0]).toEqual({ id: "c-1", name: "AWS SAA", issuer: "AWS", date: "2022", detail: "" });
    expect(doc.awards).toEqual([]);
  });

  it("opens with the résumé it belongs to", () => {
    const opened = toOpenedResume(version, shelf);
    expect(opened.versionId).toBe("6c1e9b1f-0003-4d2b-8b62-000000000003");
    expect(opened.resume.baseResumeId).toBe("5b0d8a0e-2222-4c1a-9a51-000000000002");
    expect(() => toOpenedResume({ ...version, id: "not-listed" }, shelf)).toThrow(/not in its candidate's listing/);
  });
});
