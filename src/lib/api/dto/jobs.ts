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
  /** The job's work mode as the backend reads it (the source's labels, else the location's words). */
  remote_mode: z.enum(["REMOTE", "HYBRID", "ONSITE"]).optional(),
  description: z.string().optional(),
};

/** A candidate's Match for a job (decided 2026-11-14). */
const MatchDto = z.object({ score: z.number().int().nullable(), note: z.string().nullable() });

/** `GET /api/firms/{firm}/job-postings` items and `…/job-postings/{id}`: one job, with its visible candidates. */
export const FirmJobDto = z.object({ ...posting, candidate_ids: z.array(z.string()),
  matches: z.record(z.string(), MatchDto).optional().default({}) });
export type FirmJobDto = z.infer<typeof FirmJobDto>;
/** A page of the list (decided 2026-11-14, Q29, Q47): sorted and filtered by the backend, with the whole list's total. */
export const FirmJobListDto = z.object({ items: z.array(FirmJobDto), total: z.number().int().optional(),
  next_offset: z.number().int().nullable().optional(), source_counts: z.record(z.string(), z.number().int()).optional() });

/** `POST …/candidates/{id}/job-postings`: the candidate's posting, and whether this call created it. */
export const CapturedPostingDto = z.object({ ...posting, candidate_id: z.string(), created: z.boolean(),
  match: MatchDto.optional() });
/** GET …/candidates/{id}/job-postings/{posting_id}: one of the candidate's own jobs. */
export const CandidatePostingDto = z.object({ ...posting, candidate_id: z.string(), match: MatchDto.optional() });
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
export function toJob(dto: z.infer<z.ZodObject<typeof posting>>, firmId: string, candidateIds: string[],
  matches: Record<string, { score: number | null; note: string | null }> = {}): Job {
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
    remoteMode: dto.remote_mode ?? (location && /\bremote\b/i.test(location) ? "REMOTE" : location && /\bhybrid\b/i.test(location) ? "HYBRID" : "ONSITE"),
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
    matches,
  });
}

const ownMatch = (dto: { candidate_id: string; match?: { score: number | null; note: string | null } }) =>
  dto.match ? { [fromBackendId(dto.candidate_id)]: dto.match } : {};

export const toFirmJob = (dto: FirmJobDto, firmId: string): Job => toJob(dto, firmId, dto.candidate_ids.map(fromBackendId),
  Object.fromEntries(Object.entries(dto.matches).map(([id, match]) => [fromBackendId(id), match])));
export const toCapturedJob = (dto: CapturedPostingDto, firmId: string): Job => toJob(dto, firmId, [fromBackendId(dto.candidate_id)], ownMatch(dto));
export const toCandidateJob = (dto: z.infer<typeof CandidatePostingDto>, firmId: string): Job => toJob(dto, firmId, [fromBackendId(dto.candidate_id)], ownMatch(dto));

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
  // Not on a search from before places (2026-11-14) nor on a capture.
  place: z.string().nullable().optional(),
  counts: z.object({
    saved: z.number().int(), refreshed: z.number().int(), skipped_over_cap: z.number().int(),
    skipped_work_auth: z.number().int(), skipped_too_old: z.number().int(), skipped_not_remote: z.number().int(),
    skipped_adzuna: z.number().int(), skipped_level: z.number().int(),
    // Each source's counts, for a click that asked several (decided 2026-11-17, Q90): {linkedin: {saved, …}, …}.
    by_source: z.record(z.string(), z.object({ saved: z.number().int() }).partial()),
  }).partial().nullable(),
  // A source that failed in a click that asked several, by "provider|place" (Q93).
  errors: z.record(z.string(), z.string()).nullable().optional(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  work_date: z.string().nullable().optional(),
  day: z.number().int().nullable().optional(),
  batch: z.number().int().nullable().optional(),
});

const WorkdayDto = z.object({
  start: z.string(), end: z.string(), timezone: z.string(), label: z.string(),
  assigned_at: z.string().nullable(), day_one: z.string().nullable(), today: z.string(),
  today_day: z.number().int().nullable(), days_worked: z.array(z.number().int()),
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
  role: z.string().nullable().optional(),
  places: z.array(z.object({ value: z.string(), label: z.string(), kind: z.enum(["home", "preferred", "remote"]) })).optional(),
  workday: WorkdayDto,
});
export type JobSearchesDto = z.infer<typeof JobSearchesDto>;

function toSearch(dto: z.infer<typeof SearchDto>): JobSearch {
  return {
    id: dto.batch_id,
    kind: dto.kind === "search" ? "SEARCH" : "CAPTURE",
    state: dto.state === "running" ? "RUNNING" : dto.state === "success" ? "SUCCESS" : dto.state === "empty" ? "EMPTY" : "ERROR",
    query: dto.query,
    place: dto.place ?? null,
    newCount: dto.counts?.saved ?? 0,
    seenAgainCount: dto.counts?.refreshed ?? 0,
    overLimitCount: dto.counts?.skipped_over_cap ?? 0,
    leftOutWorkAuthCount: dto.counts?.skipped_work_auth ?? 0,
    leftOutOldCount: dto.counts?.skipped_too_old ?? 0,
    leftOutNotRemoteCount: dto.counts?.skipped_not_remote ?? 0,
    leftOutAdzunaCount: dto.counts?.skipped_adzuna ?? 0,
    leftOutLevelCount: dto.counts?.skipped_level ?? 0,
    newBySource: Object.fromEntries(Object.entries(dto.counts?.by_source ?? {}).map(([name, counts]) => [name, counts.saved ?? 0])),
    failedSources: [...new Set(Object.keys(dto.errors ?? {}).map((leg) => leg.split("|")[0]))],
    errorCode: dto.error_code,
    startedAt: toIso(dto.started_at),
    finishedAt: toIsoOrNull(dto.finished_at),
    workDate: dto.work_date ?? null,
    day: dto.day ?? null,
    batch: dto.batch ?? null,
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
    role: dto.role ?? null,
    places: dto.places ?? [],
    workday: {
      start: dto.workday.start, end: dto.workday.end, timezone: dto.workday.timezone, dayOne: dto.workday.day_one,
      today: dto.workday.today, todayDay: dto.workday.today_day, daysWorked: dto.workday.days_worked,
    },
  };
}
