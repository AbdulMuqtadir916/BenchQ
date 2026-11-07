"use client";

import { useEffect, useMemo } from "react";
import { PageHeader } from "@/components/app/page-header";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { activityColumns } from "@/features/activity/activity-columns";
import { ActivityRail } from "@/features/activity/activity-rail";
import { ActivityTable, PAGE_SIZE, useEscapeBack } from "@/features/activity/activity-table";
import { DateRangeFilter, rangeLabel, type DateRange } from "@/features/activity/date-range-filter";
import { actorOptions, backStep, buildRail, resolveSelection, viewTitle, type Selection, type Viewer } from "@/features/activity/rail";
import { useActivityParams } from "@/features/activity/use-activity-params";
import type { LedgerFilters } from "@/lib/api/analytics";
import { platformApi, type ActivityView } from "@/lib/api/platform";
import { useAdminActivity, useAdminActivityCandidates, useAdminActivityOverview, useAdminActivityPeople } from "@/lib/hooks/use-admin-activity";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { PlatformRail, type PlatformPick } from "./platform-rail";
import { SignInIpButton } from "./sign-in-ip-button";

const IST = "Asia/Kolkata";
const IMMUTABLE = "Entries can't be edited or deleted.";
/** Inside a firm the Super Admin reads as its owner does, but isn't one of its people. */
const FIRM_READER: Viewer = { userId: "", scope: "firm" };
const ALL_FIRMS: Selection = {};

const isSignInFailure = (entry: LedgerEntry) => entry.action === "SIGN_IN_FAILED" || entry.action === "LOCKED_OUT";
const signInIp = (entry: LedgerEntry) => (isSignInFailure(entry) ? <SignInIpButton entryId={entry.id} /> : null);

