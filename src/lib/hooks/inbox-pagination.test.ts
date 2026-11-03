import { describe, expect, it } from "vitest";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { CandidateInboxSchema } from "@/lib/schemas/inbox";
import { queryKeys } from "@/lib/query/keys";
import { loadInboxPage, type InboxPages } from "./inbox-pages";
import { flattenInbox } from "./use-inbox";

const message = (id: string) => ({id, firmId:"firm", candidateId:"candidate", applicationId:null,
  fromName:"Recruiter", fromEmail:"r@example.test", subject:id, snippet:"", body:"", receivedAt:"2026-11-02T00:00:00Z",
  signal:null, impliedStatus:null, scheduledFor:null, isRead:true});
const page = (ids: string[], next: string | null) => CandidateInboxSchema.parse({firmId:"firm", connection:null, messages:ids.map(message), nextCursor:next});

describe("Inbox infinite pagination", () => {
  it("polls newest mail only and preserves older pages and continuation", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}});
    let changed = false;
    const requests: (string | null)[] = [];
    const key = queryKeys.inbox.byCandidate("firm", "candidate");
    const observer = new InfiniteQueryObserver(client, {queryKey:queryKeys.inbox.byCandidate("firm", "candidate"),
      initialPageParam:null as string | null,
      queryFn: ({pageParam}) => loadInboxPage(pageParam, client.getQueryData<InboxPages>(key), async cursor => {
        requests.push(cursor);
        return cursor ? page(["older"], null) : page(changed ? ["new","recent"] : ["recent"], "older-cursor");
      }),
      getNextPageParam: value => value.nextCursor ?? undefined, select:flattenInbox});
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    expect(observer.getCurrentResult().data?.messages.map(m => m.id)).toEqual(["recent","older"]);
    requests.length = 0;
    changed = true;
    await observer.refetch();
    expect(observer.getCurrentResult().data?.messages.map(m => m.id)).toEqual(["new","recent","older"]);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    expect(requests).toEqual([null]);
    unsubscribe(); client.clear();
  });
});


describe("Inbox head refresh overflow", () => {
  it("bridges new arrivals spanning multiple pages without replaying old history", async () => {
    const cached: InboxPages = {pages:[page(["recent"], "old-cursor"), page(["older"], "tail")],pageParams:[null,"old-cursor"]};
    const requests: (string | null)[] = [];
    const updated = await loadInboxPage(null, cached, async cursor => {
      requests.push(cursor);
      return cursor === null ? page(["newest"], "bridge") : page(["new", "recent"], "old-cursor");
    });
    expect(requests).toEqual([null, "bridge"]);
    expect(updated.messages.map(m=>m.id)).toEqual(["newest","new","recent"]);
    expect(updated.nextCursor).toBe("old-cursor");
    const older = await loadInboxPage("old-cursor", {...cached,pages:[updated,cached.pages[1]]}, async()=>{throw Error("Must not fetch history");});
    expect(older.messages[0].id).toBe("older");
    const tail = await loadInboxPage("tail", cached, async cursor=>page([cursor!],null));
    expect(tail.messages[0].id).toBe("tail");
  });
  it("leaves previous cache intact when a bridge fetch fails", async () => {
    const cached: InboxPages={pages:[page(["recent"],"old"),page(["older"],null)],pageParams:[null,"old"]};
    await expect(loadInboxPage(null,cached,async cursor=>{
      if(cursor) throw Error("offline");
      return page(["new"],"bridge");
    })).rejects.toThrow("offline");
    expect(cached.pages[0].messages[0].id).toBe("recent");
  });
});


describe("Inbox historical changes during import", () => {
  it("refreshes loaded history when count grows without newer head mail", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const key = queryKeys.inbox.byCandidate("firm","backfill");
    let importedOlder = false;
    const requests: (string|null)[]=[];
    const cycles = new WeakMap<AbortSignal,boolean>();
    const observer = new InfiniteQueryObserver(client,{queryKey:key,initialPageParam:null as string|null,
      queryFn:({pageParam,signal})=>loadInboxPage(pageParam,client.getQueryData<InboxPages>(key),async cursor=>{
        requests.push(cursor);
        return {...(cursor ? page(importedOlder ? ["older","backfilled"]:["older"],null) : page(["recent"],"history")),totalCount:importedOlder?3:2};
      },{signal,cycles}), getNextPageParam:p=>p.nextCursor??undefined,select:flattenInbox});
    const unsubscribe=observer.subscribe(()=>{});
    await observer.refetch(); await observer.fetchNextPage();
    importedOlder=true; requests.length=0;
    await observer.refetch();
    expect(requests).toEqual([null,"history"]);
    expect(observer.getCurrentResult().data?.messages.map(m=>m.id)).toEqual(["recent","older","backfilled"]);
    requests.length=0;
    await observer.refetch();
    expect(requests).toEqual([null]);
    unsubscribe();client.clear();
  });
});


it("refreshes retained history once when another reader deletes mail", async () => {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const key=queryKeys.inbox.byCandidate("firm","deletion");
  let deleted=false;
  const cycles=new WeakMap<AbortSignal,boolean>();
  const requests:(string|null)[]=[];
  const observer=new InfiniteQueryObserver(client,{queryKey:key,initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>loadInboxPage(pageParam,client.getQueryData<InboxPages>(key),async cursor=>{
      requests.push(cursor);
      return {...(cursor?page(deleted?["older"]:["older","deleted"],null):page(["recent"],"history")),totalCount:deleted?2:3};
    },{signal,cycles}),getNextPageParam:p=>p.nextCursor??undefined,select:flattenInbox});
  const unsubscribe=observer.subscribe(()=>{});
  await observer.refetch(); await observer.fetchNextPage();
  deleted=true; requests.length=0;
  await observer.refetch();
  expect(observer.getCurrentResult().data?.messages.map(m=>m.id)).toEqual(["recent","older"]);
  expect(requests).toEqual([null,"history"]);
  requests.length=0;await observer.refetch();expect(requests).toEqual([null]);
  unsubscribe();client.clear();
});
