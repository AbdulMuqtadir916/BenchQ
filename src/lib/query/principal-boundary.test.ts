import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { candidatesApi } from "@/lib/api/candidates";
import { sessionApi } from "@/lib/api/session";
import { useSession } from "@/lib/stores/session-store";
import { queryKeys } from "./keys";
import { clearCacheOnPrincipalChange } from "./principal-boundary";
import { signInAs } from "@/mocks/sign-in-as";

const FIRM = "firm_hts";
const key = queryKeys.candidates.list(FIRM);
const query = { queryKey: key, queryFn: () => candidatesApi.list(FIRM) };
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });

/** What a freshly mounted useCandidates() renders first: the observer's initial result. */
const firstRender = (client: QueryClient) => new QueryObserver(client, query).getCurrentResult();

afterEach(async () => {
  useSession.getState().reset();
  await sessionApi.signOut();
});

describe("principal change clears the query cache (sign-in, sign-out, an account change in another tab)", () => {
  it("firm A OWNER loads candidates; after switching to firm A BDE the first render is not the OWNER's cache", async () => {
    const client = newClient();
    const unsubscribe = clearCacheOnPrincipalChange(client);

    useSession.getState().setSession(await signInAs("user_imran")); // OWNER, firm A
    const ownersList = await client.fetchQuery(query);
    expect(ownersList.length).toBe(24);
    expect(firstRender(client).data).toBe(ownersList); // the OWNER's cache is what a mount would show

    useSession.getState().setSession(await signInAs("user_adnan")); // BDE, same firm: same key
    expect(client.getQueryCache().getAll()).toEqual([]);
    const first = firstRender(client);
    expect(first.data).toBeUndefined();
    expect(first.status).toBe("pending");
    unsubscribe();
  });

  it("clears on sign-out and on a sign-in to another firm", async () => {
    const client = newClient();
    const unsubscribe = clearCacheOnPrincipalChange(client);
    useSession.getState().setSession(await signInAs("user_lakshmi"));
    await client.fetchQuery({ queryKey: queryKeys.candidates.list("firm_stl"), queryFn: () => candidatesApi.list("firm_stl") });
    useSession.getState().signOut();
    expect(client.getQueryCache().getAll()).toEqual([]);

    useSession.getState().setSession(await signInAs("user_adnan")); // the mock backend checks membership (T8)
    await client.fetchQuery(query);
    useSession.getState().setSession(await signInAs("user_kiran"));
    expect(client.getQueryCache().getAll()).toEqual([]);
    unsubscribe();
  });

  it("keeps the cache when the same principal is set again (no needless refetch)", async () => {
    const client = newClient();
    const session = await signInAs("user_adnan");
    useSession.getState().setSession(session);
    const unsubscribe = clearCacheOnPrincipalChange(client);
    await client.fetchQuery(query);
    useSession.getState().setSession(session);
    expect(firstRender(client).data?.length).toBe(24);
    unsubscribe();
  });
});
