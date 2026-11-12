"use client";

import { useMemo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/error-state";
import { SettingRow } from "@/components/app/settings/setting-row";
import { deriveFirmUsage } from "@/lib/derive";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useMemberInvites, useTeam } from "@/lib/hooks/use-team";
import { queryGroup } from "@/lib/query/query-group";
import { useFirm } from "@/lib/tenancy/firm-context";

const EMPTY: never[] = [];

/**
 * Plan and usage on `settings/firm` (read-only; plans and limits are changed by a Super Admin, never the OWNER).
 * The counts come from `deriveFirmUsage`, the function the OWNER dashboard and /admin use on the same records, so the
 * three always agree. No plan name yet: the firm carries only its copied limits; billing adds the plan later.
 */
export function PlanUsageCard() {
  const firm = useFirm();
  const teamQuery = useTeam();
  const invitesQuery = useMemberInvites();
  const candidatesQuery = useCandidates();
  const group = queryGroup(teamQuery, invitesQuery, candidatesQuery);

  const team = teamQuery.data ?? EMPTY;
  const invites = invitesQuery.data ?? EMPTY;
  const candidates = candidatesQuery.data ?? EMPTY;
  const usage = useMemo(
    () => deriveFirmUsage(firm, { users: team, invites, candidates }, new Date()),
    [firm, team, invites, candidates],
  );

  return (
    <Card aria-label="Plan and usage">
      <CardHeader><CardTitle>Plan and usage</CardTitle></CardHeader>
      {group.status === "error" ? (
        <ErrorState error={group.error} onRetry={group.retry} />
      ) : group.status === "pending" ? (
        <div role="status" aria-busy="true" aria-label="Loading plan usage" className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <>
          <dl className="space-y-3 text-sm">
            <SettingRow label="BDE seats" value={`${usage.seatsUsed} / ${usage.seatLimit}${usage.isOverSeatLimit ? " · over the limit" : ""}`} />
            <SettingRow label="Candidates" value={`${usage.assignedCandidates} / ${usage.candidateLimit}${usage.isOverCandidateLimit ? " · over the limit" : ""}`} />
          </dl>
          <p className="mt-3 text-caption text-[var(--color-text-3)]">
            A seat is a BDE or a pending BDE invite. A candidate counts once assigned to a BDE, while on the bench, interviewing or at an offer.
          </p>
        </>
      )}
    </Card>
  );
}
