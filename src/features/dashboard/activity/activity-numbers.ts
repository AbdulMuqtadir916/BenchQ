import { teamMemberIds } from "@/lib/auth/policy";
import { isBde } from "@/lib/auth/roles";
import { maxDate } from "@/lib/derive";
import { reachedStatuses } from "@/lib/derive/funnel";
import { applicationDate, happenedIn } from "@/lib/derive/list-filters";
import type { ApplicationDate } from "@/lib/schemas/list-search";
import { isWorkingCandidate } from "@/lib/derive/tenancy";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";

/**
 * The numbers on the Activity dashboard, worked out from the records (CLAUDE.md: every number is derived).
 * One rule for the period everywhere: an application counts when it was submitted in the period, an interview when it
 * happened in it, a placement when it closed in it. Candidates and BDEs are counted as they are now.
 */

export { LIST_PERIODS as PERIODS, type ListPeriod as Period } from "@/lib/schemas/list-search";
import type { ListPeriod as Period } from "@/lib/schemas/list-search";

const DAY_MS = 86_400_000;

export const periodDays = (period: Period): number => Number(period.slice(0, -1));

/** "24 hours" for a shift, otherwise "30 days". */
export const periodLabel = (period: Period): string => (period === "1d" ? "24 hours" : `${periodDays(period)} days`);

export type { TimeWindow as Window } from "@/lib/derive/list-filters";
import type { TimeWindow as Window } from "@/lib/derive/list-filters";

export function windowOf(period: Period, now: Date): Window {
  return { start: now.getTime() - periodDays(period) * DAY_MS, end: now.getTime() };
}


export interface ActivityCounts {
  /** Submitted in the period: a saved job isn't an application yet. */
  applications: number;
  /** Of those, how many heard back. */
  responses: number;
  interviews: number;
  placements: number;
}

export function countActivity(applications: readonly Application[], window: Window): ActivityCounts {
  const submitted = submittedIn(applications, window);
  return {
    applications: submitted.length,
    responses: submitted.filter((app) => app.firstResponseAt).length,
    interviews: applications.filter((app) => happenedIn(app, "interview", window)).length,
    placements: applications.filter((app) => happenedIn(app, "placed", window)).length,
  };
}

/** Submitted in the period, for the trend and the pipeline. */
export function submittedIn(applications: readonly Application[], window: Window): Application[] {
  return applications.filter((app) => happenedIn(app, "applied", window));
}

const forCandidates = (applications: readonly Application[], candidates: readonly Candidate[]) => {
  const ids = new Set(candidates.map((candidate) => candidate.id));
  return applications.filter((app) => ids.has(app.candidateId));
};

export interface ManagerRow {
  id: string;
  name: string;
  isActive: boolean;
  bdes: number;
  candidates: number;
  /** Candidates the manager holds with no BDE yet: their queue. */
  withoutBde: number;
  counts: ActivityCounts;
}

export function managerRows(managers: readonly User[], users: readonly User[], candidates: readonly Candidate[],
  applications: readonly Application[], window: Window): ManagerRow[] {
  return managers.map((manager) => {
    const team = candidates.filter((candidate) => candidate.managerId === manager.id);
    // The policy's own team (07 Q47): BDEs who report to the manager, and BDEs holding one of the manager's candidates.
    const members = teamMemberIds(manager.id, users, candidates);
    return {
      id: manager.id,
      name: manager.name,
      isActive: manager.isActive,
      bdes: users.filter((user) => isBde(user) && user.isActive && members.has(user.id)).length,
      candidates: team.length,
      withoutBde: team.filter((candidate) => candidate.bdeId === null).length,
      counts: countActivity(forCandidates(applications, team), window),
    };
  });
}

export interface BdeRow {
  id: string;
  name: string;
  isActive: boolean;
  candidates: number;
  /** Candidates being worked now (on the bench, interviewing, at offer): the load against the firm's BDE capacity. */
  working: number;
  counts: ActivityCounts;
}

export function bdeRows(bdes: readonly User[], candidates: readonly Candidate[], applications: readonly Application[],
  window: Window): BdeRow[] {
  return bdes.map((bde) => {
    const theirs = candidates.filter((candidate) => candidate.bdeId === bde.id);
    return { id: bde.id, name: bde.name, isActive: bde.isActive, candidates: theirs.length,
      working: theirs.filter(isWorkingCandidate).length, counts: countActivity(forCandidates(applications, theirs), window) };
  });
}

