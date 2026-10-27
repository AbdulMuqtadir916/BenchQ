import { ApiError, arrayOf } from "@/lib/api/client";
import { can } from "@/lib/auth/policy";
import { isBde, isManager } from "@/lib/auth/roles";
import { candidateBlockReason } from "@/lib/derive/platform";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { CandidateSchema, CreateCandidateSchema, UpdateCandidateSchema, type Candidate, type CreateCandidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import candidatesSeed from "./data/candidates.json";
import { findInFirm, inFirm, mockResult, newId } from "./_shared";
import { currentPrincipal, currentUser } from "./auth";
import { changed, table } from "./db";
import { firmScoped } from "./membership";
import { allUsers, firms } from "./team-data";

/** Every firm's candidates, validated. */
export const allCandidates: Candidate[] = table("candidates", CandidateSchema, () => arrayOf(CandidateSchema).parse(candidatesSeed));

/**
 * Who a new candidate is assigned to (docs/02 §3.4). With `candidate.assign` (OWNER, MANAGER, Q15) the request names
 * an active MANAGER of the firm and, optionally, an active BDE of the firm; anyone else (a BDE) gets their own new
 * candidate, under their own manager, so it is in their scope. A named BDE brings their own manager: the mock holds the
 * hierarchy until the backend sends `manager_id` (onboarding 06 PR 1), so the client's guess at the manager is replaced.
 * Who may be given which candidate (07 Q41, `canAssignTo`, with the strict manager check) arrives with module 03.
 */
function assignmentFor(firmId: string, requested: { managerId: string; bdeId: string | null }): { managerId: string; bdeId: string | null } {
  const actor = currentUser();
  const member = (id: string, isRole: (user: User) => boolean) => allUsers.find((user) => user.id === id && user.firmId === firmId && user.isActive && isRole(user));
  if (!can(currentPrincipal(), "candidate.assign")) {
    if (requested.bdeId !== null && requested.bdeId !== actor.id) throw new ApiError("Your role can't assign candidates.", "FORBIDDEN", 403);
    if (actor.managerId === null) throw new ApiError("Your manager isn't set yet. Ask the owner to set it.", "INVALID", 400);
    return { managerId: actor.managerId, bdeId: actor.id };
  }
  if (requested.bdeId === null) {
    if (!member(requested.managerId, isManager)) throw new ApiError("Choose an active manager of this firm.", "INVALID", 400);
    return { managerId: requested.managerId, bdeId: null };
  }
  const bde = member(requested.bdeId, isBde);
  if (!bde) throw new ApiError("Choose an active BDE of this firm.", "INVALID", 400);
  if (bde.managerId === null) throw new ApiError("That BDE has no manager yet. Ask the owner to set one.", "INVALID", 400);
  return { managerId: bde.managerId, bdeId: bde.id };
}

export const candidatesMock = firmScoped("candidates", {
  list: (firmId: string): Promise<Candidate[]> => mockResult(inFirm(allCandidates, firmId)),

  byId: (firmId: string, id: string): Promise<Candidate> => mockResult(findInFirm(allCandidates, firmId, id, "Candidate")),

  /** A new candidate starts ON_BENCH, so it counts against the plan: at the limit it is refused (A4). */
  create: (firmId: string, body: CreateCandidate): Promise<Candidate> => {
    const input = CreateCandidateSchema.parse(body);
    const firm = firms.find((item) => item.id === firmId)!;
    const capacity = candidateCapacity(firm, allCandidates);
    if (!capacity.canAddCandidate) throw new ApiError(candidateBlockReason(capacity), "CANDIDATE_LIMIT", 409);
    const assignment = assignmentFor(firmId, input);

    const now = new Date();
    const candidate = CandidateSchema.parse({
      id: newId("cand", now),
      firmId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      linkedinUrl: input.linkedinUrl,
      city: input.city,
      state: input.state,
      country: "US",
      willingToRelocate: input.willingToRelocate,
      workAuth: input.workAuth,
      workAuthExpiry: input.workAuthExpiry,
      needsSponsorship: input.needsSponsorship,
      needsTransfer: input.needsTransfer,
      employmentTypes: input.employmentTypes,
      rateMin: input.rateMin,
      rateTarget: input.rateTarget,
      status: "ON_BENCH",
      benchStartDate: now.toISOString(),
      availableFrom: input.availableFrom,
      noticePeriodDays: input.noticePeriodDays,
      yearsExperience: input.yearsExperience,
      primaryRole: input.primaryRole,
      targetRoles: input.targetRoles.length > 0 ? input.targetRoles : [input.primaryRole],
      managerId: assignment.managerId,
      bdeId: assignment.bdeId,
      workSettings: input.workSettings,
      preferredLocations: input.preferredLocations,
      contactNotes: input.contactNotes,
      persona: null,
      qaBank: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    allCandidates.unshift(candidate);
    changed("candidates");
    return mockResult(candidate);
  },

  update: (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => {
    const candidate = findInFirm(allCandidates, firmId, id, "Candidate");
    Object.assign(candidate, UpdateCandidateSchema.parse(body), { updatedAt: new Date().toISOString() });
    changed("candidates");
    return mockResult(CandidateSchema.parse(candidate));
  },
}, { create: "candidate.create", update: "candidate.edit" });
