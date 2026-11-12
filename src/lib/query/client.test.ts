import { MutationObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient, isActivityKey } from "./client";
import { queryKeys } from "./keys";

const FIRM = "firm_hts";

describe("isActivityKey", () => {
  it("is true for a firm's activity log and the Super Admin's", () => {
    expect(isActivityKey(queryKeys.ledger.list(FIRM, { limit: 15 }))).toBe(true);
    expect(isActivityKey(queryKeys.ledger.people(FIRM))).toBe(true);
    expect(isActivityKey(queryKeys.ledger.candidates(FIRM))).toBe(true);
    expect(isActivityKey(queryKeys.platform.activity("list", { limit: 15 }))).toBe(true);
  });

  it("is false for everything else", () => {
    expect(isActivityKey(queryKeys.applications.all(FIRM))).toBe(false);
    expect(isActivityKey([FIRM, "candidates"])).toBe(false);
    expect(isActivityKey(["platform", "firms"])).toBe(false);
  });
});

describe("the app's query client", () => {
  const seed = () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.ledger.list(FIRM, { limit: 15 }), ["old row"]);
    client.setQueryData(queryKeys.platform.activity("list"), ["old admin row"]);
    client.setQueryData(queryKeys.applications.all(FIRM), ["an application"]);
    return client;
  };
  const state = (client: ReturnType<typeof createQueryClient>, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;

  it("marks Activity stale after any change succeeds, so it is read again instead of shown from the cache", async () => {
    const client = seed();
    await new MutationObserver(client, { mutationFn: async () => "saved" }).mutate();
    expect(state(client, queryKeys.ledger.list(FIRM, { limit: 15 }))).toBe(true);
    expect(state(client, queryKeys.platform.activity("list"))).toBe(true);
    expect(state(client, queryKeys.applications.all(FIRM))).toBe(false);          // not what this change was about
  });

  it("leaves Activity alone when the change failed, because nothing was written", async () => {
    const client = seed();
    await new MutationObserver(client, { mutationFn: async () => { throw new Error("refused"); } }).mutate().catch(() => undefined);
    expect(state(client, queryKeys.ledger.list(FIRM, { limit: 15 }))).toBe(false);
  });
});
