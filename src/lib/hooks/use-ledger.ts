"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerFilters, type LedgerQuery } from "@/lib/api/analytics";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useLedger(params?: LedgerQuery, options?: { isEnabled?: boolean }) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.list(firmId, params),
    queryFn: () => ledgerApi.list(firmId, params),
    enabled: options?.isEnabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/** Who the reader can see in the log, with their counts. */
export function useLedgerPeople(filters?: LedgerFilters) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.people(firmId, filters),
    queryFn: () => ledgerApi.people(firmId, filters),
    placeholderData: keepPreviousData,
  });
}

/** The candidates the reader can pick in the log. */
export function useLedgerCandidates(filters?: LedgerFilters) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.candidates(firmId, filters),
    queryFn: () => ledgerApi.candidates(firmId, filters),
    placeholderData: keepPreviousData,
  });
}

/** The days with activity in a month, for the calendar's dots. */
export function useLedgerDays(filters: LedgerFilters, options: { isEnabled: boolean }) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.days(firmId, filters),
    queryFn: () => ledgerApi.days(firmId, filters),
    enabled: options.isEnabled,
  });
}
