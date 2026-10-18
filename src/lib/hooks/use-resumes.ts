"use client";

import { useQuery } from "@tanstack/react-query";
import { resumesApi } from "@/lib/api/resumes";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useAllResumes() {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.resumes.list(firmId), queryFn: () => resumesApi.list(firmId) });
}

export function useResumes(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.byCandidate(firmId, candidateId),
    queryFn: () => resumesApi.byCandidate(firmId, candidateId),
    enabled: !!candidateId,
  });
}

export function useResume(id: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.detail(firmId, id),
    queryFn: () => resumesApi.byId(firmId, id),
    enabled: !!id,
  });
}
