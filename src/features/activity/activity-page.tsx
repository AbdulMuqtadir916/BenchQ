"use client";

import { useEffect, useMemo } from "react";
import { PageHeader } from "@/components/app/page-header";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LedgerFilters } from "@/lib/api/analytics";
import { hasOwnScope, hasTeamScope } from "@/lib/auth/permissions";
import { useLedger, useLedgerCandidates, useLedgerPeople } from "@/lib/hooks/use-ledger";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";
import { activityColumns } from "./activity-columns";
import { ActivityRail } from "./activity-rail";
import { ActivityTable, PAGE_SIZE, useEscapeBack } from "./activity-table";
import { DateRangeFilter, rangeLabel, type DateRange } from "./date-range-filter";
import { actorOptions, backStep, buildRail, resolveSelection, viewSubtitle, viewTitle, type Selection, type Viewer } from "./rail";
import { useActivityParams } from "./use-activity-params";

export function ActivityPage() {
  const principal = useSignedInPrincipal();
  const firm = useFirm();
  const [params, update] = useActivityParams();
  const viewer: Viewer = useMemo(() => ({
    userId: principal.userId,
    scope: hasOwnScope(principal) ? "own" : hasTeamScope(principal) ? "team" : "firm",
  }), [principal]);

  const viewFilters: LedgerFilters = { candidateId: params.candidate, actorType: params.type, fromDate: params.from, toDate: params.to, q: params.q };
  const filters: LedgerFilters = { ...viewFilters, actorId: params.person, teamId: params.team };
  const peopleQuery = useLedgerPeople(filters);
  const people = useMemo(() => peopleQuery.data?.people ?? [], [peopleQuery.data]);
  const isReady = peopleQuery.data !== undefined;
  const selection = useMemo(() => (isReady ? resolveSelection(people, viewer, params) : {}), [isReady, people, viewer, params]);
  const isOutOfReach = isReady && (selection.team !== params.team || selection.person !== params.person);

  // A URL naming someone outside the reader's view falls back to their own root.
  useEffect(() => {
    if (isOutOfReach) update({ team: selection.team, person: selection.person });
  }, [isOutOfReach, selection, update]);

  const ledgerQuery = useLedger(
    { ...filters, limit: PAGE_SIZE, offset: (params.page - 1) * PAGE_SIZE, sort: params.sort, dir: params.dir },
    { isEnabled: isReady && !isOutOfReach },
  );
  const candidatesQuery = useLedgerCandidates({ ...viewFilters, candidateId: undefined, actorId: params.person, teamId: params.team });

  const rail = useMemo(() => (isReady ? buildRail(people, viewer, selection, peopleQuery.data?.total ?? 0) : null), [isReady, people, viewer, selection, peopleQuery.data]);
  const back = rail ? backStep(rail, viewer, selection) : null;
  const columns = useMemo(() => activityColumns(Boolean(params.from)), [params.from]);
  const actors = useMemo(() => actorOptions(people, viewer, peopleQuery.data?.actorTypes ?? []), [people, viewer, peopleQuery.data]);
  const candidates = useMemo(() => [{ value: "ALL", label: "All candidates" }, ...(candidatesQuery.data ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))], [candidatesQuery.data]);

  const select = (next: Selection) => update({ team: next.team, person: next.person });
  const setDates = ({ from, to }: DateRange) => update({ from, to });
  const pickActor = (value: string) => {
    if (value === "ALL") update({ type: undefined, person: undefined });
    else if (value === "SYSTEM") update({ type: "SYSTEM", person: undefined, team: undefined });
    else if (value === "AGENT") update({ type: "AGENT" });
    else update({ person: value, team: undefined, type: undefined });
  };

  useEscapeBack(back ? () => update({ team: back.to.team, person: back.to.person }) : null);

  const matching = peopleQuery.data?.matching ?? 0;
  const range = rangeLabel({ from: params.from, to: params.to });

  return (
    <div className="bq-page">
      <PageHeader title="Activity logs" subtitle={rail ? viewSubtitle(rail, viewer, selection, people) : undefined} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ActivityRail rail={rail} viewer={viewer} selection={selection} back={back} rangeLabel={range} isLoading={peopleQuery.isLoading} error={peopleQuery.error} onRetry={() => void peopleQuery.refetch()} onSelect={select} />
        <ActivityTable
          title={rail ? viewTitle(rail, viewer, selection, people) : "Activity"}
          countText={`${matching} ${matching === 1 ? "action" : "actions"} · ${range}`}
          columns={columns}
          entries={ledgerQuery.data ?? []}
          matching={matching}
          isUpdating={ledgerQuery.isPlaceholderData}
          isLoading={peopleQuery.isLoading || ledgerQuery.isLoading}
          error={peopleQuery.error ?? ledgerQuery.error}
          onRetry={() => { void peopleQuery.refetch(); void ledgerQuery.refetch(); }}
          params={params}
          update={update}
          toolbarActions={
            <>
              <DateRangeFilter from={params.from} to={params.to} timeZone={firm.primaryTimezone} onChange={setDates} filters={filters} />
              <SearchableSelect className="w-40" aria-label="Filter by actor" searchPlaceholder="Find an actor…" value={params.type ?? params.person ?? "ALL"} options={actors} onValueChange={pickActor} />
              <SearchableSelect className="w-40" aria-label="Filter by candidate" searchPlaceholder="Find a candidate…" value={params.candidate ?? "ALL"} options={candidates} onValueChange={(value) => update({ candidate: value === "ALL" ? undefined : value })} />
            </>
          }
        />
      </div>
    </div>
  );
}
