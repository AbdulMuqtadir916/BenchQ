"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api/inbox";
import { loadInboxPage, MAX_RESTORE_PAGES } from "./inbox-pages";
import type { CandidateInbox } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

type Pages = InfiniteData<CandidateInbox, string | null>;
export function flattenInbox(data: Pages): CandidateInbox {
  const first = data.pages[0];
  const seen = new Set<string>();
  return {...first, nextCursor: data.pages.at(-1)?.nextCursor ?? null,
    messages: data.pages.flatMap(page => page.messages).filter(message => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })};
}
/** How often a candidate's inbox reloads: quickly while importing or while any email is still being classified, else slowly. */
export const IMPORT_POLL_MS = 2_000;
export const CLASSIFY_POLL_MS = 4_000;
export const IDLE_POLL_MS = 300_000;
export function inboxRefetchInterval(data: Pages | undefined): number | false {
  const connection = data?.pages[0]?.connection;
  if (["QUEUED", "IMPORTING"].includes(connection?.syncState ?? "")) return IMPORT_POLL_MS;
  const isClassifying = data?.pages.some(page => page.messages.some(message => ["PENDING", "PROCESSING"].includes(message.classificationState ?? "")));
  if (isClassifying) return CLASSIFY_POLL_MS;
  return connection?.status === "CONNECTED" ? IDLE_POLL_MS : false;
}
const initialPages = (inbox: CandidateInbox): Pages => ({pages: [inbox], pageParams: [null]});

/** The inbox's classifications at one moment: how many wait, each email's state and result, the newest arrival. */
export type ClassificationSnapshot = {classifying: number; newest: number; states: Map<string, {key: string; done: boolean; at: number}>};
export function classificationSnapshot(messages: CandidateInbox["messages"]): ClassificationSnapshot {
  const states = new Map(messages.map(message => [message.id, {key: `${message.classificationState ?? ""}:${message.classificationVersion ?? ""}`,
    done: message.classificationState === "DONE", at: Date.parse(message.receivedAt) || 0}]));
  return {states, newest: Math.max(0, ...[...states.values()].map(state => state.at)),
    classifying: messages.filter(message => ["PENDING", "PROCESSING"].includes(message.classificationState ?? "")).length};
}
/** Some classification finished since `previous`: an email seen unfinished (or with an older result) is DONE now, newer
 * mail arrived already DONE, or fewer emails wait (one gave up). Older mail loaded by "Load more" is not a change. */
export function classificationsFinished(previous: ClassificationSnapshot, next: ClassificationSnapshot): boolean {
  return next.classifying < previous.classifying || [...next.states].some(([id, state]) => state.done
    && (previous.states.has(id) ? previous.states.get(id)!.key !== state.key : state.at > previous.newest));
}

export function useCandidateInbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  const params = useSearchParams();
  const refreshCycles = useRef(new WeakMap<AbortSignal, boolean>());
  const desiredPages = z.coerce.number().int().min(1).catch(1).transform(value => Math.min(value, MAX_RESTORE_PAGES)).parse(params.get("inbox_pages") ?? 1);
  const query = useInfiniteQuery({queryKey: queryKeys.inbox.byCandidate(firm, candidateId),
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) => loadInboxPage(pageParam, cache.getQueryData<Pages>(queryKeys.inbox.byCandidate(firm, candidateId)), async cursor => {
      signal.throwIfAborted();
      const page = await inboxApi.byCandidate(firm, candidateId, undefined, cursor);
      signal.throwIfAborted();
      return page;
    }, {signal, cycles: refreshCycles.current}),
    getNextPageParam: page => page.nextCursor ?? undefined, select: flattenInbox, enabled: !!candidateId,
    refetchInterval: query => inboxRefetchInterval(query.state.data)});
  // When emails finish classifying, a review (and possibly an automatic status change) was created on the server:
  // reload the review list and the applications at that moment, not only on the next page load.
  const messages = query.data?.messages;
  const lastSeen = useRef<ClassificationSnapshot | null>(null);
  useEffect(() => {
    if (!messages) return;
    const next = classificationSnapshot(messages);
    if (lastSeen.current && classificationsFinished(lastSeen.current, next)) {
      void cache.invalidateQueries({queryKey: queryKeys.inbox.reviews(firm, candidateId)});
      void cache.invalidateQueries({queryKey: queryKeys.applications.all(firm)});
    }
    lastSeen.current = next;
  }, [messages, cache, firm, candidateId]);
  const forbidden = query.error && "status" in query.error && [403, 404].includes(Number(query.error.status));
  useEffect(() => {
    if (forbidden) cache.removeQueries({queryKey: queryKeys.inbox.body(firm, candidateId)});
  }, [forbidden, cache, firm, candidateId]);
  const loadedPageCount = cache.getQueryData<Pages>(queryKeys.inbox.byCandidate(firm, candidateId))?.pages.length ?? 0;
  const {fetchNextPage, hasNextPage, isFetching, isFetchNextPageError} = query;
  useEffect(() => {
    if (!forbidden && hasNextPage && !isFetching && !isFetchNextPageError && loadedPageCount < desiredPages) void fetchNextPage();
  }, [forbidden, hasNextPage, isFetching, isFetchNextPageError, loadedPageCount, desiredPages, fetchNextPage]);
  return {...query, loadedPageCount, data: forbidden ? undefined : query.data};
}

