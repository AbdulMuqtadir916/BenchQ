import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionKey } from "./autofill/connection-store";
import { confirmationKey } from "./autofill/job-check";
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

describe("the keyboard shortcuts", () => {
  it("open the panel and pass the key on, with the tab it was pressed on", () => {
    fake.commands.onCommand.fire("run-autofill", { id: 7, windowId: 3 });
    expect(fake.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: "shortcut", command: "run-autofill", tabId: 7 });
  });

  it("pass Mark applied on the same way", () => {
    fake.commands.onCommand.fire("mark-applied", { id: 9, windowId: 1 });
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: "shortcut", command: "mark-applied", tabId: 9 });
  });

  it("leave any other command alone", () => {
    fake.commands.onCommand.fire("_execute_action", { id: 7, windowId: 1 });
    expect(fake.sidePanel.open).not.toHaveBeenCalled();
    expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
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

  it("remembers a job the BDE confirmed", async () => {
    connect(5);
    const confirmed = confirmationKey("https://boards.example.test/1", "Java Developer · Acme");
    await send({ type: "confirm-host", tabId: 5, host: confirmed });
    expect(stored(5)?.confirmedHosts).toEqual([confirmed]);
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

  it("keeps the connection on the job's own site and one where the BDE confirmed the job", async () => {
    const tabId = await open();
    await send({ type: "confirm-host", tabId, host: confirmationKey("https://boards.example.test/1", "Java Developer · Acme") });
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://jobs.acme.test/2", transitionType: "typed" });
    fake.webNavigation.onCommitted.fire({ tabId, frameId: 0, url: "https://boards.example.test/2", transitionType: "typed" });
    await settle();
    expect(stored(tabId)).toBeDefined();
  });
});

describe("using the tab that shows the job (#130)", () => {
  it("connects that tab, and a tab connected to the same job before lets go", async () => {
    const before = await open();
    expect(await send({ type: "connect-tab", connection: details, tabId: 42 })).toEqual({ ok: true, tabId: 42 });
    expect(stored(42)).toMatchObject({ applicationId: details.applicationId, tabId: 42, confirmedHosts: [] });
    expect(stored(before)).toBeUndefined();
  });
});

describe("LinkedIn postings inside BenchQ (frame-rules.ts, decided 2026-11-17)", () => {
  it("lifts the frame headers only for frames BenchQ opens, and sends the page-visit headers", async () => {
    const { frameRules, benchqHost } = await import("./frame-rules");
    const host = benchqHost("http://localhost:3000");
    const [lift, visit] = frameRules(host);
    expect(lift.condition).toEqual({ urlFilter: "*", resourceTypes: ["sub_frame"], initiatorDomains: ["localhost"],
      excludedRequestDomains: ["localhost"] });
    expect((lift.action as { responseHeaders: { header: string }[] }).responseHeaders.map((h) => h.header))
      .toEqual(["x-frame-options", "content-security-policy"]);
    expect((visit.action as { requestHeaders: unknown[] }).requestHeaders).toEqual([
      { header: "sec-fetch-dest", operation: "set", value: "document" },
      { header: "sec-fetch-site", operation: "set", value: "none" }]);
  });

  it("the panel's switch takes the rules away and puts them back, each in one call", async () => {
    const { setupFrameRules } = await import("./frame-rules");
    fake.declarativeNetRequest.updateSessionRules.mockClear();
    fake.sync.set("previewUnblock", false);
    await setupFrameRules();
    expect(fake.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1);
    expect(fake.declarativeNetRequest.updateSessionRules).toHaveBeenLastCalledWith({ removeRuleIds: [1, 2], addRules: [] });
    fake.sync.set("previewUnblock", true);
    await setupFrameRules();
    expect(fake.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(2);
    expect(fake.declarativeNetRequest.updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [1, 2], addRules: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })] });
  });

  it("two setups at once, as the worker's start and its install listener run, leave the rules in place", async () => {
    const { setupFrameRules } = await import("./frame-rules");
    // As Chrome does: within one call it removes before it adds, and refuses an id that is already there.
    const installed = new Set<number>();
    fake.declarativeNetRequest.updateSessionRules.mockImplementation(async ({ removeRuleIds = [], addRules = [] }) => {
      await Promise.resolve();
      for (const id of removeRuleIds) installed.delete(id);
      for (const { id } of addRules as { id: number }[]) {
        if (installed.has(id)) throw new Error(`Rule with id ${id} does not have a unique ID.`);
        installed.add(id);
      }
    });
    try {
      fake.sync.set("previewUnblock", true);
      await expect(Promise.all([setupFrameRules(), setupFrameRules()])).resolves.toHaveLength(2);
      expect([...installed].sort()).toEqual([1, 2]);
    } finally {
      fake.declarativeNetRequest.updateSessionRules.mockImplementation(async () => undefined);
    }
  });
});
it("opens the assistant from a page without issuing an autofill command", async () => {
  const reply = vi.fn();
  fake.runtime.onMessage.fire({ type: "assistant-open" }, { id: "extension-id", frameId: 0, tab: { id: 8, windowId: 4 } }, reply);
  await settle();
  expect(fake.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
  expect(reply).toHaveBeenCalledWith(true);
  expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
});

it("checks site access before injecting a job detector", async () => {
  fake.permissions.contains.mockResolvedValue(false);
  fake.webNavigation.onCompleted.fire({ frameId: 0, tabId: 8, url: "https://example.test/jobs" });
  await settle();
  expect(fake.scripting.executeScript).not.toHaveBeenCalled();
});
it("offers Chrome site access for a listing URL before inspecting the page", async () => {
  fake.permissions.contains.mockResolvedValue(false);
  const url = "https://example.test/jobs/developer";
  fake.webNavigation.onCompleted.fire({ frameId: 0, tabId: 8, url });
  await settle();
  expect(fake.permissions.addHostAccessRequest).toHaveBeenCalledWith({ tabId: 8, pattern: url });
  expect(fake.scripting.executeScript).not.toHaveBeenCalled();
  expect(fake.sidePanel.open).not.toHaveBeenCalled();
});
it("uses the source click to open the panel and bind the destination to the saved candidate job", async () => {
  const api = await import("./api");
  const url = "https://jobs.example.test/apply/42";
  vi.spyOn(api, "getSession").mockResolvedValue({ principal: { kind: "firm", role: "BDE", user_id: "user-1" } });
  vi.spyOn(api, "getSavedApplications").mockResolvedValue([{
    id: "app-1", candidate_id: "candidate-1", job_id: "job-42", status: "saved", title: "Engineer", company: "Example", location: null, url,
  }]);
  fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url }]);
  const reply = await new Promise(resolve => fake.runtime.onMessage.fire(
    { type: "source-click", candidateId: "candidate-1", jobId: "job-42", url },
    { id: "extension-id", url: api.BENCHQ_URL, frameId: 0, tab: { id: 7, windowId: 4 } }, resolve));
  expect(reply).toBe(true);
  expect(fake.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
  expect(stored(101)).toMatchObject({ candidateId: "candidate-1", applicationId: "app-1", userId: "user-1" });
  expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
it.each([
  ["binds a source link that redirected within the job's site", "https://www.adzuna.example/details/42?i=1", true],
  ["leaves the tab unbound once it shows another site", "https://elsewhere.example/", false],
])("%s", async (_name, landed, isBound) => {
  const api = await import("./api");
  const url = "https://www.adzuna.example/land/ad/42";
  vi.spyOn(api, "getSession").mockResolvedValue({ principal: { kind: "firm", role: "BDE", user_id: "user-1" } });
  vi.spyOn(api, "getSavedApplications").mockResolvedValue([{
    id: "app-1", candidate_id: "candidate-1", job_id: "job-42", status: "saved", title: "Engineer", company: "Example", location: null, url,
  }]);
  fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url: landed }]);
  await new Promise(resolve => fake.runtime.onMessage.fire(
    { type: "source-click", candidateId: "candidate-1", jobId: "job-42", url },
    { id: "extension-id", url: api.BENCHQ_URL, frameId: 0, tab: { id: 7, windowId: 4 } }, resolve));
  expect(stored(101) !== undefined).toBe(isBound);
  vi.restoreAllMocks();
});
it.each([
  ["binds the one candidate who saved the job when the link names none", ["candidate-1"], true],
  ["leaves it to Add job when two candidates saved the job", ["candidate-1", "candidate-2"], false],
])("%s", async (_name, candidates, isBound) => {
  const api = await import("./api");
  const url = "https://jobs.example.test/apply/42";
  vi.spyOn(api, "getSession").mockResolvedValue({ principal: { kind: "firm", role: "BDE", user_id: "user-1" } });
  const saved = vi.spyOn(api, "getSavedApplications").mockResolvedValue(candidates.map((candidate, index) => ({
    id: `app-${index}`, candidate_id: candidate, job_id: "job-42", status: "saved", title: "Engineer", company: "Example", location: null, url,
  })));
  fake.webNavigation.getAllFrames.mockResolvedValue([{ frameId: 0, url }]);
  await new Promise(resolve => fake.runtime.onMessage.fire({ type: "source-click", jobId: "job-42", url },
    { id: "extension-id", url: api.BENCHQ_URL + "/firm/jobs", frameId: 0, tab: { id: 7, windowId: 4 } }, resolve));
  expect(saved).toHaveBeenCalledWith(undefined);
  expect(stored(101) !== undefined).toBe(isBound);
  vi.restoreAllMocks();
});

