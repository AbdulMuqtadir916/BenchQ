import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { stageRank } from "@/components/app/applications/status-meta";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ApplicationDate, ApplicationsSearchState, BenchBand, CandidatesSearchState, ListPeriod } from "@/lib/schemas/list-search";
import { effectiveEvents, reachedStatuses } from "./funnel";

/**
 * The rules behind the Applications and Candidates filters. The dashboard counts with the same rules, so a number on
 * the dashboard and the list it opens always agree (CLAUDE.md: every number is derived).
 */

const DAY_MS = 86_400_000;
const at = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

export interface TimeWindow {
  start: number;
  end: number;
}

export const periodWindow = (period: ListPeriod, now: Date): TimeWindow =>
  ({ start: now.getTime() - Number(period.slice(0, -1)) * DAY_MS, end: now.getTime() });

/**
 * When the application first got to `stage` or further, from its history: the live backend sends no stage dates.
 * A skipped stage counts as reached (D1), and a legacy placement as reaching Offer (D6).
 */
function firstReached(app: Application, stage: ApplicationStatus): string | null {
  const rank = stageRank(stage);
  const times = effectiveEvents(app)
    .filter((event) => (event.toStatus === "PLACED" ? stageRank("OFFER") : stageRank(event.toStatus)) >= rank)
    .map((event) => event.createdAt)
    .sort();
  return times[0] ?? null;
}

/** The date a filter's period is about. A Saved draft was never submitted (no appliedAt); a job moved back to Saved
 * keeps the date it was submitted. */
export function applicationDate(app: Application, by: ApplicationDate): string | null {
  if (by === "applied") return app.appliedAt;
  if (by === "response") return app.firstResponseAt;
  if (by === "interview") return app.interviewAt ?? firstReached(app, "INTERVIEW_SCHEDULED");
  return app.offerAt ?? firstReached(app, "OFFER");
}

export function happenedIn(app: Application, by: ApplicationDate, window: TimeWindow): boolean {
  const time = at(applicationDate(app, by));
  return time !== null && time >= window.start && time <= window.end;
}

/** Whole days on the bench, from the bench start (or when the candidate was added). */
export function benchDays(candidate: Pick<Candidate, "benchStartDate" | "createdAt">, now: Date): number {
  const start = at(candidate.benchStartDate ?? candidate.createdAt) ?? now.getTime();
  return Math.max(0, Math.floor((now.getTime() - start) / DAY_MS));
}

/** On the bench now, in the band: under 30 days, 30 to 60, over 60, or 30 and over. */
export function inBenchBand(candidate: Candidate, band: BenchBand, now: Date): boolean {
  if (candidate.status !== "ON_BENCH") return false;
  const days = benchDays(candidate, now);
  if (band === "under30") return days < 30;
  if (band === "30to60") return days >= 30 && days <= 60;
  if (band === "over60") return days > 60;
  return days >= 30;
}

/** "Senior Java Developer" and a job's "senior-java-developer" are the same role. */
export const roleKey = (role: string) => role.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type ApplicationFilters = Omit<ApplicationsSearchState, "view">;

/** Applications matching the filters. Manager, BDE and candidate go through the candidate, as the dashboard does. */
export function filterApplications(applications: readonly Application[], filters: ApplicationFilters,
  candidates: readonly Candidate[], now: Date): Application[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const window = filters.period ? periodWindow(filters.period, now) : null;
  return applications.filter((app) => {
    const candidate = byId.get(app.candidateId);
    if (filters.candidate && app.candidateId !== filters.candidate) return false;
    if (filters.manager && candidate?.managerId !== filters.manager) return false;
    if (filters.bde && candidate?.bdeId !== filters.bde) return false;
    if (filters.status && app.status !== filters.status) return false;
    if (filters.reached && !reachedStatuses(app).has(filters.reached)) return false;
    if (window && !happenedIn(app, filters.by, window)) return false;
    return true;
  });
}

type CandidateFilters = Omit<CandidatesSearchState, "assignment" | "page">;

export function filterCandidates(candidates: readonly Candidate[], filters: CandidateFilters, now: Date): Candidate[] {
  return candidates.filter((candidate) =>
    (filters.status === "ALL" || candidate.status === filters.status)
    && (!filters.bench || inBenchBand(candidate, filters.bench, now))
    && (!filters.manager || candidate.managerId === filters.manager)
    && (!filters.bde || candidate.bdeId === filters.bde)
    && (!filters.role || roleKey(candidate.primaryRole ?? "") === filters.role));
}

/** Query strings for links into the lists: only the keys that filter, so the URL stays short. */
export type ApplicationsLink = Partial<Omit<ApplicationsSearchState, "view">>;
export type CandidatesLink = Partial<Omit<CandidatesSearchState, "assignment" | "page">> & { assignment?: "needs-bde" };

export const linkQuery = (filters: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
