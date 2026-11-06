"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { ActionTag, ActorTag } from "@/components/app/ledger-tags";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { actorDisplay } from "./actor";

/** With dates picked, "When" shows the exact time; otherwise how long ago. */
export function activityColumns(isExactTime: boolean): ColumnDef<LedgerEntry, unknown>[] {
  return [
    {
      id: "when",
      accessorFn: (entry) => entry.createdAt,
      header: "When",
      cell: ({ row }) => <DualTimestamp iso={row.original.createdAt} format={isExactTime ? "absolute" : "relative"} primary="ist" className="whitespace-nowrap text-[var(--color-text-3)]" />,
    },
    {
      id: "actor",
      accessorFn: (entry) => entry.actorName,
      header: "Actor",
      cell: ({ row }) => {
        const actor = actorDisplay(row.original);
        return (
          <div className="flex items-start gap-2 whitespace-nowrap">
            {actor.hasTag ? <ActorTag type={row.original.actorType} /> : null}
            <div>
              <span className="block text-[var(--color-text-2)]">{actor.name}</span>
              {actor.role ? <span className="block text-caption text-[var(--color-text-3)]">({actor.role})</span> : null}
            </div>
          </div>
        );
      },
    },
    {
      id: "action",
      accessorFn: (entry) => entry.action,
      header: "Action",
      cell: ({ row }) => <ActionTag action={row.original.action} />,
    },
    {
      id: "candidate",
      accessorFn: (entry) => entry.candidateName ?? "",
      header: "Candidate",
      enableSorting: false,
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--color-text-2)]">{row.original.candidateName ?? "—"}</span>,
    },
    {
      id: "summary",
      accessorFn: (entry) => entry.summary,
      header: "Summary",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="block truncate text-[var(--color-text-2)]">{row.original.summary}</span>
          {row.original.modelId ? <span className="text-caption text-[var(--color-text-3)]">{row.original.modelId} · {row.original.promptVersion}</span> : null}
        </div>
      ),
    },
  ];
}
