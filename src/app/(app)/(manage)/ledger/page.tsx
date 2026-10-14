"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { useLedger } from "@/lib/hooks/use-ledger";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { Tag, type TagTone } from "@/components/ui/tag";
import { ClaimChip } from "@/components/app/claim-chip";

const ACTION_TONE: Record<LedgerEntry["action"], TagTone> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  STATE_CHANGE: "violet",
  AI_GENERATE: "amber",
  AI_BLOCK: "red",
  AI_OVERRIDE: "amber",
  EXPORT: "teal",
  LOGIN: "neutral",
  ADMIN_ACCESS: "neutral",
};

const ACTOR_TONE: Record<LedgerEntry["actorType"], TagTone> = {
  USER: "blue",
  SYSTEM: "neutral",
  AGENT: "amber",
  PLATFORM_ADMIN: "violet",
};

export default function LedgerPage() {
  const ledgerQuery = useLedger({ limit: 100 });
  const [actorFilter, setActorFilter] = useState<"ALL" | LedgerEntry["actorType"]>("ALL");

  const rows = useMemo(() => {
    const entries = ledgerQuery.data ?? [];
    return entries.filter((e) => actorFilter === "ALL" || e.actorType === actorFilter);
  }, [ledgerQuery.data, actorFilter]);

  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      {
        id: "when",
        accessorFn: (e) => e.createdAt,
        header: "When",
        cell: ({ row }) => <DualTimestamp iso={row.original.createdAt} format="relative" className="text-[var(--color-text-3)]" />,
      },
      {
        id: "actor",
        accessorFn: (e) => e.actorName,
        header: "Actor",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Tag tone={ACTOR_TONE[row.original.actorType]}>{row.original.actorType.toLowerCase()}</Tag>
            <span className="text-[var(--color-text-2)]">{row.original.actorName}</span>
          </div>
        ),
      },
      {
        id: "action",
        accessorFn: (e) => e.action,
        header: "Action",
        cell: ({ row }) => <Tag tone={ACTION_TONE[row.original.action]}>{row.original.action.replaceAll("_", " ").toLowerCase()}</Tag>,
      },
      {
        id: "summary",
        accessorFn: (e) => e.summary,
        header: "Summary",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate text-[var(--color-text-2)]">{row.original.summary}</span>
            {row.original.modelId ? <span className="text-caption text-[var(--color-text-3)]">{row.original.modelId} · {row.original.promptVersion}</span> : null}
          </div>
        ),
      },
      {
        id: "claim",
        accessorFn: (e) => e.claimState ?? "",
        header: "Claim",
        enableSorting: false,
        cell: ({ row }) => (row.original.claimState ? <ClaimChip state={row.original.claimState} /> : <span className="text-[var(--color-text-3)]">—</span>),
      },
    ],
    [],
  );

  return (
    <div className="bq-page">
      <PageHeader title="Ledger" subtitle="Append-only audit trail. Every AI action, every state change, immutable." />

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(e) => e.id}
          isLoading={ledgerQuery.isLoading}
          error={ledgerQuery.error as Error | null}
          isRowSelectable={false}
          searchPlaceholder="Search the ledger…"
          storageKey="ledger-list"
          pagination
          pageSize={15}
          toolbarActions={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
                <span className="sr-only">Filter by actor</span>
                <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value as typeof actorFilter)} className="bq-input h-8 w-auto">
                  <option value="ALL">All actors</option>
                  <option value="USER">Users</option>
                  <option value="AGENT">AI agents</option>
                  <option value="SYSTEM">System</option>
                </select>
              </label>
            </div>
          }
        />
      </div>
    </div>
  );
}
