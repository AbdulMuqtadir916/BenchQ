"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Activity, SearchX } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import type { ActivityParams } from "./use-activity-params";

export const PAGE_SIZE = 15;
const SEARCH_DELAY_MS = 300;

function isTypingTarget(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']"));
}

/** Esc goes one step back, unless the reader is typing. */
export function useEscapeBack(goBack: (() => void) | null) {
  useEffect(() => {
    if (!goBack) return;
    const back = goBack;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isTypingTarget(event.target)) back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);
}

interface ActivityTableProps {
  title: string;
  countText: string;
  columns: ColumnDef<LedgerEntry, unknown>[];
  entries: LedgerEntry[];
  matching: number;
  isUpdating: boolean;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  params: ActivityParams;
  update: (changes: Partial<ActivityParams>) => void;
  toolbarActions: ReactNode;
}

/** The log's table, with its search, paging, sorting and empty states, all kept in the URL. */
export function ActivityTable({ title, countText, columns, entries, matching, isUpdating, isLoading, error, onRetry, params, update, toolbarActions }: ActivityTableProps) {
  const [search, setSearch] = useState(params.q ?? "");

  useEffect(() => {
    const value = search.trim() || undefined;
    if (value === params.q) return;
    const timer = setTimeout(() => update({ q: value }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, params.q, update]);

  const hasFilters = Boolean(params.from || params.q || params.type || params.candidate);
  const clearFilters = () => {
    setSearch("");
    update({ from: undefined, to: undefined, q: undefined, type: undefined, candidate: undefined });
  };

  return (
    <div className={cn("min-w-0 transition-opacity", isUpdating && "opacity-60")} aria-busy={isUpdating}>
      <div className="mb-2">
        <h2 className="text-sm font-medium text-[var(--color-text)]">{title}</h2>
        <p className="text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{countText}</p>
      </div>
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(entry) => entry.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isRowSelectable={false}
        label="Activity logs"
        searchPlaceholder="Search the logs…"
        storageKey="activity-list"
        countLabel=""
        pagination
        pageSize={PAGE_SIZE}
        search={{ value: search, onChange: setSearch }}
        page={{ index: params.page - 1, onChange: (index) => update({ page: index + 1 }), count: Math.max(1, Math.ceil(matching / PAGE_SIZE)) }}
        sort={{
          value: [{ id: params.sort, desc: params.dir === "desc" }],
          onChange: ([first]) => update({ sort: (first?.id ?? "when") as ActivityParams["sort"], dir: first?.desc === false ? "asc" : "desc" }),
        }}
        emptyState={
          <EmptyState
            icon={hasFilters ? SearchX : Activity}
            variant={hasFilters ? "filtered" : "first-run"}
            title={hasFilters ? "No activity matches these filters" : "No activity yet"}
            description={hasFilters ? "Try other dates or clear the filters." : "Actions show up here as they happen."}
            action={hasFilters ? <Button variant="secondary" size="sm" onClick={clearFilters}>{params.from ? "Show all dates" : "Clear filter"}</Button> : undefined}
          />
        }
        toolbarActions={toolbarActions}
      />
    </div>
  );
}
