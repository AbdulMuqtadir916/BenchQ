"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Inbox } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { GroupBody } from "@/components/app/card-group";
import { deriveNewAssignments } from "@/lib/derive/assignment";
import { formatRelative } from "@/lib/format/timezone";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useLedger } from "@/lib/hooks/use-ledger";
import { useNow } from "@/lib/hooks/use-now";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";

const EMPTY: never[] = [];
/** How far back the card reads the ledger: it has no per-BDE filter yet (module 07). */
const LEDGER_WINDOW = 500;

/**
 * "New assignments" on the BDE's dashboard (A5, Q50; no notifications): their candidates assigned in the last 7 days,
 * newest first, with who assigned them and the note. Derived from the ledger's ASSIGN entries, which only the backend
 * writes, so on mock candidates it shows its empty state until module 07.
 */
export function NewAssignmentsCard({ userId }: { userId: string }) {
  const toHref = useHref();
  const now = useNow();
  const candidatesQuery = useCandidates();
  const ledgerQuery = useLedger({ limit: LEDGER_WINDOW });
  const group = queryGroup(candidatesQuery, ledgerQuery);
  const items = useMemo(
    () => deriveNewAssignments(userId, candidatesQuery.data ?? EMPTY, ledgerQuery.data ?? EMPTY, now),
    [userId, candidatesQuery.data, ledgerQuery.data, now],
  );

  return (
    <Card className="p-0">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2"><Inbox size={15} aria-hidden />New assignments{group.status === "success" && items.length > 0 ? ` (${items.length})` : ""}</CardTitle>
      </CardHeader>
      <GroupBody group={group} skeleton={<div className="p-4"><SkeletonCard /></div>}>{() => items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-[var(--color-text-3)]">No new candidates this week.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map(({ candidate, entry }) => (
            <li key={candidate.id}>
              <Link href={toHref("candidates.detail", { id: candidate.id })} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--color-text)]">{candidate.fullName}</span>
                  <span className="block truncate text-caption text-[var(--color-text-3)]">From {entry.actorName}, {formatRelative(entry.createdAt)}</span>
                  {entry.note ? <span className="mt-1 block text-caption text-[var(--color-text-2)]">“{entry.note}”</span> : null}
                </span>
                <ArrowRight size={13} aria-hidden className="mt-1 shrink-0 text-[var(--color-text-3)]" />
              </Link>
            </li>
          ))}
        </ul>
      )}</GroupBody>
    </Card>
  );
}
