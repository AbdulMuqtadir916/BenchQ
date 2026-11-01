import { z } from "zod";
import { CompanySchema, type Company } from "@/lib/schemas/company";
import { JobSchema, type Job } from "@/lib/schemas/job";
import type { LegalBasis, JobSourceType } from "@/lib/schemas/enums";
import { toIso, toIsoOrNull } from "./shared";

/** The fields consumed from backend/api/routes_jobs.py::_job_to_dict. */
export const BackendJobSchema = z.object({
  id: z.string(),
  external_id: z.string().nullable(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  source: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  remote: z.boolean().nullable(),
  arr_remote: z.boolean().nullable(),
  arr_hybrid: z.boolean().nullable(),
  arr_onsite: z.boolean().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  h1b_company_lca_count: z.number().int().nullable(),
  h1b_company_approval_rate: z.number().nullable(),
  h1b_jd_flag: z.boolean(),
  h1b_verdict: z.string().nullable(),
  status: z.string(),
  discovered_at: z.string().nullable(),
});
export type BackendJob = z.infer<typeof BackendJobSchema>;

export const BackendCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  scrape_urls: z.array(z.string()).default([]),
  detected_scrape_types: z.record(z.string(), z.string()).default({}),
  h1b_lca_count: z.number().int().nullable().optional(),
  h1b_approval_rate: z.number().nullable().optional(),
  h1b_median_salary: z.number().nullable().optional(),
  h1b_last_checked: z.string().nullable().optional(),
});
export type BackendCompany = z.infer<typeof BackendCompanySchema>;

export const BackendJobListSchema = z.object({
  total: z.number().int(),
  jobs: z.array(BackendJobSchema),
  candidate_id: z.string().optional(),
  favorite_job_ids: z.array(z.string()).optional(),
});
export type BackendJobList = z.infer<typeof BackendJobListSchema>;

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string): string {
  return normalise(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function domainFrom(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function validUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function h1bData(company: BackendCompany, job?: BackendJob): Company["h1b"] {
  const count = company.h1b_lca_count ?? job?.h1b_company_lca_count ?? null;
  if (count === null) return null;
  return {
    sponsorsH1b: count > 0,
    lcaCount: count,
    lcaYear: null,
    medianLcaWage: company.h1b_median_salary ?? null,
    topLcaTitles: [],
    dataSource: "JobNavigator",
    lastCheckedAt: toIsoOrNull(company.h1b_last_checked),
  };
}

function toCompany(dto: BackendCompany, job?: BackendJob): Company {
  return CompanySchema.parse({
    id: dto.id,
    name: dto.name,
    normalisedName: normalise(dto.name),
    domain: domainFrom(dto.scrape_urls[0]),
    websiteUrl: null,
    linkedinUrl: null,
    employeeBand: null,
    hasUsPresence: null,
    clientType: "UNKNOWN",
    atsProvider: Object.values(dto.detected_scrape_types)[0] ?? null,
    h1b: h1bData(dto, job),
    verification: null,
  });
}

export function companyLookup(companies: BackendCompany[]): Map<string, Company> {
  const lookup = new Map<string, Company>();
  for (const dto of companies) {
    const company = toCompany(dto);
    for (const name of [dto.name, ...dto.aliases]) lookup.set(normalise(name), company);
  }
  return lookup;
}

function sourceType(source: string | null): JobSourceType {
  const value = (source ?? "").toLowerCase();
  if (value === "manual") return "MANUAL";
  if (value === "linkedin_extension" || value === "extension") return "USER_SUBMITTED";
  if (value === "playwright_url" || value.includes("career_page")) return "CONNECTOR";
  return "AGGREGATOR";
}

function locationFields(location: string | null): { city: string | null; state: string | null; country: string } {
  if (!location) return { city: null, state: null, country: "US" };
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const lower = location.toLowerCase();
  const country = lower.includes("india") || lower.includes("telangana") || lower.includes("hyderabad") ? "IN" : "US";
  if (/^remote\b/i.test(location)) return { city: null, state: null, country };
  if (parts.length < 2) return { city: parts[0] ?? null, state: null, country };
  if (parts.length >= 3 && /^(usa|us|united states|india)$/i.test(parts[2])) {
    return { city: parts[0], state: parts[1], country: /^india$/i.test(parts[2]) ? "IN" : "US" };
  }
  return { city: parts[0], state: parts[1], country };
}

export function toJob(dto: BackendJob, firmId: string, companies: Map<string, Company>): Job {
  const companyName = dto.company?.trim() || "Unknown company";
  const company = companies.get(normalise(companyName)) ?? CompanySchema.parse({
    id: `company:${slug(companyName)}`,
    name: companyName,
    normalisedName: normalise(companyName),
    domain: null,
    websiteUrl: null,
    linkedinUrl: null,
    employeeBand: null,
    hasUsPresence: null,
    clientType: "UNKNOWN",
    atsProvider: null,
    h1b: h1bData({
      id: "", name: companyName, aliases: [], scrape_urls: [], detected_scrape_types: {},
      h1b_lca_count: null, h1b_median_salary: null, h1b_last_checked: null,
    }, dto),
    verification: null,
  });
  const title = dto.title?.trim() || "Untitled role";
  const source = sourceType(dto.source);
  const location = locationFields(dto.location);
  const sourceUrl = validUrl(dto.url);
  const ingestedAt = toIsoOrNull(dto.discovered_at) ?? new Date().toISOString();
  const remoteMode = dto.arr_remote && !dto.arr_onsite
    ? "REMOTE"
    : dto.arr_hybrid
      ? "HYBRID"
      : dto.remote || /^remote\b/i.test(dto.location ?? "")
        ? "REMOTE"
        : "ONSITE";

  return JobSchema.parse({
    id: dto.id,
    firmId,
    companyId: company.id,
    company,
    title,
    normalisedTitle: normalise(title),
    description: dto.description ?? "",
    ...location,
    remoteMode,
    employmentType: null,
    rateMin: null,
    rateMax: null,
    salaryMin: dto.salary_min,
    salaryMax: dto.salary_max,
    allowedWorkAuth: [],
    excludesC2C: false,
    postedAt: toIsoOrNull(dto.discovered_at),
    applicantCount: null,
    applyUrl: sourceUrl,
    requirements: [],
    dedupe: {
      urlHash: dto.external_id ?? dto.id,
      contentHash: dto.id,
      canonicalUrl: sourceUrl,
      duplicateOfJobId: null,
    },
    provenance: {
      sourceType: source,
      sourceId: dto.external_id ?? dto.id,
      sourceUrl,
      legalBasis: (source === "MANUAL" || source === "USER_SUBMITTED" ? "USER_SESSION" : "PUBLIC_DOCUMENTED") as LegalBasis,
      capturedByUserId: null,
      ingestedAt: toIso(ingestedAt),
    },
    isActive: dto.status !== "skip",
  });
}
