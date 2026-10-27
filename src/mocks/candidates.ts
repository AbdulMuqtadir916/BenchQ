import { ApiError, arrayOf } from "@/lib/api/client";
import { canAssignTo } from "@/lib/auth/policy";
import { isBde, isManager } from "@/lib/auth/roles";
import { candidateBlockReason } from "@/lib/derive/platform";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { CandidateSchema, CreateCandidateSchema, UpdateCandidateSchema, type Candidate, type CreateCandidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import candidatesSeed from "./data/candidates.json";
import { findInFirm, inFirm, mockResult, newId } from "./_shared";
import { currentPrincipal } from "./auth";
import { changed, table } from "./db";
import { firmScoped } from "./membership";
import { allUsers, firms } from "./team-data";

/** Every firm's candidates, validated. */
export const allCandidates: Candidate[] = table("candidates", CandidateSchema, () => arrayOf(CandidateSchema).parse(candidatesSeed));

/**
 * Who a new candidate is assigned to (docs/02 §3.4, 07 Q41). A named BDE brings their own manager: the mock holds the
 * hierarchy until the backend sends `manager_id` (onboarding 06 PR 1), so the client's guess at the manager is replaced.
 * Then the policy decides (`canAssignTo`): the OWNER any manager and one of their BDEs, a MANAGER only their own BDEs.
 */
function assignmentFor(firmId: string, requested: { managerId: string; bdeId: string | null }): { managerId: string; bdeId: string | null } {
  const team = allUsers.filter((user) => user.firmId === firmId);
  const bde = requested.bdeId === null ? null : team.find((user) => user.id === requested.bdeId && user.isActive && isBde(user));
  if (requested.bdeId !== null && !bde) throw new ApiError("Choose an active BDE of this firm.", "INVALID", 400);
  if (bde && bde.managerId === null) throw new ApiError("That BDE has no manager yet. Ask the owner to set one.", "INVALID", 400);
  const target = { managerId: bde?.managerId ?? requested.managerId, bdeId: bde?.id ?? null };
  if (!team.some((user) => user.id === target.managerId && user.isActive && isManager(user))) throw new ApiError("Choose an active manager of this firm.", "INVALID", 400);
  if (!canAssignTo(currentPrincipal(), null, target, team)) throw new ApiError("You can't assign this candidate to that BDE.", "FORBIDDEN", 403);
  return target;
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