export function useConnectMailbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: (returnTo: string) => inboxApi.connect(firm, candidateId, returnTo),
    onSuccess: inbox => {if (typeof inbox !== "string") cache.setQueryData(queryKeys.inbox.byCandidate(firm, candidateId), initialPages(inbox));}});
}

export function useDisconnectMailbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: () => inboxApi.disconnect(firm, candidateId),
    onSuccess: inbox => {
      cache.setQueryData<Pages>(queryKeys.inbox.byCandidate(firm, candidateId), old => old ? {...old,
        pages: old.pages.map(page => ({...page, connection: inbox.connection}))} : initialPages(inbox));
      void cache.invalidateQueries({queryKey: queryKeys.ledger.all(firm)});
    }});
}

export function useMarkRead(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  const key = queryKeys.inbox.byCandidate(firm, candidateId);
  const setRead = (id: string, isRead: boolean) => cache.setQueryData<Pages>(key, old => old ? {...old,
    pages: old.pages.map(page => ({...page, messages: page.messages.map(m => m.id === id ? {...m, isRead} : m)}))} : old);
  return useMutation({mutationFn: (id: string) => inboxApi.markRead(firm, candidateId, id),
    onMutate: async id => {
      await cache.cancelQueries({queryKey: key});
      const wasRead = cache.getQueryData<Pages>(key)?.pages.flatMap(p => p.messages).find(m => m.id === id)?.isRead;
      setRead(id, true);
      return {wasRead};
    },
    onError: (_error, id, context) => {if (context?.wasRead !== undefined) setRead(id, context.wasRead);},
  });
}

export function useSyncMailbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: () => inboxApi.sync(firm, candidateId), onSuccess: () => {
    void cache.invalidateQueries({queryKey: queryKeys.inbox.byCandidate(firm, candidateId)});
  }});
}

export function useMailboxConfirmation(candidateId: string, attempt: string | null) {
  const firm = useFirmId();
  const cache = useQueryClient();
  const details = useQuery({queryKey: queryKeys.inbox.confirmation(firm, candidateId, attempt), enabled: !!attempt,
    retry: false, queryFn: () => inboxApi.confirmation(firm, candidateId, attempt!)});
  const confirm = useMutation({mutationFn: () => inboxApi.confirm(firm, candidateId, attempt!),
    onSuccess: inbox => cache.setQueryData(queryKeys.inbox.byCandidate(firm, candidateId), initialPages(inbox))});
  const cancel = useMutation({mutationFn: () => inboxApi.cancelConfirmation(firm, candidateId, attempt!),
    onSuccess: () => {cache.removeQueries({queryKey: queryKeys.inbox.confirmation(firm, candidateId, attempt)});}});
  return {details, confirm, cancel};
}

export function useInboxBody(candidateId: string, messageId: string | null) {
  const firm = useFirmId();
  return useQuery({queryKey: queryKeys.inbox.body(firm, candidateId, messageId), enabled: !!messageId,
    queryFn: async () => (await inboxApi.byCandidate(firm, candidateId, messageId!)).messages.find(m => m.id === messageId)});
}

export function useDeleteInboxContent(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({onError: () => {void cache.invalidateQueries({queryKey: queryKeys.inbox.byCandidate(firm, candidateId)});},
    mutationFn: ({message, disconnect}: {message?: string; disconnect: boolean}) => inboxApi.deleteContent(firm, candidateId, message, disconnect),
    onMutate: async () => {
      await cache.cancelQueries({queryKey: queryKeys.inbox.byCandidate(firm, candidateId)});
      await cache.cancelQueries({queryKey: queryKeys.inbox.body(firm, candidateId)});
    },
    onSuccess: inbox => {
      cache.setQueryData(queryKeys.inbox.byCandidate(firm, candidateId), initialPages(inbox));
      cache.removeQueries({queryKey: queryKeys.inbox.body(firm, candidateId)});
      void cache.invalidateQueries({queryKey: queryKeys.ledger.all(firm)});
    }});
}
