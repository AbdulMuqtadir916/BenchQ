import { isBde } from "@/lib/auth/roles";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import type { Invite, InviteStatus } from "@/lib/schemas/tenancy";

/**
 * Seat and candidate usage for a firm (docs/02 §3.1, A1–A4). Every number here is derived from the
 * records, never stored. `now` is a parameter so results are stable in tests and fixtures.
 */

/**
 * 07 Q45: the working statuses: what counts toward the candidate limit and a BDE's load. Change it here only, with a
 * decision entry (the backend's WORKING_STATUSES in backend/models/candidates.py says the same).
 */
export const WORKING_STATUSES: readonly Candidate["status"][] = ["ON_BENCH", "INTERVIEWING", "OFFER"];

export function isWorkingCandidate(candidate: Pick<Candidate, "status">): boolean {
  return WORKING_STATUSES.includes(candidate.status);
}

/** 07 Q45: a candidate counts toward the limit once a BDE is assigned and its status is working. */
export function countsTowardLimit(candidate: Pick<Candidate, "status" | "bdeId">): boolean {
  return candidate.bdeId !== null && isWorkingCandidate(candidate);
}

/** A9: a PENDING invite past its `expiresAt` is treated as EXPIRED. */
export function effectiveInviteStatus(invite: Pick<Invite, "status" | "expiresAt">, now: Date): InviteStatus {
  if (invite.status === "PENDING" && new Date(invite.expiresAt).getTime() <= now.getTime()) return "EXPIRED";
  return invite.status;
}

/** A1 + approved implication 1: only PENDING, unexpired invites reserve a seat. */
export function isSeatReservingInvite(invite: Pick<Invite, "status" | "expiresAt">, now: Date): boolean {
  return effectiveInviteStatus(invite, now) === "PENDING";
}

export interface FirmUsage {
  /** Active BDEs + pending, unexpired BDE invites (A1, 07 Q44). OWNER, MANAGER and VIEWER take no seat. */
  seatsUsed: number;
  seatLimit: number;
  /** Candidates with a BDE and a working status (07 Q45): what `candidateLimit` counts. */
  assignedCandidates: number;
  candidateLimit: number;
  /** usage < limit: the firm may add one more. These drive the block (A4): a seat on a BDE invite, a candidate on assigning a BDE. */
  canAddSeat: boolean;
  canAssignCandidate: boolean;
  /** usage > limit: shown as the "over limit" flag (e.g. after a downgrade). At the limit is not over. */
  isOverSeatLimit: boolean;
  isOverCandidateLimit: boolean;
  isOverLimit: boolean;
}

export function deriveFirmUsage(
  /** A Firm (its effective limits, copied from the plan). */
  firm: { id: string; seatLimit: number; candidateLimit: number },
  data: { users: readonly Pick<User, "firmId" | "isActive" | "role">[]; invites: readonly Invite[]; candidates: readonly Pick<Candidate, "firmId" | "status" | "bdeId">[] },
  now: Date,
): FirmUsage {
  const activeUsers = data.users.filter((user) => user.firmId === firm.id && user.isActive && isBde(user)).length;
  const reserved = data.invites.filter((invite) => invite.firmId === firm.id && isBde(invite) && isSeatReservingInvite(invite, now)).length;
  const seatsUsed = activeUsers + reserved;
  const { assignedCandidates } = candidateCapacity(firm, data.candidates);
  const isOverSeatLimit = seatsUsed > firm.seatLimit;
  const isOverCandidateLimit = assignedCandidates > firm.candidateLimit;
  return {
    seatsUsed,
    seatLimit: firm.seatLimit,
    assignedCandidates,
    candidateLimit: firm.candidateLimit,
    canAddSeat: seatsUsed < firm.seatLimit,
    canAssignCandidate: assignedCandidates < firm.candidateLimit,
    isOverSeatLimit,
    isOverCandidateLimit,
    isOverLimit: isOverSeatLimit || isOverCandidateLimit,
  };
}

/**
 * Room to assign a BDE to one more candidate (07 Q45, A4), from the firm's candidates alone — what firm pages can read.
 * The same numbers as `deriveFirmUsage`'s candidate half.
 */
export function candidateCapacity(
  firm: { id: string; candidateLimit: number },
  candidates: readonly Pick<Candidate, "firmId" | "status" | "bdeId">[],
): Pick<FirmUsage, "assignedCandidates" | "candidateLimit" | "canAssignCandidate"> {
  const assignedCandidates = candidates.filter((candidate) => candidate.firmId === firm.id && countsTowardLimit(candidate)).length;
  return { assignedCandidates, candidateLimit: firm.candidateLimit, canAssignCandidate: assignedCandidates < firm.candidateLimit };
}

/** A BDE's load against the firm's capacity (07 Q46): their candidates in a working status. At capacity is a warning, never a block. */
export function deriveBdeLoad(bdeId: string, candidates: readonly Pick<Candidate, "status" | "bdeId">[], bdeCapacity: number): { load: number; capacity: number; isAtCapacity: boolean } {
  const load = candidates.filter((candidate) => candidate.bdeId === bdeId && isWorkingCandidate(candidate)).length;
  return { load, capacity: bdeCapacity, isAtCapacity: load >= bdeCapacity };
}
