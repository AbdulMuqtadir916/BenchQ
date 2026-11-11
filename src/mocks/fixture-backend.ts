import { vi } from "vitest";
import { ledgerApi } from "@/lib/api/analytics";
import { jobsApi } from "@/lib/api/jobs";
import { liveSession } from "@/lib/api/live-session";
import { platformApi } from "@/lib/api/platform";
import { sessionApi } from "@/lib/api/session";
import { teamApi } from "@/lib/api/team";
import { ApiError } from "@/lib/api/client";
import { JobSchema, type Job } from "@/lib/schemas/job";
import { mockResult, inFirm } from "./_shared";
import { injectedFailure } from "./membership";
import { firmBySlugForTest } from "./sign-in-as";
import { allUsers, firms } from "./team-data";
import { invites, plans } from "./tenancy";

/**
 * TESTS ONLY: answer the reads that moved to the backend (the session, the team, invites, the ledger and the platform tier) from the
 * fixtures, so a component test can render a dashboard or an admin page without one. Same data the mocks served
 * before F6, and the dev fault switch (`window.__BENCHQ_MOCK_FAIL__`) still makes a named read fail, so the
 * error and Retry states stay testable. What the backend really answers is tested in backend/tests/.
 */
/** The jobs the stubbed backend answers with (none unless a test sets them): jobs are only the backend's (docs/02 §6.z). */
let stubJobs: Job[] = [];
export function setStubJobs(jobs: Job[]): void {
  stubJobs = jobs;
}

/** A job found by a search for one candidate, as the mapper makes it (src/lib/api/dto/jobs.ts): only what a posting knows. */
export function stubJob(firmId: string, candidateId: string, n: number, title: string): Job {
  const url = `https://jobs.example.test/${candidateId}-${n}`;
  return JobSchema.parse({
    id: `job_stub_${candidateId}_${n}`, firmId, companyId: "company:example-corp",
    company: { id: "company:example-corp", name: "Example Corp", normalisedName: "example-corp", domain: null, websiteUrl: null, linkedinUrl: null, employeeBand: null, hasUsPresence: null, clientType: "UNKNOWN", atsProvider: null, h1b: null, verification: null },
    title, normalisedTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: "A made-up job.", city: "Remote", state: null, country: "US", remoteMode: "REMOTE",
    employmentType: null, rateMin: null, rateMax: null, salaryMin: null, salaryMax: null, allowedWorkAuth: [], excludesC2C: false, postedAt: null, applicantCount: null, applyUrl: url,
    requirements: [], dedupe: { urlHash: "", contentHash: `hash_${candidateId}_${n}`, canonicalUrl: url, duplicateOfJobId: null },
    provenance: { sourceType: "AGGREGATOR", sourceId: "freehire", sourceUrl: url, legalBasis: "LICENSED_API", capturedByUserId: null, ingestedAt: "2026-11-11T13:00:00.000Z" },
    isActive: true, candidateIds: [candidateId],
  });
}

export function stubBackendReads(): void {
  const newestFirst = (rows: typeof invites) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  vi.spyOn(sessionApi, "current").mockImplementation(async () => liveSession());
  vi.spyOn(sessionApi, "firmBySlug").mockImplementation(firmBySlugForTest);
  vi.spyOn(ledgerApi, "list").mockImplementation(() => mockResult([]));
  vi.spyOn(jobsApi, "list").mockImplementation((firmId, params) => {
    injectedFailure("jobs.list");
    return mockResult(stubJobs.filter((job) => job.firmId === firmId && (!params?.candidateId || job.candidateIds.includes(params.candidateId))));
  });
  vi.spyOn(teamApi, "list").mockImplementation((firmId) => {
    injectedFailure("team.list");
    return mockResult(inFirm(allUsers, firmId));
  });
  vi.spyOn(teamApi, "invites").mockImplementation((firmId) => {
    injectedFailure("memberInvites.list");
    return mockResult(newestFirst(inFirm(invites, firmId)));
  });
  vi.spyOn(platformApi.firms, "get").mockImplementation(async (firmId) => {
    const firm = firms.find((item) => item.id === firmId);
    if (!firm) throw new ApiError("Not found.", "NOT_FOUND", 404);
    return mockResult(firm);
  });
  vi.spyOn(platformApi.firms, "list").mockImplementation(() => mockResult(firms));
  vi.spyOn(platformApi.users, "list").mockImplementation((firmId) => mockResult(firmId ? inFirm(allUsers, firmId) : allUsers));
  vi.spyOn(platformApi.invites, "list").mockImplementation((firmId) => mockResult(firmId === undefined ? invites : invites.filter((invite) => invite.firmId === firmId)));
  vi.spyOn(platformApi.plans, "list").mockImplementation(() => mockResult(plans));
  vi.spyOn(platformApi.audit, "list").mockImplementation(() => mockResult([]));
}
