import type { CandidateInbox, InboxMessage } from "@/lib/schemas/inbox";
import { http } from "./http";
import { BackendInboxMessageSchema, BackendInboxReviewPageSchema, BackendInboxSchema, toCandidateInbox, toInboxMessage } from "./dto/inbox";
import { toBackendId } from "./dto/demo-ids";
import { z } from "zod";

const AuthorizationUrlSchema = z.object({ authorization_url: z.string().url() });
const SyncResultSchema = z.object({ imported: z.number().int().nonnegative(), inbox: BackendInboxSchema });

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const inboxApi = {
  byCandidate: async (firmId: string, candidateId: string, messageId?: string | null): Promise<CandidateInbox> => toCandidateInbox(
    await http.get(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/inbox`, BackendInboxSchema,
      messageId ? { query: { message_id: toBackendId(messageId), limit: 1 } } : undefined),
  ),

  unmatchedReviews: async (firmId: string): Promise<InboxMessage[]> => {
    const messages: InboxMessage[] = [];
    let total = 0;
    do {
      const page = await http.get(`/api/firms/${toBackendId(firmId)}/inbox/unmatched-reviews`, BackendInboxReviewPageSchema,
        { query: { limit: 200, offset: messages.length } });
      messages.push(...page.messages.map(toInboxMessage));
      total = page.total;
      if (page.messages.length === 0) break;
    } while (messages.length < total);
    return messages;
  },

  connect: async (firmId: string, candidateId: string, returnTo: string): Promise<string> => {
    const result = await http.post(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/mailbox/oauth`, AuthorizationUrlSchema, { body: { return_to: returnTo } });
    return result.authorization_url;
  },

  disconnect: async (firmId: string, candidateId: string): Promise<CandidateInbox> => toCandidateInbox(
    await http.delete(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/mailbox`, BackendInboxSchema),
  ),

  sync: async (firmId: string, candidateId: string): Promise<CandidateInbox> => toCandidateInbox((await http.post(
    `/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/mailbox/sync`, SyncResultSchema,
  )).inbox),

  markRead: async (firmId: string, candidateId: string, messageId: string): Promise<InboxMessage> => toInboxMessage(
    await http.patch(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/inbox-messages/${toBackendId(messageId)}/read`, BackendInboxMessageSchema),
  ),

  reviewMessage: async (firmId: string, candidateId: string, messageId: string, body: {
    application_id: string; status: string; expected_revision: number; review_id?: string;
    expected_review_revision?: number; note?: string | null;
  }): Promise<CandidateInbox> => toCandidateInbox(
    await http.patch(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/inbox-messages/${toBackendId(messageId)}/review`, BackendInboxSchema, { body }),
  ),

  retryClassification: async (firmId: string, candidateId: string, messageId: string): Promise<CandidateInbox> => toCandidateInbox(
    await http.post(`/api/firms/${toBackendId(firmId)}/candidates/${toBackendId(candidateId)}/inbox-messages/${toBackendId(messageId)}/classification/retry`, BackendInboxSchema),
  ),
};
