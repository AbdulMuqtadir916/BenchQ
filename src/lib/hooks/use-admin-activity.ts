"use client";

import { keepPreviousData, useQuery, type Query } from "@tanstack/react-query";
import type { LedgerFilters, LedgerQuery } from "@/lib/api/analytics";
import { platformApi, type ActivityView } from "@/lib/api/platform";
import { queryKeys } from "@/lib/query/keys";

/** The Super Admin's activity log (backend/api/routes_admin_activity.py). */
const k = queryKeys.platform.activity;

export const useAdminActivity = (view: ActivityView, params: LedgerQuery, options: { isEnabled: boolean }) =>
  useQuery({ queryKey: k("list", view, params), queryFn: () => platformApi.activity.list(view, params), enabled: options.isEnabled, placeholderData: keepPreviousData });

export const useAdminActivityOverview = (view: ActivityView, filters: LedgerFilters) =>
  useQuery({ queryKey: k("overview", view, filters), queryFn: () => platformApi.activity.overview(view, filters), placeholderData: keepPreviousData });

/** Which firm and which view a query's answer belongs to: the key is `[platform, activity, part, firm or view, filters]`. */
function scopeOf(scope: unknown): string {
  const view: ActivityView = typeof scope === "object" && scope !== null ? (scope as ActivityView) : { firmId: scope as string | undefined };
  return `${view.firmId ?? ""}|${view.isFailed ? "failed" : "all"}`;
}

/** Keep the last answer while the next loads, but only within the same firm and view: another firm's people or
 *  candidates, or the whole platform's while failed sign-ins load, would be picked into this one's filters. */
export function sameScopeOnly<T>(view: ActivityView) {
  return (previous: T | undefined, previousQuery: Query<T, Error, T, readonly unknown[]> | undefined) =>
    previousQuery !== undefined && scopeOf(previousQuery.queryKey[3]) === scopeOf(view) ? previous : undefined;
}

export const useAdminActivityPeople = (firmId: string | undefined, filters: LedgerFilters) =>
  useQuery({ queryKey: k("people", firmId, filters), queryFn: () => platformApi.activity.people(firmId as string, filters), enabled: firmId !== undefined, placeholderData: sameScopeOnly({ firmId }) });

export const useAdminActivityCandidates = (view: ActivityView, filters: LedgerFilters) =>
  useQuery({ queryKey: k("candidates", view, filters), queryFn: () => platformApi.activity.candidates(view, filters), placeholderData: sameScopeOnly(view) });

/** One failed sign-in's IP, fetched only when the Super Admin asks for it. */
export const useSignInIp = (entryId: string, options: { isEnabled: boolean }) =>
  useQuery({ queryKey: k("ip", entryId), queryFn: () => platformApi.activity.ip(entryId), enabled: options.isEnabled, staleTime: Infinity });
