"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCandidate, ReassignCandidate, UpdateCandidate } from "@/lib/schemas/candidate";
import { candidatesApi } from "@/lib/api/candidates";
import { queryKeys } from "@/lib/query/keys";
import { candidateCapacity } from "@/lib/derive/tenancy";
import { assignBlockReason } from "@/lib/derive/platform";
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

/** Reassign a candidate (07 Q43). The lists, the dashboards' cards and the ledger all move with it. */
export function useReassignCandidate(id: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReassignCandidate) => candidatesApi.reassign(firmId, id, body),
    onSuccess: (candidate) => {
      queryClient.setQueryData(queryKeys.candidates.detail(firmId, id), candidate);
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.lists(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}

/**
 * The block on assigning a BDE at the candidate limit (07 Q45, A4, docs/04 §0's second exception): null while the firm
 * may assign one more, else the reason to show beside the disabled control. Creating a candidate for a manager's queue
 * is never blocked. Counts the whole firm's candidates against the limit on the firm from the URL. (A MANAGER's list is
 * their team's, so on live data the backend's count is the one that decides.)
 */
export function useAssignBlock(): { isPending: boolean; reason: string | null } {
  const firm = useFirm();
  const candidates = useCandidates();
  if (!candidates.data) return { isPending: candidates.isPending, reason: null };
  const capacity = candidateCapacity(firm, candidates.data);
  return { isPending: false, reason: capacity.canAssignCandidate ? null : assignBlockReason(capacity) };
}
