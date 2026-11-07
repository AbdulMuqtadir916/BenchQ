import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resumesMock } from "./resumes";
import { allApplications } from "./applications";
import { signInAs, signOutForTest } from "./sign-in-as";

const FIRM = "firm_hts";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
  await signInAs("user_adnan"); // cand_03's BDE
});
afterAll(() => signOutForTest());

describe("the résumé mock's writes follow the backend's rules (resume-versioning.md §4.3, §4.7)", () => {
  it("a save is the next version; saving again from the older one says so", async () => {
    const { document } = await resumesMock.open(FIRM, "rv_cand_03_2");
    const first = await resumesMock.save(FIRM, "rv_cand_03_2", { ...document, title: "Edited" });
    expect(first.notice).toBeNull();
    expect(first.opened.resume.versions.at(-1)!.versionNumber).toBe(3);
    expect(first.opened.document.title).toBe("Edited");
    const second = await resumesMock.save(FIRM, "rv_cand_03_2", document);
    expect(second.notice).toBe("v3 was saved while you were editing; your v4 doesn't include those changes.");
  });

  it("the active base can't be deleted; a version sent with a live application can't either; v1 goes with its base", async () => {
    expect((await resumesMock.baseRemoval(FIRM, "cand_03", "base_cand_03")).outcome).toBe("REFUSED");
    const live = allApplications.filter((a) => a.resumeVersionId === "rv_cand_03_2" && !["REJECTED", "WITHDRAWN", "EXPIRED"].includes(a.status)).length;
    expect(live).toBeGreaterThan(0);
    expect(await resumesMock.versionRemoval(FIRM, "cand_03", "rv_cand_03_2")).toMatchObject({ outcome: "REFUSED", uses: { applications: live } });
    expect((await resumesMock.versionRemoval(FIRM, "cand_03", "rv_cand_03_1")).outcome).toBe("REFUSED");
  });

  it("using a later version as the base makes a new active base; the old one, in use, is then hidden, not deleted", async () => {
    const before = await resumesMock.shelfByCandidate(FIRM, "cand_03");
    const v3 = before.resumes.find((r) => r.isMaster)!.versions.find((v) => v.versionNumber === 3)!;
    await resumesMock.useAsBase(FIRM, "cand_03", v3.id);
    const after = await resumesMock.shelfByCandidate(FIRM, "cand_03");
    expect(after.bases.map((b) => [b.source, b.isActive])).toEqual([["UPLOAD", false], ["PROMOTED", true]]);

    const removal = await resumesMock.baseRemoval(FIRM, "cand_03", "base_cand_03");
    expect(removal.outcome).toBe("HIDE");
    expect(removal.rest.versions).toBeGreaterThan(0); // the versions after v1 that nothing sent
    await resumesMock.deleteBase(FIRM, "cand_03", "base_cand_03", true);
    const hidden = await resumesMock.shelfByCandidate(FIRM, "cand_03");
    expect(hidden.bases.find((b) => b.id === "base_cand_03")!.archivedAt).not.toBeNull();
    const kept = hidden.resumes.find((r) => r.baseResumeId === "base_cand_03" && r.isMaster)!;
    expect(kept.versions.map((v) => v.versionNumber)).toEqual([1, 2]); // v1 and the sent v2 stay; the unsent v3, v4 go

    await resumesMock.showBase(FIRM, "cand_03", "base_cand_03");
    expect((await resumesMock.shelfByCandidate(FIRM, "cand_03")).bases.find((b) => b.id === "base_cand_03")!.archivedAt).toBeNull();
  });

  it("only the candidate's BDE manages: another BDE's candidate is refused", async () => {
    await expect(resumesMock.upload(FIRM, "cand_01", "later.pdf")).rejects.toMatchObject({ status: 403 });
  });
});
