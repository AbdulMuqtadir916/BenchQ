import { beforeAll, describe, expect, it, vi } from "vitest";

// The candidates come from the backend (no candidates mock): Adnan is cand_01's BDE here.
vi.mock("@/lib/api/candidates", () => ({
  candidatesApi: { list: vi.fn(async () => [{ id: "cand_01", managerId: "user_fatima", bdeId: "user_adnan" }]) },
}));

const FIRM = "firm_hts";

/** Abdul's review of #140, #3: a mock Saved draft moved on kept no submitter, so it left its BDE's board (a BDE sees
 * Saved drafts and the applications they submitted). The first move out of Saved records who made it, as the backend
 * does (backend/applications/tracking.py). */
describe("a mock Saved draft's first move on", () => {
  beforeAll(async () => {
    const { signInAs } = await import("./sign-in-as");
    await signInAs("user_adnan");
  });

  it("records the BDE who moved it, so it stays theirs, and a later move never changes that", async () => {
    const { applicationsMock } = await import("./applications");
    const saved = await applicationsMock.saveJob(FIRM, { candidateId: "cand_01", jobId: "job_submitter_test", title: "QA", company: "Example" });
    expect([saved.status, saved.submittedByUserId]).toEqual(["SAVED", ""]);
    const applied = await applicationsMock.updateStatus(FIRM, saved.id, { status: "APPLIED", note: null });
    expect(applied.submittedByUserId).toBe("user_adnan");
    // Still the BDE's: a second move finds it (a draft out of scope would be "not found").
    const screening = await applicationsMock.updateStatus(FIRM, saved.id, { status: "SCREENING_CALL", note: null });
    expect(screening.submittedByUserId).toBe("user_adnan");
  });
});
