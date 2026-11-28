import type { NewConnection, PanelMessage, PanelReply } from "./types";
import type { Application } from "../api";

export const CONNECTION_PREFIX = "connection:";
export const connectionKey = (tabId: number) => `${CONNECTION_PREFIX}${tabId}`;

/** How many times this worker wrote each tab's connection. A write that waited (Open source's lookup) checks that
 * nothing was written since it began, in the same step as its own write, so a job the BDE picked meanwhile wins. */
const writes = new Map<number, number>();
export const connectionWrites = (tabId: number) => writes.get(tabId) ?? 0;
export const countConnectionWrite = (tabId: number) => { writes.set(tabId, connectionWrites(tabId) + 1); };

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