it("asks the panel in the job page's window whether BenchQ is open there", async () => {
  fake.runtime.sendMessage.mockResolvedValueOnce(true);
  const reply = await new Promise(resolve => fake.runtime.onMessage.fire({ type: "assistant-visible" },
    { id: "extension-id", url: "https://jobs.example.test/42", frameId: 0, tab: { id: 7, windowId: 4 } }, resolve));
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: "panel-window", windowId: 4 });
  expect(reply).toBe(true);
});

it("attaches the click listener to an existing BenchQ tab when the extension is installed", async () => {
  const { BENCHQ_URL } = await import("./api");
  fake.tabs.query.mockResolvedValue([{ id: 12, windowId: 1, url: BENCHQ_URL + "/firm/jobs" }]);
  fake.runtime.onInstalled.fire();
  await settle();
  expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 12 }, files: ["source-click.js"] });
});

it("keeps the original click tab active until the panel has opened", async () => {
  const { BENCHQ_URL } = await import("./api");
  let opened!: () => void;
  fake.sidePanel.open.mockImplementationOnce(() => new Promise<undefined>(resolve => { opened = () => resolve(undefined); }));
  const reply = vi.fn();
  fake.runtime.onMessage.fire({ type: "source-click", url: "https://jobs.example.test/42" },
    { id: "extension-id", frameId: 0, tab: { id: 7, windowId: 4 }, url: BENCHQ_URL + "/firm/jobs" }, reply);
  expect(fake.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
  expect(fake.tabs.create).not.toHaveBeenCalled();
  opened();
  await settle();
  expect(fake.tabs.create).toHaveBeenCalledTimes(1);
  expect(reply).toHaveBeenCalledWith(true);
});
