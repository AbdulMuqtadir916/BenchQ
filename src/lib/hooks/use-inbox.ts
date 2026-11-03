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
const initialPages = (inbox: CandidateInbox): Pages => ({pages: [inbox], pageParams: [null]});

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
    refetchInterval: query => {
      const connection = query.state.data?.pages[0]?.connection;
      return ["QUEUED", "IMPORTING"].includes(connection?.syncState ?? "") ? 2_000 : connection?.status === "CONNECTED" ? 300_000 : false;
    }});
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
    onSuccess: () => {void cache.invalidateQueries({queryKey: queryKeys.ledger.all(firm)});}});
}

export function useSyncMailbox(candidateId: string) {
  const firm = useFirmId();
  const cache = useQueryClient();
  return useMutation({mutationFn: () => inboxApi.sync(firm, candidateId), onSuccess: () => {
    void cache.invalidateQueries({queryKey: queryKeys.inbox.byCandidate(firm, candidateId)});
    void cache.invalidateQueries({queryKey: queryKeys.ledger.all(firm)});
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
