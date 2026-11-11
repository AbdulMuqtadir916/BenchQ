import { z } from "zod";
import { CompanySchema, type Company } from "@/lib/schemas/company";
import type { EmploymentType, JobSourceType, LegalBasis } from "@/lib/schemas/enums";
import { JobSchema, type CaptureJob, type Job } from "@/lib/schemas/job";
import { JobSearchErrorCode, type JobSearch, type JobSearches } from "@/lib/schemas/job-search";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * The job search backend (backend/api/routes_job_search.py, docs/02 §6.y–§6.z) → the frontend's `Job`. A posting
 * knows less than `Job` describes: what it doesn't know stays empty, never guessed (docs/02 §6.z's table).
 */
const posting = {
  id: z.string(),
  source: z.string(),
  job_id: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  title: z.string(),
  company: z.string(),
  apply_url: z.string().nullable(),
  location: z.string().nullable(),
  countries: z.array(z.string()),
  posted_at: z.string().nullable(),
  employment_type: z.string().nullable(),
  skills: z.array(z.string()),
  is_closed: z.boolean(),
  /** The source marks the employer a known H-1B sponsor (freehire.me's `us-h1b-sponsor`). False: not known. */
  h1b_sponsor: z.boolean().optional().default(false),
  description: z.string().optional(),
};

/** `GET /api/firms/{firm}/job-postings` items and `…/job-postings/{id}`: one job, with its visible candidates. */
export const FirmJobDto = z.object({ ...posting, candidate_ids: z.array(z.string()) });
export type FirmJobDto = z.infer<typeof FirmJobDto>;
export const FirmJobListDto = z.object({ items: z.array(FirmJobDto) });

/** `POST …/candidates/{id}/job-postings`: the candidate's posting, and whether this call created it. */
export const CapturedPostingDto = z.object({ ...posting, candidate_id: z.string(), created: z.boolean() });
export type CapturedPostingDto = z.infer<typeof CapturedPostingDto>;

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Only a real http(s) link (the `Job` fields are URLs). */
function urlOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** A source's date, when it is one; anything else is unknown. */
function dateOrNull(value: string | null): string | null {
  try {
    return toIsoOrNull(value);
  } catch {
    return null;
  }
}

const EMPLOYMENT: Record<string, EmploymentType> = {
  c2c: "C2C", "corp-to-corp": "C2C", w2: "W2", "1099": "TEEN99",
  "full-time": "FTE", "full time": "FTE", fulltime: "FTE", permanent: "FTE", fte: "FTE",
};

const SOURCE_TYPE: Record<string, { type: JobSourceType; basis: LegalBasis }> = {
  manual: { type: "MANUAL", basis: "USER_SESSION" },
  extension: { type: "USER_SUBMITTED", basis: "USER_SESSION" },
};
const PROVIDER = { type: "AGGREGATOR", basis: "LICENSED_API" } as const;

/** The source's H-1B mark (docs/02 §6.z): a known sponsor only; nothing known is `null`, never "doesn't sponsor". */
const KNOWN_SPONSOR = { sponsorsH1b: true, lcaCount: null, lcaYear: null, medianLcaWage: null, topLcaTitles: [], dataSource: "freehire.me", lastCheckedAt: null };

/** The name, and whether the source knows it sponsors H-1B: the rest of the company is unknown (`null`). */
function companyFrom(name: string, isKnownSponsor: boolean): Company {
  return CompanySchema.parse({
    id: `company:${normalise(name)}`, name, normalisedName: normalise(name), domain: null, websiteUrl: null,
    linkedinUrl: null, employeeBand: null, hasUsPresence: null, clientType: "UNKNOWN", atsProvider: null,
    h1b: isKnownSponsor ? KNOWN_SPONSOR : null, verification: null,
  });
}

