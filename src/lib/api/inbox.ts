import type { CandidateInbox, InboxMessage } from "@/lib/schemas/inbox";

const mock = () => import("@/mocks/inbox").then((m) => m.inboxMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const inboxApi = {
  byCandidate: async (firmId: string, candidateId: string): Promise<CandidateInbox> => (await mock()).byCandidate(firmId, candidateId),

  connect: async (firmId: string, candidateId: string): Promise<CandidateInbox> => (await mock()).connect(firmId, candidateId),

  disconnect: async (firmId: string, candidateId: string): Promise<CandidateInbox> => (await mock()).disconnect(firmId, candidateId),

  markRead: async (firmId: string, messageId: string): Promise<InboxMessage> => (await mock()).markRead(firmId, messageId),
};
