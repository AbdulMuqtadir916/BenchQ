import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import type { Invite, InviteStatus } from "@/lib/schemas/tenancy";

/**
 * Seat and candidate usage for a firm (docs/02 §3.1, A1–A4). Every number here is derived from the
 * records, never stored. `now` is a parameter so results are stable in tests and fixtures.
 */

/** A2: only these statuses count against `candidateLimit`. */
export const ACTIVE_CANDIDATE_STATUSES: readonly Candidate["status"][] = ["ON_BENCH", "INTERVIEWING", "OFFER"];

export function isActiveCandidate(candidate: Pick<Candidate, "status">): boolean {
  return ACTIVE_CANDIDATE_STATUSES.includes(candidate.status);
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
  /** Active users of every role + pending, unexpired invites (A1). */
  seatsUsed: number;
  seatLimit: number;
  /** Candidates in ON_BENCH, INTERVIEWING or OFFER (A2). */
  activeCandidates: number;
  candidateLimit: number;
  /** usage < limit: the firm may add one more. These drive the block on new additions (A4). */
  canAddSeat: boolean;
  canAddCandidate: boolean;
  /** usage > limit: shown as the "over limit" flag (e.g. after a downgrade). At the limit is not over. */
  isOverSeatLimit: boolean;
  isOverCandidateLimit: boolean;
  isOverLimit: boolean;
}

export function deriveFirmUsage(
  /** A Firm (its effective limits, copied from the plan). */
  firm: { id: string; seatLimit: number; candidateLimit: number },
  data: { users: readonly User[]; invites: readonly Invite[]; candidates: readonly Candidate[] },
  now: Date,
): FirmUsage {
  const activeUsers = data.users.filter((user) => user.firmId === firm.id && user.isActive).length;
  const reserved = data.invites.filter((invite) => invite.firmId === firm.id && isSeatReservingInvite(invite, now)).length;
  const seatsUsed = activeUsers + reserved;
  const activeCandidates = data.candidates.filter((candidate) => candidate.firmId === firm.id && isActiveCandidate(candidate)).length;
  const isOverSeatLimit = seatsUsed > firm.seatLimit;
  const isOverCandidateLimit = activeCandidates > firm.candidateLimit;
  return {
    seatsUsed,
    seatLimit: firm.seatLimit,
    activeCandidates,
    candidateLimit: firm.candidateLimit,
    canAddSeat: seatsUsed < firm.seatLimit,
    canAddCandidate: activeCandidates < firm.candidateLimit,
    isOverSeatLimit,
    isOverCandidateLimit,
    isOverLimit: isOverSeatLimit || isOverCandidateLimit,
  };
}
