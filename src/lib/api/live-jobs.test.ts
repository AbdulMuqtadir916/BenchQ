import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demoIds from "./dto/demo-ids.json";
import { JOBS_LIST_MAX, jobsApi } from "./jobs";

/** The jobs adapter on the backend (backend/api/routes_job_search.py, docs/02 §6.z): the only source of jobs. */
const BASE = `/api/firms/${demoIds.firm_hts}/job-postings`;
const urls: string[] = [];

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the firm's jobs on the backend", () => {
  it("never asks for more than the backend answers (a larger limit is its 422)", async () => {
    await jobsApi.list("firm_hts", { limit: 1000 });
    await jobsApi.list("firm_hts");
    await jobsApi.list("firm_hts", { limit: 50, candidateId: "0b9c6c1e-0000-4000-8000-000000000000" });
    expect(urls).toEqual([
      `${BASE}?limit=${JOBS_LIST_MAX}`,
      `${BASE}?limit=${JOBS_LIST_MAX}`,
      `${BASE}?limit=50&candidate_id=0b9c6c1e-0000-4000-8000-000000000000`,
    ]);
  });
});
