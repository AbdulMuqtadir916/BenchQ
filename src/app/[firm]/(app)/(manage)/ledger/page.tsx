"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { useLedgerAll } from "@/lib/hooks/use-ledger";
import { LEDGER_MAX_ENTRIES } from "@/lib/api/analytics";
import { LedgerCapNotice } from "@/components/app/ledger-cap-notice";
import { hasOwnScope, hasTeamScope } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { ActionTag, ActorTag } from "@/components/app/ledger-tags";
import { ACTOR_FILTERS, actorFilterLabel, countByActor, filterByActor, type ActorFilter } from "@/lib/derive/ledger-actors";

import { LedgerListQuery, LEDGER_SORT_COLUMNS } from "@/lib/routes/ledger-list-query";
import { useUrlState } from "@/lib/routes/use-url-state";
import { pageIndexFor } from "@/lib/routes/page-index";
import { formatSort, parseSort } from "@/lib/routes/sort-param";
import { matchesSearch } from "@/lib/search";

const PAGE_SIZE = 15;
const EMPTY_LEDGER: LedgerEntry[] = [];

export default function LedgerPage() {
  const principal = useSignedInPrincipal();
  // The whole ledger, not the first page (BUG-022: 100 of 119 entries were shown, the older ones unreachable).
  const ledgerQuery = useLedgerAll();
  const isTeamScope = hasTeamScope(principal);
  const [{ actor, q, sort, page }, setQuery] = useUrlState(LedgerListQuery);

  const scoped = ledgerQuery.data?.items ?? EMPTY_LEDGER;
  const rows = useMemo(
    () => filterByActor(scoped, actor).filter((entry) => matchesSearch([entry.createdAt, entry.actorName, entry.action, entry.summary], q)),
    [scoped, actor, q],
  );
  // Each option says how many rows it would show, so one that is empty (no AI agent has written an entry yet) reads as empty.
  const actorCounts = useMemo(() => countByActor(scoped), [scoped]);

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
            <ActorTag type={row.original.actorType} />
            <span className="text-[var(--color-text-2)]">{row.original.actorName}</span>
          </div>
        ),
      },
      {
        id: "action",
        accessorFn: (e) => e.action,
        header: "Action",
        cell: ({ row }) => <ActionTag action={row.original.action} />,
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
    ],
    [],
  );

  return (
    <div className="bq-page">
      <PageHeader title="Ledger" subtitle={hasOwnScope(principal) ? "Your actions in the audit trail. Append-only, immutable." : isTeamScope ? "Your team's actions and candidates in the audit trail. Append-only, immutable." : "Append-only audit trail. Every AI action, every state change, immutable."} />

      <div className="mt-4">
        <LedgerCapNotice hasMore={ledgerQuery.data?.hasMore ?? false} shown={LEDGER_MAX_ENTRIES} />
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(e) => e.id}
          isLoading={ledgerQuery.isLoading}
          error={ledgerQuery.error}
          onRetry={() => void ledgerQuery.refetch()}
          isRowSelectable={false}
          searchPlaceholder="Search the ledger…"
          storageKey="ledger-list"
          pagination
          pageSize={PAGE_SIZE}
          search={{ value: q, onChange: (value) => setQuery({ q: value, page: 1 }) }}
          sort={{ value: parseSort(sort, LEDGER_SORT_COLUMNS), onChange: (value) => setQuery({ sort: formatSort(value), page: 1 }) }}
          page={{ index: pageIndexFor(page, rows.length, PAGE_SIZE), onChange: (index) => setQuery({ page: index + 1 }) }}
          toolbarActions={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
                <span className="sr-only">Filter by actor</span>
                <select value={actor} onChange={(e) => setQuery({ actor: e.target.value as ActorFilter, page: 1 })} className="bq-input h-8 w-auto">
                  {ACTOR_FILTERS.map((filter) => (
                    <option key={filter} value={filter}>{actorFilterLabel(filter, actorCounts)}</option>
                  ))}
                </select>
              </label>
            </div>
          }
        />
      </div>
    </div>
  );
}
