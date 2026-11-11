import { isBde } from "@/lib/auth/roles";
import { reachedStatuses } from "@/lib/derive/funnel";
import { applicationDate, benchDays, roleKey } from "@/lib/derive/list-filters";
import { isWorkingCandidate } from "@/lib/derive/tenancy";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import { REACHED_STAGES } from "@/lib/schemas/list-search";
import type { User } from "@/lib/schemas/session";
import { countActivity, submittedIn, type ActivityCounts, type Window } from "./activity-numbers";

/**
 * The deeper numbers on the Activity dashboard: how this period compares with the one before, how fast applications
 * move, how the bench is used, and what needs someone's attention. All worked out from the records.
 */

const DAY_MS = 86_400_000;
const at = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
const isIn = (time: number | null, window: Window) => time !== null && time >= window.start && time <= window.end;

/** The same length of time, just before this period. */
export function previousWindow(window: Window): Window {
  const length = window.end - window.start;
  return { start: window.start - length, end: window.start - 1 };
}

export interface Change {
  /** "+3" or "−2"; null when both periods are zero. */
  text: string | null;
  trend: "up" | "down" | "neutral";
}

export function changeFrom(now: number, before: number): Change {
  if (now === before) return { text: now ? "no change" : null, trend: "neutral" };
  const difference = now - before;
  return { text: `${difference > 0 ? "+" : "−"}${Math.abs(difference)}`, trend: difference > 0 ? "up" : "down" };
}

export function compareActivity(applications: readonly Application[], window: Window): Record<keyof ActivityCounts, Change> {
  const now = countActivity(applications, window);
  const before = countActivity(applications, previousWindow(window));
  return {
    applications: changeFrom(now.applications, before.applications),
    responses: changeFrom(now.responses, before.responses),
    interviews: changeFrom(now.interviews, before.interviews),
    offers: changeFrom(now.offers, before.offers),
  };
}

export interface StageSpeed {
  label: string;
  /** Average days, one decimal; null when nothing made that step in the period. */
  averageDays: number | null;
  count: number;
  isSlowest: boolean;
}

const STEPS: { label: string; from: (app: Application) => string | null; to: (app: Application) => string | null }[] = [
  { label: "Applied → response", from: (app) => app.appliedAt, to: (app) => app.firstResponseAt },
  { label: "Response → interview", from: (app) => app.firstResponseAt, to: (app) => applicationDate(app, "interview") },
  { label: "Interview → offer", from: (app) => applicationDate(app, "interview"), to: (app) => applicationDate(app, "offer") },
];

/** How long each step took, for the steps finished in the period. The slowest is where applications wait. */
export function stageSpeeds(applications: readonly Application[], window: Window): StageSpeed[] {
  const speeds = STEPS.map(({ label, from, to }) => {
    const spans = applications.flatMap((app) => {
      const start = at(from(app));
      const end = at(to(app));
      return start !== null && end !== null && end >= start && isIn(end, window) ? [(end - start) / DAY_MS] : [];
    });
    const averageDays = spans.length ? Math.round((10 * spans.reduce((sum, days) => sum + days, 0)) / spans.length) / 10 : null;
    return { label, averageDays, count: spans.length, isSlowest: false };
  });
  const timed = speeds.filter((speed) => speed.averageDays !== null);
  if (timed.length > 1) {
    const slowest = timed.reduce((worst, speed) => ((speed.averageDays ?? 0) > (worst.averageDays ?? 0) ? speed : worst));
    slowest.isSlowest = true;
  }
  return speeds;
}

/** Days to an offer, end to end: submission to offer, for offers in the period. Offer is the last stage. */
export function averageDaysToOffer(applications: readonly Application[], window: Window): number | null {
  const spans = applications.flatMap((app) => {
    const start = at(app.appliedAt);
    const end = at(applicationDate(app, "offer"));
    return start !== null && end !== null && end >= start && isIn(end, window) ? [(end - start) / DAY_MS] : [];
  });
  return spans.length ? Math.round(spans.reduce((sum, days) => sum + days, 0) / spans.length) : null;
}

