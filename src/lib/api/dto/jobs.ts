import { z } from "zod";
import { WorkAuth } from "@/lib/schemas/enums";
import type { Job } from "@/lib/schemas/job";
import type { RemoteMode } from "@/lib/schemas/enums";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * The firm job feed (`GET /api/jobs`, `_job_to_dict`) mapped to the frontend `Job`. Only the fields the
 * backend has are read; everything the backend does not know is left empty, never invented.
 */
export const BackendJobSchema = z.object({
  id: z.string(),
  external_id: z.string().nullable().optional(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  source: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  remote: z.boolean().nullable().optional(),
  arr_remote: z.boolean().nullable().optional(),
  arr_hybrid: z.boolean().nullable().optional(),
  arr_onsite: z.boolean().nullable().optional(),
  salary_min: z.number().nullable().optional(),
  salary_max: z.number().nullable().optional(),
  discovered_at: z.string().nullable().optional(),
});
export type BackendJob = z.infer<typeof BackendJobSchema>;

export const BackendJobListSchema = z.object({ total: z.number().int(), jobs: z.array(BackendJobSchema) });

/** Sources a person added by hand; everything else came from a board or an aggregator. */
const USER_SOURCES = new Set(["manual", "extension", "user", "chrome_extension"]);

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function remoteMode(dto: BackendJob): RemoteMode {
  if (dto.arr_remote || (dto.remote && !dto.arr_hybrid && !dto.arr_onsite)) return "REMOTE";
  if (dto.arr_hybrid) return "HYBRID";
  return "ONSITE";
}

function place(location: string | null | undefined): { city: string | null; state: string | null } {
  const parts = (location ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function toJob(dto: BackendJob, firmId: string): Job {
  const companyName = dto.company?.trim() || "Unknown company";
  const title = dto.title?.trim() || "Untitled role";
  const url = safeUrl(dto.url);
  const discoveredAt = dto.discovered_at ? toIso(dto.discovered_at) : new Date(0).toISOString();
  const source = (dto.source ?? "").toLowerCase();
  return {
    id: fromBackendId(dto.id),
    firmId,
    companyId: `company:${slug(companyName)}`,
    company: {
      id: `company:${slug(companyName)}`,
      name: companyName,
      normalisedName: slug(companyName),
      domain: null,
      websiteUrl: null,
      linkedinUrl: null,
      employeeBand: null,
      hasUsPresence: null,
      clientType: "UNKNOWN",
      atsProvider: null,
      h1b: null,
      verification: null,
    },
    title,
    normalisedTitle: slug(title),
    description: dto.description ?? "",
    ...place(dto.location),
    country: "US",
    remoteMode: remoteMode(dto),
    employmentType: null,
    rateMin: null,
    rateMax: null,
    salaryMin: dto.salary_min ?? null,
    salaryMax: dto.salary_max ?? null,
    // The backend does not record which work authorisations a job accepts: no candidate is excluded for it.
    allowedWorkAuth: [...WorkAuth.options],
    excludesC2C: false,
    postedAt: toIsoOrNull(dto.discovered_at),
    applicantCount: null,
    applyUrl: url,
    requirements: [],
    dedupe: { urlHash: dto.external_id ?? dto.id, contentHash: "", canonicalUrl: url, duplicateOfJobId: null },
    provenance: {
      sourceType: USER_SOURCES.has(source) ? "USER_SUBMITTED" : "AGGREGATOR",
      sourceId: dto.source ?? "backend",
      sourceUrl: url,
      legalBasis: USER_SOURCES.has(source) ? "USER_SESSION" : "PUBLIC_DOCUMENTED",
      capturedByUserId: null,
      ingestedAt: discoveredAt,
    },
    // The feed has no closed state (its `status` is new | saved | applied | skip): every listed job is open.
    isActive: true,
  };
}
