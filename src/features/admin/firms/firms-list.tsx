"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus, SearchX } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { hasCustomLimits, lastActivityAt, ownerStatus, usageOf, type OwnerStatus } from "@/lib/derive/platform";
import type { FirmUsage } from "@/lib/derive/tenancy";
import { usePlans } from "@/lib/hooks/use-platform";
import { useNow } from "@/lib/hooks/use-now";
import { usePageKey } from "@/lib/hooks/use-page-key";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { useUrlState } from "@/lib/routes/use-url-state";
import type { Firm } from "@/lib/schemas/session";
import { FirmStatus } from "@/lib/schemas/tenancy";
import { AdminDate, AdminTime } from "../admin-time";
import { CustomLimitsBadge, FIRM_STATUS_LABEL, FirmStatusBadge, OverLimitBadge } from "../firm-badges";
import { usePlatformData } from "../use-platform-data";

const PAGE_SIZE = 20;

/** docs/04 §14.3: every control in the URL. */
const FirmsQuery = z.object({
  q: z.string().catch(""),
  status: z.enum(["all", ...FirmStatus.options]).catch("all"),
  overLimit: z.enum(["0", "1"]).catch("0"),
  sort: z.enum(["lastActivity", "name", "created"]).catch("lastActivity"),
  page: z.coerce.number().int().min(1).catch(1),
});

interface FirmRow {
  firm: Firm;
  planName: string;
  usage: FirmUsage;
  owner: OwnerStatus;
  lastActivity: string | null;
  isCustom: boolean;
}

