"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resumesApi } from "@/lib/api/resumes";
import type { ResumeShelf } from "@/lib/schemas/resume";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

const resumesOf = (shelf: ResumeShelf) => shelf.resumes;

/** Every base and résumé the principal sees (the Resume Builder library). */
export function useFirmResumeShelf() {
  const firmId = useFirmId();
  return useQuery({ queryKey: queryKeys.resumes.list(firmId), queryFn: () => resumesApi.shelf(firmId) });
}

/** One candidate's bases and résumés. */
export function useResumeShelf(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.byCandidate(firmId, candidateId),
    queryFn: () => resumesApi.shelfByCandidate(firmId, candidateId),
    enabled: !!candidateId,
  });
}

/** One candidate's résumés alone (the same cached request as `useResumeShelf`). */
export function useResumes(candidateId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.byCandidate(firmId, candidateId),
    queryFn: () => resumesApi.shelfByCandidate(firmId, candidateId),
    select: resumesOf,
    enabled: !!candidateId,
  });
}

/** One version with its text, for the studio. */
export function useOpenedResume(versionId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.detail(firmId, versionId),
    queryFn: () => resumesApi.open(firmId, versionId),
    enabled: !!versionId,
  });
}

/** Every write changes what the lists show: refetch all of this firm's résumé queries afterwards. */
function useResumeWrite<V, R>(write: (firmId: string, vars: V) => Promise<R>) {
  const firmId = useFirmId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => write(firmId, vars),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.resumes.all(firmId) }),
  });
}

/** Save the studio's edit as the next version; the new version's text is cached, so the studio opens it at once. */
export function useSaveResume() {
  const firmId = useFirmId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, doc }: { versionId: string; doc: ResumeDocument }) => resumesApi.save(firmId, versionId, doc),
    onSuccess: (result) => client.setQueryData(queryKeys.resumes.detail(firmId, result.opened.versionId), result.opened),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.resumes.all(firmId) }),
  });
}

export const useUseAsBase = () => useResumeWrite((f, v: { candidateId: string; versionId: string }) => resumesApi.useAsBase(f, v.candidateId, v.versionId));
export const useUploadResume = () => useResumeWrite((f, v: { candidateId: string; file: File }) => resumesApi.upload(f, v.candidateId, v.file));
export const useDeleteBase = () => useResumeWrite((f, v: { candidateId: string; baseId: string; keepUsed: boolean }) => resumesApi.deleteBase(f, v.candidateId, v.baseId, v.keepUsed));
export const useDeleteVersion = () => useResumeWrite((f, v: { candidateId: string; versionId: string }) => resumesApi.deleteVersion(f, v.candidateId, v.versionId));
export const useShowBase = () => useResumeWrite((f, v: { candidateId: string; baseId: string }) => resumesApi.showBase(f, v.candidateId, v.baseId));

/** The delete warning, read when the person asks to delete (not cached: it must be current). */
export function useRemovalPreview() {
  const firmId = useFirmId();
  return useMutation({
    mutationFn: (v: { candidateId: string; baseId: string } | { candidateId: string; versionId: string }) =>
      "baseId" in v ? resumesApi.baseRemoval(firmId, v.candidateId, v.baseId) : resumesApi.versionRemoval(firmId, v.candidateId, v.versionId),
  });
}
export { DuplicateUploadError } from "@/lib/api/resumes";
