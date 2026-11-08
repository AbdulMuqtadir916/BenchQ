// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { connectionKey } from "./autofill/connection-store";
import { installDialog } from "./test/dialog";
import { fakeChrome, type FakeChrome } from "./test/fake-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installDialog();

const job = {
  id: "app-1", candidate_id: "cand-1", status: "saved", title: "Java Developer", company: "Acme",
  url: "https://jobs.acme.test/1", location: "Dallas",
};

const summary = { title: job.title, company: job.company, url: job.url };

const otherJob = { ...job, id: "app-2", candidate_id: "cand-2", title: "Data Engineer", url: "https://jobs.acme.test/2" };

/** Each candidate has one saved job. */
function reply(url: string) {
  if (url.includes("auth/me")) return { principal: { kind: "firm", role: "BDE", user_id: "user-1", firm_id: "firm-1" } };
  if (url.includes("/candidates")) return [{ id: "cand-1", full_name: "Aarav" }, { id: "cand-2", full_name: "Priya" }];
  if (url.includes("autofill/config")) return { candidate_id: "cand-1", qa_bank: [] };
  if (url.includes("candidate-status")) return { status: "applied", status_revision: 1, status_transitions: [] };
  const owned = [job, otherJob].filter(({ candidate_id }) => url.includes(`candidate_id=${candidate_id}`));
  return { applications: url.includes("status=saved") ? owned : [] };
}

const respond = async (url: string) => ({ ok: true, status: 200, json: async () => reply(url) });

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

let fake: FakeChrome;

async function mount() {
  await act(async () => { await import("./main"); });
  await settle();
}

const buttons = () => [...document.querySelectorAll<HTMLElement>("[data-slot='autofill-actions'] button")];
const actionLabels = () => buttons().map(({ textContent }) => textContent);
const press = (name: string) => act(async () => {
  [...document.querySelectorAll<HTMLElement>("button")].find(({ textContent }) => textContent === name)!.click();
});
const picker = () => document.querySelector<HTMLSelectElement>("#candidate-select")!;
const jobCards = () => [...document.querySelectorAll("[data-slot='job']")];

beforeEach(() => {
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  vi.stubGlobal("fetch", vi.fn(respond));
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = `<div id="root"></div>`;
});

const opened = { type: "open-job", connection: { applicationId: "app-1", candidateId: "cand-1", userId: "user-1", job: summary } };

it("opens and connects a job from Open job", async () => {
  await mount();
  await act(async () => { document.querySelector<HTMLElement>("[data-slot='job'] .bq-secondary")!.click(); });
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith(opened);
});

it("does the same from the job's title, with no separate step to select it", async () => {
  await mount();
  await act(async () => { document.querySelector<HTMLElement>("[data-slot='job-select']")!.click(); });
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith(opened);
  expect(document.body.textContent).not.toContain("Selected job");
});

it("marks a job applied only from the job itself, not from the list", async () => {
  await mount();
  expect(jobCards().map((card) => [...card.querySelectorAll("button")].map(({ textContent }) => textContent))).toEqual([["Java Developer", "Open job"]]);
});

it("says when a job couldn't be opened", async () => {
  await mount();
  fake.runtime.sendMessage.mockRejectedValueOnce(new Error("Worker gone"));
  await act(async () => { document.querySelector<HTMLElement>("[data-slot='job-select']")!.click(); });
  expect(document.querySelector("[data-slot='error']")?.textContent).toContain("Could not open this job");
});

const connectTab = (tabId = 7, { id, candidate_id }: typeof job = job) => fake.session.set(connectionKey(tabId), {
  tabId, applicationId: id, candidateId: candidate_id, userId: "user-1", confirmedHosts: [], job: summary,
});

const endConnection = (tabId = 7) => act(async () => {
  fake.session.delete(connectionKey(tabId));
  fake.storage.onChanged.fire({ [connectionKey(tabId)]: {} }, "session");
});

