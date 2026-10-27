"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, UserX } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { GroupBody } from "@/components/app/card-group";
import { hasTeamScope, scopeCandidates } from "@/lib/auth/permissions";
import { isWaitingForBde, queueByManager } from "@/lib/derive/assignment";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

const EMPTY: never[] = [];

/**
 * "Needs a BDE" on the floor (docs/candidate-onboarding/05 §5, 07 Q42): a MANAGER sees their queue's count and its
 * first five; the OWNER (and a VIEWER or support view) the firm's count per manager. Every number is derived from the
 * candidates; the link opens the list's queue filter.
 */
export function NeedsBdeCard() {
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const candidatesQuery = useCandidates();
  const teamQuery = useTeam();
  const group = queryGroup(candidatesQuery, teamQuery);
  const waiting = useMemo(() => scopeCandidates(principal, candidatesQuery.data ?? EMPTY).filter(isWaitingForBde), [principal, candidatesQuery.data]);
  const perManager = useMemo(() => [...queueByManager(waiting)].sort((a, b) => b[1] - a[1]), [waiting]);
  const nameOf = (id: string) => teamQuery.data?.find((user) => user.id === id)?.name ?? "A manager";
  const isTeam = hasTeamScope(principal);

  return (
    <Card className="p-0">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2"><UserX size={15} aria-hidden className="text-[var(--color-warning-fg)]" />Needs a BDE{group.status === "success" ? ` (${waiting.length})` : ""}</CardTitle>
        {waiting.length > 0 ? (
          <Link href={toHref("candidates", {}, { assignment: "needs-bde" })} className="inline-flex items-center gap-1 text-caption text-[var(--color-text-2)] hover:underline">
            Open queue<ArrowRight size={12} aria-hidden />
          </Link>
        ) : null}
      </CardHeader>
      <GroupBody group={group} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => waiting.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-[var(--color-text-3)]">No candidates waiting for a BDE.</p>
      ) : isTeam ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {waiting.slice(0, 5).map((candidate) => (
            <li key={candidate.id}>
              <Link href={toHref("candidates.detail", { id: candidate.id })} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[var(--color-surface-2)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--color-text)]">{candidate.fullName}</span>
                  <span className="block truncate text-caption text-[var(--color-text-3)]">{candidate.primaryRole ?? "Open role"}</span>
                </span>
                <ArrowRight size={13} aria-hidden className="shrink-0 text-[var(--color-text-3)]" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {perManager.map(([managerId, count]) => (
            <li key={managerId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="truncate text-[var(--color-text)]">{nameOf(managerId)}</span>
              <span className="tabular text-[var(--color-text-2)]">{count} waiting</span>
            </li>
          ))}
        </ul>
      )}</GroupBody>
    </Card>
  );
}