const SORTS: Record<z.infer<typeof FirmsQuery>["sort"], { label: string; compare: (a: FirmRow, b: FirmRow) => number }> = {
  lastActivity: { label: "Last activity", compare: (a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") },
  name: { label: "Name", compare: (a, b) => a.firm.name.localeCompare(b.firm.name) },
  created: { label: "Newest", compare: (a, b) => b.firm.createdAt.localeCompare(a.firm.createdAt) },
};

function OwnerCell({ owner }: { owner: OwnerStatus }) {
  if (owner.kind === "active") return <span className="text-[var(--color-text)]">{owner.name}</span>;
  if (owner.kind === "pending") return <span className="text-[var(--color-text-3)]">Invite pending</span>;
  if (owner.kind === "expired") return <span className="text-[var(--color-warning-fg)]">Invite expired</span>;
  return <span className="text-[var(--color-text-3)]">—</span>;
}

/** /admin/firms (docs/04 §14.3). */
export function FirmsList() {
  const router = useRouter();
  const toHref = useHref();
  const now = useNow();
  const [query, setQuery] = useUrlState(FirmsQuery);
  const platform = usePlatformData();
  const plans = usePlans();
  const group = queryGroup(platform.queries.firms, platform.queries.users, platform.queries.invites, platform.queries.candidates, platform.queries.ledger, plans);

  const newFirm = useCallback(() => router.push(toHref("admin.firms.new")), [router, toHref]);
  usePageKey("n", newFirm);

  const allRows = useMemo<FirmRow[]>(() => {
    const data = platform.data;
    if (!data || !plans.data) return [];
    return data.firms.map((firm) => ({
      firm,
      planName: plans.data.find((plan) => plan.id === firm.planId)?.name ?? "Unknown plan",
      usage: usageOf(firm, data, now),
      owner: ownerStatus(firm.id, data, now),
      lastActivity: lastActivityAt(firm.id, data.ledger),
      isCustom: hasCustomLimits(firm.id, data.ledger),
    }));
  }, [platform.data, plans.data, now]);

  const rows = useMemo(() => {
    const q = query.q.trim().toLowerCase();
    return allRows
      .filter((row) => !q || row.firm.name.toLowerCase().includes(q) || row.firm.slug.includes(q))
      .filter((row) => query.status === "all" || row.firm.status === query.status)
      .filter((row) => query.overLimit === "0" || row.usage.isOverLimit)
      .sort(SORTS[query.sort].compare);
  }, [allRows, query]);

  const isFiltered = query.q !== "" || query.status !== "all" || query.overLimit === "1";
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageIndex = Math.min(query.page, pageCount) - 1;

  const columns = useMemo<ColumnDef<FirmRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Firm",
        enableSorting: false,
        cell: ({ row }) => (
          <Link href={toHref("admin.firms.detail", { firmId: row.original.firm.id })} className="font-[600] text-[var(--color-text)] hover:underline" onClick={(event) => event.stopPropagation()}>
            {row.original.firm.name}
          </Link>
        ),
      },
      { id: "slug", header: "Slug", enableSorting: false, cell: ({ row }) => <span className="text-mono-sm">{row.original.firm.slug}</span> },
      { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <FirmStatusBadge status={row.original.firm.status} /> },
      {
        id: "plan",
        header: "Plan",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            {row.original.planName}
            {row.original.isCustom ? <CustomLimitsBadge /> : null}
          </span>
        ),
      },
      {
        id: "seats",
        header: "Seats",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="tabular">{row.original.usage.seatsUsed} / {row.original.usage.seatLimit}</span>
            {row.original.usage.isOverLimit ? <OverLimitBadge /> : null}
          </span>
        ),
      },
      { id: "owner", header: "Owner", enableSorting: false, cell: ({ row }) => <OwnerCell owner={row.original.owner} /> },
      { id: "created", header: "Created", enableSorting: false, cell: ({ row }) => <AdminDate iso={row.original.firm.createdAt} /> },
      {
        id: "lastActivity",
        header: "Last activity",
        enableSorting: false,
        cell: ({ row }) => (row.original.lastActivity ? <AdminTime iso={row.original.lastActivity} /> : <span className="text-[var(--color-text-3)]">—</span>),
      },
    ],
    [toHref],
  );

  const empty =
    allRows.length === 0 ? (
      <EmptyState
        icon={Building2}
        title="No firms yet"
        description="Create a firm to onboard its owner."
        action={<Button onClick={newFirm}><Plus size={14} aria-hidden /> Create the first firm</Button>}
      />
    ) : (
      <EmptyState
        icon={SearchX}
        variant="filtered"
        title="No firms match"
        description="Change or clear the filters to see more firms."
        action={<Button variant="secondary" size="sm" onClick={() => setQuery({ q: "", status: "all", overLimit: "0", page: 1 })}>Clear filters</Button>}
      />
    );

  return (
    <div className="bq-page">
      <PageHeader
        title="Firms"
        subtitle="Every client firm: status, plan, seats and owner."
        actions={
          <Button asChild>
            <Link href={toHref("admin.firms.new")}>
              <Plus size={14} aria-hidden /> New firm <kbd className="ml-1 text-mono-sm opacity-70">N</kbd>
            </Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.firm.id}
        isLoading={group.status === "pending"}
        error={group.status === "error" ? group.error : null}
        onRetry={group.retry}
        isRowSelectable={false}
        onRowClick={(row) => router.push(toHref("admin.firms.detail", { firmId: row.firm.id }))}
        searchPlaceholder="Search by name or slug"
        search={{ value: query.q, onChange: (q) => setQuery({ q, page: 1 }) }}
        pagination
        pageSize={PAGE_SIZE}
        page={{ index: pageIndex, onChange: (index) => setQuery({ page: index + 1 }) }}
        emptyState={isFiltered || allRows.length === 0 ? empty : undefined}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
              <span className="sr-only">Status</span>
              <select value={query.status} onChange={(event) => setQuery({ status: event.target.value as typeof query.status, page: 1 })} className="bq-input h-8 w-auto">
                <option value="all">All statuses</option>
                {FirmStatus.options.map((status) => <option key={status} value={status}>{FIRM_STATUS_LABEL[status]}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
              <Checkbox checked={query.overLimit === "1"} onChange={(event) => setQuery({ overLimit: event.target.checked ? "1" : "0", page: 1 })} />
              Over limit only
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
              <span className="sr-only">Sort by</span>
              <select value={query.sort} onChange={(event) => setQuery({ sort: event.target.value as typeof query.sort })} className="bq-input h-8 w-auto">
                {Object.entries(SORTS).map(([value, sort]) => <option key={value} value={value}>Sort: {sort.label}</option>)}
              </select>
            </label>
          </div>
        }
      />
    </div>
  );
}