export interface Ratios {
  /** Of the applications submitted in the period, the share that got to an interview. */
  submissionToInterviewPct: number | null;
  /** Of those interviewed, the share with an offer. */
  interviewToOfferPct: number | null;
  /** Applications submitted for each offer in the period. */
  applicationsPerOffer: number | null;
}

const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : null);

export function ratios(applications: readonly Application[], window: Window): Ratios {
  const submitted = submittedIn(applications, window);
  const interviewed = submitted.filter((app) => applicationDate(app, "interview"));
  const offered = interviewed.filter((app) => applicationDate(app, "offer"));
  const offers = countActivity(applications, window).offers;
  return {
    submissionToInterviewPct: pct(interviewed.length, submitted.length),
    interviewToOfferPct: pct(offered.length, interviewed.length),
    applicationsPerOffer: offers ? Math.round(submitted.length / offers) : null,
  };
}

export interface BenchHealth {
  /** Placed, out of everyone being worked or placed (paused and inactive candidates don't count). */
  utilizationPct: number | null;
  placed: number;
  /** Everyone being worked or placed: the whole the utilization is out of. */
  counted: number;
  onBench: number;
  /** On the bench with nothing submitted for them in the last 7 days. */
  idle: number;
  aging: { under30: number; from30to60: number; over60: number };
  /** The longest on the bench, longest first. */
  longest: { candidate: Candidate; days: number }[];
}

export function benchHealth(candidates: readonly Candidate[], applications: readonly Application[], now: Date): BenchHealth {
  const counted = candidates.filter((candidate) => isWorkingCandidate(candidate) || candidate.status === "PLACED");
  const placed = counted.filter((candidate) => candidate.status === "PLACED").length;
  const bench = candidates.filter((candidate) => candidate.status === "ON_BENCH");
  const days = (candidate: Candidate) => benchDays(candidate, now);
  const lastWeek = { start: now.getTime() - 7 * DAY_MS, end: now.getTime() };
  const busy = new Set(submittedIn(applications, lastWeek).map((app) => app.candidateId));
  const aged = bench.map((candidate) => ({ candidate, days: days(candidate) })).sort((a, b) => b.days - a.days);
  return {
    utilizationPct: pct(placed, counted.length),
    placed,
    counted: counted.length,
    onBench: bench.length,
    idle: bench.filter((candidate) => !busy.has(candidate.id)).length,
    aging: {
      under30: aged.filter((row) => row.days < 30).length,
      from30to60: aged.filter((row) => row.days >= 30 && row.days <= 60).length,
      over60: aged.filter((row) => row.days > 60).length,
    },
    longest: aged.filter((row) => row.days >= 30).slice(0, 5),
  };
}

export type Attention =
  | { kind: "without-bde"; count: number }
  | { kind: "quiet-bde"; bde: User; candidates: number }
  | { kind: "aging"; count: number };

/** What someone should act on: candidates nobody is working, BDEs with candidates and no submissions, a long bench. */
export function needsAttention(users: readonly User[], candidates: readonly Candidate[], applications: readonly Application[],
  window: Window, health: BenchHealth): Attention[] {
  const items: Attention[] = [];
  const withoutBde = candidates.filter((candidate) => candidate.bdeId === null && isWorkingCandidate(candidate)).length;
  if (withoutBde) items.push({ kind: "without-bde", count: withoutBde });
  const submittedFor = new Set(submittedIn(applications, window).map((app) => app.candidateId));
  for (const bde of users.filter((user) => isBde(user) && user.isActive)) {
    const theirs = candidates.filter((candidate) => candidate.bdeId === bde.id && isWorkingCandidate(candidate));
    if (theirs.length && !theirs.some((candidate) => submittedFor.has(candidate.id))) items.push({ kind: "quiet-bde", bde, candidates: theirs.length });
  }
  const aging = health.aging.from30to60 + health.aging.over60;
  if (aging) items.push({ kind: "aging", count: aging });
  return items;
}

