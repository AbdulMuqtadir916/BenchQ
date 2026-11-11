"use client";

import { useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerQuery } from "@/lib/api/analytics";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** One page of the ledger (a count, a record's history): `params` carries `limit` and `offset`. */
export function useLedger(params?: LedgerQuery) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.list(firmId, params),
    queryFn: () => ledgerApi.list(firmId, params),
  });
}

/**
 * The whole ledger, for the screen that shows all of it (BUG-022): `data.items`, newest first, and `data.hasMore` when entries
 * remain beyond the cap (see `ledgerApi.listAll`).
 */
export function useLedgerAll(params?: Omit<LedgerQuery, "limit" | "offset">) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.whole(firmId, params),
    queryFn: () => ledgerApi.listAll(firmId, params),
  });
}
