"use client";

import Link from "next/link";
import { ActionTag } from "@/components/app/ledger-tags";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { Firm } from "@/lib/schemas/session";
import { useHref } from "@/lib/routes/use-href";
import { AdminTime } from "./admin-time";

/**
 * A short ledger list (the overview's recent activity, a firm's recent activity): when, who, what.
 * `firms` adds the firm column (a link, or "Platform" for firmId null).
 */
export function ActivityList({ entries, firms, empty }: { entries: readonly LedgerEntry[]; firms?: readonly Pick<Firm, "id" | "name">[]; empty: string }) {
  const toHref = useHref();
  if (entries.length === 0) return <p className="py-2 text-sm text-[var(--color-text-3)]">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {entries.map((entry) => {
        const firm = firms && entry.firmId ? firms.find((item) => item.id === entry.firmId) : undefined;
        return (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
            <AdminTime iso={entry.createdAt} className="w-28 shrink-0 text-caption text-[var(--color-text-3)]" />
            <ActionTag action={entry.action} />
            <span className="min-w-0 flex-1 text-[var(--color-text-2)]">
              <span className="text-[var(--color-text)]">{entry.actorName}</span> · {entry.summary}
            </span>
            {firms ? (
              firm ? (
                <Link href={toHref("admin.firms.detail", { firmId: firm.id })} className="text-caption text-[var(--color-primary-subtle-fg)] hover:underline">{firm.name}</Link>
              ) : (
                <span className="text-caption text-[var(--color-text-3)]">{entry.firmId ? "Unknown firm" : "Platform"}</span>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
