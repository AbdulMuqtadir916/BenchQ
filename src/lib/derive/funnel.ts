import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { FunnelStage } from "@/lib/schemas/analytics";
import { round1 } from "./dates";

/**
 * The funnel counts every application that REACHED each stage, not just those
 * sitting in it now — an app now at INTERVIEW also passed through APPLIED and
 * RESPONSE. We read each application's event chain to know what it reached.
 */
const STAGE_ORDER: Array<{ status: ApplicationStatus; label: string }> = [
  { status: "APPLIED", label: "Applied" },
  { status: "RESPONSE", label: "Response" },
  { status: "SCREENING", label: "Screening" },
  { status: "INTERVIEW", label: "Interview" },
  { status: "OFFER", label: "Offer" },
  { status: "PLACED", label: "Placed" },
];

export function reachedStatuses(app: Application): Set<ApplicationStatus> {
  const reached = new Set<ApplicationStatus>();
  for (const e of app.events) reached.add(e.toStatus);
  reached.add(app.status);
  return reached;
}

export function deriveFunnel(applications: Application[]): FunnelStage[] {
  const reachedList = applications.map(reachedStatuses);

  let previousCount: number | null = null;
  return STAGE_ORDER.map(({ status, label }) => {
    const count = reachedList.filter((r) => r.has(status)).length;
    const conversion =
      previousCount && previousCount > 0 ? round1((100 * count) / previousCount) : null;
    previousCount = count;
    return {
      status,
      label,
      count,
      conversionFromPreviousPct: conversion,
    };
  });
}
