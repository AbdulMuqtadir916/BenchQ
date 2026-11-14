"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LedgerFilters, LedgerQuery } from "@/lib/api/analytics";
import { platformApi, type ActivityView } from "@/lib/api/platform";
import { queryKeys } from "@/lib/query/keys";

/** The Super Admin's activity log (backend/api/routes_admin_activity.py). */
const k = queryKeys.platform.activity;

export const useAdminActivity = (view: ActivityView, params: LedgerQuery, options: { isEnabled: boolean }) =>
  useQuery({ queryKey: k("list", view, params), queryFn: () => platformApi.activity.list(view, params), enabled: options.isEnabled, placeholderData: keepPreviousData });

export const useAdminActivityOverview = (view: ActivityView, filters: LedgerFilters) =>
  useQuery({ queryKey: k("overview", view, filters), queryFn: () => platformApi.activity.overview(view, filters), placeholderData: keepPreviousData });

export const useAdminActivityPeople = (firmId: string | undefined, filters: LedgerFilters) =>
  useQuery({ queryKey: k("people", firmId, filters), queryFn: () => platformApi.activity.people(firmId as string, filters), enabled: firmId !== undefined, placeholderData: keepPreviousData });

export const useAdminActivityCandidates = (view: ActivityView, filters: LedgerFilters) =>
  useQuery({ queryKey: k("candidates", view, filters), queryFn: () => platformApi.activity.candidates(view, filters), placeholderData: keepPreviousData });

/** One failed sign-in's IP, fetched only when the Super Admin asks for it. */
export const useSignInIp = (entryId: string, options: { isEnabled: boolean }) =>
  useQuery({ queryKey: k("ip", entryId), queryFn: () => platformApi.activity.ip(entryId), enabled: options.isEnabled, staleTime: Infinity });
