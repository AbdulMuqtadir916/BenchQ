import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateCandidate } from "@/lib/schemas/candidate";
import type { CaptureJob } from "@/lib/schemas/job";

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

const candidate = (overrides: Partial<CreateCandidate> = {}): CreateCandidate => ({
  fullName: "Nisha Verma", primaryRole: "Data Engineer", email: "nisha@example.com", phone: null, workAuth: "H1B", needsSponsorship: true, needsTransfer: true, assignedUserId: null, ...overrides,
});

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
  it("an OWNER adds one: ON_BENCH, assigned to the BDE chosen, still there after a reload", async () => {
    const m = await load(EMAIL.imran);
    const created = await m.candidates.create(FIRM, candidate({ assignedUserId: "user_adnan" }));
    expect(created).toMatchObject({ firmId: FIRM, fullName: "Nisha Verma", status: "ON_BENCH", workAuth: "H1B", assignedUserIds: ["user_adnan"], primaryUserId: "user_adnan", primaryRole: "Data Engineer" });
    expect((await m.candidates.list(FIRM))[0]?.id).toBe(created.id);
    m.db.flush();

    const later = await load(EMAIL.imran);
    expect(await later.candidates.byId(FIRM, created.id)).toMatchObject({ fullName: "Nisha Verma" });
  });

  it("an OWNER may leave it unassigned, and may only assign an active BDE of the firm", async () => {
    const m = await load(EMAIL.imran);
    expect((await m.candidates.create(FIRM, candidate())).assignedUserIds).toEqual([]);
    await expect(m.candidates.create(FIRM, candidate({ assignedUserId: "user_fatima" }))).rejects.toMatchObject({ status: 400 }); // a MANAGER
    await expect(m.candidates.create(FIRM, candidate({ assignedUserId: "user_kiran" }))).rejects.toMatchObject({ status: 400 }); // another firm's BDE
  });

  it("a BDE's new candidate is their own (so it is in their scope); a BDE can't assign someone else", async () => {
    const m = await load(EMAIL.adnan);
    const created = await m.candidates.create(FIRM, candidate());
    expect(created).toMatchObject({ assignedUserIds: ["user_adnan"], primaryUserId: "user_adnan" });
    await expect(m.candidates.create(FIRM, candidate({ assignedUserId: "user_sneha" }))).rejects.toMatchObject({ status: 403 });
  });

  it("at the candidate limit it is refused with the reason, and nothing is added (A4)", async () => {
    const m = await load(EMAIL.imran);
    const active = m.allCandidates.filter((row) => row.firmId === FIRM && ["ON_BENCH", "INTERVIEWING", "OFFER"].includes(row.status)).length;
    const { firms } = await import("./team-data");
    firms.find((item) => item.id === FIRM)!.candidateLimit = active; // the plan's limit, as the backend would hold it
    const before = m.allCandidates.length;
    await expect(m.candidates.create(FIRM, candidate())).rejects.toMatchObject({ status: 409, code: "CANDIDATE_LIMIT", message: `Your plan allows ${active} active candidates; ${active} are active.` });
    expect(m.allCandidates.length).toBe(before);
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
