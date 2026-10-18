import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { CandidateInboxSchema, InboxMessageSchema, type CandidateInbox, type InboxMessage } from "@/lib/schemas/inbox";
import inboxSeed from "./data/inbox.json";
import { candidates } from "./candidates";
import { inDevFirm, mockResult, notFound, wait } from "./_shared";

const seed = z
  .object({ messages: arrayOf(InboxMessageSchema), initiallyConnected: z.array(z.string()) })
  .parse(inboxSeed);

export const allMessages: InboxMessage[] = seed.messages;
const messages: InboxMessage[] = inDevFirm(allMessages);
const connectedAt = new Map<string, string>(
  seed.initiallyConnected.map((candidateId) => [candidateId, new Date(Date.now() - 12 * 86_400_000).toISOString()]),
);

function inboxFor(candidateId: string): CandidateInbox {
  const candidate = candidates.find((item) => item.id === candidateId) ?? notFound("Candidate", candidateId);
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
    messages: messages.filter((message) => message.candidateId === candidateId),
  });
}

export const inboxMock = {
  byCandidate: (candidateId: string): Promise<CandidateInbox> => mockResult(inboxFor(candidateId)),

  connect: async (candidateId: string): Promise<CandidateInbox> => {
    if (!candidates.some((candidate) => candidate.id === candidateId)) return notFound("Candidate", candidateId);
    await wait(500);
    connectedAt.set(candidateId, new Date().toISOString());
    return mockResult(inboxFor(candidateId));
  },

  disconnect: (candidateId: string): Promise<CandidateInbox> => {
    connectedAt.delete(candidateId);
    return mockResult(inboxFor(candidateId));
  },

  markRead: (messageId: string): Promise<InboxMessage> => {
    const message = messages.find((item) => item.id === messageId) ?? notFound("Email", messageId);
    message.isRead = true;
    return mockResult(InboxMessageSchema.parse(message));
  },
};
