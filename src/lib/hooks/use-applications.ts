"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationsApi, followupsApi, type SaveJob } from "@/lib/api/applications";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useApplications(candidateId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.list(firmId, { candidateId }),
    queryFn: () => applicationsApi.list(firmId, candidateId ? { candidateId } : undefined),
  });
}

export function useApplication(id: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.detail(firmId, id),
    queryFn: () => applicationsApi.byId(firmId, id),
    enabled: !!id,
  });
}

export function useFollowups(userId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.followups.list(firmId, { userId }),
    queryFn: () => followupsApi.list(firmId, userId ? { userId } : undefined),
  });
}

export type MoveVariables = { id: string; status: ApplicationStatus; note: string | null };

/** Applications with a move in flight, as `firmId:applicationId`. Module-level: every screen shares it (DEBUG D-06). */
const movesInFlight = new Set<string>();

/** Every cached copy of one application (lists and detail), or undefined. */
function cachedApplication(queryClient: ReturnType<typeof useQueryClient>, firmId: string, id: string): Application | undefined {
  const detail = queryClient.getQueryData<Application>(queryKeys.applications.detail(firmId, id));
  if (detail) return detail;
  for (const [, list] of queryClient.getQueriesData<Application[]>({ queryKey: queryKeys.applications.lists(firmId) })) {
    const found = list?.find((a) => a.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Move an application to a new stage (DEBUG D-06).
 * - One move per application at a time: a second move is refused (returns false) until the first settles.
 * - The cache only ever holds server data: the move's target is shown from the pending mutation (`usePendingMoves`),
 *   so there is nothing to roll back and no refetch can overwrite a pending change.
 * - The revision sent is the server-confirmed one in the cache when the request starts.
 */
export function useUpdateApplicationStatus() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: queryKeys.applications.moves(firmId),
    mutationFn: ({ id, status, note }: MoveVariables) =>
      applicationsApi.updateStatus(firmId, id, { status, note, expectedRevision: cachedApplication(queryClient, firmId, id)?.statusRevision }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.applications.detail(firmId, saved.id), saved);
      queryClient.setQueriesData<Application[]>({ queryKey: queryKeys.applications.lists(firmId) },
        (list) => list?.map((a) => (a.id === saved.id ? saved : a)));
    },
    onSettled: (_data, _error, variables) => {
      movesInFlight.delete(`${firmId}:${variables.id}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
    },
  });
  const move = useCallback((variables: MoveVariables): boolean => {
    const key = `${firmId}:${variables.id}`;
    if (movesInFlight.has(key)) return false;
    movesInFlight.add(key);
    try {
      mutation.mutate(variables);
    } catch (error) {
      movesInFlight.delete(key);
      throw error;
    }
    return true;
  }, [firmId, mutation]);
  return { ...mutation, mutate: move, isMoving: (id: string) => movesInFlight.has(`${firmId}:${id}`) };
}

/** Target status of every move still in flight in this firm, by application id. */
export function usePendingMoves(): Map<string, ApplicationStatus> {
  const firmId = useFirmId();
  const pending = useMutationState({
    filters: { mutationKey: queryKeys.applications.moves(firmId), status: "pending" },
    select: (m) => m.state.variables as MoveVariables | undefined,
  });
  return useMemo(() => new Map(pending.filter((v): v is MoveVariables => !!v).map((v) => [v.id, v.status])), [pending]);
}

/** Applications as the screen should show them: a pending move's target replaces the server status until it settles. */
export function useWithPendingMoves(applications: Application[]): { applications: Application[]; saving: Set<string> } {
  const pending = usePendingMoves();
  return useMemo(() => ({
    applications: pending.size ? applications.map((a) => (pending.has(a.id) ? { ...a, status: pending.get(a.id)! } : a)) : applications,
    saving: new Set(pending.keys()),
  }), [applications, pending]);
}

/** Server counts per status for the board's column headers and counters (DEBUG D-20). */
export function useApplicationCounts(candidateId?: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.applications.counts(firmId, candidateId),
    queryFn: () => applicationsApi.counts(firmId, candidateId ? { candidateId } : undefined),
  });
}

/** Undo the latest automatic change of an application. The same click reuses its command id, so a retry is safe. */
export function useUndoAutomaticChange() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ applicationId, eventId, expectedRevision, commandId }: { applicationId: string; eventId: string; expectedRevision: number; commandId: string }) =>
      applicationsApi.undoAutomatic(firmId, applicationId, eventId, expectedRevision, commandId),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.applications.detail(firmId, saved.id), saved);
      queryClient.setQueriesData<Application[]>({ queryKey: queryKeys.applications.lists(firmId) },
        (list) => list?.map((a) => (a.id === saved.id ? saved : a)));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) }),
  });
}

/**
 * Save a feed job for a candidate, or remove it again (the heart and "Open source" in the job explorer). The job
 * becomes a Saved application and stays in the feed. One call per candidate and job at a time; the applications
 * and the ledger reload afterwards so the Saved column and the counts show it at once.
 */
export function useToggleSavedJob() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation<void, Error, { save: SaveJob } | { unsave: { applicationId: string; jobId: string; candidateId: string } }>({
    mutationKey: queryKeys.applications.savedJobs(firmId),
    mutationFn: (vars) => ("save" in vars ? applicationsApi.saveJob(firmId, vars.save) : applicationsApi.unsaveJob(firmId, vars.unsave.applicationId)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all(firmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}

/** Candidate+job pairs with a save or unsave in flight, so the heart shows the coming state and ignores repeats. */
export function usePendingSavedJobs(): Map<string, boolean> {
  const firmId = useFirmId();
  const pending = useMutationState({
    filters: { mutationKey: queryKeys.applications.savedJobs(firmId), status: "pending" },
    select: (mutation) => mutation.state.variables as { save: SaveJob } | { unsave: { jobId: string; candidateId: string } } | undefined,
  });
  return useMemo(() => {
    const map = new Map<string, boolean>();
    for (const vars of pending) {
      if (!vars) continue;
      if ("save" in vars) map.set(savedJobKey(vars.save.candidateId, vars.save.jobId), true);
      else map.set(savedJobKey(vars.unsave.candidateId, vars.unsave.jobId), false);
    }
    return map;
  }, [pending]);
}

export const savedJobKey = (candidateId: string, jobId: string) => `${candidateId}|${jobId}`;
