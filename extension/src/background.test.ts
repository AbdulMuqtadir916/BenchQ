import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionKey } from "./autofill/connection-store";
import type { Connection, NewConnection, PanelMessage, PanelReply } from "./autofill/types";
import { fakeChrome, type FakeChrome } from "./test/fake-chrome";

const details: NewConnection = {
  applicationId: "app-1", candidateId: "cand-1", userId: "user-1",
  job: { title: "Java Developer", company: "Acme", url: "https://jobs.acme.test/1" },
};

let fake: FakeChrome;

const send = (message: PanelMessage, sender: object = { id: "extension-id" }) => new Promise<PanelReply>((resolve) => {
  fake.runtime.onMessage.fire(message, sender, resolve);
});

const stored = (tabId: number) => fake.session.get(connectionKey(tabId)) as Connection | undefined;

async function open(connection = details): Promise<number> {
  const reply = await send({ type: "open-job", connection });
  return (reply as { tabId: number }).tabId;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  vi.resetModules();
  await import("./background");
});

describe("opening a job", () => {
  it("opens the URL and connects the new tab", async () => {
    const tabId = await open();
    expect(fake.tabs.create).toHaveBeenCalledWith({ url: details.job.url });
    expect(stored(tabId)).toEqual({ ...details, tabId, confirmedHosts: [] });
  });

  it("stores ids and the job's summary, never candidate answers", async () => {
    const tabId = await open();
    expect(Object.keys(stored(tabId)!).sort()).toEqual(["applicationId", "candidateId", "confirmedHosts", "job", "tabId", "userId"]);
  });

  it("focuses the tab it already has instead of opening a duplicate", async () => {
    const tabId = await open();
    expect(await open()).toBe(tabId);
    expect(fake.tabs.create).toHaveBeenCalledTimes(1);
    expect(fake.tabs.update).toHaveBeenCalledWith(tabId, { active: true });
    expect(fake.windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it("opens a fresh tab when the old one has gone", async () => {
    const first = await open();
    fake.tabs_open.delete(first);
    const second = await open();
    expect(second).not.toBe(first);
    expect(stored(first)).toBeUndefined();
    expect(stored(second)).toBeDefined();
  });

  it("gives each application its own tab", async () => {
    const first = await open();
    const second = await open({ ...details, applicationId: "app-2" });
    expect(second).not.toBe(first);
  });

  it("doesn't reuse another user's tab", async () => {
    const first = await open();
    expect(await open({ ...details, userId: "user-2" })).not.toBe(first);
  });
});

describe("ending a connection", () => {
  const connect = (tabId: number) => fake.session.set(connectionKey(tabId), { ...details, tabId, confirmedHosts: [] });

  it("disconnects a tab", async () => {
    connect(5);
    await send({ type: "disconnect-tab", tabId: 5 });
    expect(stored(5)).toBeUndefined();
  });

  it("disconnects every tab of a job, and no other job", async () => {
    const first = await open();
    connect(5);
    const other = await open({ ...details, applicationId: "app-2" });
    await send({ type: "disconnect-job", applicationId: "app-1" });
    expect(stored(first)).toBeUndefined();
    expect(stored(5)).toBeUndefined();
    expect(stored(other)?.applicationId).toBe("app-2");
  });

  it("remembers a host the BDE confirmed", async () => {
    connect(5);
    await send({ type: "confirm-host", tabId: 5, host: "boards.example.test" });
    expect(stored(5)?.confirmedHosts).toEqual(["boards.example.test"]);
  });

  it("clears every connection, for a sign-out", async () => {
    connect(5);
    connect(6);
    await send({ type: "clear-connections" });
    expect(fake.session.size).toBe(0);
  });
});

describe("who it listens to", () => {
  it("refuses a message from a page", () => {
    const [handled] = fake.runtime.onMessage.fire({ type: "clear-connections" }, { id: "extension-id", tab: { id: 1 } }, () => undefined);
    expect(handled).toBe(false);
  });

  it("refuses a message from another extension", () => {
    const [handled] = fake.runtime.onMessage.fire({ type: "clear-connections" }, { id: "someone-else" }, () => undefined);
    expect(handled).toBe(false);
  });

  it("answers not ok when something fails", async () => {
    fake.tabs.create.mockRejectedValueOnce(new Error("blocked"));
    expect(await send({ type: "open-job", connection: details })).toEqual({ ok: false });
  });
});

describe("following a tab", () => {
  it("forgets a closed tab", async () => {
    const tabId = await open();
    fake.tabs.onRemoved.fire(tabId);
    await settle();
    expect(stored(tabId)).toBeUndefined();
  });

  it("carries the connection to a tab the employer's page opens", async () => {
    const tabId = await open();
    fake.webNavigation.onCreatedNavigationTarget.fire({ sourceTabId: tabId, tabId: 200 });
    await settle();
    expect(stored(200)).toMatchObject({ applicationId: "app-1", tabId: 200 });
  });

  it("moves the connection when Chrome swaps a tab", async () => {
    const tabId = await open();
    fake.tabs.onReplaced.fire(300, tabId);
    await settle();
    expect(stored(tabId)).toBeUndefined();
    expect(stored(300)?.tabId).toBe(300);
  });

  it.each(["typed", "auto_bookmark"])("clears a tab reused by %s", async (transitionType) => {
    const tabId = await open();
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://news.example.test/", transitionType });
    await settle();
    expect(stored(tabId)).toBeUndefined();
  });

  it("keeps the connection when the BDE follows a link", async () => {
    const tabId = await open();
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://boards.example.test/apply", transitionType: "link" });
    await settle();
    expect(stored(tabId)).toBeDefined();
  });

  it("keeps the connection on the job's own site and a confirmed one", async () => {
    const tabId = await open();
    await send({ type: "confirm-host", tabId, host: "boards.example.test" });
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://jobs.acme.test/2", transitionType: "typed" });
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://boards.example.test/2", transitionType: "typed" });
    await settle();
    expect(stored(tabId)).toBeDefined();
  });
});