/** /admin/audit: everything on the platform and in every firm, read-only (07 A13). Days are IST (docs/04 §14). */
export function AdminActivityPage() {
  const [params, update] = useActivityParams();
  const isFailed = params.view === "failed";
  const view: ActivityView = useMemo(() => ({ firmId: params.firm, isFailed }), [params.firm, isFailed]);
  const viewFilters: LedgerFilters = { candidateId: params.candidate, actorType: params.type, fromDate: params.from, toDate: params.to, q: params.q };
  const filters: LedgerFilters = { ...viewFilters, actorId: params.person, teamId: params.team };

  const overviewQuery = useAdminActivityOverview(view, filters);
  const peopleQuery = useAdminActivityPeople(params.firm, filters);
  const people = useMemo(() => peopleQuery.data?.people ?? [], [peopleQuery.data]);
  const overview = overviewQuery.data;
  const firm = overview?.firms.find((row) => row.id === params.firm);
  const isUnknownFirm = overview !== undefined && params.firm !== undefined && firm === undefined;

  // A link naming a firm that doesn't exist falls back to the whole platform.
  useEffect(() => {
    if (isUnknownFirm) update({ firm: undefined });
  }, [isUnknownFirm, update]);

  const selection = useMemo(() => (peopleQuery.data ? resolveSelection(people, FIRM_READER, params) : {}), [peopleQuery.data, people, params]);
  const rail = useMemo(() => (params.firm && peopleQuery.data ? buildRail(people, FIRM_READER, selection, peopleQuery.data.total) : null), [params.firm, peopleQuery.data, people, selection]);
  const firmBack = rail ? backStep(rail, FIRM_READER, selection) ?? { label: "All firms", to: ALL_FIRMS } : null;
  const selectInFirm = (next: Selection) => (next === ALL_FIRMS ? update({ firm: undefined, team: undefined, person: undefined }) : update({ team: next.team, person: next.person }));
  useEscapeBack(firmBack ? () => selectInFirm(firmBack.to) : isFailed || params.person ? () => update({ view: undefined, person: undefined }) : null);

  const ledgerQuery = useAdminActivity(view, { ...filters, limit: PAGE_SIZE, offset: (params.page - 1) * PAGE_SIZE, sort: params.sort, dir: params.dir }, { isEnabled: !isUnknownFirm });
  const candidatesQuery = useAdminActivityCandidates(view, { ...viewFilters, candidateId: undefined, actorId: params.person, teamId: params.team });

  const columns = useMemo(() => activityColumns(Boolean(params.from), { hasFirm: !params.firm, hasNoCandidate: isFailed, summaryAction: signInIp }), [params.from, params.firm, isFailed]);
  const actors = useMemo(() => actorOptions(people, FIRM_READER, overview?.actorTypes ?? []), [people, overview]);
  const candidates = useMemo(() => [{ value: "ALL", label: "All candidates" }, ...(candidatesQuery.data ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))], [candidatesQuery.data]);

  const useDays = (dayFilters: LedgerFilters, options: { isEnabled: boolean }) =>
    useQuery({ queryKey: queryKeys.platform.activity("days", view, dayFilters), queryFn: () => platformApi.activity.days(view, dayFilters), enabled: options.isEnabled });

  const pick = (next: PlatformPick) => update({
    firm: next.kind === "firm" ? next.firmId : undefined,
    view: next.kind === "failed" ? "failed" : undefined,
    person: next.kind === "me" ? overview?.me.userId : undefined,
    team: undefined,
    candidate: undefined,
    type: undefined,
  });
  const pickActor = (value: string) => {
    if (value === "ALL") update({ type: undefined, person: undefined });
    else if (value === "SYSTEM" || value === "AGENT") update({ type: value, person: undefined, team: undefined });
    else update({ person: value, team: undefined, type: undefined });
  };

  const picked: PlatformPick["kind"] = isFailed ? "failed" : params.person && params.person === overview?.me.userId ? "me" : "all";
  const matching = overview?.matching ?? 0;
  const range = rangeLabel({ from: params.from, to: params.to });
  const title = isFailed ? "Failed sign-ins" : firm && rail ? `${firm.name}: ${viewTitle(rail, FIRM_READER, selection, people)}` : picked === "me" ? "Your actions" : "Whole platform activity";
  const subtitle = isFailed ? `Every failed sign-in and lockout, in every firm. Only a Super Admin sees these. ${IMMUTABLE}` : `Everything that happened on the platform and in every firm. ${IMMUTABLE}`;
  const noun = isFailed ? (matching === 1 ? "entry" : "entries") : matching === 1 ? "action" : "actions";

  return (
    <div className="bq-page">
      <PageHeader title="Activity logs" subtitle={subtitle} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {params.firm ? (
          <ActivityRail rail={rail} viewer={FIRM_READER} selection={selection} back={firmBack} rangeLabel={range} isLoading={peopleQuery.isLoading} error={peopleQuery.error} onRetry={() => void peopleQuery.refetch()} onSelect={selectInFirm} />
        ) : (
          <PlatformRail overview={overview} picked={picked} rangeLabel={range} isLoading={overviewQuery.isLoading} error={overviewQuery.error} onRetry={() => void overviewQuery.refetch()} onPick={pick} />
        )}
        <ActivityTable
          title={title}
          countText={`${matching} ${noun} · ${range}`}
          columns={columns}
          entries={ledgerQuery.data ?? []}
          matching={matching}
          isUpdating={ledgerQuery.isPlaceholderData}
          isLoading={overviewQuery.isLoading || ledgerQuery.isLoading}
          error={overviewQuery.error ?? ledgerQuery.error}
          onRetry={() => { void overviewQuery.refetch(); void ledgerQuery.refetch(); }}
          params={params}
          update={update}
          toolbarActions={
            <>
              <DateRangeFilter from={params.from} to={params.to} timeZone={overview?.timezone ?? IST} onChange={({ from, to }: DateRange) => update({ from, to })} filters={filters} useDays={useDays} />
              <SearchableSelect className="w-40" aria-label="Filter by actor" searchPlaceholder="Find an actor…" value={params.type ?? params.person ?? "ALL"} options={actors} onValueChange={pickActor} />
              <SearchableSelect className="w-40" aria-label="Filter by candidate" searchPlaceholder="Find a candidate…" value={params.candidate ?? "ALL"} options={candidates} onValueChange={(value) => update({ candidate: value === "ALL" ? undefined : value })} />
            </>
          }
        />
      </div>
    </div>
  );
}
