import type { Candidate } from "@/lib/schemas/candidate";
import { isBde } from "@/lib/auth/roles";
import type { Application } from "@/lib/schemas/application";
import type { User } from "@/lib/schemas/session";
import type { BdePerformance } from "@/lib/schemas/analytics";
import { round1 } from "./dates";

/**
 * Per-BDE performance for the owner/manager transparency view.
 * All counts derive from the assignment + application arrays.
 */
export function deriveBdePerformance(
  users: User[],
  candidates: Candidate[],
  applications: Application[],
): BdePerformance[] {
  return users
    .filter(isBde)
    .map((user) => {
      const assigned = candidates.filter((c) => c.assignedUserIds.includes(user.id));
      const assignedIds = new Set(assigned.map((c) => c.id));
      const apps = applications.filter(
        (a) => assignedIds.has(a.candidateId) && a.status !== "SAVED",
      );
      const responses = apps.filter((a) => a.firstResponseAt).length;

      return {
        userId: user.id,
        userName: user.name,
        candidatesAssigned: assigned.length,
        applicationsSubmitted: apps.length,
        responses,
        responseRatePct: apps.length ? round1((100 * responses) / apps.length) : 0,
        interviews: apps.filter((a) => a.interviewAt).length,
        placements: apps.filter((a) => a.status === "PLACED").length,
      };
    });
}
