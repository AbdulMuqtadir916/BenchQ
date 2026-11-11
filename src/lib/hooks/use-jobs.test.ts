import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TanStack Query turns its timers off where there is no `window` (a server render): give it one, as a browser tab has,
// before it loads.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
});

import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { blockedReason } from "@/components/app/candidate/find-jobs";
import { jobsApi } from "@/lib/api/jobs";
import { queryKeys } from "@/lib/query/keys";
import type { JobSearch, JobSearches } from "@/lib/schemas/job-search";
import { jobSearchesQuery } from "./use-jobs";

/**
 * "Find jobs" follows a search to its end and lifts today's limit at the reset, with the page left open (Abdul on
 * #135). The query is driven with fake timers, as the mounted page would drive it.
 */

const FIRM = "firm_hts";
const CANDIDATE = "cand_1";
const RESET = "2026-11-11T13:00:00.000Z"; // 6:30 PM IST
const candidate = { primaryRole: "Java Developer", targetRoles: [], country: "US" };

function search(id: string, state: JobSearch["state"]): JobSearch {
  return { id, kind: "SEARCH", state, query: "Java Developer", newCount: state === "SUCCESS" ? 12 : 0, seenAgainCount: 0, overLimitCount: 0,
    errorCode: null, startedAt: "2026-11-11T12:00:00.000Z", finishedAt: state === "RUNNING" ? null : "2026-11-11T12:00:05.000Z" };
}

function searches(over: Partial<JobSearches> = {}, usage: Partial<JobSearches["usage"]> = {}): JobSearches {
  return { running: null, searches: [], usage: { jobsToday: 0, jobsCap: 100, searchesToday: 1, searchesCap: 20, capturesToday: 0, capturesCap: 20, resetsAt: RESET, ...usage }, ...over };
}

/** The page: a job list already loaded, then the searches query, each with a subscriber, as mounted screens have. */
async function mount(reads: JobSearches[], startedBatchId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  client.mount();                                                  // what QueryClientProvider does: focus reaches it
  const jobList = vi.fn(async () => []);
  const stops = [new QueryObserver(client, { queryKey: queryKeys.jobs.list(FIRM, { candidateId: CANDIDATE }), queryFn: jobList }).subscribe(() => {})];
  await vi.advanceTimersByTimeAsync(0);
  // The start (useStartJobSearch's onSuccess) remembers the batch id before the searches are read again.
  if (startedBatchId) client.setQueryData(queryKeys.jobs.startedSearch(FIRM, CANDIDATE), startedBatchId);
  const read = vi.spyOn(jobsApi, "searches").mockImplementation(async () => (reads.length > 1 ? reads.shift()! : reads[0]));
  const invalidate = vi.spyOn(client, "invalidateQueries");
  stops.push(new QueryObserver(client, jobSearchesQuery(client, FIRM, CANDIDATE)).subscribe(() => {}));
  const current = () => client.getQueryData<JobSearches>(queryKeys.jobs.searches(FIRM, CANDIDATE));
  const ledgerRefreshed = () => invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.ledger.all(FIRM)));
  const started = () => client.getQueryData(queryKeys.jobs.startedSearch(FIRM, CANDIDATE));
  return { client, read, jobList, current, ledgerRefreshed, started, unmount: () => { stops.forEach((stop) => stop()); client.unmount(); } };
}

let page: Awaited<ReturnType<typeof mount>> | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
  focusManager.setFocused(true);
});
afterEach(() => {
  page?.unmount();
  page = null;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a search this tab started (Abdul on #135, item 4)", () => {
  it("one that ended before the first read: the job list and the ledger refresh, and the polling stops", async () => {
    page = await mount([searches({ searches: [search("b1", "SUCCESS")] })], "b1");
    await vi.advanceTimersByTimeAsync(0);
    expect(page.read).toHaveBeenCalledTimes(1);
    expect(page.current()?.running).toBeNull();                 // never seen running
    expect(page.jobList).toHaveBeenCalledTimes(2);                // the mounted list read again
    expect(page.ledgerRefreshed()).toBe(true);
    expect(page.started()).toBeNull();                            // the marker clears
    const reads = page.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.read.mock.calls.length).toBe(reads);              // and nothing polls any more
  });

  it("one seen running, then finished (the control): read every 3 s, then the list and the ledger refresh", async () => {
    page = await mount([searches({ running: search("b1", "RUNNING") }), searches({ searches: [search("b1", "SUCCESS")] })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.current()?.running?.id).toBe("b1");
    expect(page.jobList).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(page.current()?.running).toBeNull();
    expect(page.jobList).toHaveBeenCalledTimes(2);
    expect(page.ledgerRefreshed()).toBe(true);
  });
});

describe("the 6:30 PM IST reset, with the page left open (Abdul on #135, item 5)", () => {
  const atCap = searches({}, { searchesToday: 20 });
  const newDay = searches({}, { searchesToday: 0, resetsAt: "2026-11-12T13:00:00.000Z" });

  it("a candidate at today's limit gets Find jobs back just after the reset, without a reload", async () => {
    vi.setSystemTime(new Date("2026-11-11T12:59:00.000Z"));      // 6:29 PM IST
    page = await mount([atCap, newDay]);
    await vi.advanceTimersByTimeAsync(0);
    expect(blockedReason(candidate, page.current())).toMatch(/^20\/20 searches today/);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(page.read).toHaveBeenCalledTimes(1);                   // nothing read before the reset
    await vi.advanceTimersByTimeAsync(33_000);                    // just past 6:30 PM
    expect(page.read).toHaveBeenCalledTimes(2);
    expect(blockedReason(candidate, page.current())).toBeNull();
  });

  it("a tab in the background across the reset reads again when the BDE comes back to it", async () => {
    vi.setSystemTime(new Date("2026-11-11T12:59:00.000Z"));
    page = await mount([atCap, newDay]);
    await vi.advanceTimersByTimeAsync(0);
    focusManager.setFocused(false);
    focusManager.setFocused(true);                                // an alt-tab before the reset reads nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(page.read).toHaveBeenCalledTimes(1);
    focusManager.setFocused(false);
    vi.setSystemTime(new Date("2026-11-11T14:00:00.000Z"));      // the clock moved; the hidden tab's timer didn't fire
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.read).toHaveBeenCalledTimes(2);
    expect(blockedReason(candidate, page.current())).toBeNull();
  });
});
