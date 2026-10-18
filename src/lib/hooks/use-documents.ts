"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/documents";
import type { CandidateDocument, UploadDocument } from "@/lib/schemas/document";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useCandidateDocuments(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.documents.byCandidate(firmId, candidateId), queryFn: () => documentsApi.byCandidate(firmId, candidateId), enabled: !!candidateId });
}

export function useUploadDocument(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UploadDocument) => documentsApi.upload(firmId, candidateId, body),
    onSuccess: (doc) => queryClient.setQueryData<CandidateDocument[]>(queryKeys.documents.byCandidate(firmId, candidateId), (list) => [doc, ...(list ?? [])]),
  });
}

export function useRemoveDocument(candidateId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const key = queryKeys.documents.byCandidate(firmId, candidateId);
  return useMutation({
    mutationFn: (id: string) => documentsApi.remove(firmId, id),
    onMutate: (id) => queryClient.setQueryData<CandidateDocument[]>(key, (list) => list?.filter((d) => d.id !== id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
