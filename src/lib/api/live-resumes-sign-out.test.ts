import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import sample from "./dto/__samples__/resumes.json";

/**
 * Résumés on the live backend: the save reuses the version the studio opened (Abdul's PR 7 review, #7), and that copy
 * is forgotten the moment the signed-in person changes, with the query cache (src/lib/query/principal-boundary.ts):
 * nothing of the previous person's stays in the tab.
 */
const before = process.env.NEXT_PUBLIC_LIVE_MODULES;
process.env.NEXT_PUBLIC_LIVE_MODULES = "resumes";
vi.resetModules();
const { resumesApi } = await import("./resumes");
const { fromBackendId } = await import("./dto/demo-ids");
const { clearCacheOnPrincipalChange } = await import("@/lib/query/principal-boundary");
const { useSession } = await import("@/lib/stores/session-store");
const { signInAs, signOutForTest } = await import("@/mocks/sign-in-as");
afterAll(() => {
  process.env.NEXT_PUBLIC_LIVE_MODULES = before;
  vi.resetModules();
});

const FIRM = "firm_hts";
const VERSION = fromBackendId(sample.version.id);
const versionReads: string[] = [];

beforeEach(() => {
  versionReads.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    if (method === "POST") return new Response(JSON.stringify({ ...sample.version, notice: null }), { status: 201 });
    if (url.endsWith(`/resumes/${sample.version.id}`)) {
      versionReads.push(url);
      return new Response(JSON.stringify(sample.version), { status: 200 });
    }
    return new Response(JSON.stringify(sample.listing), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSession.getState().reset();
  signOutForTest();
});

describe("the versions the studio read, across a change of who is signed in", () => {
  it("a save reuses the opened version; after another person signs in it is read again", async () => {
    const unsubscribe = clearCacheOnPrincipalChange(new QueryClient());
    useSession.getState().setSession(await signInAs("user_imran"));

    const opened = await resumesApi.open(FIRM, VERSION);
    expect(versionReads).toHaveLength(1);
    await resumesApi.save(FIRM, VERSION, opened.document);
    expect(versionReads).toHaveLength(1);                        // the opened copy, not a second read

    useSession.getState().setSession(await signInAs("user_adnan")); // another person, same tab, no reload
    await resumesApi.save(FIRM, VERSION, opened.document);
    expect(versionReads).toHaveLength(2);                        // the previous person's copy is gone
    unsubscribe();
  });

  it("a read answered after another person signs in doesn't put the previous person's version back", async () => {
    const unsubscribe = clearCacheOnPrincipalChange(new QueryClient());
    useSession.getState().setSession(await signInAs("user_imran"));

    let answer = () => {};
    const answered = new Promise<void>((resolve) => { answer = resolve; });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (method === "POST") return new Response(JSON.stringify({ ...sample.version, notice: null }), { status: 201 });
      if (url.endsWith(`/resumes/${sample.version.id}`)) {
        versionReads.push(url);
        await answered;                                          // held until after the change below
        return new Response(JSON.stringify(sample.version), { status: 200 });
      }
      return new Response(JSON.stringify(sample.listing), { status: 200 });
    });

    const opening = resumesApi.open(FIRM, VERSION);               // started as the first person
    await vi.waitFor(() => expect(versionReads).toHaveLength(1));
    useSession.getState().setSession(await signInAs("user_adnan")); // another person, before the answer
    answer();
    const opened = await opening;

    await resumesApi.save(FIRM, VERSION, opened.document);
    expect(versionReads).toHaveLength(2);                        // read again: the late answer wasn't kept
    unsubscribe();
  });
});
