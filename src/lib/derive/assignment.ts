import type { Candidate } from "@/lib/schemas/candidate";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { isWorkingCandidate } from "./tenancy";

/** How long an assignment stays "new" on the BDE's dashboard (A5). */
export const NEW_ASSIGNMENT_DAYS = 7;

/**
 * Waiting in a manager's "Needs a BDE" queue (07 Q42): no BDE yet, and still being marketed. A placed or inactive
 * candidate without a BDE is not waiting for anyone.
 */
export function isWaitingForBde(candidate: Pick<Candidate, "bdeId" | "status">): boolean {
  return candidate.bdeId === null && isWorkingCandidate(candidate);
}

/** The queue's size per manager, for the OWNER's view (docs/candidate-onboarding/05 §5). */
export function queueByManager(candidates: readonly Pick<Candidate, "managerId" | "bdeId" | "status">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (isWaitingForBde(candidate)) counts.set(candidate.managerId, (counts.get(candidate.managerId) ?? 0) + 1);
  }
  return counts;
}

/** Each candidate's latest ASSIGN entry (07 Q43: every assignment change writes one). */
export function latestAssignments(entries: readonly LedgerEntry[]): Map<string, LedgerEntry> {
  const latest = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (entry.action !== "ASSIGN" || entry.entityType !== "candidate") continue;
    const seen = latest.get(entry.entityId);
    if (!seen || entry.createdAt > seen.createdAt) latest.set(entry.entityId, entry);
  }
  return latest;
}

/**
 * "New assignments" on a BDE's dashboard (A5, Q50): their candidates whose latest ASSIGN entry is under 7 days old,
 * newest first. The entry's summary names the BDE in words only, so who holds the candidate comes from the candidate
 * itself: a candidate reassigned away has another `bdeId` and drops out.
 */
export function deriveNewAssignments(
  bdeId: string,
  candidates: readonly Candidate[],
  entries: readonly LedgerEntry[],
  now: Date,
): { candidate: Candidate; entry: LedgerEntry }[] {
  const latest = latestAssignments(entries);
  const cutoff = now.getTime() - NEW_ASSIGNMENT_DAYS * 86_400_000;
  return candidates
    .filter((candidate) => candidate.bdeId === bdeId)
    .flatMap((candidate) => {
      const entry = latest.get(candidate.id);
      return entry && new Date(entry.createdAt).getTime() >= cutoff ? [{ candidate, entry }] : [];
    })
    .sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt));
}

/** The latest handoff note on a candidate (05 §6: "Note from {actor}, {date}"); null when the last move had none. */
export function latestHandoff(candidateId: string, entries: readonly LedgerEntry[]): LedgerEntry | null {
  const entry = latestAssignments(entries.filter((item) => item.entityId === candidateId)).get(candidateId);
  return entry?.note ? entry : null;
}