export interface RoleDemand {
  /** The role's slug: the Candidates list's `?role=` filter. */
  key: string;
  role: string;
  /** Active jobs with this title. */
  jobs: number;
  /** Candidates on the bench whose main role is this one. */
  onBench: number;
}

/** The most-posted roles next to how many bench candidates fit them: where to market, and where the bench is thin. */
export function roleDemand(jobs: readonly Job[], candidates: readonly Candidate[], limit = 6): RoleDemand[] {
  const posted = new Map<string, { role: string; jobs: number }>();
  for (const job of jobs.filter((item) => item.isActive)) {
    const key = roleKey(job.normalisedTitle || job.title);
    const entry = posted.get(key) ?? { role: job.title, jobs: 0 };
    entry.jobs += 1;
    posted.set(key, entry);
  }
  const bench = candidates.filter((candidate) => candidate.status === "ON_BENCH" && candidate.primaryRole);
  return [...posted.entries()]
    .map(([key, entry]) => ({ key, role: entry.role, jobs: entry.jobs, onBench: bench.filter((candidate) => roleKey(candidate.primaryRole ?? "") === key).length }))
    .sort((a, b) => b.jobs - a.jobs || a.role.localeCompare(b.role))
    .slice(0, limit);
}

export interface SourceRow {
  source: Job["provenance"]["sourceType"];
  applications: number;
  /** Of those, the share that heard back. */
  responsePct: number;
}

/** Applications submitted in the period by where their job came from, and how often each source got a reply. */
export function sourceEffectiveness(applications: readonly Application[], jobs: readonly Job[], window: Window): SourceRow[] {
  const sourceOf = new Map(jobs.map((job) => [job.id, job.provenance.sourceType]));
  const stats = new Map<SourceRow["source"], { applications: number; responses: number }>();
  for (const app of submittedIn(applications, window)) {
    const source = sourceOf.get(app.jobId);
    if (!source) continue;
    const entry = stats.get(source) ?? { applications: 0, responses: 0 };
    entry.applications += 1;
    if (app.firstResponseAt) entry.responses += 1;
    stats.set(source, entry);
  }
  return [...stats.entries()]
    .map(([source, entry]) => ({ source, applications: entry.applications, responsePct: Math.round((100 * entry.responses) / entry.applications) }))
    .sort((a, b) => b.applications - a.applications || a.source.localeCompare(b.source));
}

export interface CandidateProgress {
  candidate: Candidate;
  /** How far their best application got: 0 for none submitted, then 1 (Applied) to 7 (Offer). */
  stage: number;
  /** Submitted for them in the last 24 hours. */
  today: number;
  /** Being worked, with nothing submitted for them in the last 7 days. */
  isQuiet: boolean;
}

/** Each candidate's furthest stage, today's count and whether they've gone quiet: the BDE's own list for the shift. */
export function candidateProgress(candidates: readonly Candidate[], applications: readonly Application[], now: Date): CandidateProgress[] {
  const end = now.getTime();
  return candidates.map((candidate) => {
    const theirs = applications.filter((app) => app.candidateId === candidate.id && app.status !== "SAVED");
    const stage = theirs.reduce((best, app) => {
      const reached = reachedStatuses(app);
      return Math.max(best, ...REACHED_STAGES.map((step, index) => (reached.has(step) ? index + 1 : 0)));
    }, 0);
    return {
      candidate,
      stage,
      today: submittedIn(theirs, { start: end - DAY_MS, end }).length,
      isQuiet: isWorkingCandidate(candidate) && submittedIn(theirs, { start: end - 7 * DAY_MS, end }).length === 0,
    };
  }).sort((a, b) => Number(b.isQuiet) - Number(a.isQuiet) || b.stage - a.stage || a.candidate.fullName.localeCompare(b.candidate.fullName));
}