/** One posting (or one job's newest posting) as a `Job` (docs/02 §6.z). */
export function toJob(dto: z.infer<z.ZodObject<typeof posting>>, firmId: string, candidateIds: string[]): Job {
  const company = companyFrom(dto.company, dto.h1b_sponsor);
  const applyUrl = urlOrNull(dto.apply_url);
  const source = SOURCE_TYPE[dto.source] ?? PROVIDER;
  const location = dto.location?.trim() || null;
  return JobSchema.parse({
    id: dto.id,
    firmId,
    companyId: company.id,
    company,
    title: dto.title,
    normalisedTitle: normalise(dto.title),
    description: dto.description ?? "",
    city: location,
    state: null,
    country: (dto.countries[0] ?? "US").toUpperCase(),
    // What the location says: remote, hybrid, else on-site (decided 2026-11-11; "hybrid" per the bot review on #135).
    remoteMode: location && /\bremote\b/i.test(location) ? "REMOTE" : location && /\bhybrid\b/i.test(location) ? "HYBRID" : "ONSITE",
    employmentType: (dto.employment_type && EMPLOYMENT[dto.employment_type.trim().toLowerCase()]) ?? null,
    rateMin: null,
    rateMax: null,
    salaryMin: null,
    salaryMax: null,
    allowedWorkAuth: [],
    excludesC2C: false,
    postedAt: dateOrNull(dto.posted_at),
    applicantCount: null,
    applyUrl,
    requirements: dto.skills.map((skill, index) => ({
      id: `${dto.id}:skill:${index}`, kind: "PREFERRED", category: "SKILL", value: skill, canonicalValue: skill.toLowerCase(), isBlocker: false,
    })),
    dedupe: { urlHash: "", contentHash: dto.job_id, canonicalUrl: applyUrl, duplicateOfJobId: null },
    provenance: { sourceType: source.type, sourceId: dto.source, sourceUrl: applyUrl, legalBasis: source.basis, capturedByUserId: null, ingestedAt: toIso(dto.discovered_at) },
    isActive: !dto.is_closed,
    candidateIds,
  });
}

export const toFirmJob = (dto: FirmJobDto, firmId: string): Job => toJob(dto, firmId, dto.candidate_ids.map(fromBackendId));
export const toCapturedJob = (dto: CapturedPostingDto, firmId: string): Job => toJob(dto, firmId, [fromBackendId(dto.candidate_id)]);

/** What the capture form sends, as `CaptureBody` (backend/api/routes_job_search.py). */
export function toBackendCapture(body: CaptureJob) {
  return { source: "manual", title: body.title, company: body.companyName, description: body.description, url: body.sourceUrl, location: body.location || null };
}

// ── "Find jobs": a candidate's searches (`GET …/job-searches`) ──

const SearchDto = z.object({
  batch_id: z.string(),
  kind: z.enum(["search", "capture"]),
  state: z.enum(["running", "success", "empty", "error"]),
  error_code: JobSearchErrorCode.nullable(),
  query: z.string().nullable(),
  counts: z.object({ saved: z.number().int(), refreshed: z.number().int(), skipped_over_cap: z.number().int() }).partial().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export const JobSearchesDto = z.object({
  running: SearchDto.nullable(),
  searches: z.array(SearchDto),
  usage: z.object({
    jobs_saved_today: z.number().int(),
    jobs_cap: z.number().int(),
    attempts_today: z.number().int().nullable(),
    attempts_cap: z.number().int(),
    captures_today: z.number().int().nullable(),
    captures_cap: z.number().int(),
    resets_at: z.string(),
  }),
});
export type JobSearchesDto = z.infer<typeof JobSearchesDto>;

function toSearch(dto: z.infer<typeof SearchDto>): JobSearch {
  return {
    id: dto.batch_id,
    kind: dto.kind === "search" ? "SEARCH" : "CAPTURE",
    state: dto.state === "running" ? "RUNNING" : dto.state === "success" ? "SUCCESS" : dto.state === "empty" ? "EMPTY" : "ERROR",
    query: dto.query,
    newCount: dto.counts?.saved ?? 0,
    seenAgainCount: dto.counts?.refreshed ?? 0,
    overLimitCount: dto.counts?.skipped_over_cap ?? 0,
    errorCode: dto.error_code,
    startedAt: toIso(dto.started_at),
    finishedAt: toIsoOrNull(dto.finished_at),
  };
}

export function toJobSearches(dto: JobSearchesDto): JobSearches {
  const u = dto.usage;
  return {
    running: dto.running ? toSearch(dto.running) : null,
    searches: dto.searches.map(toSearch),
    usage: {
      jobsToday: u.jobs_saved_today, jobsCap: u.jobs_cap, searchesToday: u.attempts_today, searchesCap: u.attempts_cap,
      capturesToday: u.captures_today, capturesCap: u.captures_cap, resetsAt: toIso(u.resets_at),
    },
  };
}
