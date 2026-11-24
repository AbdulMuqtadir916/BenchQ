"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, SearchX } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LedgerFilters } from "@/lib/api/analytics";
import { hasOwnScope, hasTeamScope } from "@/lib/auth/permissions";
import { useLedger, useLedgerCandidates, useLedgerPeople } from "@/lib/hooks/use-ledger";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";
import { cn } from "@/lib/cn";
import { activityColumns } from "./activity-columns";
import { candidateOptions } from "./candidate-label";
import { ActivityRail } from "./activity-rail";
import { DateRangeFilter, rangeLabel, type DateRange } from "./date-range-filter";
import { actorOptions, backStep, buildRail, resolveSelection, viewSubtitle, viewTitle, type Selection, type Viewer } from "./rail";
import { useActivityParams } from "./use-activity-params";

const PAGE_SIZE = 15;
const SEARCH_DELAY_MS = 300;

function isTypingTarget(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']"));
}

export function ActivityPage() {
  const principal = useSignedInPrincipal();
  const firm = useFirm();
  const [params, update] = useActivityParams();
  const [search, setSearch] = useState(params.q ?? "");
  // Back or Forward can change `q` while the page stays: follow it, unless the box already says the same.
  const [syncedQ, setSyncedQ] = useState(params.q);
  if (params.q !== syncedQ) {
    setSyncedQ(params.q);
    if ((search.trim() || undefined) !== params.q) setSearch(params.q ?? "");
  }
  const viewer: Viewer = useMemo(() => ({
    userId: principal.userId,
    scope: hasOwnScope(principal) ? "own" : hasTeamScope(principal) ? "team" : "firm",
  }), [principal]);

  useEffect(() => {
    const value = search.trim() || undefined;
    if (value === params.q) return;
    const timer = setTimeout(() => update({ q: value }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, params.q, update]);

  const viewFilters: LedgerFilters = { candidateId: params.candidate, actorType: params.type, fromDate: params.from, toDate: params.to, q: params.q };
  const filters: LedgerFilters = { ...viewFilters, actorId: params.person, teamId: params.team };
  const peopleQuery = useLedgerPeople(filters);
  const people = useMemo(() => peopleQuery.data?.people ?? [], [peopleQuery.data]);
  const isReady = peopleQuery.data !== undefined;
  // The previous view's people (kept while the next loads) can't say whether the URL's pick is out of reach.
  const isSettled = isReady && !peopleQuery.isPlaceholderData;
  const selection = useMemo(() => (isReady ? resolveSelection(people, viewer, params) : {}), [isReady, people, viewer, params]);
  const isOutOfReach = isSettled && (selection.team !== params.team || selection.person !== params.person);

  // A URL naming someone outside the reader's view falls back to their own root.
  useEffect(() => {
    if (isOutOfReach) update({ team: selection.team, person: selection.person });
  }, [isOutOfReach, selection, update]);

  const ledgerQuery = useLedger(
    { ...filters, limit: PAGE_SIZE, offset: (params.page - 1) * PAGE_SIZE, sort: params.sort, dir: params.dir },
    { isEnabled: isReady && !isOutOfReach },
  );
  const candidatesQuery = useLedgerCandidates({ ...viewFilters, candidateId: undefined, actorId: params.person, teamId: params.team });

  const rail = useMemo(() => (isReady ? buildRail(people, viewer, selection, { total: peopleQuery.data?.total ?? 0, teamActions: peopleQuery.data?.teamActions ?? {} }) : null), [isReady, people, viewer, selection, peopleQuery.data]);
  const back = rail ? backStep(rail, viewer, selection) : null;
  const columns = useMemo(() => activityColumns(Boolean(params.from)), [params.from]);
  const actors = useMemo(() => actorOptions(people, viewer, peopleQuery.data?.actorTypes ?? []), [people, viewer, peopleQuery.data]);
  const candidates = useMemo(() => candidateOptions(candidatesQuery.data ?? [], params.candidate, ledgerQuery.data ?? []), [candidatesQuery.data, params.candidate, ledgerQuery.data]);

  const select = (next: Selection) => update({ team: next.team, person: next.person });
  const setDates = ({ from, to }: DateRange) => update({ from, to });
  const pickActor = (value: string) => {
    if (value === "ALL") update({ type: undefined, person: undefined });
    else if (value === "SYSTEM") update({ type: "SYSTEM", person: undefined, team: undefined });
    else if (value === "AGENT") update({ type: "AGENT" });
    else update({ person: value, team: undefined, type: undefined });
  };

  useEffect(() => {
    function goBack(event: KeyboardEvent) {
      if (event.key !== "Escape" || !back || isTypingTarget(event.target)) return;
      update({ team: back.to.team, person: back.to.person });
    }
    window.addEventListener("keydown", goBack);
    return () => window.removeEventListener("keydown", goBack);
  }, [back, update]);

  const matching = peopleQuery.data?.matching ?? 0;
  const pageCount = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  // A stale URL (page 9 of 2) goes to the last page there is, once the count is the current one.
  useEffect(() => {
    if (isSettled && params.page > pageCount) update({ page: pageCount });
  }, [isSettled, params.page, pageCount, update]);
  const candidatesNotice = candidatesQuery.isError && !candidatesQuery.data ? (
    <span>Couldn’t load the candidates. <button type="button" className="underline" onClick={() => void candidatesQuery.refetch()}>Retry</button></span>
  ) : candidatesQuery.isLoading ? "Loading candidates…" : undefined;
  const range = rangeLabel({ from: params.from, to: params.to });
  const hasFilters = Boolean(params.from || params.q || params.type || params.candidate);
  const clearFilters = () => {
    setSearch("");
    update({ from: undefined, to: undefined, q: undefined, type: undefined, candidate: undefined });
  };

  return (
    <div className="bq-page">
      <PageHeader title="Activity logs" subtitle={rail ? viewSubtitle(rail, viewer, selection, people) : undefined} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ActivityRail rail={rail} viewer={viewer} selection={selection} back={back} rangeLabel={range} isLoading={peopleQuery.isLoading} error={peopleQuery.error} onRetry={() => void peopleQuery.refetch()} onSelect={select} />
        <div className={cn("min-w-0 transition-opacity", ledgerQuery.isPlaceholderData && "opacity-60")} aria-busy={ledgerQuery.isPlaceholderData}>
          <div className="mb-2">
            <h2 className="text-sm font-medium text-[var(--color-text)]">{rail ? viewTitle(rail, viewer, selection, people) : "Activity"}</h2>
            <p className="text-mono-sm text-[var(--color-text-3)]" aria-live="polite">{matching} {matching === 1 ? "action" : "actions"} · {range}</p>
          </div>
          <DataTable
            columns={columns}
            data={ledgerQuery.data ?? []}
            getRowId={(entry) => entry.id}
            isLoading={peopleQuery.isLoading || ledgerQuery.isLoading}
            error={peopleQuery.error ?? ledgerQuery.error}
            onRetry={() => { void peopleQuery.refetch(); void ledgerQuery.refetch(); }}
            isRowSelectable={false}
            label="Activity logs"
            searchPlaceholder="Search the logs…"
            storageKey="activity-list"
            countLabel=""
            pagination
            pageSize={PAGE_SIZE}
            search={{ value: search, onChange: setSearch }}
            page={{ index: params.page - 1, onChange: (index) => update({ page: index + 1 }), count: pageCount }}
            sort={{
              value: { id: params.sort, desc: params.dir === "desc" },
              onChange: (next) => update({ sort: (next?.id ?? "when") as typeof params.sort, dir: next?.desc === false ? "asc" : "desc" }),
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
            toolbarPlacement="outside"
            toolbarActions={
              <>
                <DateRangeFilter from={params.from} to={params.to} timeZone={firm.primaryTimezone} onChange={setDates} filters={filters} />
                <SearchableSelect className="w-40" aria-label="Filter by actor" searchPlaceholder="Find an actor…" value={params.type ?? params.person ?? "ALL"} options={actors} onValueChange={pickActor} />
                <SearchableSelect className="w-40" aria-label="Filter by candidate" searchPlaceholder="Find a candidate…" value={params.candidate ?? "ALL"} options={candidates} notice={candidatesNotice} onValueChange={(value) => update({ candidate: value === "ALL" ? undefined : value })} />
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
