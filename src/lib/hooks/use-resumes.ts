"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

/**
 * After a résumé write, refetch this firm's résumé queries, and its candidates too: a candidate's name, email, phone
 * and location are read from the active base's newest version (07 Q57), so an upload, a switch or a save can change
 * them, and the header, the list and ⌘K must show it at once (Abdul's PR 7 review, #2).
 */
function refreshAfterResumeWrite(client: QueryClient, firmId: string, freshCandidateId?: string) {
  // A save has just loaded its candidate's list into the cache (review #7): that one isn't loaded again.
  const fresh = freshCandidateId === undefined ? null : JSON.stringify(queryKeys.resumes.byCandidate(firmId, freshCandidateId));
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.resumes.all(firmId), predicate: (query) => JSON.stringify(query.queryKey) !== fresh }),
    client.invalidateQueries({ queryKey: queryKeys.candidates.all(firmId) }),
    client.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) }),
  ]);
}

/** Every write changes what the lists show. */
function useResumeWrite<V, R>(write: (firmId: string, vars: V) => Promise<R>) {
  const firmId = useFirmId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => write(firmId, vars),
    onSettled: () => refreshAfterResumeWrite(client, firmId),
  });
}

/**
 * Save the studio's edit as the next version; the new version's text is cached, so the studio opens it at once. The
 * candidate's list is loaded once, into its query (review #7): a save is the save, that list, and the candidates (#2).
 */
export function useSaveResume() {
  const firmId = useFirmId();
  const client = useQueryClient();
  const loadShelf = (candidateId: string) => client.fetchQuery({
    queryKey: queryKeys.resumes.byCandidate(firmId, candidateId),
    queryFn: () => resumesApi.shelfByCandidate(firmId, candidateId),
    staleTime: 0,
  });
  return useMutation({
    mutationFn: async ({ versionId, doc }: { versionId: string; doc: ResumeDocument }) => {
      let listLoadedFor: string | undefined;          // set only when the list was loaded (the mock path doesn't)
      const result = await resumesApi.save(firmId, versionId, doc, (candidateId) => {
        listLoadedFor = candidateId;
        return loadShelf(candidateId);
      });
      return { ...result, listLoadedFor };
    },
    onSuccess: (result) => client.setQueryData(queryKeys.resumes.detail(firmId, result.opened.versionId), result.opened),
    onSettled: (result) => refreshAfterResumeWrite(client, firmId, result?.listLoadedFor),
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
