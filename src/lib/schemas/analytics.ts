import { z } from "zod";
import { ApplicationStatus, CandidateStatus, ClaimState } from "./enums";

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

export const LedgerEntrySchema = z.object({
  id: z.string(),
  /** Set for any event about a firm (shows in that firm's ledger); null only for platform-only events (A13). */
  firmId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorType: z.enum(["USER", "SYSTEM", "AGENT", "PLATFORM_ADMIN"]),
  actorName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string(),
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
  ]),
  summary: z.string(),
  modelId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  claimState: ClaimState.nullable(),
  createdAt: z.string().datetime(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

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
