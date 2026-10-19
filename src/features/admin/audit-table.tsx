"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText, SearchX } from "lucide-react";
import { z } from "zod";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { ActionTag, ActorTag, actionLabel } from "@/components/app/ledger-tags";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useHref } from "@/lib/routes/use-href";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import type { Firm } from "@/lib/schemas/session";
import { AdminTime } from "./admin-time";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 25;
const ACTIONS = LedgerEntrySchema.shape.action.options;
const ACTORS = LedgerEntrySchema.shape.actorType.options;
const RANGES = { "7d": { label: "Last 7 days", days: 7 }, "30d": { label: "Last 30 days", days: 30 }, "90d": { label: "Last 90 days", days: 90 }, all: { label: "All time", days: null }, custom: { label: "Custom range", days: null } } as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The audit filters (docs/04 §14.5 Activity, §14.7), all in the URL. `range` defaults per page. */
export const auditQuery = (defaultRange: keyof typeof RANGES) =>
  z.object({
    action: z.enum(["all", ...ACTIONS]).catch("all"),
    actor: z.enum(["all", ...ACTORS]).catch("all"),
    range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES, ...(keyof typeof RANGES)[]]).catch(defaultRange),
    from: z.string().regex(ISO_DATE).catch(""),
    to: z.string().regex(ISO_DATE).catch(""),
    firm: z.string().catch(""),
    platformOnly: z.enum(["0", "1"]).catch("0"),
    page: z.coerce.number().int().min(1).catch(1),
  });
export type AuditQuery = z.infer<ReturnType<typeof auditQuery>>;

