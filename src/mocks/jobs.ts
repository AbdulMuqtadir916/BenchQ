import { z } from "zod";
import { ApiError, arrayOf } from "@/lib/api/client";
import { CompanySchema, type Company } from "@/lib/schemas/company";
import { canSearchJobs } from "@/lib/auth/policy";
import type { Candidate } from "@/lib/schemas/candidate";
import { CaptureJobSchema, JobSchema, type CaptureJob, type Job } from "@/lib/schemas/job";
import { JobSearchSchema, type JobSearch, type JobSearches } from "@/lib/schemas/job-search";
import companiesSeed from "./data/companies.json";
import jobsSeed from "./data/jobs.json";
import { findInFirm, inFirm, mockResult, newId, notFound } from "./_shared";
import { allCandidates } from "./candidates";
import { currentPrincipal, currentUser } from "./auth";
import { changed, table } from "./db";
import { firmScoped } from "./membership";

/** The fixture jobs (2 MB: never written to the browser's demo data). */
const fixtureJobs: Job[] = arrayOf(JobSchema).parse(jobsSeed);
/** Jobs captured in this browser (persisted, src/mocks/db.ts), newest first. */
export const capturedJobs: Job[] = table("capturedJobs", JobSchema, () => []);

/** Every job: captured ones first, so they lead the lists. */
export const allJobs = (): Job[] => [...capturedJobs, ...fixtureJobs];

const knownCompanies: Company[] = arrayOf(CompanySchema).parse(companiesSeed);

/** "JPMorgan Chase" → "jpmorgan-chase", as the fixtures' `normalisedName` / `normalisedTitle`. */
const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The listing's address without tracking: no query or fragment, lowercase host, no trailing slash. */
function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
}

/** A small stable hash (FNV-1a) for the dedupe fields; the backend hashes properly. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return (value >>> 0).toString(16);
}

/** Companies are global reference data (07 Q13): reuse one by name, else add it with nothing known yet. */
function companyFor(name: string): Company {
  const key = normalise(name);
  const known = knownCompanies.find((company) => company.normalisedName === key) ?? capturedJobs.find((job) => job.company.normalisedName === key)?.company;
  if (known) return known;
  return CompanySchema.parse({
    id: newId("comp"), name, normalisedName: key, domain: null, websiteUrl: null, linkedinUrl: null, employeeBand: null,
    hasUsPresence: null, clientType: "UNKNOWN", atsProvider: null, h1b: null, verification: null,
  });
}

/** Thrown when the candidate already has this job; `jobId` is the existing one, for "View job". */
export class DuplicateJobError extends ApiError {
  jobId: string;
  constructor(jobId: string) {
    super("This job is already in this candidate's jobs.", "DUPLICATE_JOB", 409);
    this.jobId = jobId;
  }
}

/** A job the mock knows only a little about, as the backend's would be (docs/02 §6.z): the rest stays unknown. */
function knownLittle(fields: { id: string; firmId: string; title: string; companyName: string; location: string; description: string; url: string; candidateId: string; sourceType: "MANUAL" | "AGGREGATOR"; at: Date }): Job {
  const company = companyFor(fields.companyName);
  const location = fields.location.trim() || null;
  return JobSchema.parse({
    id: fields.id, firmId: fields.firmId, companyId: company.id, company, title: fields.title, normalisedTitle: normalise(fields.title),
    description: fields.description, city: location, state: null, country: "US",
    remoteMode: location && /\bremote\b/i.test(location) ? "REMOTE" : "ONSITE", employmentType: null,
    rateMin: null, rateMax: null, salaryMin: null, salaryMax: null, allowedWorkAuth: [], excludesC2C: false,
    postedAt: null, applicantCount: null, applyUrl: fields.url, requirements: [],
    dedupe: { urlHash: `urlh_${hash(canonicalUrl(fields.url))}`, contentHash: `ctnh_${hash(fields.description)}`, canonicalUrl: canonicalUrl(fields.url), duplicateOfJobId: null },
    provenance: { sourceType: fields.sourceType, sourceId: fields.sourceType === "MANUAL" ? "manual" : "mock", sourceUrl: fields.url, legalBasis: fields.sourceType === "MANUAL" ? "USER_SESSION" : "LICENSED_API", capturedByUserId: currentUser().id, ingestedAt: fields.at.toISOString() },
    isActive: true,
    candidateIds: [fields.candidateId],
  });
}

