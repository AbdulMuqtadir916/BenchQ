"use client";

import { useQuery } from "@tanstack/react-query";
import { recordsApi } from "@/lib/api/records";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useRecord(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.records.byCandidate(firmId, candidateId),
    queryFn: () => recordsApi.byCandidate(firmId, candidateId),
    enabled: !!candidateId,
  });
}