const switchToTab = (id: number) => act(async () => {
  fake.tabs.query.mockResolvedValue([{ id, windowId: 1, url: "https://jobs.acme.test/" }]);
  fake.tabs.onActivated.fire({ windowId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
});

const markApplied = async () => {
  await press("Mark applied");
  await press("Yes, mark applied");
  await settle();
};

it("moves between Saved and Applied the way the website's tabs do", async () => {
  await mount();
  const tab = (name: string) => document.getElementById(`job-tab-${name}`)!;
  const press = (name: string, key: string) => act(async () => {
    tab(name).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  expect(document.querySelector("[role='tablist']")?.getAttribute("role")).toBe("tablist");
  expect(tab("saved").getAttribute("aria-selected")).toBe("true");
  expect(tab("applied").tabIndex).toBe(-1);

  await press("saved", "ArrowRight");
  expect(tab("applied").getAttribute("aria-selected")).toBe("true");
  expect(tab("applied").tabIndex).toBe(0);
  expect(document.activeElement).toBe(tab("applied"));
  expect(document.querySelector("[role='tabpanel']")?.getAttribute("aria-labelledby")).toBe("job-tab-applied");
  expect(document.querySelector("[data-slot='empty']")?.textContent).toContain("No applied jobs");

  await press("applied", "ArrowRight");
  expect(tab("saved").getAttribute("aria-selected")).toBe("true");
  await press("saved", "End");
  expect(tab("applied").getAttribute("aria-selected")).toBe("true");
  await press("applied", "Home");
  expect(tab("saved").getAttribute("aria-selected")).toBe("true");
  await press("saved", "Tab");
  expect(tab("saved").getAttribute("aria-selected")).toBe("true");
});

it("shows only the linked job on a connected tab: no list, no tabs, no accordion", async () => {
  connectTab();
  await mount();
  expect(document.querySelector("#autofill-title")?.textContent).toBe("Java Developer");
  expect(document.querySelector("[role='tablist']")).toBeNull();
  expect(document.querySelector("[data-slot='job']")).toBeNull();
  expect(document.querySelector("details")).toBeNull();
});

it("shows the list and tabs when no job is linked", async () => {
  await mount();
  expect(document.querySelector("[data-slot='autofill']")).toBeNull();
  expect(document.querySelector("[role='tablist']")).not.toBeNull();
  expect(jobCards()).toHaveLength(1);
});

it("locks the dropdown while a job is linked", async () => {
  connectTab();
  await mount();
  expect(picker().value).toBe("cand-1");
  expect(picker().disabled).toBe(true);
});

it("moves the dropdown to the linked job's candidate", async () => {
  connectTab();
  localStorage.setItem("benchq-selected-candidate", "cand-2");
  await mount();
  await settle();
  expect(picker().value).toBe("cand-1");
  expect(actionLabels()).toContain("Mark applied");
});

it("follows the BDE between tabs, and stays on that candidate on a tab with no job", async () => {
  connectTab(8, otherJob);
  await mount();
  expect(picker().value).toBe("cand-1");
  expect(picker().disabled).toBe(false);

  await switchToTab(8);
  expect(picker().value).toBe("cand-2");
  expect(picker().disabled).toBe(true);
  expect(actionLabels()).toContain("Mark applied");

  await switchToTab(7);
  expect(picker().value).toBe("cand-2");
  expect(picker().disabled).toBe(false);
  expect(jobCards().map((card) => card.querySelector("[data-slot='job-select']")?.textContent)).toEqual(["Data Engineer"]);
});

it("gives the list back when the card is closed, with the job still saved and the dropdown free", async () => {
  connectTab();
  await mount();
  await act(async () => { document.querySelector<HTMLElement>("[aria-label='Disconnect this tab from the job']")!.click(); });
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: "disconnect-tab", tabId: 7 });
  await endConnection();
  expect(document.querySelector("[data-slot='autofill']")).toBeNull();
  expect(jobCards()).toHaveLength(1);
  expect(document.getElementById("job-tab-saved")?.textContent).toContain("1");
  expect(picker().value).toBe("cand-1");
  expect(picker().disabled).toBe(false);
});

it("goes by the latest load when an earlier one answers late", async () => {
  await mount();
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("candidate_id=cand-2")) await gate;
    return respond(url);
  }));
  await act(async () => {
    picker().value = "cand-2";
    picker().dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    connectTab();
    fake.storage.onChanged.fire({ [connectionKey(7)]: {} }, "session");
  });
  await settle();
  expect(picker().value).toBe("cand-1");
  expect(actionLabels()).toContain("Mark applied");
  await act(async () => { release(); });
  await settle();
  expect(actionLabels()).toContain("Mark applied");
});

it("leaves out a candidate the BDE can no longer reach", async () => {
  connectTab(7, { ...job, candidate_id: "cand-gone" });
  await mount();
  expect(picker().value).toBe("cand-1");
});

it("offers Mark applied in the panel of a connected tab", async () => {
  connectTab();
  await mount();
  expect(actionLabels()).toContain("Mark applied");
});

it("asks before marking applied", async () => {
  connectTab();
  await mount();
  await press("Mark applied");
  expect(actionLabels()).toEqual(["Mark applied", "Yes, mark applied", "Cancel"]);
  expect(document.querySelector("dialog[data-slot='autofill-confirm']")?.hasAttribute("open")).toBe(true);
  const patches = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("candidate-status"));
  expect(patches()).toEqual([]);
  await press("Cancel");
  expect(patches()).toEqual([]);
  expect(actionLabels()).toEqual(["Mark applied"]);
});

it("sends the form with the status, and only once confirmed", async () => {
  connectTab();
  await mount();
  await markApplied();
  const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("candidate-status"))!;
  expect(init?.method).toBe("PATCH");
  expect(JSON.parse(String(init?.body))).toMatchObject({ status: "applied", expected_revision: 0, form_data: { fields: [] } });
});

it("ends the job's connections once it's marked applied", async () => {
  connectTab();
  await mount();
  await markApplied();
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: "disconnect-job", applicationId: "app-1" });
});

it("leaves the connection alone when marking applied fails", async () => {
  connectTab();
  await mount();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })));
  await markApplied();
  expect(fake.runtime.sendMessage).not.toHaveBeenCalledWith({ type: "disconnect-job", applicationId: "app-1" });
  expect(document.querySelector("[data-slot='error']")?.textContent).toContain("Could not update this application");
  expect(actionLabels()).toEqual(["Mark applied"]);
});
