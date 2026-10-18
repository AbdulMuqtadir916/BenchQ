import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { CandidateInboxSchema, InboxMessageSchema, type CandidateInbox, type InboxMessage } from "@/lib/schemas/inbox";
import inboxSeed from "./data/inbox.json";
import { allCandidates } from "./candidates";
import { findInFirm, inFirm, mockResult, wait } from "./_shared";
import { firmScoped } from "./membership";

const seed = z
  .object({ messages: arrayOf(InboxMessageSchema), initiallyConnected: z.array(z.string()) })
  .parse(inboxSeed);

export const allMessages: InboxMessage[] = seed.messages;
const connectedAt = new Map<string, string>(
  seed.initiallyConnected.map((candidateId) => [candidateId, new Date(Date.now() - 12 * 86_400_000).toISOString()]),
);

function inboxFor(firmId: string, candidateId: string): CandidateInbox {
  const candidate = findInFirm(allCandidates, firmId, candidateId, "Candidate");
  const connectedSince = connectedAt.get(candidateId);
  if (!connectedSince) return { firmId: candidate.firmId, connection: null, messages: [] };

  return CandidateInboxSchema.parse({
    firmId: candidate.firmId,
    connection: {
      firmId: candidate.firmId,
      candidateId,
      provider: "GOOGLE",
      address: candidate.email ?? `${candidate.fullName.toLowerCase().replace(/\s+/g, ".")}@gmail.com`,
      connectedAt: connectedSince,
      lastSyncedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    },
    messages: inFirm(allMessages, firmId).filter((message) => message.candidateId === candidateId),
  });
}

export const inboxMock = firmScoped("inbox", {
  byCandidate: (firmId: string, candidateId: string): Promise<CandidateInbox> => mockResult(inboxFor(firmId, candidateId)),

  connect: async (firmId: string, candidateId: string): Promise<CandidateInbox> => {
    findInFirm(allCandidates, firmId, candidateId, "Candidate");
    await wait(500);
    connectedAt.set(candidateId, new Date().toISOString());
    return mockResult(inboxFor(firmId, candidateId));
  },

  disconnect: (firmId: string, candidateId: string): Promise<CandidateInbox> => {
    findInFirm(allCandidates, firmId, candidateId, "Candidate");
    connectedAt.delete(candidateId);
    return mockResult(inboxFor(firmId, candidateId));
  },

  markRead: (firmId: string, messageId: string): Promise<InboxMessage> => {
    const message = findInFirm(allMessages, firmId, messageId, "Email");
    message.isRead = true;
    return mockResult(InboxMessageSchema.parse(message));
  },
});
