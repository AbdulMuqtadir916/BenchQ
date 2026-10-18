"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateCandidate } from "@/lib/schemas/candidate";
import { candidatesApi } from "@/lib/api/candidates";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/stores/session-store";

export function useCandidates() {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.candidates.list(firmId),
    queryFn: () => candidatesApi.list(firmId),
  });
}

export function useCandidate(id: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.candidates.detail(firmId, id),
    queryFn: () => candidatesApi.byId(firmId, id),
    enabled: !!id,
  });
}

export function useUpdateCandidate(id: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCandidate) => candidatesApi.update(firmId, id, patch),
    onSuccess: (candidate) => {
      queryClient.setQueryData(queryKeys.candidates.detail(firmId, id), candidate);
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.list(firmId) });
    },
  });
}
