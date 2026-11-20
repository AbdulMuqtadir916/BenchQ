import { CLOSED, isActive } from "@/components/app/applications/status-meta";
import type { StoredApplicationStatus } from "@/lib/schemas/enums";

/**
 * One definition of "how many applications", for every screen (BUG-005). A saved job is a draft or favourite, "not proof of
 * submission" (docs/02), so it is not an application: it is counted on its own, never as active. The rest split by stage, on the
 * one vocabulary in components/app/applications/status-meta.ts (docs/02 §2.1).
 */

/** Ended without a placement: Move On, and the legacy closed values. A legacy Placed is counted on its own. */
export const CLOSED_STATUSES: readonly StoredApplicationStatus[] = CLOSED.filter((status) => status !== "PLACED");

export interface ApplicationCounts {
  saved: number;
  /** Active: submitted and not closed (`isActive` in status-meta), so every stage from Applied to Offer. */
  open: number;
  /** Ended in a (legacy) placement: neither active nor closed. */
  placed: number;
  /** `CLOSED_STATUSES`. */
  closed: number;
  /** Everything that was actually submitted: all but saved, so `open + placed + closed`. */
  submitted: number;
}

/** Whether this application was really submitted (anything but a saved job). */
export const isSubmitted = (status: StoredApplicationStatus): boolean => status !== "SAVED";

export function countApplications(applications: readonly { status: StoredApplicationStatus }[]): ApplicationCounts {
  let saved = 0;
  let open = 0;
  let placed = 0;
  let closed = 0;
  for (const { status } of applications) {
    if (status === "SAVED") saved++;
    else if (status === "PLACED") placed++;
    else if (CLOSED_STATUSES.includes(status)) closed++;
    else if (isActive(status)) open++;
  }
  return { saved, open, placed, closed, submitted: open + placed + closed };
}

/**
 * The rows a candidate's board and list show. Active keeps what the board has a column for: Saved (counted as saved), every open
 * stage (counted as active) and Move On (counted as closed); the legacy closed values and a legacy Placed are left out. All keeps
 * everything. So every row shown is named in the line above the board.
 */
export function applicationsInScope<T extends { status: StoredApplicationStatus }>(applications: readonly T[], scope: "active" | "all"): T[] {
  return scope === "active"
    ? applications.filter((a) => a.status === "SAVED" || a.status === "MOVE_ON" || isActive(a.status))
    : [...applications];
}

/** "10 active · 2 closed · 3 saved": the line above a candidate's board. Saved and placed appear only when there are some. */
export function describeApplicationCounts(counts: ApplicationCounts): string {
  return [`${counts.open} active`, counts.placed > 0 ? `${counts.placed} placed` : null, `${counts.closed} closed`, counts.saved > 0 ? `${counts.saved} saved` : null]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * The applications of an Analytics period (BUG-008): submitted ones only, whose `appliedAt` is within the last `days` days (the
 * last day counts). A saved job has no `appliedAt` and is never in a period; a submitted application with no date cannot be placed
 * in one, so it is left out rather than counted in every period (none exist in the data).
 */
export function applicationsSubmittedWithin<T extends { status: StoredApplicationStatus; appliedAt: string | null }>(
  applications: readonly T[],
  days: number,
  now: Date = new Date(),
): T[] {
  const end = now.getTime();
  const start = end - days * 86_400_000;
  return applications.filter((application) => {
    if (!isSubmitted(application.status) || application.appliedAt === null) return false;
    const applied = Date.parse(application.appliedAt);
    return applied >= start && applied <= end;
  });
}
