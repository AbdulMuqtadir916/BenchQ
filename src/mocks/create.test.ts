import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureJob } from "@/lib/schemas/job";
import { createCandidateBody as candidate } from "./create-candidate-body";

/**
 * Phase B fix PR 1 (audit B1, B2): New candidate and Capture job save for real. Both persist across a
 * reload, follow the policy (a BDE's candidate is their own; a VIEWER and a
 * support view are refused, write-authorization.test.ts), and a new candidate respects the plan's
 * candidate limit (A4). Each "reload" is a fresh set of mock modules over the same stub storage.
 */

class StubStorage {
  items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

type Globals = { __BENCHQ_DEMO_STORAGE__?: Storage | null };
const g = globalThis as Globals;
const FIRM = "firm_hts";
const EMAIL = { imran: "user_imran", adnan: "user_adnan", lakshmi: "user_lakshmi", sana: "padm_sana" }; // seeded account ids (./sign-in-as.ts)

async function load(email: string | null) {
  vi.resetModules();
  const [db, signIn, candidates, jobs] = await Promise.all([import("./db"), import("./sign-in-as"), import("./candidates"), import("./jobs")]);
  if (email) await signIn.signInAs(email);
  return { db, signInAs: signIn.signInAs, candidates: candidates.candidatesMock, allCandidates: candidates.allCandidates, jobs: jobs.jobsMock, DuplicateJobError: jobs.DuplicateJobError };
}

const job = (overrides: Partial<CaptureJob> = {}): CaptureJob => ({
  sourceUrl: "https://careers.example.com/jobs/4021?utm_source=linkedin", title: "Senior Data Engineer", companyName: "JPMorgan Chase", location: "Dallas, TX",
  remoteMode: "HYBRID", employmentType: "C2C", payPeriod: "HOUR", payMin: 80, payMax: 95, sponsorsVisa: true, excludesC2C: false,
  experience: "5+ years", skills: ["Spark", "AWS"], description: "Build data pipelines.", ...overrides,
});

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
beforeEach(() => {
  g.__BENCHQ_DEMO_STORAGE__ = new StubStorage() as unknown as Storage;
});
afterEach(() => {
  delete g.__BENCHQ_DEMO_STORAGE__;
});

describe("New candidate", () => {
  it("an OWNER adds one: ON_BENCH, with the manager and BDE chosen, still there after a reload", async () => {
    const m = await load(EMAIL.imran);
    const created = await m.candidates.create(FIRM, candidate({ bdeId: "user_adnan" }));
    expect(created).toMatchObject({ firmId: FIRM, fullName: "Nisha Verma", status: "ON_BENCH", workAuth: "H1B", managerId: "user_fatima", bdeId: "user_adnan", primaryRole: "Data Engineer" });
    expect((await m.candidates.list(FIRM))[0]?.id).toBe(created.id);
    m.db.flush();

    const later = await load(EMAIL.imran);
    expect(await later.candidates.byId(FIRM, created.id)).toMatchObject({ fullName: "Nisha Verma" });
  });

  it("with it: a Record whose every claim is UNVERIFIED with no evidence, and the parsed résumé as a RESUME document (05 §2, Q49)", async () => {
    const m = await load(EMAIL.imran);
    const [records, documents] = await Promise.all([import("./records"), import("./documents")]);
    const parse = await m.candidates.parseResume(FIRM, { fileName: "Nisha_Verma.pdf", sizeBytes: 204800, mimeType: "application/pdf" });
    const created = await m.candidates.create(FIRM, candidate({
      bdeId: "user_adnan", summary: "Eight years of data pipelines.", resumeParseId: parse.parse_id,
      skills: [{ name: "Spark", family: "Data", source: "AI_EXTRACTED" }, { name: "Airflow", family: null, source: "MANUAL" }],
    }));
    const record = await records.recordsMock.byCandidate(FIRM, created.id);
    expect(record).toMatchObject({ headline: "Data Engineer", summary: "Eight years of data pipelines.", summaryState: "UNVERIFIED", evidence: [], lastVerifiedAt: null });
    expect(record.skills.map((skill) => [skill.name, skill.source, skill.state])).toEqual([["Spark", "AI_EXTRACTED", "UNVERIFIED"], ["Airflow", "MANUAL", "UNVERIFIED"]]);
    expect(JSON.stringify(record)).not.toMatch(/"VERIFIED"/);
    expect(await documents.documentsMock.byCandidate(FIRM, created.id)).toEqual([expect.objectContaining({ kind: "RESUME", fileName: "Nisha_Verma.pdf", sizeKb: 200 })]);

    const noResume = await m.candidates.create(FIRM, candidate({ email: "other@example.com" }));
    expect(await documents.documentsMock.byCandidate(FIRM, noResume.id)).toEqual([]);
  });

  it("an OWNER may hand it to a manager without a BDE, and may only name an active manager and a BDE under them", async () => {
    const m = await load(EMAIL.imran);
    expect(await m.candidates.create(FIRM, candidate())).toMatchObject({ managerId: "user_fatima", bdeId: null });
    await expect(m.candidates.create(FIRM, candidate({ managerId: "user_adnan" }))).rejects.toMatchObject({ status: 400 }); // a BDE, not a manager
    await expect(m.candidates.create(FIRM, candidate({ managerId: "user_arjun" }))).rejects.toMatchObject({ status: 400 }); // another firm's manager
    await expect(m.candidates.create(FIRM, candidate({ bdeId: "user_fatima" }))).rejects.toMatchObject({ status: 400 }); // a MANAGER as the BDE
    await expect(m.candidates.create(FIRM, candidate({ bdeId: "user_kiran" }))).rejects.toMatchObject({ status: 400 }); // another firm's BDE
  });

  it("a named BDE brings their own manager (the mock holds the hierarchy until the backend sends it)", async () => {
    const m = await load(EMAIL.imran);
    expect(await m.candidates.create(FIRM, candidate({ bdeId: "user_vikram" }))).toMatchObject({ managerId: "user_priya", bdeId: "user_vikram" });
  });

  it("a BDE can't add a candidate (07 Q41)", async () => {
    const m = await load(EMAIL.adnan);
    await expect(m.candidates.create(FIRM, candidate({ bdeId: "user_adnan" }))).rejects.toMatchObject({ status: 403 });
  });

  it("a MANAGER adds one for a BDE of their own team only, never to their queue alone (07 Q41)", async () => {
    const m = await load("user_fatima");
    expect(await m.candidates.create(FIRM, candidate({ bdeId: "user_sneha" }))).toMatchObject({ managerId: "user_fatima", bdeId: "user_sneha" });
    await expect(m.candidates.create(FIRM, candidate({ bdeId: "user_vikram" }))).rejects.toMatchObject({ status: 403 }); // Priya's BDE
    await expect(m.candidates.create(FIRM, candidate())).rejects.toMatchObject({ status: 403 }); // no BDE
  });

  it("at the candidate limit, giving it a BDE is refused with the reason; a manager's queue never is (07 Q45)", async () => {
    const m = await load(EMAIL.imran);
    const assigned = m.allCandidates.filter((row) => row.firmId === FIRM && row.bdeId !== null && ["ON_BENCH", "INTERVIEWING", "OFFER"].includes(row.status)).length;
    const { firms } = await import("./team-data");
    firms.find((item) => item.id === FIRM)!.candidateLimit = assigned; // the plan's limit, as the backend would hold it
    const before = m.allCandidates.length;
    await expect(m.candidates.create(FIRM, candidate({ bdeId: "user_adnan" }))).rejects.toMatchObject({
      status: 409, code: "CANDIDATE_LIMIT",
      message: `Your plan allows ${assigned} assigned candidates; ${assigned} are assigned. Hand this candidate to a manager instead, or free a slot.`,
    });
    expect(m.allCandidates.length).toBe(before);
    expect(await m.candidates.create(FIRM, candidate())).toMatchObject({ bdeId: null });
  });

  it("checks the fields", async () => {
    const m = await load(EMAIL.imran);
    await expect(m.candidates.create(FIRM, candidate({ fullName: "  " }))).rejects.toThrow();
    await expect(m.candidates.create(FIRM, candidate({ primaryRole: "" }))).rejects.toThrow();
  });
});

describe("Capture job", () => {
  it("captures one: first in the list, by id, provenance USER_SUBMITTED by the user, the known company reused, kept after a reload", async () => {
    const m = await load(EMAIL.adnan);
    const captured = await m.jobs.capture(FIRM, job());
    expect(captured).toMatchObject({
      firmId: FIRM, title: "Senior Data Engineer", city: "Dallas", state: "TX", remoteMode: "HYBRID", employmentType: "C2C", rateMin: 80, rateMax: 95, salaryMin: null,
      company: { id: "comp_01", name: "JPMorgan Chase" },
      dedupe: { canonicalUrl: "https://careers.example.com/jobs/4021" },
      provenance: { sourceType: "USER_SUBMITTED", legalBasis: "USER_SESSION", capturedByUserId: "user_adnan" },
    });
    expect(captured.requirements.map((requirement) => [requirement.category, requirement.value])).toEqual([["SKILL", "Spark"], ["SKILL", "AWS"], ["EXPERIENCE_YEARS", "5+ years"]]);
    expect((await m.jobs.list(FIRM))[0]?.id).toBe(captured.id);
    m.db.flush();

    const later = await load(EMAIL.adnan);
    expect(await later.jobs.byId(FIRM, captured.id)).toMatchObject({ title: "Senior Data Engineer" });
  });

  it("a company it doesn't know is added with nothing known yet; a yearly range is a salary", async () => {
    const m = await load(EMAIL.imran);
    const captured = await m.jobs.capture(FIRM, job({ companyName: "Brand New Labs", payPeriod: "YEAR", payMin: 120000, payMax: 150000, sponsorsVisa: false }));
    expect(captured.company).toMatchObject({ name: "Brand New Labs", normalisedName: "brand-new-labs", clientType: "UNKNOWN", h1b: null, verification: null });
    expect(captured).toMatchObject({ rateMin: null, salaryMin: 120000, salaryMax: 150000, allowedWorkAuth: ["USC", "GC"] });
  });

  it("the same listing twice in a firm is refused with the existing job (tracking and trailing slash ignored); another firm may capture it", async () => {
    const m = await load(EMAIL.imran);
    const first = await m.jobs.capture(FIRM, job());
    const again = m.jobs.capture(FIRM, job({ sourceUrl: "https://CAREERS.example.com/jobs/4021/?gclid=x#apply", title: "Other title" }));
    await expect(again).rejects.toBeInstanceOf(m.DuplicateJobError);
    await expect(again).rejects.toMatchObject({ status: 409, jobId: first.id });
    const fixture = (await m.jobs.list(FIRM))[1]!;
    await expect(m.jobs.capture(FIRM, job({ sourceUrl: `${fixture.dedupe.canonicalUrl}?ref=x` }))).rejects.toMatchObject({ jobId: fixture.id });

    await m.signInAs(EMAIL.lakshmi);
    await expect(m.jobs.capture("firm_stl", job())).resolves.toMatchObject({ firmId: "firm_stl" });
  });
});
