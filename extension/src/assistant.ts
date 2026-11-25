import { BENCHQ_URL, getSavedApplications, getSession } from "./api";
import { connectionFor, connectionKey } from "./autofill/connection-store";

async function connectSource(tabId: number, source: URL, jobId: string, candidateId: string) {
  const { principal } = await getSession();
  if (principal.kind !== "firm" || principal.role !== "BDE") return;
  // The website saves the application concurrently with opening the source link.
  for (const delay of [0, 300, 1000, 2500]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const jobs = await getSavedApplications(candidateId);
    const job = jobs.find(item => item.job_id === jobId && item.candidate_id === candidateId && item.status === "saved");
    if (!job) continue;
    const connection = connectionFor(job, principal.user_id);
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const currentUrl = frames?.find(frame => frame.frameId === 0)?.url;
    if (!connection) return;
    if (!currentUrl || currentUrl === "about:blank") continue;
    if (currentUrl !== source.href && currentUrl !== job.url) return;
    await chrome.storage.session.set({ [connectionKey(tabId)]: { ...connection, tabId, confirmedHosts: [] } });
    return;
  }
}

async function detect({ tabId, frameId, url }: FrameDetails & { url?: string }) {
  if (frameId !== 0 || !url?.startsWith("https://") || new URL(url).origin === BENCHQ_URL) return;
  if (!await chrome.permissions.contains({ origins: [new URL(url).origin + "/*"] })) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js", "assistant.js"] });
}

export function installAssistant() {
  const onPage = (details: FrameDetails & { url?: string }) => { void detect(details).catch(() => undefined); };
  chrome.webNavigation.onCompleted.addListener(onPage);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onPage);
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void chrome.webNavigation.getAllFrames({ tabId }).then(frames => {
      const page = frames?.find(frame => frame.frameId === 0);
      if (page) onPage({ tabId, ...page });
    }).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((value, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !value || typeof value !== "object") return false;
    const { windowId } = sender.tab;
    const message = value as Record<string, unknown>;
    if (message.type === "assistant-visible") {
      void chrome.runtime.getContexts({ windowIds: [windowId], contextTypes: ["SIDE_PANEL"] }).then(list => respond(list.length > 0), () => respond(false));
    } else if (message.type === "assistant-open") {
      void chrome.sidePanel.open({ windowId }).then(() => respond(true), () => respond(false));
    } else if (message.type === "source-click" && sender.url && new URL(sender.url).origin === BENCHQ_URL && typeof message.url === "string") {
      let source: URL;
      try { source = new URL(message.url); } catch { return false; }
      if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) return false;
      void chrome.sidePanel.open({ windowId }).catch(() => undefined);
      void chrome.tabs.create({ windowId, url: source.href }).then(async tab => {
        if (tab.id !== undefined && typeof message.jobId === "string" && typeof message.candidateId === "string") {
          await connectSource(tab.id, source, message.jobId, message.candidateId).catch(() => undefined);
        }
        respond(true);
      }, () => respond(false));
    } else return false;
    return true;
  });
}
