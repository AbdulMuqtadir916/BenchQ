"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ApiError } from "@/lib/api/client";
import { periodsOf } from "@/lib/derive/billing";
import { ownerStatus, usageOf } from "@/lib/derive/platform";
import { useBillingPeriods, usePlans, usePlatformFirm } from "@/lib/hooks/use-platform";
import { useNow } from "@/lib/hooks/use-now";
import { queryGroup } from "@/lib/query/query-group";
import { usePlatformData } from "../use-platform-data";

/** The firm id of an /admin/firms/[firmId]/… page. */
export function useFirmIdParam(): string {
  const params = useParams<{ firmId: string }>();
  return decodeURIComponent(params.firmId ?? "");
}

/**
 * One firm's admin view (docs/04 §14.5): the firm, its plan, usage, owner and billing periods, all
 * derived from the platform records. `isNotFound` for an unknown firm id.
 */
export function useFirmDetail() {
  const firmId = useFirmIdParam();
  const now = useNow();
  const firm = usePlatformFirm(firmId);
  const plans = usePlans();
  const billing = useBillingPeriods();
  const platform = usePlatformData();
  const group = queryGroup(firm, plans, billing, ...Object.values(platform.queries));
  const isNotFound = firm.error instanceof ApiError && firm.error.status === 404;

  const detail = useMemo(() => {
    if (!firm.data || !plans.data || !billing.data || !platform.data) return null;
    const data = platform.data;
    return {
      firm: firm.data,
      plan: plans.data.find((plan) => plan.id === firm.data.planId) ?? null,
      plans: plans.data,
      usage: usageOf(firm.data, data, now),
      owner: ownerStatus(firm.data.id, data, now),
      periods: periodsOf(firm.data.id, billing.data),
      data,
      now,
    };
  }, [firm.data, plans.data, billing.data, platform.data, now]);

  return { firmId, group, isNotFound, detail };
}

export type FirmDetail = NonNullable<ReturnType<typeof useFirmDetail>["detail"]>;
