import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus, StoredApplicationStatus } from "@/lib/schemas/enums";
import type { FunnelStage } from "@/lib/schemas/analytics";
import { PIPELINE, STATUS_LABEL, stageRank } from "@/components/app/applications/status-meta";
import { round1 } from "./dates";

/**
 * The funnel counts every application that REACHED each stage, not just those sitting in it now. Stages come
 * from the one pipeline in status-meta (Applied → Offer). A move may skip stages (D1), so an application counts
 * as having reached every stage up to the furthest one in its history. Legacy values: a legacy placement counts
 * as reaching Offer (D6); other legacy values reach nothing beyond Applied.
 */
const STAGES = PIPELINE.slice(1);

function furthestRank(app: Application): number {
  const statuses: StoredApplicationStatus[] = [app.status, ...app.events.map((e) => e.toStatus)];
  let furthest = app.appliedAt || app.status !== "SAVED" ? stageRank("APPLIED") : -1;
  for (const status of statuses) {
    const rank = status === "PLACED" ? stageRank("OFFER") : stageRank(status);
    if (rank > furthest) furthest = rank;
  }
  return furthest;
}

/**
 * Every pipeline stage this application has reached, by the same rule as the funnel: a skipped stage counts (D1), and
 * a legacy placement counts as reaching Offer (D6). Saved drafts reach nothing.
 */
export function reachedStatuses(app: Application): Set<ApplicationStatus> {
  const furthest = furthestRank(app);
  return new Set(STAGES.filter((status) => stageRank(status) <= furthest));
}

export function deriveFunnel(applications: Application[]): FunnelStage[] {
  const reached = applications.map(furthestRank);
  let previousCount: number | null = null;
  return STAGES.map((status: ApplicationStatus) => {
    const count = reached.filter((rank) => rank >= stageRank(status)).length;
    const conversion = previousCount && previousCount > 0 ? round1((100 * count) / previousCount) : null;
    previousCount = count;
    return { status, label: STATUS_LABEL[status], count, conversionFromPreviousPct: conversion };
  });
}
