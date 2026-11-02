import { describe, expect, it } from "vitest";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { CandidateInboxSchema } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { flattenInbox } from "./use-inbox";

const message = (id: string) => ({id, firmId:"firm", candidateId:"candidate", applicationId:null,
  fromName:"Recruiter", fromEmail:"r@example.test", subject:id, snippet:"", body:"", receivedAt:"2026-11-02T00:00:00Z",
  signal:null, impliedStatus:null, scheduledFor:null, isRead:true});
const page = (ids: string[], next: string | null) => CandidateInboxSchema.parse({firmId:"firm", connection:null, messages:ids.map(message), nextCursor:next});

describe("Inbox infinite pagination", () => {
  it("refetches loaded older pages using current cursors without replacing the cache with page one", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}});
    let changed = false;
    const observer = new InfiniteQueryObserver(client, {queryKey:queryKeys.inbox.byCandidate("firm", "candidate"),
      initialPageParam:null as string | null,
      queryFn: async ({pageParam}) => pageParam ? page(["older"], null) : page(changed ? ["new","recent"] : ["recent"], "older-cursor"),
      getNextPageParam: value => value.nextCursor ?? undefined, select:flattenInbox});
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    expect(observer.getCurrentResult().data?.messages.map(m => m.id)).toEqual(["recent","older"]);
    changed = true;
    await observer.refetch();
    expect(observer.getCurrentResult().data?.messages.map(m => m.id)).toEqual(["new","recent","older"]);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    unsubscribe(); client.clear();
  });
});