/** A calendar day in IST (admin dates are IST, docs/04 §14). */
const istDay = (date: string, end = false) => new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`).getTime();

export function filterAudit(entries: readonly LedgerEntry[], query: AuditQuery, now: Date): LedgerEntry[] {
  const days = RANGES[query.range].days;
  const from = query.range === "custom" ? (query.from ? istDay(query.from) : -Infinity) : days ? now.getTime() - days * DAY_MS : -Infinity;
  const to = query.range === "custom" && query.to ? istDay(query.to, true) : Infinity;
  return entries.filter((entry) => {
    const at = new Date(entry.createdAt).getTime();
    if (at < from || at > to) return false;
    if (query.action !== "all" && entry.action !== query.action) return false;
    if (query.actor !== "all" && entry.actorType !== query.actor) return false;
    if (query.platformOnly === "1" && entry.firmId !== null) return false;
    if (query.firm && entry.firmId !== query.firm) return false;
    return true;
  });
}

/**
 * The ledger as an admin reads it: when · actor · action · (firm) · entity · summary, newest first,
 * read-only. `firms` adds the firm column and filter (the platform audit log).
 */
export function AuditTable({
  entries,
  query,
  setQuery,
  firms,
  defaultRange,
  isLoading,
  error,
  onRetry,
}: {
  entries: readonly LedgerEntry[];
  query: AuditQuery;
  setQuery: (patch: Partial<AuditQuery>) => void;
  firms?: readonly Pick<Firm, "id" | "name">[];
  defaultRange: keyof typeof RANGES;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const toHref = useHref();
  const isFiltered = query.action !== "all" || query.actor !== "all" || query.range !== defaultRange || query.firm !== "" || query.platformOnly === "1";

  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(() => {
    const firmName = (id: string | null) => (id ? (firms?.find((firm) => firm.id === id)?.name ?? "Unknown firm") : "Platform");
    return [
      { id: "when", header: "When", enableSorting: false, cell: ({ row }) => <AdminTime iso={row.original.createdAt} /> },
      {
        id: "actor",
        header: "Actor",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[var(--color-text)]">{row.original.actorName}</span>
            <ActorTag type={row.original.actorType} />
          </span>
        ),
      },
      { id: "action", header: "Action", enableSorting: false, cell: ({ row }) => <ActionTag action={row.original.action} /> },
      ...(firms
        ? [
            {
              id: "firm",
              header: "Firm",
              enableSorting: false,
              cell: ({ row }) =>
                row.original.firmId ? (
                  <Link href={toHref("admin.firms.detail", { firmId: row.original.firmId })} className="text-[var(--color-primary-subtle-fg)] hover:underline">{firmName(row.original.firmId)}</Link>
                ) : (
                  <span className="text-[var(--color-text-3)]">Platform</span>
                ),
            } satisfies ColumnDef<LedgerEntry, unknown>,
          ]
        : []),
      { id: "entity", header: "Entity", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text-2)]">{row.original.entityLabel} <span className="text-mono-sm text-[var(--color-text-3)]">{row.original.entityType}</span></span> },
      { id: "summary", header: "Summary", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.summary}</span> },
    ];
  }, [firms, toHref]);

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageIndex = Math.min(query.page, pageCount) - 1;
  const clear = () => setQuery({ action: "all", actor: "all", range: defaultRange, from: "", to: "", firm: "", platformOnly: "0", page: 1 });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-[var(--color-text-2)]">
          <span className="sr-only">Action</span>
          <select value={query.action} onChange={(event) => setQuery({ action: event.target.value as AuditQuery["action"], page: 1 })} className="bq-input h-8 w-auto">
            <option value="all">All actions</option>
            {ACTIONS.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
          </select>
        </label>
        <label className="text-sm text-[var(--color-text-2)]">
          <span className="sr-only">Actor type</span>
          <select value={query.actor} onChange={(event) => setQuery({ actor: event.target.value as AuditQuery["actor"], page: 1 })} className="bq-input h-8 w-auto">
            <option value="all">All actors</option>
            {ACTORS.map((actor) => <option key={actor} value={actor}>{actor.replaceAll("_", " ").toLowerCase()}</option>)}
          </select>
        </label>
        {firms ? (
          <>
            <label className="text-sm text-[var(--color-text-2)]">
              <span className="sr-only">Firm</span>
              <select value={query.firm} onChange={(event) => setQuery({ firm: event.target.value, platformOnly: "0", page: 1 })} className="bq-input h-8 w-auto">
                <option value="">All firms</option>
                {firms.map((firm) => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
              <Checkbox checked={query.platformOnly === "1"} onChange={(event) => setQuery({ platformOnly: event.target.checked ? "1" : "0", firm: "", page: 1 })} />
              Platform only
            </label>
          </>
        ) : null}
        <label className="text-sm text-[var(--color-text-2)]">
          <span className="sr-only">Date range</span>
          <select value={query.range} onChange={(event) => setQuery({ range: event.target.value as AuditQuery["range"], page: 1 })} className="bq-input h-8 w-auto">
            {Object.entries(RANGES).map(([value, range]) => <option key={value} value={value}>{range.label}</option>)}
          </select>
        </label>
        {query.range === "custom" ? (
          <>
            <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-2)]">
              From <Input type="date" value={query.from} onChange={(event) => setQuery({ from: event.target.value, page: 1 })} className="h-8 w-auto" />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-2)]">
              To <Input type="date" value={query.to} onChange={(event) => setQuery({ to: event.target.value, page: 1 })} className="h-8 w-auto" />
            </label>
          </>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={[...entries]}
        getRowId={(entry) => entry.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isRowSelectable={false}
        hasToolbar={false}
        label="Audit log"
        pagination
        pageSize={PAGE_SIZE}
        page={{ index: pageIndex, onChange: (index) => setQuery({ page: index + 1 }) }}
        emptyState={
          isFiltered ? (
            <EmptyState icon={SearchX} variant="filtered" title="No activity in this period" description="Change or clear the filters to see more." action={<Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={ScrollText} title="No activity in this period" description="Actions show here as they happen." />
          )
        }
      />
    </>
  );
}
