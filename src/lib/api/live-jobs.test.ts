import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobSchema } from "@/lib/schemas/job";
import demoIds from "./dto/demo-ids.json";

/**
 * Jobs and the heart on the live backend (PR 4): with `jobs,applications` in NEXT_PUBLIC_LIVE_MODULES the feed
 * comes from GET /api/jobs (an empty feed is an empty list), and saving a job for a candidate calls the backend's
 * existing favourite + Saved-draft endpoints.
 */
const before = process.env.NEXT_PUBLIC_LIVE_MODULES;
process.env.NEXT_PUBLIC_LIVE_MODULES = "jobs,applications";
vi.resetModules();
const { jobsApi } = await import("./jobs");
const { applicationsApi } = await import("./applications");
afterAll(() => {
  process.env.NEXT_PUBLIC_LIVE_MODULES = before;
  vi.resetModules();
});

const JOB = {
  id: "5d2c0000-0000-4000-8000-000000000001", external_id: "ext-1", company: "Acme Corp", title: "Data Engineer",
  url: "https://careers.acme.example/jobs/1", source: "manual", description: "Build pipelines.\n- Python", location: "Austin, TX",
  remote: false, arr_remote: null, arr_hybrid: true, arr_onsite: null, salary_min: 120000, salary_max: 150000,
  status: "new", discovered_at: "2026-11-05T10:00:00", cv_scores: {}, in_flight: [],
};

let answers: { status: number; body: unknown }[];
const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("jobs on the live backend", () => {
  it("maps the feed to valid frontend jobs, inventing nothing the backend lacks", async () => {
    answers.push({ status: 200, body: { total: 1, jobs: [JOB] } });
    const [job] = await jobsApi.list("firm_hts", { limit: 400 });
    expect(calls[0]!.url).toContain("/api/jobs?limit=200&offset=0");
    expect(() => JobSchema.parse(job)).not.toThrow();
    expect(job).toMatchObject({
      id: JOB.id, title: "Data Engineer", city: "Austin", state: "TX", remoteMode: "HYBRID", salaryMin: 120000,
      applyUrl: JOB.url, requirements: [], employmentType: null, rateMin: null, isActive: true,
      company: { name: "Acme Corp", h1b: null, verification: null },
    });
  });

  it("shows an empty feed as no jobs, not an error", async () => {
    answers.push({ status: 200, body: { total: 0, jobs: [] } });
    await expect(jobsApi.list("firm_hts")).resolves.toEqual([]);
  });

  it("reads further pages only while the backend has more", async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ ...JOB, id: `job-${i}` }));
    answers.push({ status: 200, body: { total: 201, jobs: page } }, { status: 200, body: { total: 201, jobs: [{ ...JOB, id: "job-200" }] } });
    const jobs = await jobsApi.list("firm_hts", { limit: 400 });
    expect(jobs).toHaveLength(201);
    expect(calls.map((c) => c.url)).toEqual([expect.stringContaining("offset=0"), expect.stringContaining("limit=200&offset=200")]);
  });

  it("drops a URL that is not http(s)", async () => {
    answers.push({ status: 200, body: { total: 1, jobs: [{ ...JOB, url: "javascript:alert(1)" }] } });
    const [job] = await jobsApi.list("firm_hts");
    expect(job!.applyUrl).toBeNull();
    expect(job!.provenance.sourceUrl).toBeNull();
  });
});

describe("saving a job for a candidate", () => {
  it("creates the Saved application with the candidate's backend id", async () => {
    answers.push({ status: 200, body: { id: "app-1", job_id: JOB.id, candidate_id: demoIds.cand_01, status: "saved", favorite: true } });
    await applicationsApi.saveJob("firm_hts", { candidateId: "cand_01", jobId: JOB.id, title: "Data Engineer", company: "Acme Corp", url: JOB.url });
    expect(calls[0]).toEqual({
      url: expect.stringMatching(/\/api\/applications$/), method: "POST",
      body: { candidate_id: demoIds.cand_01, job_id: JOB.id, status: "saved", title: "Data Engineer", company: "Acme Corp", url: JOB.url },
    });
  });

  it("removes it with unfavorite only", async () => {
    answers.push({ status: 200, body: { favorite: false, application_id: "app-1", application_preserved: false } });
    await applicationsApi.unsaveJob("firm_hts", "app-1");
    expect(calls[0]).toEqual({ url: expect.stringMatching(/\/api\/applications\/app-1$/), method: "PATCH", body: { unfavorite: true } });
  });

  it("passes the backend's refusal for a job outside the candidate's list", async () => {
    answers.push({ status: 404, body: { detail: "Job not found for this candidate." } });
    await expect(applicationsApi.saveJob("firm_hts", { candidateId: "cand_01", jobId: JOB.id, title: "t", company: "c", url: "" }))
      .rejects.toMatchObject({ status: 404 });
  });
});
