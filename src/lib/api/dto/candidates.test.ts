import { describe, expect, it } from "vitest";
import { CandidateSchema } from "@/lib/schemas/candidate";
import { createCandidateBody } from "@/mocks/create-candidate-body";
import sample from "./__samples__/candidates.json";
import { CandidateDto, toBackendAssign, toBackendCreateCandidate, toBackendUpdateCandidate, toCandidate } from "./candidates";
import { toBackendId } from "./demo-ids";

/** The mapper against a real response (GET /api/firms/{id}/candidates on the demo seed; onboarding 07 §3). */
const [assigned, queued] = sample.list.map((row) => toCandidate(CandidateDto.parse(row)));

describe("the backend candidate → Candidate", () => {
  it("parses the sample into the frontend's schema, translating seeded ids back to fixture ids", () => {
    expect(CandidateSchema.parse(assigned)).toEqual(assigned);
    expect(assigned).toMatchObject({ firmId: "firm_hts", managerId: "user_fatima", fullName: "Meera Krishnan", status: "ON_BENCH" });
    expect(assigned!.id).toMatch(/^cand_/);
    expect(assigned!.bdeId).toMatch(/^user_/);
  });

  it("maps the nested persona and answers, and timestamps to UTC ISO", () => {
    expect(assigned!.persona).toMatchObject({ willRelocate: false, preferredIndustries: ["any"], dealBreakers: [] });
    expect(assigned!.qaBank[0]).toMatchObject({ useCount: 3, state: "VERIFIED", evidenceId: "ev_cand_06_qa_0" });
    expect(assigned!.createdAt).toBe("2026-09-26T06:17:52.966Z");
  });

  it("a candidate in a manager's queue has no BDE", () => {
    expect(queued).toMatchObject({ bdeId: null, managerId: "user_fatima", workSettings: ["REMOTE", "HYBRID"] });
  });

  it("refuses a VERIFIED answer without evidence (Truth Guard)", () => {
    const row = structuredClone(sample.list[0]!);
    row.qa_bank[0]!.evidence_id = null as unknown as string;
    expect(() => toCandidate(CandidateDto.parse(row))).toThrow(/VERIFIED without evidence/);
  });

  it("refuses a value the frontend doesn't know (a contract change is a stop-and-ask, 07 §2)", () => {
    expect(() => toCandidate(CandidateDto.parse({ ...sample.list[0], status: "ON_HOLD" }))).toThrow();
  });
});

describe("bodies sent to the backend", () => {
  it("create: snake_case, with the manager and BDE by their backend ids", () => {
    const body = toBackendCreateCandidate(createCandidateBody({ bdeId: "user_adnan", handoffNote: "Push banking.", skills: [{ name: "Java", family: null, source: "MANUAL" }] }));
    expect(body).toMatchObject({ full_name: "Nisha Verma", work_auth: "H1B", manager_id: toBackendId("user_fatima"), bde_id: toBackendId("user_adnan"), handoff_note: "Push banking.", skills: [{ name: "Java", family: null, source: "MANUAL" }] });
    expect(Object.keys(body).every((key) => key === key.toLowerCase())).toBe(true);
  });

  it("update: only the fields being changed", () => {
    expect(toBackendUpdateCandidate({ rateTarget: 90, employmentTypes: ["C2C"] })).toEqual({ rate_target: 90, employment_types: ["C2C"] });
  });

  it("assign: the queue is a null BDE", () => {
    expect(toBackendAssign({ managerId: "user_priya", bdeId: null, note: null })).toEqual({ manager_id: toBackendId("user_priya"), bde_id: null, note: null });
  });
});
