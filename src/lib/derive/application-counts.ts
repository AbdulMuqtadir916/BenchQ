import type { ApplicationStatus } from "@/lib/schemas/enums";
import { daysBetween } from "./dates";

/**
 * One definition of "how many applications", for every screen (BUG-005). A saved job is a draft or favourite, "not proof of
 * submission" (docs/02), so it is not an application: it is counted on its own, never as active. The rest split by stage.
 */

/** In play: applied and waiting, or moving through the pipeline. This is "Active" everywhere. */
export const OPEN_STATUSES: readonly ApplicationStatus[] = ["APPLIED", "RESPONSE", "SCREENING", "INTERVIEW", "OFFER"];

/** Ended without a placement: the board's Closed column (`CLOSED` in components/app/applications/status-meta.ts is pinned to this by a test). */
export const CLOSED_STATUSES: readonly ApplicationStatus[] = ["REJECTED", "WITHDRAWN", "EXPIRED"];

export interface ApplicationCounts {
  saved: number;
  /** Active: `OPEN_STATUSES`. */
  open: number;
  /** Ended in a placement: neither active nor closed. */
  placed: number;
  /** `CLOSED_STATUSES`. */
  closed: number;
  /** Everything that was actually submitted: all but saved, so `open + placed + closed`. */
  submitted: number;
}

/** Whether this application was really submitted (anything but a saved job). */
export const isSubmitted = (status: ApplicationStatus): boolean => status !== "SAVED";

export function countApplications(applications: readonly { status: ApplicationStatus }[]): ApplicationCounts {
  let saved = 0;
  let open = 0;
  let placed = 0;
  let closed = 0;
  for (const { status } of applications) {
    if (status === "SAVED") saved++;
    else if (status === "PLACED") placed++;
    else if (CLOSED_STATUSES.includes(status)) closed++;
    else if (OPEN_STATUSES.includes(status)) open++;
  }
  return { saved, open, placed, closed, submitted: open + placed + closed };
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
export function applicationsSubmittedWithin<T extends { status: ApplicationStatus; appliedAt: string | null }>(
  applications: readonly T[],
  days: number,
  now: Date = new Date(),
): T[] {
  return applications.filter((a) => isSubmitted(a.status) && a.appliedAt !== null && daysBetween(a.appliedAt, now) <= days);
}
