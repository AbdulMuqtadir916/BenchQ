"use client";

import * as React from "react";
import {
  type ColumnDef,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Search, SearchX, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonTable } from "@/components/app/skeleton-table";
import { cn } from "@/lib/cn";

type Density = "compact" | "default" | "comfortable";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  error?: Error | null;
  /** Shown as Retry on the error state; a list without it leaves the user stuck (docs/05 §5). */
  onRetry?: () => void;
  emptyState?: React.ReactNode;
  virtualise?: boolean;
  density?: Density;
  onRowClick?: (row: TData) => void;
  storageKey?: string;
  searchPlaceholder?: string;
  getRowId?: (row: TData, index: number) => string;
  isRowSelectable?: boolean;
  className?: string;
  toolbarActions?: React.ReactNode;
  /** "outside" renders search and actions above the table card instead of inside its top edge. */
  toolbarPlacement?: "inside" | "outside";
  pagination?: boolean;
  pageSize?: number;
}

const ROW_HEIGHT: Record<Density, number> = {
  compact: 40,
  default: 52,
  comfortable: 64,
};

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  error = null,
  onRetry,
  emptyState,
  virtualise = false,
  density = "default",
  onRowClick,
  storageKey,
  searchPlaceholder = "Filter rows",
  getRowId,
  isRowSelectable = true,
  className,
  toolbarActions,
  toolbarPlacement = "inside",
  pagination = false,
  pageSize = 10,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [paginationState, setPaginationState] = React.useState({ pageIndex: 0, pageSize });
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const [loadedStorageKey, setLoadedStorageKey] = React.useState<string>();
  const rowRefs = React.useRef(new Map<number, HTMLTableRowElement>());

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(`${storageKey}:columns`);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "boolean")) {
          setColumnVisibility(parsed as VisibilityState);
        }
      }
    } catch {
      // Storage is optional. Defaults remain usable when it is unavailable.
    }
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  React.useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(
        `${storageKey}:columns`,
        JSON.stringify(columnVisibility),
      );
    } catch {
      // Storage is optional. The current session still works.
    }
  }, [columnVisibility, storageKey, loadedStorageKey]);

  // TanStack Table deliberately returns stateful callbacks; React Compiler
  // skips this component while the table owns its internal interaction model.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, rowSelection, columnVisibility, ...(pagination ? { pagination: paginationState } : {}) },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPaginationState,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
    getRowId,
    enableRowSelection: isRowSelectable,
  });

  const rows = table.getRowModel().rows;
  const safeFocusedIndex = Math.min(focusedIndex, Math.max(0, rows.length - 1));
  const virtualizer = useVirtualizer({
    count: virtualise ? rows.length : 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT[density],
    overscan: 8,
  });

  const focusRow = React.useCallback(
    (nextIndex: number) => {
      if (rows.length === 0) return;
      const bounded = Math.max(0, Math.min(nextIndex, rows.length - 1));
      setFocusedIndex(bounded);
      if (virtualise) virtualizer.scrollToIndex(bounded, { align: "auto" });
      window.requestAnimationFrame(() => rowRefs.current.get(bounded)?.focus());
    },
    [rows.length, virtualise, virtualizer],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (isTypingTarget(event.target) || (event.target as HTMLElement).closest("button, a, summary")) return;
    const key = event.key.toLowerCase();
    if (key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(safeFocusedIndex + 1);
    } else if (key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(safeFocusedIndex - 1);
    } else if (key === "x" || event.key === " ") {
      event.preventDefault();
      if (isRowSelectable) rows[safeFocusedIndex]?.toggleSelected();
    } else if (event.key === "Enter" && rows[safeFocusedIndex]) {
      event.preventDefault();
      onRowClick?.(rows[safeFocusedIndex].original);
    } else if (event.key === "/") {
      event.preventDefault();
      filterRef.current?.focus();
    }
  }

  if (isLoading) return <SkeletonTable columns={columns.length + 1} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const renderRow = (row: Row<TData>, index: number, style?: React.CSSProperties) => (
    <tr
      key={row.id}
      ref={(node) => {
        if (node) rowRefs.current.set(index, node);
        else rowRefs.current.delete(index);
      }}
      tabIndex={index === safeFocusedIndex ? 0 : -1}
      aria-selected={row.getIsSelected()}
      data-selected={row.getIsSelected() ? "true" : undefined}
      onFocus={() => setFocusedIndex(index)}
      onClick={() => onRowClick?.(row.original)}
      style={style}
      className={cn(
        "border-b border-[var(--color-border)] outline-none",
        "hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]",
        "data-[selected=true]:bg-[var(--color-primary-subtle)]",
        onRowClick && "cursor-pointer",
        virtualise && "absolute left-0 top-0 flex w-full items-center",
      )}
    >
      {isRowSelectable ? (
        <td className="w-10 shrink-0 px-4" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label={`Select row ${index + 1}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        </td>
      ) : null}
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          style={virtualise ? { width: cell.column.getSize() } : undefined}
          className={cn(
            "px-4 text-sm text-[var(--color-text-2)]",
            virtualise ? "flex min-w-0 items-center" : "",
          )}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  const isOutside = toolbarPlacement === "outside";
  const toolbar = (
      <div className={cn("flex flex-wrap items-center gap-2", isOutside ? "mb-3" : "border-b border-[var(--color-border)] p-3")}>
        <div className="relative min-w-0 w-full sm:max-w-72 flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]"
          />
          <Input
            ref={filterRef}
            data-table-filter
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>
        <span className="ml-auto text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{rows.length} rows · {table.getFilteredSelectedRowModel().rows.length} selected</span>
        <details className="relative">
          <summary className="bq-secondary inline-flex h-7 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-sm list-none">
                <Columns3 size={16} aria-hidden="true" />
                Columns
          </summary>
          <div className="absolute right-0 z-20 mt-2 min-w-48 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-md)]">
            {table.getAllLeafColumns().map((column) => (
              <label key={column.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 text-sm hover:bg-[var(--color-surface-2)]">
                <Checkbox
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
                <span>{column.id}</span>
              </label>
            ))}
          </div>
        </details>
        {toolbarActions}
      </div>
  );

  return (
    <>
    {isOutside ? toolbar : null}
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
      aria-label="Data table"
    >
      {isOutside ? null : toolbar}

      {rows.length === 0 ? (
        emptyState ?? (
          <EmptyState
            icon={SearchX}
            title={globalFilter ? "No matching rows" : "No rows yet"}
            description={
              globalFilter
                ? "Clear the filter to see the full list."
                : "Rows will appear here when data is available."
            }
            variant={globalFilter ? "filtered" : "first-run"}
            action={
              globalFilter ? (
                <Button variant="secondary" size="sm" onClick={() => setGlobalFilter("")}>
                  Clear filter
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div
          ref={viewportRef}
          onKeyDown={handleKeyDown}
          className="max-h-[480px] overflow-auto rounded-b-[var(--radius-lg)]"
        >
          <table className={cn("w-full min-w-[640px] border-collapse", virtualise && "grid")}>
            <caption className="sr-only">
              {rows.length} row{rows.length === 1 ? "" : "s"}. Use J and K to move, Enter to open, and X to select.
            </caption>
            <thead className={cn("sticky top-0 z-10 bg-[var(--color-surface-3)]", virtualise && "grid")}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className={cn("border-b border-[var(--color-border)]", virtualise && "flex w-full")}>
                  {isRowSelectable ? (
                    <th scope="col" className="w-10 shrink-0 px-4 text-left">
                      <Checkbox
                        aria-label="Select all visible rows"
                        checked={table.getIsAllRowsSelected()}
                        isIndeterminate={table.getIsSomeRowsSelected()}
                        onChange={table.getToggleAllRowsSelectedHandler()}
                      />
                    </th>
                  ) : null}
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                        style={virtualise ? { width: header.getSize() } : undefined}
                        className={cn("h-11 px-4 text-left text-sm font-medium text-[var(--color-text-2)]", virtualise && "flex min-w-0 items-center")}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex min-h-8 items-center gap-1.5"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon size={13} className="text-[var(--color-text-3)]" aria-hidden="true" />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            {virtualise ? (
              <tbody
                className="relative grid"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) =>
                  renderRow(rows[virtualRow.index]!, virtualRow.index, {
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }),
                )}
              </tbody>
            ) : (
              <tbody>
                {rows.map((row, index) =>
                  renderRow(row, index, { height: ROW_HEIGHT[density] }),
                )}
              </tbody>
            )}
          </table>
        </div>
      )}

      {pagination && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3">
          <div className="text-sm text-[var(--color-text-3)]">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </section>
    </>
  );
}

export type { DataTableProps, Density };