export interface CandidateRow {
  candidate: Candidate;
  counts: ActivityCounts;
  /** The latest thing that happened to the candidate or one of their applications, whenever it was. */
  lastActivity: string | null;
}

export function candidateRows(candidates: readonly Candidate[], applications: readonly Application[],
  window: Window): CandidateRow[] {
  return candidates.map((candidate) => {
    const theirs = applications.filter((app) => app.candidateId === candidate.id);
    return {
      candidate,
      counts: countActivity(theirs, window),
      lastActivity: maxDate([candidate.updatedAt, ...theirs.flatMap((app) => [app.appliedAt, app.firstResponseAt, app.interviewAt, app.closedAt])]),
    };
  });
}

export interface TrendBin {
  start: number;
  count: number;
}

/** The period cut into `bins` equal parts, each with the applications whose `by` date falls in it. */
export function eventBins(applications: readonly Application[], window: Window, by: ApplicationDate, bins = 7): TrendBin[] {
  const width = (window.end - window.start) / bins;
  const times = applications.filter((app) => happenedIn(app, by, window)).map((app) => new Date(applicationDate(app, by) as string).getTime());
  return Array.from({ length: bins }, (_, index) => {
    const from = window.start + index * width;
    const to = index === bins - 1 ? window.end + 1 : from + width;
    return { start: from, count: times.filter((time) => time >= from && time < to).length };
  });
}

/** Submissions across the period. */
export const trendBins = (applications: readonly Application[], window: Window, bins = 7): TrendBin[] => eventBins(applications, window, "applied", bins);

export interface StackedBin {
  start: number;
  /** Submissions in this part of the period, per BDE, in the order of `bdes`. */
  counts: number[];
  /** The rest: candidates with no BDE, or held by a BDE who isn't in `bdes`. The parts add up to every submission. */
  rest: number;
}

/** Submissions per part of the period, split by the BDE who holds the candidate: who carried the team, when. */
export function stackedByBde(bdes: readonly User[], candidates: readonly Candidate[], applications: readonly Application[],
  window: Window, bins = 7): StackedBin[] {
  const perBde = bdes.map((bde) => eventBins(forCandidates(applications, candidates.filter((candidate) => candidate.bdeId === bde.id)), window, "applied", bins));
  return eventBins(forCandidates(applications, candidates), window, "applied", bins).map((bin, index) => {
    const counts = perBde.map((series) => series[index].count);
    return { start: bin.start, counts, rest: bin.count - counts.reduce((sum, count) => sum + count, 0) };
  });
}

export interface Pace {
  /** Submitted in the last 24 hours. */
  today: number;
  /** The average per day over the 14 days before that, one decimal. */
  usual: number;
}

/** Today against an ordinary day: the BDE's pace for the shift. */
export function paceOf(applications: readonly Application[], now: Date, days = 14): Pace {
  const end = now.getTime();
  const today = submittedIn(applications, { start: end - DAY_MS, end }).length;
  const before = submittedIn(applications, { start: end - (days + 1) * DAY_MS, end: end - DAY_MS - 1 }).length;
  return { today, usual: Math.round((10 * before) / days) / 10 };
}

/** How far one BDE's applications of the period got: each count is the applications that reached that stage (like the pipeline). */
export interface BdeStageRow {
  id: string;
  name: string;
  applied: number;
  shortlisted: number;
  interview: number;
  placed: number;
}

export function bdeStageRows(bdes: readonly User[], candidates: readonly Candidate[], applications: readonly Application[], window: Window): BdeStageRow[] {
  return bdes.map((bde) => {
    const mine = submittedIn(forCandidates(applications, candidates.filter((candidate) => candidate.bdeId === bde.id)), window);
    const reached = mine.map(reachedStatuses);
    const count = (status: "SCREENING" | "INTERVIEW" | "PLACED") => reached.filter((set) => set.has(status)).length;
    return { id: bde.id, name: bde.name, applied: mine.length, shortlisted: count("SCREENING"), interview: count("INTERVIEW"), placed: count("PLACED") };
  });
}
