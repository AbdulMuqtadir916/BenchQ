"use client";

import { useQuery } from "@tanstack/react-query";
import { ledgerApi } from "@/lib/api/analytics";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/stores/session-store";

export function useLedger(params?: { limit?: number; offset?: number }) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.ledger.list(firmId, params),
    queryFn: () => ledgerApi.list(firmId, params),
  });
}
