"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCandidate, UpdateCandidate } from "@/lib/schemas/candidate";
import { candidatesApi } from "@/lib/api/candidates";
import { queryKeys } from "@/lib/query/keys";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { candidateBlockReason } from "@/lib/derive/platform";
import { useFirm, useFirmId } from "@/lib/tenancy/firm-context";

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

/** Add a candidate (docs/04 §4.2). The new row leads the list; the ledger gets its CREATE. */
export function useCreateCandidate() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCandidate) => candidatesApi.create(firmId, body),
    onSuccess: (candidate) => {
      queryClient.setQueryData(queryKeys.candidates.detail(firmId, candidate.id), candidate);
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.lists(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}

/**
 * The over-limit block on New candidate (A4, docs/04 §0's second exception): null while the firm may
 * add one, else the reason to show beside the disabled control. Counts the whole firm's candidates (the
 * list is the firm's, whatever the viewer's scope), against the limit on the firm from the URL.
 */
export function useCandidateBlock(): { isPending: boolean; reason: string | null } {
  const firm = useFirm();
  const candidates = useCandidates();
  if (!candidates.data) return { isPending: candidates.isPending, reason: null };
  const capacity = candidateCapacity(firm, candidates.data);
  return { isPending: false, reason: capacity.canAddCandidate ? null : candidateBlockReason(capacity) };
}