// ── "Find jobs" (docs/02 §6.z): a fake search that saves a few fixture jobs for the candidate ──

const StoredSearchSchema = JobSearchSchema.extend({ firmId: z.string(), candidateId: z.string(), userId: z.string() });
type StoredSearch = z.infer<typeof StoredSearchSchema>;
/** Searches run in this browser (persisted), newest first. */
const storedSearches: StoredSearch[] = table("jobSearches", StoredSearchSchema, () => []);

/** How long the fake search "runs" before its jobs arrive. */
const SEARCH_TAKES_MS = 3000;
const JOBS_PER_SEARCH = 5;
const CAPS = { jobs: 100, searches: 20, captures: 20 } as const;

/** The day's start: the last 6:30 PM IST (13:00 UTC), when the BDE's shift starts; and when it resets. */
function dayBounds(now = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0));
  if (start > now) start.setUTCDate(start.getUTCDate() - 1);
  const resetsAt = new Date(start);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { start, resetsAt };
}

const isCandidates = (candidateId: string) => (job: Job) => job.candidateIds.includes(candidateId);

/** A finished-in-time search saves its jobs: the first fixture jobs the candidate doesn't have, within today's 100. */
function settle(now = new Date()): void {
  let isChanged = false;
  for (const search of storedSearches) {
    if (search.state !== "RUNNING" || now.getTime() - new Date(search.startedAt).getTime() < SEARCH_TAKES_MS) continue;
    const { start } = dayBounds(now);
    const theirs = capturedJobs.filter(isCandidates(search.candidateId));
    const savedToday = theirs.filter((job) => job.provenance.sourceType === "AGGREGATOR" && new Date(job.provenance.ingestedAt) >= start).length;
    const known = new Set(theirs.map((job) => job.dedupe.contentHash));
    // Like a real search, the role's jobs first: fixture jobs whose title shares a word with the query.
    const words = (search.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    const matches = (job: Job) => words.some((word) => job.title.toLowerCase().includes(word));
    const unseen = inFirm(fixtureJobs, search.firmId).filter((job) => !known.has(`ctnh_${hash(job.description)}`));
    const fresh = [...unseen.filter(matches), ...unseen.filter((job) => !matches(job))].slice(0, JOBS_PER_SEARCH);
    const room = Math.max(0, CAPS.jobs - savedToday);
    for (const job of fresh.slice(0, room)) {
      capturedJobs.unshift(knownLittle({ id: newId("job", now), firmId: search.firmId, title: job.title, companyName: job.company.name, location: job.remoteMode === "REMOTE" ? "Remote" : [job.city, job.state].filter(Boolean).join(", "), description: job.description, url: job.applyUrl ?? job.provenance.sourceUrl ?? `https://jobs.example.test/${job.id}`, candidateId: search.candidateId, sourceType: "AGGREGATOR", at: now }));
    }
    Object.assign(search, { state: fresh.length ? "SUCCESS" : "EMPTY", newCount: Math.min(fresh.length, room), overLimitCount: Math.max(0, fresh.length - room), finishedAt: now.toISOString() });
    isChanged = true;
  }
  if (isChanged) changed("jobSearches", "capturedJobs");
}

function candidateFor(firmId: string, candidateId: string): Candidate {
  const candidate = inFirm(allCandidates, firmId).find((row) => row.id === candidateId);
  if (!candidate) notFound("Candidate", candidateId);
  return candidate;
}

function searchesFor(firmId: string, candidateId: string): JobSearches {
  settle();
  const candidate = candidateFor(firmId, candidateId);
  const { start, resetsAt } = dayBounds();
  const mine = storedSearches.filter((search) => search.firmId === firmId && search.candidateId === candidateId);
  const bdeId = candidate.bdeId;
  const today = (at: string) => new Date(at) >= start;
  const strip = (stored: StoredSearch): JobSearch => JobSearchSchema.parse(stored);
  const running = mine.find((search) => search.state === "RUNNING");
  return {
    running: running ? strip(running) : null,
    searches: mine.filter((search) => search.state !== "RUNNING").map(strip),
    usage: {
      jobsToday: capturedJobs.filter((job) => isCandidates(candidateId)(job) && job.provenance.sourceType === "AGGREGATOR" && today(job.provenance.ingestedAt)).length,
      jobsCap: CAPS.jobs,
      searchesToday: bdeId ? storedSearches.filter((search) => search.userId === bdeId && today(search.startedAt)).length : null,
      searchesCap: CAPS.searches,
      capturesToday: bdeId ? capturedJobs.filter((job) => job.provenance.sourceType === "MANUAL" && job.provenance.capturedByUserId === bdeId && today(job.provenance.ingestedAt)).length : null,
      capturesCap: CAPS.captures,
      resetsAt: resetsAt.toISOString(),
    },
  };
}

export const jobsMock = firmScoped("jobs", {
  list: (firmId: string, params?: { limit?: number; offset?: number; candidateId?: string }): Promise<Job[]> => {
    settle();
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const rows = inFirm(allJobs(), firmId).filter((job) => !params?.candidateId || job.candidateIds.includes(params.candidateId));
    return mockResult(rows.slice(offset, offset + limit));
  },

  byId: (firmId: string, id: string): Promise<Job> => mockResult(findInFirm(allJobs(), firmId, id, "Job")),

  /** A job captured by hand for one candidate (docs/02 §6.z): the same listing again is the one they have. */
  capture: (firmId: string, body: CaptureJob): Promise<Job> => {
    const input = CaptureJobSchema.parse(body);
    const candidate = candidateFor(firmId, input.candidateId);
    if (!canSearchJobs(currentPrincipal(), candidate)) throw new ApiError("Only this candidate's BDE adds jobs for them.", "FORBIDDEN", 403);
    const canonical = canonicalUrl(input.sourceUrl);
    const duplicate = inFirm(capturedJobs, firmId).find((job) => job.candidateIds.includes(candidate.id) && job.dedupe.canonicalUrl === canonical);
    if (duplicate) throw new DuplicateJobError(duplicate.id);
    if ((searchesFor(firmId, candidate.id).usage.capturesToday ?? 0) >= CAPS.captures) throw new ApiError(`You've captured ${CAPS.captures} jobs today.`, "RATE_LIMITED", 429);
    const now = new Date();
    const job = knownLittle({ id: newId("job", now), firmId, title: input.title, companyName: input.companyName, location: input.location, description: input.description, url: input.sourceUrl, candidateId: candidate.id, sourceType: "MANUAL", at: now });
    capturedJobs.unshift(job);
    changed("capturedJobs");
    return mockResult(job);
  },

  searches: (firmId: string, candidateId: string): Promise<JobSearches> => mockResult(searchesFor(firmId, candidateId)),

  /** "Find jobs": the candidate's BDE only; one at a time; 20 a day per BDE. */
  startSearch: (firmId: string, candidateId: string, query: string): Promise<void> => {
    const candidate = candidateFor(firmId, candidateId);
    if (!canSearchJobs(currentPrincipal(), candidate)) throw new ApiError("Only this candidate's BDE searches jobs for them.", "FORBIDDEN", 403);
    const current = searchesFor(firmId, candidateId);
    if (current.running) throw new ApiError("A search for this candidate is already running.", "CONFLICT", 409);
    if ((current.usage.searchesToday ?? 0) >= CAPS.searches) throw new ApiError(`You've run ${CAPS.searches} searches today.`, "RATE_LIMITED", 429);
    const now = new Date();
    storedSearches.unshift({ id: newId("search", now), firmId, candidateId, userId: currentUser().id, kind: "SEARCH", state: "RUNNING", query: query.trim(), newCount: 0, seenAgainCount: 0, overLimitCount: 0, errorCode: null, startedAt: now.toISOString(), finishedAt: null });
    changed("jobSearches");
    return mockResult(undefined);
  },
}, { capture: "job.capture", startSearch: "job.search" });
