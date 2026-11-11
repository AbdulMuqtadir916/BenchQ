import type { NewConnection, PanelMessage, PanelReply } from "./types";
import type { Application } from "../api";

export const connectionKey = (tabId: number) => `connection:${tabId}`;

export const sendToBackground = (message: PanelMessage) => chrome.runtime.sendMessage(message) as Promise<PanelReply>;

export function connectionFor(job: Application, userId: string): NewConnection | null {
  if (!job.url || !job.candidate_id) return null;
  return {
    applicationId: job.id, candidateId: job.candidate_id, userId,
    job: { title: job.title, company: job.company, url: job.url },
  };
}
