import { ApiError, arrayOf } from "@/lib/api/client";
import { CompanySchema, type Company } from "@/lib/schemas/company";
import { CaptureJobSchema, JobSchema, type CaptureJob, type Job } from "@/lib/schemas/job";
import type { WorkAuth } from "@/lib/schemas/enums";
import companiesSeed from "./data/companies.json";
import jobsSeed from "./data/jobs.json";
import { findInFirm, inFirm, mockResult, newId } from "./_shared";
import { currentUser } from "./auth";
import { changed, table } from "./db";
import { logFirmAction } from "./ledger";
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

/** Sponsorship available: every work authorization the fixtures allow; otherwise citizens and green-card holders only. */
const SPONSORED: WorkAuth[] = ["H1B", "H4_EAD", "OPT", "CPT", "GC", "GC_EAD", "USC", "TN"];
const UNSPONSORED: WorkAuth[] = ["USC", "GC"];

/** Thrown when the job is already captured in this firm; `jobId` is the existing one, for "View job". */
export class DuplicateJobError extends ApiError {
  jobId: string;
  constructor(jobId: string) {
    super("This job is already captured.", "DUPLICATE_JOB", 409);
    this.jobId = jobId;
  }
}

export const jobsMock = firmScoped("jobs", {
  list: (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(inFirm(allJobs(), firmId).slice(offset, offset + limit));
  },

  byId: (firmId: string, id: string): Promise<Job> => mockResult(findInFirm(allJobs(), firmId, id, "Job")),

  /** A job captured by hand (docs/04 §5.2). The same listing twice in a firm is refused with the existing job. */
  capture: (firmId: string, body: CaptureJob): Promise<Job> => {
    const input = CaptureJobSchema.parse(body);
    const canonical = canonicalUrl(input.sourceUrl);
    const duplicate = inFirm(allJobs(), firmId).find((job) => job.dedupe.canonicalUrl !== null && canonicalUrl(job.dedupe.canonicalUrl) === canonical);
    if (duplicate) throw new DuplicateJobError(duplicate.id);

    const now = new Date();
    const id = newId("job", now);
    const company = companyFor(input.companyName);
    const [city, state] = input.location.split(",").map((part) => part.trim());
    const hourly = input.payPeriod === "HOUR";
    const requirements = [
      ...input.skills.map((skill) => ({ id: newId("req", now), kind: "MANDATORY" as const, category: "SKILL" as const, value: skill, canonicalValue: skill.toLowerCase(), isBlocker: false })),
      ...(input.experience ? [{ id: newId("req", now), kind: "MANDATORY" as const, category: "EXPERIENCE_YEARS" as const, value: input.experience, canonicalValue: null, isBlocker: false }] : []),
    ];
    const job = JobSchema.parse({
      id,
      firmId,
      companyId: company.id,
      company,
      title: input.title,
      normalisedTitle: normalise(input.title),
      description: input.description,
      city: city || null,
      state: state || null,
      country: "US",
      remoteMode: input.remoteMode,
      employmentType: input.employmentType,
      rateMin: hourly ? input.payMin : null,
      rateMax: hourly ? input.payMax : null,
      salaryMin: hourly ? null : input.payMin,
      salaryMax: hourly ? null : input.payMax,
      allowedWorkAuth: input.sponsorsVisa ? SPONSORED : UNSPONSORED,
      excludesC2C: input.excludesC2C,
      postedAt: null,
      applicantCount: null,
      applyUrl: input.sourceUrl,
      requirements,
      dedupe: { urlHash: `urlh_${hash(canonical)}`, contentHash: `ctnh_${hash(input.description)}`, canonicalUrl: canonical, duplicateOfJobId: null },
      provenance: { sourceType: "USER_SUBMITTED", sourceId: newId("src_user_submitted", now), sourceUrl: input.sourceUrl, legalBasis: "USER_SESSION", capturedByUserId: currentUser().id, ingestedAt: now.toISOString() },
      isActive: true,
    });
    capturedJobs.unshift(job);
    changed("capturedJobs");
    logFirmAction({ firmId, entityType: "job", entityId: job.id, entityLabel: `${job.title} · ${company.name}`, action: "CREATE", summary: `Captured ${job.title} at ${company.name}` }, now);
    return mockResult(job);
  },
}, { capture: "job.capture" });
