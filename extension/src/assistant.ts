import { BENCHQ_URL, getSavedApplications, getSession } from "./api";
import { isJobLink } from "./autofill/job-link";
import { connectionFor, connectionKey } from "./autofill/connection-store";
import { hostOf } from "./autofill/job-check";

/** Connects the opened tab to the saved job: the link's candidate's, or, from a page without one, the one candidate who
 * has it saved. With no such job the tab stays unconnected and the panel offers Add job. */
async function connectSource(tabId: number, source: URL, jobId: string | undefined, candidateId: string | undefined) {
  const { principal } = await getSession();
  if (principal.kind !== "firm" || principal.role !== "BDE") return;
  // The website saves the application concurrently with opening the source link.
  for (const delay of [0, 300, 1000, 2500]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const jobs = await getSavedApplications(candidateId);
    const matches = jobs.filter(item => (!candidateId || item.candidate_id === candidateId) && item.status === "saved"
      && (jobId ? item.job_id === jobId : item.url === source.href));
    // More than one match won't settle by waiting.
    if (matches.length > 1) return;
    const job = matches[0];
    if (!job) continue;
    const connection = connectionFor(job, principal.user_id);
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const currentUrl = frames?.find(frame => frame.frameId === 0)?.url;
    if (!connection) return;
    if (!currentUrl || currentUrl === "about:blank") continue;
    // Source links often redirect within their own site (Adzuna's /land/ad/ opens /details/): compare sites, not addresses.
    const host = hostOf(currentUrl);
    if (host !== hostOf(source.href) && (!job.url || host !== hostOf(job.url))) return;
    await chrome.storage.session.set({ [connectionKey(tabId)]: { ...connection, tabId, confirmedHosts: [] } });
    return;
  }
}

async function detect({ tabId, frameId, url }: FrameDetails & { url?: string }) {
  if (frameId !== 0 || !url?.startsWith("https://") || new URL(url).origin === BENCHQ_URL) return;
  if (!await chrome.permissions.contains({ origins: [new URL(url).origin + "/*"] })) {
    if (isJobLink(url)) {
      // Chrome owns this indicator. Limit it to this listing, including its query on single-page boards.
      await chrome.permissions.addHostAccessRequest?.({ tabId, pattern: url.split("#")[0]! });
    }
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js", "assistant.js"] });
}

export function installAssistant() {
  // Static content scripts only run on navigation. Attach the click listener to BenchQ tabs already open on install or reload.
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.tabs.query({ url: BENCHQ_URL + "/*" }).then(tabs => Promise.allSettled(tabs.map(tab =>
      tab.id !== undefined && tab.url && new URL(tab.url).origin === BENCHQ_URL
        ? chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["source-click.js"] })
        : undefined))).catch(() => undefined);
  });
  const onPage = (details: FrameDetails & { url?: string }) => { void detect(details).catch(() => undefined); };
  chrome.webNavigation.onCompleted.addListener(onPage);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onPage);
  const checkTab = ({ tabId }: { tabId: number }) => {
    void chrome.webNavigation.getAllFrames({ tabId }).then(frames => {
      const page = frames?.find(frame => frame.frameId === 0);
      if (page) onPage({ tabId, ...page });
    }).catch(() => undefined);
  };
  chrome.tabs.onActivated.addListener(checkTab);
  chrome.permissions.onAdded.addListener(() => {
    void chrome.tabs.query({ active: true }).then(tabs => {
      for (const tab of tabs) if (tab.id !== undefined) checkTab({ tabId: tab.id });
    }).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((value, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !value || typeof value !== "object") return false;
    const { windowId } = sender.tab;
    const message = value as Record<string, unknown>;
    if (message.type === "assistant-visible") {
      // Chrome reports a side panel's window as -1, so the panel in this window answers for itself (panel-window.ts).
      void chrome.runtime.sendMessage({ type: "panel-window", windowId }).then(isOpen => respond(isOpen === true), () => respond(false));
    } else if (message.type === "assistant-open") {
      void chrome.sidePanel.open({ windowId }).then(() => respond(true), () => respond(false));
    } else if (message.type === "source-click" && sender.url && new URL(sender.url).origin === BENCHQ_URL && typeof message.url === "string") {
      let source: URL;
      try { source = new URL(message.url); } catch { return false; }
      if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) return false;
      // Consume the trusted click immediately and let Chrome finish opening the panel before switching tabs.
      void chrome.sidePanel.open({ windowId }).catch(() => undefined)
        .then(() => chrome.tabs.create({ windowId, url: source.href })).then(async tab => {
        const jobId = typeof message.jobId === "string" ? message.jobId : undefined;
        const candidateId = typeof message.candidateId === "string" ? message.candidateId : undefined;
        if (tab.id !== undefined && (jobId || candidateId)) await connectSource(tab.id, source, jobId, candidateId).catch(() => undefined);
        respond(true);
      }, () => respond(false));
    } else return false;
    return true;
  });
}
