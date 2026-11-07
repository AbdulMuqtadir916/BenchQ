import { FirmRole } from "./enums";
import { z } from "zod";
import { ApplicationStatus, CandidateStatus } from "./enums";

export const FunnelStageSchema = z.object({
  status: ApplicationStatus,
  label: z.string(),
  count: z.number().int(),
  conversionFromPreviousPct: z.number().nullable(),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const BdePerformanceSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  candidatesAssigned: z.number().int(),
  applicationsSubmitted: z.number().int(),
  responses: z.number().int(),
  responseRatePct: z.number(),
  interviews: z.number().int(),
  placements: z.number().int(),
});
export type BdePerformance = z.infer<typeof BdePerformanceSchema>;

export const SourceRoiSchema = z.object({
  sourceId: z.string(),
  sourceLabel: z.string(),
  jobsIngested: z.number().int(),
  applications: z.number().int(),
  responses: z.number().int(),
  responseRatePct: z.number(),
});
export type SourceRoi = z.infer<typeof SourceRoiSchema>;

export const FirmDashboardSchema = z.object({
  period: z.enum(["7d", "30d", "90d"]),
  funnel: z.array(FunnelStageSchema),
  byBde: z.array(BdePerformanceSchema),
  pipelineByStatus: z.array(
    z.object({
      status: CandidateStatus,
      count: z.number().int(),
    }),
  ),
  medianTimeToFirstResponseDays: z.number().nullable(),
  sourceRoi: z.array(SourceRoiSchema),
  activeBdeCount: z.number().int(),
  totalApplicationsInPeriod: z.number().int(),
});
export type FirmDashboard = z.infer<typeof FirmDashboardSchema>;

export const BdeDashboardSchema = z.object({
  queueCount: z.number().int(),
  followUpsDueToday: z.number().int(),
  followUpsOverdue: z.number().int(),
  applicationsThisWeek: z.number().int(),
  responsesThisWeek: z.number().int(),
  interviewsScheduled: z.number().int(),
  candidatesAssigned: z.number().int(),
  atRiskCandidateIds: z.array(z.string()),
});
export type BdeDashboard = z.infer<typeof BdeDashboardSchema>;

const ActorType = z.enum(["USER", "SYSTEM", "AGENT", "PLATFORM_ADMIN", "UNKNOWN"]);

export const LedgerEntrySchema = z.object({
  id: z.string(),
  /** Set for any event about a firm (shows in that firm's ledger); null only for platform-only events (A13). */
  firmId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  /** UNKNOWN: a failed sign-in for an email with no account. */
  actorType: ActorType,
  actorName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string(),
  /** The candidate the entry is about, and the name they have now. Absent on the Super Admin's audit. */
  candidateId: z.string().nullable().optional(),
  candidateName: z.string().nullable().optional(),
  /** The actor's role when the entry was written; an AI agent has its person's, the system none. */
  actorRole: z.enum([...FirmRole.options, "PLATFORM_ADMIN"]).nullable().optional(),
  /** The person an AI agent worked for: its action counts towards them. */
  onBehalfOfUserId: z.string().nullable().optional(),
  onBehalfOfName: z.string().nullable().optional(),
  /** How many tries a failed sign-in row stands for: repeats within 10 seconds from one IP share a row. */
  attemptCount: z.number().int().optional(),
  /** The firm's name, on the Super Admin's log. */
  firmName: z.string().nullable().optional(),
  action: z.enum([
    "CREATE",
    "UPDATE",
    "DELETE",
    "STATE_CHANGE",
    "AI_GENERATE",
    "AI_BLOCK",
    "AI_OVERRIDE",
    "EXPORT",
    "LOGIN",
    "ADMIN_ACCESS",
    // tenancy (docs/02 §3.1)
    "ADMIN_ACCESS_END",
    "FIRM_CREATED",
    "FIRM_SUSPENDED",
    "FIRM_REACTIVATED",
    /** summary states before → after, e.g. "Starter → Growth, seats 5 → 10" (A14). */
    "PLAN_CHANGED",
    "INVITE_SENT",
    "INVITE_ACCEPTED",
    "INVITE_REVOKED",
    /** A candidate's manager or BDE set or changed (docs/02 §3.4, 07 Q43); `note` is the handoff note. */
    "ASSIGN",
    "LOGOUT",
    /** The Super Admin's alone: the backend serves these to no firm reader. */
    "SIGN_IN_FAILED",
    "LOCKED_OUT",
  ]),
  summary: z.string(),
  /** The handoff note on an ASSIGN entry; null on every other entry. */
  note: z.string().nullable(),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/** One person in the activity log's people list, with the count of what they did in the current view. */
export const LedgerPersonSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: FirmRole,
  managerId: z.string().nullable(),
  /** Left the firm or the reader's team, and still has rows to show. */
  isFormer: z.boolean(),
  actions: z.number().int(),
});
export type LedgerPerson = z.infer<typeof LedgerPersonSchema>;

export const LedgerPeopleSchema = z.object({
  /** The actor types this reader may filter by. */
  actorTypes: z.array(ActorType),
  /** Rows in the view, whoever is picked. */
  total: z.number().int(),
  /** Rows on show, with the person or team picked. */
  matching: z.number().int(),
  people: z.array(LedgerPersonSchema),
});
export type LedgerPeople = z.infer<typeof LedgerPeopleSchema>;

/** The counts beside the Super Admin's log. */
export const PlatformActivityOverviewSchema = z.object({
  timezone: z.string(),
  actorTypes: z.array(ActorType),
  total: z.number().int(),
  matching: z.number().int(),
  failed: z.number().int(),
  me: z.object({ userId: z.string(), name: z.string(), actions: z.number().int() }),
  firms: z.array(z.object({ id: z.string(), name: z.string(), managers: z.number().int(), actions: z.number().int() })),
});
export type PlatformActivityOverview = z.infer<typeof PlatformActivityOverviewSchema>;

export const LedgerCandidateSchema = z.object({ id: z.string(), name: z.string() });
export type LedgerCandidate = z.infer<typeof LedgerCandidateSchema>;

/** Merged activity stream for a candidate. */
export const TimelineEventSchema = z.object({
  id: z.string(),
  kind: z.enum(["STATUS", "APPLICATION", "RESUME", "OUTREACH", "FOLLOWUP", "NOTE", "RECORD"]),
  occurredAt: z.string().datetime(),
  actorName: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  linkTo: z.string().nullable(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
