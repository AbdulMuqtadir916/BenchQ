import { ApiError, arrayOf } from "@/lib/api/client";
import { can } from "@/lib/auth/policy";
import { isBde } from "@/lib/auth/roles";
import { candidateBlockReason } from "@/lib/derive/platform";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { CandidateSchema, CreateCandidateSchema, UpdateCandidateSchema, type Candidate, type CreateCandidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import candidatesSeed from "./data/candidates.json";
import { findInFirm, inFirm, mockResult, newId } from "./_shared";
import { currentPrincipal, currentUser } from "./auth";
import { changed, table } from "./db";
import { logFirmAction } from "./ledger";
import { firmScoped } from "./membership";
import { allUsers, firms } from "./team-data";

/** Every firm's candidates, validated. */
export const allCandidates: Candidate[] = table("candidates", CandidateSchema, () => arrayOf(CandidateSchema).parse(candidatesSeed));

/**
 * Who a new candidate is assigned to. With `candidate.assign` (OWNER, MANAGER, Q15) the form may name an
 * active BDE of the firm, or nobody; anyone else (a BDE) gets their own new candidate, so it is in their
 * scope, and may not name someone else.
 */
function assigneeFor(firmId: string, requested: string | null): string | null {
  const actor = currentUser();
  if (!can(currentPrincipal(), "candidate.assign")) {
    if (requested !== null && requested !== actor.id) throw new ApiError("Your role can't assign candidates.", "FORBIDDEN", 403);
    return actor.id;
  }
  if (requested === null) return null;
  const assignee = allUsers.find((user) => user.id === requested && user.firmId === firmId && user.isActive && isBde(user));
  if (!assignee) throw new ApiError("Choose an active BDE of this firm.", "INVALID", 400);
  return assignee.id;
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
    const assigneeId = assigneeFor(firmId, input.assignedUserId);

    const now = new Date();
    const candidate = CandidateSchema.parse({
      id: newId("cand", now),
      firmId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      linkedinUrl: null,
      city: null,
      state: null,
      country: "US",
      willingToRelocate: false,
      workAuth: input.workAuth,
      workAuthExpiry: null,
      needsSponsorship: input.needsSponsorship,
      needsTransfer: input.needsTransfer,
      employmentTypes: [],
      rateMin: null,
      rateTarget: null,
      status: "ON_BENCH",
      benchStartDate: now.toISOString(),
      availableFrom: null,
      noticePeriodDays: null,
      yearsExperience: null,
      primaryRole: input.primaryRole,
      targetRoles: [input.primaryRole],
      assignedUserIds: assigneeId ? [assigneeId] : [],
      primaryUserId: assigneeId,
      persona: null,
      qaBank: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    allCandidates.unshift(candidate);
    changed("candidates");
    const assignee = assigneeId ? allUsers.find((user) => user.id === assigneeId) : null;
    logFirmAction({
      firmId,
      entityType: "candidate",
      entityId: candidate.id,
      entityLabel: candidate.fullName,
      action: "CREATE",
      summary: `Added candidate ${candidate.fullName}${assignee ? `, assigned to ${assignee.name}` : ", unassigned"}`,
    }, now);
    return mockResult(candidate);
  },

  update: (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => {
    const candidate = findInFirm(allCandidates, firmId, id, "Candidate");
    Object.assign(candidate, UpdateCandidateSchema.parse(body), { updatedAt: new Date().toISOString() });
    changed("candidates");
    return mockResult(CandidateSchema.parse(candidate));
  },
}, { create: "candidate.create", update: "candidate.edit" });
