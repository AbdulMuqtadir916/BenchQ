import { z } from "zod";
import {
  CandidateSchema,
  type Candidate,
  type CreateCandidate,
  type ReassignCandidate,
  type UpdateCandidate,
} from "@/lib/schemas/candidate";
import { fromBackendId, toBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * backend/candidates/serialize.py `candidate_json` (docs/candidate-onboarding/06-backend.md §5): the frontend's
 * `CandidateSchema` in snake_case. Seeded ids are UUIDv5 of the fixture ids and come back as `cand_01` etc., so the
 * modules still on mocks (applications, résumés…) keep finding their candidates. The skills and the summary are the base résumé's,
 * not the candidate's (migration 0015).
 */
export const CandidateDto = z.object({
  id: z.string(),
  firm_id: z.string(),
  manager_id: z.string(),
  bde_id: z.string().nullable(),
  full_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  willing_to_relocate: z.boolean(),
  work_auth: z.string(),
  work_auth_expiry: z.string().nullable(),
  needs_sponsorship: z.boolean(),
  needs_transfer: z.boolean(),
  employment_types: z.array(z.string()),
  rate_min: z.number().nullable(),
  rate_target: z.number().nullable(),
  status: z.string(),
  bench_start_date: z.string().nullable(),
  available_from: z.string().nullable(),
  notice_period_days: z.number().int().nullable(),
  years_experience: z.number().nullable(),
  primary_role: z.string().nullable(),
  target_roles: z.array(z.string()),
  work_settings: z.array(z.string()),
  preferred_locations: z.array(z.string()),
  contact_notes: z.string().nullable(),
  preferred_industries: z.array(z.string()),
  deal_breakers: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CandidateDto = z.infer<typeof CandidateDto>;

// A malformed LinkedIn value on the active résumé should not make the candidate unreadable (07 Q57, BUG-014).
const linkRule = CandidateSchema.shape.linkedinUrl;
function readableLink(candidateId: string, link: string | null): string | null {
  if (link === null || linkRule.safeParse(link).success) return link;
  console.warn(`[api] candidate ${candidateId}: ignoring a malformed linkedin_url`);
  return null;
}

/** Backend candidate → `Candidate`. */
export function toCandidate(dto: CandidateDto): Candidate {
  const id = fromBackendId(dto.id);
  return CandidateSchema.parse({
    id,
    firmId: fromBackendId(dto.firm_id),
    managerId: fromBackendId(dto.manager_id),
    bdeId: dto.bde_id === null ? null : fromBackendId(dto.bde_id),
    fullName: dto.full_name,
    email: dto.email,
    phone: dto.phone,
    linkedinUrl: readableLink(id, dto.linkedin_url),
    city: dto.city,
    state: dto.state,
    country: dto.country,
    willingToRelocate: dto.willing_to_relocate,
    workAuth: dto.work_auth,
    workAuthExpiry: toIsoOrNull(dto.work_auth_expiry),
    needsSponsorship: dto.needs_sponsorship,
    needsTransfer: dto.needs_transfer,
    employmentTypes: dto.employment_types,
    rateMin: dto.rate_min,
    rateTarget: dto.rate_target,
    status: dto.status,
    benchStartDate: toIsoOrNull(dto.bench_start_date),
    availableFrom: toIsoOrNull(dto.available_from),
    noticePeriodDays: dto.notice_period_days,
    yearsExperience: dto.years_experience,
    primaryRole: dto.primary_role,
    targetRoles: dto.target_roles,
    workSettings: dto.work_settings,
    preferredLocations: dto.preferred_locations,
    contactNotes: dto.contact_notes,
    preferredIndustries: dto.preferred_industries,
    dealBreakers: dto.deal_breakers,
    // The backend has no answer bank on the candidate since migration 0019 (each résumé version holds its own
    // `autofill`). The Documents tab's Screening answers panel shows its empty state until that section is removed
    // (planned, docs/team/abdul.md §3).
    qaBank: [],
    createdAt: toIso(dto.created_at),
    updatedAt: toIso(dto.updated_at),
  });
}

/** `CreateCandidate` → the backend's CreateCandidateBody (routes_candidates.py). */
export function toBackendCreateCandidate(body: CreateCandidate) {
  return {
    full_name: body.fullName,
    primary_role: body.primaryRole,
    email: body.email,
    phone: body.phone,
    country: body.country,
    linkedin_url: body.linkedinUrl,
    city: body.city,
    state: body.state,
    years_experience: body.yearsExperience,
    work_auth: body.workAuth,
    work_auth_expiry: body.workAuthExpiry,
    needs_sponsorship: body.needsSponsorship,
    needs_transfer: body.needsTransfer,
    employment_types: body.employmentTypes,
    rate_target: body.rateTarget,
    rate_min: body.rateMin,
    available_from: body.availableFrom,
    notice_period_days: body.noticePeriodDays,
    target_roles: body.targetRoles,
    willing_to_relocate: body.willingToRelocate,
    work_settings: body.workSettings,
    preferred_locations: body.preferredLocations,
    contact_notes: body.contactNotes,
    summary: body.summary,
    skills: body.skills.map((skill) => ({ name: skill.name, family: skill.family })),
    preferred_industries: body.preferredIndustries,
    deal_breakers: body.dealBreakers,
    resume_parse_id: body.resumeParseId,
    manager_id: toBackendId(body.managerId),
    bde_id: body.bdeId === null ? null : toBackendId(body.bdeId),
    handoff_note: body.handoffNote,
  };
}

/** `UpdateCandidate` → UpdateCandidateBody: only the fields being changed (the backend reads unset as "leave it"). */
export function toBackendUpdateCandidate(patch: UpdateCandidate) {
  const names: Record<keyof UpdateCandidate, string> = {
    workAuth: "work_auth", needsSponsorship: "needs_sponsorship", needsTransfer: "needs_transfer",
    workAuthExpiry: "work_auth_expiry", rateTarget: "rate_target", rateMin: "rate_min",
    availableFrom: "available_from", noticePeriodDays: "notice_period_days", willingToRelocate: "willing_to_relocate",
    employmentTypes: "employment_types",
  };
  return Object.fromEntries((Object.keys(patch) as (keyof UpdateCandidate)[]).map((key) => [names[key], patch[key]]));
}

/** `ReassignCandidate` → AssignBody. */
export function toBackendAssign(body: ReassignCandidate) {
  return { manager_id: toBackendId(body.managerId), bde_id: body.bdeId === null ? null : toBackendId(body.bdeId), note: body.note };
}
