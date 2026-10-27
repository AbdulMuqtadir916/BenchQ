"use client";

import { useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerQuery } from "@/lib/api/analytics";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useLedger(params?: LedgerQuery) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.list(firmId, params),
    queryFn: () => ledgerApi.list(firmId, params),
  });
}
