import { ApiError, arrayOf } from "@/lib/api/client";
import { canAssignTo } from "@/lib/auth/policy";
import { isBde, isManager } from "@/lib/auth/roles";
import { assignBlockReason } from "@/lib/derive/platform";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { CandidateSchema, CreateCandidateSchema, UpdateCandidateSchema, type Candidate, type CreateCandidate, type UpdateCandidate } from "@/lib/schemas/candidate";
import type { z } from "zod";
import type { BackendResumeParseResponseSchema } from "@/lib/api/dto/resume-parse";
import { resumeFileProblem } from "@/lib/constants/candidate-intake";
import candidatesSeed from "./data/candidates.json";
import resumeParses from "./data/resume-parses.json";
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

  /** A new candidate starts ON_BENCH. Given a BDE, it counts toward the plan, so at the limit it is refused (07 Q45, A4). */
  create: (firmId: string, body: CreateCandidate): Promise<Candidate> => {
    const input = CreateCandidateSchema.parse(body);
    const firm = firms.find((item) => item.id === firmId)!;
    const assignment = assignmentFor(firmId, input);
    // 07 Q45: only assigning a BDE counts toward the limit; a manager's queue is never blocked.
    const capacity = candidateCapacity(firm, allCandidates);
    if (assignment.bdeId !== null && !capacity.canAssignCandidate) throw new ApiError(assignBlockReason(capacity), "CANDIDATE_LIMIT", 409);

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

  /**
   * Stand-in for the backend's résumé parser (onboarding 06 §4): answers in Zuhair's format, saving nothing. A sample's
   * file name gets that sample; any other file gets the first one, under its own name (the mock can't read a file).
   */
  parseResume: (_firmId: string, file: { fileName: string; sizeBytes: number; mimeType: string }): Promise<z.input<typeof BackendResumeParseResponseSchema>> => {
    const problem = resumeFileProblem({ name: file.fileName, size: file.sizeBytes, type: file.mimeType });
    if (problem) throw new ApiError(problem, problem.startsWith("PDF") ? "UNSUPPORTED_FILE" : "FILE_TOO_LARGE", problem.startsWith("PDF") ? 415 : 413);
    const sample = resumeParses.find((item) => item.file_name === file.fileName) ?? resumeParses[0]!;
    return mockResult({ parse_id: newId("parse"), file_name: file.fileName, parse: sample.parse });
  },

  /**
   * A BDE moved to another manager (07 Q43): every candidate they work follows. The backend does this itself
   * (PATCH …/members/{id}/manager); the mock's candidates follow here until candidates go live (onboarding 07).
   */
  followBde: (firmId: string, bdeId: string, managerId: string): Promise<number> => {
    const moved = inFirm(allCandidates, firmId).filter((candidate) => candidate.bdeId === bdeId);
    for (const candidate of moved) Object.assign(candidate, { managerId, updatedAt: new Date().toISOString() });
    if (moved.length > 0) changed("candidates");
    return mockResult(moved.length);
  },
}, { create: "candidate.create", update: "candidate.edit", parseResume: "candidate.create", followBde: "member.changeManager" });

/** The sample résumés the mock parser knows, for step 1's "Try a sample" (README assumption A1: mocks only). */
export const SAMPLE_RESUME_NAMES: readonly string[] = resumeParses.map((item) => item.file_name);
