import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { CandidateInboxSchema, InboxMessageSchema, type CandidateInbox, type InboxMessage } from "@/lib/schemas/inbox";
import inboxSeed from "./data/inbox.json";
import { allCandidates } from "./candidates";
import { findInFirm, inFirm, mockResult, wait } from "./_shared";
import { firmScoped } from "./membership";
import { changed, seededAt, table } from "./db";

const fixture = () =>
  z.object({ messages: arrayOf(InboxMessageSchema), initiallyConnected: z.array(z.string()) }).parse(inboxSeed);

export const allMessages: InboxMessage[] = table("inboxMessages", InboxMessageSchema, () => fixture().messages);

/** Which candidates have a connected inbox, since when. Seeded "12 days before" this browser's seeding instant. */
const ConnectionSchema = z.object({ candidateId: z.string(), connectedAt: z.string().datetime() });
const connections = table("inboxConnections", ConnectionSchema, () =>
  fixture().initiallyConnected.map((candidateId) => ({ candidateId, connectedAt: new Date(seededAt().getTime() - 12 * 86_400_000).toISOString() })),
);
const connectedSince = (candidateId: string) => connections.find((connection) => connection.candidateId === candidateId)?.connectedAt;

function inboxFor(firmId: string, candidateId: string): CandidateInbox {
  const candidate = findInFirm(allCandidates, firmId, candidateId, "Candidate");
  const since = connectedSince(candidateId);
  if (!since) return { firmId: candidate.firmId, connection: null, messages: [] };

  return CandidateInboxSchema.parse({
    firmId: candidate.firmId,
    connection: {
      firmId: candidate.firmId,
      candidateId,
      provider: "GOOGLE",
      address: candidate.email ?? `${candidate.fullName.toLowerCase().replace(/\s+/g, ".")}@gmail.com`,
      connectedAt: since,
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
    const at = new Date().toISOString();
    const existing = connections.find((connection) => connection.candidateId === candidateId);
    if (existing) existing.connectedAt = at;
    else connections.push({ candidateId, connectedAt: at });
    changed("inboxConnections");
    return mockResult(inboxFor(firmId, candidateId));
  },

  disconnect: (firmId: string, candidateId: string): Promise<CandidateInbox> => {
    findInFirm(allCandidates, firmId, candidateId, "Candidate");
    const index = connections.findIndex((connection) => connection.candidateId === candidateId);
    if (index >= 0) connections.splice(index, 1);
    changed("inboxConnections");
    return mockResult(inboxFor(firmId, candidateId));
  },

  markRead: (firmId: string, messageId: string): Promise<InboxMessage> => {
    const message = findInFirm(allMessages, firmId, messageId, "Email");
    message.isRead = true;
    changed("inboxMessages");
    return mockResult(InboxMessageSchema.parse(message));
  },
}, { connect: "candidate.edit", disconnect: "candidate.edit", markRead: "candidate.edit" });
