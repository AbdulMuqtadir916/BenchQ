import type { NewConnection, PanelMessage, PanelReply } from "./types";
import type { Application } from "../api";

export const connectionKey = (tabId: number) => `connection:${tabId}`;

/** The BenchQ job a tab was opened for by the website's Open source (assistant.ts): Add job saves that job itself. */
export const sourceJobKey = (tabId: number) => `source-job:${tabId}`;
export async function readSourceJob(tabId: number): Promise<string | null> {
  const value = (await chrome.storage.session.get(sourceJobKey(tabId)))[sourceJobKey(tabId)];
  return typeof value === "string" ? value : null;
}

export const sendToBackground = (message: PanelMessage) => chrome.runtime.sendMessage(message) as Promise<PanelReply>;

export function connectionFor(job: Application, userId: string): NewConnection | null {
  if (!job.url || !job.candidate_id) return null;
  return {
    applicationId: job.id, candidateId: job.candidate_id, userId,
    job: { title: job.title, company: job.company, url: job.url },
  };
}
