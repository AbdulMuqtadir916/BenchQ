import { z } from "zod";
import { ApplicationStatus, CandidateStatus } from "./enums";

/**
 * The Applications and Candidates lists' filters, as shareable URL state (CLAUDE.md: filters live in the URL, parsed
 * with Zod). Every dashboard number links here with the filter that gives the same count. Each key falls back to "no
 * filter", so a stale or hand-edited link shows everything instead of breaking.
 */

export const LIST_PERIODS = ["1d", "7d", "30d", "90d"] as const;
export type ListPeriod = (typeof LIST_PERIODS)[number];

/** Which date the period is about: submitted, first reply, interview, offer, or placed (closed as placed). */
export const APPLICATION_DATES = ["applied", "response", "interview", "offer", "placed"] as const;
export type ApplicationDate = (typeof APPLICATION_DATES)[number];

/** Stages an application can have reached, in order (the funnel's stages). */
export const REACHED_STAGES = ["APPLIED", "RESPONSE", "SCREENING", "INTERVIEW", "OFFER", "PLACED"] as const;
export type ReachedStage = (typeof REACHED_STAGES)[number];

export const ApplicationsSearch = z.object({
  view: z.enum(["kanban", "calendar", "table"]).catch("kanban"),
  /** Where the application is now. */
  status: z.union([ApplicationStatus, z.literal("")]).catch(""),
  /** Got at least this far, whatever happened after. */
  reached: z.union([z.enum(REACHED_STAGES), z.literal("")]).catch(""),
  /** With `period`: the date that has to fall in it. */
  by: z.enum(APPLICATION_DATES).catch("applied"),
  period: z.union([z.enum(LIST_PERIODS), z.literal("")]).catch(""),
  manager: z.string().catch(""),
  bde: z.string().catch(""),
  candidate: z.string().catch(""),
});
export type ApplicationsSearchState = z.infer<typeof ApplicationsSearch>;

/** Days on the bench, in the dashboard's three bands; `over30` is the two older bands together. */
export const BENCH_BANDS = ["under30", "30to60", "over60", "over30"] as const;
export type BenchBand = (typeof BENCH_BANDS)[number];

export const CandidatesSearch = z.object({
  /** The manager's queue (docs/candidate-onboarding/05 §5). */
  assignment: z.enum(["all", "needs-bde"]).catch("all"),
  status: z.union([CandidateStatus, z.literal("ALL")]).catch("ALL"),
  bench: z.union([z.enum(BENCH_BANDS), z.literal("")]).catch(""),
  manager: z.string().catch(""),
  bde: z.string().catch(""),
  q: z.string().catch(""),
  sort: z.string().regex(/^-?[A-Za-z]+$/).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
  /** A role slug, as "Roles in demand" groups them. */
  role: z.string().catch(""),
});
export type CandidatesSearchState = z.infer<typeof CandidatesSearch>;

export const isReachedStage = (status: string): status is ReachedStage => (REACHED_STAGES as readonly string[]).includes(status);

/** A manager's BDEs page: the name search and the period its numbers cover. */
/** The job page opened for one candidate (`?candidate=`): it reads that candidate's own job and acts for them. */
export const JobDetailSearch = z.object({
  candidate: z.string().catch(""),
});

export const BdesSearch = z.object({
  q: z.string().catch(""),
  period: z.enum(LIST_PERIODS).catch("30d"),
});

/** The Managers page: table or cards, the name search, and the period its numbers cover. */
export const ManagersSearch = z.object({
  view: z.enum(["table", "cards"]).catch("table"),
  q: z.string().catch(""),
  period: z.enum(LIST_PERIODS).catch("30d"),
});
