import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("maps the preferences, no answer bank (each résumé version's autofill since 0019), and timestamps to UTC ISO", () => {
    expect(assigned).toMatchObject({ preferredIndustries: ["any"], dealBreakers: [], qaBank: [] });
    expect(assigned!.createdAt).toBe("2026-09-26T06:17:52.966Z");
  });

  it("a candidate in a manager's queue has no BDE", () => {
    expect(queued).toMatchObject({ bdeId: null, managerId: "user_fatima", workSettings: ["REMOTE", "HYBRID"] });
  });

  it("refuses a value the frontend doesn't know (a contract change is a stop-and-ask, 07 §2)", () => {
    expect(() => toCandidate(CandidateDto.parse({ ...sample.list[0], status: "ON_HOLD" }))).toThrow();
  });
});

/**
 * BUG-014: one malformed optional link (the candidate's LinkedIn comes from the active résumé) used to fail `toCandidate`,
 * and so every list and detail read, for every role. The mapper's input is the backend shape (`linkedin_url`).
 */
describe("a malformed optional link", () => {
  const withLink = (link: string | null) => CandidateDto.parse({ ...sample.list[0], linkedin_url: link });
  const silenceWarnings = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

  afterEach(() => vi.restoreAllMocks());

  it("becomes null instead of failing the read, and everything else is kept", () => {
    silenceWarnings();
    const candidate = toCandidate(withLink("aghajrgng;knga"));
    expect(candidate.linkedinUrl).toBeNull();
    expect(candidate).toEqual({ ...assigned!, linkedinUrl: null });
    expect(CandidateSchema.parse(candidate)).toEqual(candidate);
  });

  it("is logged without the typed value, naming the field and the candidate", () => {
    const warn = silenceWarnings();
    toCandidate(withLink("aghajrgng;knga"));
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("linkedin_url");
    expect(message).toContain(assigned!.id);
    expect(message).not.toContain("aghajrgng");
  });

  it("recovers for every row of a list: one bad row no longer fails the others", () => {
    silenceWarnings();
    const mapped = [withLink("aghajrgng;knga"), CandidateDto.parse(sample.list[1])].map(toCandidate);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]!.linkedinUrl).toBeNull();
    expect(mapped[1]).toEqual(queued);
  });

  it("keeps a well-formed link, and a null one, without logging", () => {
    const warn = silenceWarnings();
    expect(toCandidate(withLink("https://linkedin.com/in/meera-k")).linkedinUrl).toBe("https://linkedin.com/in/meera-k");
    expect(toCandidate(withLink(null)).linkedinUrl).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not hide a different problem: a bad link beside an unknown status still throws", () => {
    silenceWarnings();
    const row = CandidateDto.parse({ ...sample.list[0], linkedin_url: "aghajrgng;knga", status: "ON_HOLD" });
    expect(() => toCandidate(row)).toThrow();
  });
});

describe("bodies sent to the backend", () => {
  it("create: snake_case, with the manager and BDE by their backend ids", () => {
    const body = toBackendCreateCandidate(createCandidateBody({ bdeId: "user_adnan", handoffNote: "Push banking.", skills: [{ name: "Java", family: null }] }));
    expect(body).toMatchObject({ full_name: "Nisha Verma", work_auth: "H1B", manager_id: toBackendId("user_fatima"), bde_id: toBackendId("user_adnan"), handoff_note: "Push banking.", skills: [{ name: "Java", family: null }] });
    expect(Object.keys(body).every((key) => key === key.toLowerCase())).toBe(true);
  });

  it("update: only the fields being changed", () => {
    expect(toBackendUpdateCandidate({ rateTarget: 90, employmentTypes: ["C2C"] })).toEqual({ rate_target: 90, employment_types: ["C2C"] });
  });

  it("update: a new work authorization goes with its sponsorship and transfer (the backend refuses it alone)", () => {
    expect(toBackendUpdateCandidate({ workAuth: "GC", needsSponsorship: false, needsTransfer: false })).toEqual({
      work_auth: "GC", needs_sponsorship: false, needs_transfer: false });
  });

  it("assign: the queue is a null BDE", () => {
    expect(toBackendAssign({ managerId: "user_priya", bdeId: null, note: null })).toEqual({ manager_id: toBackendId("user_priya"), bde_id: null, note: null });
  });
});
